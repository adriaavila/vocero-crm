import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fork — el agente oye notas de voz y ve imágenes: el TURNO REAL de Rei contra
 * Postgres de verdad (se salta sin `REALDB_TEST_DATABASE_URL`). El proveedor de
 * IA es un `fetch` falso que transcribe, describe y contesta con eco de lo
 * último que leyó el agente, para ver qué entendió.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_oir_${SFX}`;
const NOTA = "quería saber si atienden el sábado";
const VISTA = "Comprobante de transferencia por $450";

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  media: typeof import("@/server/whatsapp/media");
  runAgentTurn: typeof import("@/server/ai/pipeline").runAgentTurn;
};
let m: Mod;
const llamadas = { whisper: 0, vista: 0, turnos: [] as string[] };

function proveedorFalso(url: string, init?: RequestInit): Response {
  if (url.endsWith("/v1/audio/transcriptions")) {
    llamadas.whisper++;
    return Response.json({ text: NOTA });
  }
  if (url.endsWith("/v1/chat/completions")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: unknown }[] };
    if (body.messages.some((x) => Array.isArray(x.content))) {
      llamadas.vista++;
      return Response.json({ choices: [{ message: { content: VISTA } }] });
    }
    const ultimo = [...body.messages].reverse().find((x) => x.role === "user")?.content as string;
    llamadas.turnos.push(ultimo);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ action: "reply", text: `ECO: ${ultimo}` }) } }] });
  }
  return new Response("no", { status: 404 });
}

let n = 0;
async function conversacion() {
  const contactId = m.ids.newId("contact");
  const conversationId = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({ id: contactId, organizationId: ORG, waIdentity: `oir${SFX}${n++}`, name: "Lucía" });
  await m.db.insert(m.schema.conversation).values({
    id: conversationId,
    organizationId: ORG,
    contactId,
    isTest: true,
    aiEnabled: true,
    lastInboundAt: new Date(),
  });
  return conversationId;
}

let t = Date.now() - 60_000;
async function mensaje(conversationId: string, v: { direction?: "in" | "out"; type?: string; text?: string; mediaAssetId?: string }) {
  const id = m.ids.newId("message");
  await m.db.insert(m.schema.message).values({
    id,
    organizationId: ORG,
    conversationId,
    direction: v.direction ?? "in",
    type: v.type ?? "text",
    text: v.text ?? null,
    mediaAssetId: v.mediaAssetId ?? null,
    status: "delivered",
    createdAt: new Date((t += 1000)),
  });
  return id;
}

async function adjunto(kind: "audio" | "image", over: { caption?: string; descargado?: boolean } = {}) {
  const id = m.ids.newId("mediaAsset");
  const descargado = over.descargado ?? true;
  const storagePath = descargado ? await m.media.saveMediaFile(ORG, id, Buffer.from(`bytes-${kind}`)) : null;
  await m.db.insert(m.schema.mediaAsset).values({
    id,
    organizationId: ORG,
    kind,
    waMediaId: `wa-${id}`,
    mimeType: kind === "audio" ? "audio/ogg; codecs=opus" : "image/jpeg",
    caption: over.caption ?? null,
    storagePath,
    fetchStatus: descargado ? "available" : "pending",
  });
  return id;
}

async function respuesta(conversationId: string) {
  const rows = await m.db.select().from(m.schema.message).where(m.eq(m.schema.message.conversationId, conversationId));
  return rows.filter((r) => r.direction === "out").sort((a, b) => +a.createdAt - +b.createdAt).at(-1)?.text ?? null;
}

async function transcripcion(id: string) {
  const rows = await m.db.select().from(m.schema.message).where(m.eq(m.schema.message.id, id));
  return rows[0]?.transcript ?? null;
}

describeReal("el agente oye y ve — turno real, Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "oir-verify",
      META_APP_SECRET: "oir-secret",
      META_GRAPH_BASE_URL: "http://graph.invalid",
      MEDIA_DIR: mkdtempSync(path.join(tmpdir(), "oir-")),
      OPENAI_API_KEY: "sk-falsa",
      OPENAI_MODEL: "falso",
      OPENAI_BASE_URL: "http://ia.invalid",
    });
    delete process.env.OPENROUTER_API_TOKEN;
    delete process.env.NEA_DISPATCH_URL;
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith("http://ia.invalid") ? proveedorFalso(url, init) : realFetch(input, init);
    });
    const dbMod = await import("@/lib/db");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: (await import("drizzle-orm")).eq,
      ids: await import("@/lib/db/ids"),
      media: await import("@/server/whatsapp/media"),
      runAgentTurn: (await import("@/server/ai/pipeline")).runAgentTurn,
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
    await m.db.insert(m.schema.agentProfile).values({
      id: m.ids.newId("agentProfile"),
      organizationId: ORG,
      enabled: true,
      name: "Asistente",
      aiProvider: "openai",
    });
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("contesta lo que dijo la nota de voz, no el mensaje anterior, y la guarda", async () => {
    const cv = await conversacion();
    await mensaje(cv, { text: "hola" });
    await mensaje(cv, { direction: "out", text: "¡Hola! ¿En qué te ayudo?" });
    const nota = await mensaje(cv, { type: "audio", mediaAssetId: await adjunto("audio") });
    await m.runAgentTurn(cv);
    expect(await respuesta(cv)).toBe(`ECO: [Nota de voz] ${NOTA}`);
    expect(await transcripcion(nota)).toBe(NOTA);

    // El turno siguiente no la vuelve a pagar.
    const antes = llamadas.whisper;
    await mensaje(cv, { text: "¿y el domingo?" });
    await m.runAgentTurn(cv);
    expect(llamadas.whisper).toBe(antes);
    expect(await respuesta(cv)).toBe("ECO: ¿y el domingo?");
  });

  it("ve la foto y no pierde el pie de foto", async () => {
    const cv = await conversacion();
    const foto = await mensaje(cv, { type: "image", mediaAssetId: await adjunto("image", { caption: "ya pagué" }) });
    await m.runAgentTurn(cv);
    expect(await respuesta(cv)).toBe(`ECO: [Imagen: ${VISTA}] ya pagué`);
    expect(await transcripcion(foto)).toBe(VISTA);
  });

  it("si el audio no se puede bajar, pide que se lo escriban en vez de callar o repetir", async () => {
    const cv = await conversacion();
    await mensaje(cv, { text: "buenas" });
    await mensaje(cv, { direction: "out", text: "¡Buenas!" });
    const nota = await mensaje(cv, { type: "audio", mediaAssetId: await adjunto("audio", { descargado: false }) });
    await m.runAgentTurn(cv);
    expect(await respuesta(cv)).toMatch(/^ECO: \[Mandó una nota de voz que no se pudo escuchar/);
    expect(await transcripcion(nota)).toBeNull();
  });
});
