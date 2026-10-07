import { z } from "zod";
import { BORRADOR_FAQ_MAX, borradorSchema, type Borrador } from "@/server/agencia/borrador-negocio-prompt";

/**
 * Capa de agencia — la cuenta que nace de una demo del sitio
 * (`allok.fun/demo/<slug>` → `/register?demo=<slug>`) trae lo que esa demo ya
 * sabe del negocio: «Tu negocio» abre lleno, como un borrador de «Llénalo por
 * mí» (solo campos vacíos, nada se guarda sin el botón).
 *
 * Sin modelo: la demo ya leyó la web y podó lo que no estaba en ella; aquí
 * solo se acomoda en los tres campos. El sitio es fijo (`ALLOK_SITE_URL`,
 * allok.fun por defecto) y el slug se valida: no hay URL que ponga el cliente.
 */

export const DEMO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FETCH_TIMEOUT_MS = 6_000;

// Lo largo se recorta, no se rechaza: un servicio de más no tira el resto.
const text = z.string().trim().transform((t) => t.slice(0, 600));
const demoPerfilSchema = z.object({
  businessName: z.string().optional(),
  profile: z.object({
    summary: text.optional().catch(undefined),
    services: z
      .array(z.object({ name: text, price: text.optional().catch(undefined), duration: text.optional().catch(undefined) }))
      .max(30)
      .catch([]),
    hours: z.array(text).max(10).catch([]),
    address: text.optional().catch(undefined),
    booking: text.optional().catch(undefined),
    payment: z.array(text).max(10).catch([]),
    faqs: z.array(z.object({ q: text, a: text })).max(15).catch([]),
  }),
});

export type DemoPerfil = z.infer<typeof demoPerfilSchema>["profile"];

/** Lo que sabe la demo, en los campos de «Tu negocio». Puro. */
export function borradorFromDemo(profile: DemoPerfil): Borrador {
  const serviceNames = profile.services.map((s) => s.name).filter(Boolean);
  const oferta = [
    profile.summary,
    serviceNames.length ? `Servicios: ${serviceNames.join(", ")}.` : "",
    profile.booking ? `Para agendar: ${profile.booking}` : "",
  ].filter(Boolean).join("\n");
  const priced = profile.services.filter((s) => s.price);
  const precios = [
    ...priced.map((s) => `${s.name}: ${s.price}${s.duration ? ` (${s.duration})` : ""}`),
    profile.payment.length ? `Formas de pago: ${profile.payment.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
  const zona = [
    profile.address,
    profile.hours.length ? `Horario: ${profile.hours.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
  return borradorSchema.parse({
    oferta,
    precios,
    zona,
    preguntas: profile.faqs.filter((f) => f.q.length >= 3 && f.a).slice(0, BORRADOR_FAQ_MAX).map((f) => ({ pregunta: f.q, respuesta: f.a })),
  });
}

function siteBase(): string {
  return (process.env.ALLOK_SITE_URL?.trim() || "https://allok.fun").replace(/\/+$/, "");
}

export type DemoImportResult =
  | { ok: true; borrador: Borrador }
  | { ok: false; status: number; code: string; message: string };

/** Trae el perfil de la demo `slug` del sitio y lo acomoda. */
export async function importarDemo(slug: string, doFetch: typeof fetch = fetch): Promise<DemoImportResult> {
  if (!DEMO_SLUG.test(slug) || slug.length > 80) {
    return { ok: false, status: 400, code: "bad_demo", message: "Esa demo no existe." };
  }
  let response: Response;
  try {
    response = await doFetch(`${siteBase()}/api/demo/${slug}/perfil`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, code: "demo_unreachable", message: "No pudimos traer lo que aprendió tu demo. Usa «Llénalo por mí» con tu web." };
  }
  if (response.status === 404) return { ok: false, status: 404, code: "demo_not_found", message: "Esa demo ya no existe." };
  const parsed = demoPerfilSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    return { ok: false, status: 503, code: "demo_unreachable", message: "No pudimos traer lo que aprendió tu demo. Usa «Llénalo por mí» con tu web." };
  }
  const borrador = borradorFromDemo(parsed.data.profile);
  if (!borrador.oferta && !borrador.precios && !borrador.zona && borrador.preguntas.length === 0) {
    return { ok: false, status: 422, code: "nothing_found", message: "Tu demo no traía datos para llenar. Escríbelos abajo." };
  }
  return { ok: true, borrador };
}
