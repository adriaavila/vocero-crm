import { lookup } from "node:dns/promises";
import type { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { getAiRuntimeConfig } from "@/server/ai/credentials";
import { getBranding } from "@/server/branding";
import { canAutomate } from "@/server/agencia/entitlements";
import {
  asLink,
  borradorSchema,
  borradorSystemPrompt,
  borradorUserPrompt,
  htmlToText,
  isPrivateAddress,
  walledSite,
  type Borrador,
} from "@/server/agencia/borrador-negocio-prompt";

/**
 * Capa de agencia — «Llénalo por mí»: del texto o la web del dueño a un
 * borrador de «Tu negocio». Las reglas del texto viven en
 * `borrador-negocio-prompt.ts`; aquí la red, el cupo y el modelo.
 *
 * Nunca se loguea lo pegado ni lo que devuelve el modelo: es del negocio.
 */

export const BORRADOR_DAILY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const FETCH_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MODEL_TIMEOUT_MS = 30_000;

export type BorradorResult =
  | { ok: true; borrador: Borrador; remaining: number }
  | { ok: false; status: number; code: string; message: string };

type Deps = {
  fetch: typeof fetch;
  resolve: (host: string) => Promise<string[]>;
};

const defaultDeps: Deps = {
  fetch: (...args) => fetch(...args),
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
};

/**
 * Lee el texto de una web pública. Cada salto (incluidas las redirecciones)
 * se resuelve y se rechaza si apunta a una IP privada.
 * ponytail: entre resolver y conectar el DNS podría cambiar (rebinding). El
 * tope es una página de texto con 8 s y 1 MB; para cerrarlo del todo, fijar
 * la IP resuelta en el agente HTTP.
 */
export async function readPublicPage(start: URL, deps: Deps = defaultDeps): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "Ese enlace no es una página web." };
    if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, message: "No pudimos abrir ese enlace." };
    const addresses = await deps.resolve(url.hostname).catch(() => [] as string[]);
    if (addresses.length === 0) return { ok: false, message: "No encontramos esa página. Revisa el enlace." };
    if (addresses.some(isPrivateAddress)) return { ok: false, message: "No pudimos abrir ese enlace." };

    let response: Response;
    try {
      response = await deps.fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "Mozilla/5.0 (compatible; allok-borrador/1.0)" },
      });
    } catch {
      return { ok: false, message: "Tu página tardó demasiado o no respondió." };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return { ok: false, message: "No pudimos abrir ese enlace." };
      url = new URL(next, url);
      continue;
    }
    if (!response.ok) return { ok: false, message: "Tu página no se dejó leer. Pega el texto aquí." };
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return { ok: false, message: "Ese enlace no es una página de texto." };
    const raw = await readCapped(response, FETCH_MAX_BYTES);
    const text = /text\/plain/i.test(type) ? raw : htmlToText(raw);
    if (text.trim().length < 40) return { ok: false, message: "Tu página casi no tiene texto que leer. Pega aquí lo que dirías de tu negocio." };
    return { ok: true, text };
  }
  return { ok: false, message: "Ese enlace redirige demasiadas veces." };
}

async function readCapped(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (size >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

export async function draftNegocio(organizationId: string, input: string, deps: Deps = defaultDeps, now = Date.now()): Promise<BorradorResult> {
  if (!(await canAutomate(organizationId))) {
    return { ok: false, status: 402, code: "billing_inactive", message: "Reactiva tu plan para que te llenemos los datos." };
  }

  // ponytail: en memoria y por proceso, como «Pregúntale a allok». Va antes
  // de leer la web para que el cuadro no sirva para pedir páginas sin tope.
  const key = `borrador-negocio:${organizationId}`;
  const limit = checkRateLimit(key, { windowMs: DAY_MS, max: BORRADOR_DAILY_LIMIT }, now);
  if (!limit.allowed) {
    return { ok: false, status: 429, code: "rate_limited", message: "Ya usaste los borradores de hoy. Mañana puedes pedir otro." };
  }
  const fail = (code: string, message: string, status = 422): BorradorResult => {
    refundRateLimit(key);
    return { ok: false, status, code, message };
  };

  let source = input.trim();
  const link = asLink(source);
  if (link) {
    const walled = walledSite(link);
    if (walled) {
      return fail("walled_site", `${walled} no deja leer su página desde afuera. Copia el texto de tu perfil o descríbelo aquí con tus palabras.`);
    }
    const page = await readPublicPage(link, deps);
    if (!page.ok) return fail("page_unreadable", page.message);
    source = page.text;
  } else if (source.length < 20) {
    return fail("too_short", "Cuéntanos un poco más: qué vendes, precios y dónde estás.");
  }

  const [branding, config, profile] = await Promise.all([
    getBranding(organizationId),
    getAiRuntimeConfig(organizationId),
    getDb()
      .select({ aiProvider: schema.agentProfile.aiProvider })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
  ]);
  const result = await chatJson(
    // El esquema limpia (recorta y vacía lo inválido): su entrada no es su salida.
    borradorSchema as unknown as z.ZodType<Borrador>,
    [
      { role: "system", content: borradorSystemPrompt(branding.name) },
      { role: "user", content: borradorUserPrompt(source) },
    ],
    { provider: profile[0]?.aiProvider, credentials: config.providers, timeoutMs: MODEL_TIMEOUT_MS },
  );
  if (!result.ok) {
    console.error(`[borrador-negocio] el proveedor no respondió (${result.error})`);
    return result.error === "not_configured"
      ? fail("not_configured", "La IA todavía no está configurada en tu espacio.", 409)
      : fail("provider_error", "No pudimos armar el borrador ahora. Prueba de nuevo en un momento.", 503);
  }
  const borrador = result.data;
  if (!borrador.oferta && !borrador.precios && !borrador.zona && borrador.preguntas.length === 0) {
    return fail("nothing_found", "No encontramos datos de tu negocio en eso. Descríbelo aquí con tus palabras.");
  }
  return { ok: true, borrador, remaining: limit.remaining };
}
