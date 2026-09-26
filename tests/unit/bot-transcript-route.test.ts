import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/bot/messages/{id}/transcript` (dispatch v2): transcripción de un
 * entrante de audio/documento/imagen. Alcance por organización, solo esos
 * tipos, y primera escritura gana — un segundo POST nunca pisa lo que ya se
 * guardó, y devuelve lo que de verdad quedó guardado.
 */

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return { ...actual, resolveInstanceOrg: async () => "org_1" };
});

/** Tabla `message` en memoria, keyed por id. */
const messages = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: (proj: Record<string, unknown> | undefined) => {
      // El SELECT de esta ruta siempre filtra por (organizationId, id) o por
      // id solo (el de "quién ganó" tras perder la carrera) — en ambos casos
      // basta resolver por id: el mock guarda una sola organización.
      const c: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "leftJoin"]) c[m] = () => c;
      c.where = (..._args: unknown[]) => c;
      c.limit = () => {
        // Se filtra "manualmente" abajo, en cada test, vía `currentLookupId`.
        // El WHERE real de la ruta exige `organizationId = resolveInstanceOrg()`
        // (mockeado a "org_1") — una fila de otra organización nunca debería
        // devolverse, así que el mock lo respeta para que ese caso sea real.
        const row = currentLookupId ? messages.get(currentLookupId) : undefined;
        if (!row || row.organizationId !== "org_1") return Promise.resolve([]);
        if (proj) {
          const projected: Record<string, unknown> = {};
          for (const key of Object.keys(proj)) projected[key] = row[key];
          return Promise.resolve([projected]);
        }
        return Promise.resolve([row]);
      };
      return c;
    },
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: (proj: Record<string, unknown> | undefined) => {
            const row = currentLookupId ? messages.get(currentLookupId) : undefined;
            // La condición real es `id = X AND transcript IS NULL` — se
            // simula aquí: si ya tiene transcript, el UPDATE no afecta nada.
            if (!row || row.transcript != null) return Promise.resolve([]);
            const updated = { ...row, ...v };
            messages.set(currentLookupId!, updated);
            if (proj) {
              const projected: Record<string, unknown> = {};
              for (const key of Object.keys(proj)) projected[key] = (updated as Record<string, unknown>)[key];
              return Promise.resolve([projected]);
            }
            return Promise.resolve([updated]);
          },
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

/** El id que el SELECT/UPDATE de arriba usa para "encontrar" la fila — lo fija cada test. */
let currentLookupId: string | null = null;

import { resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/bot/messages/[id]/transcript/route";

const KEY = "clave-de-servicio-larga-0123456789abcdef";

function req(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/bot/messages/${id}/transcript`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function seed(id: string, over: Record<string, unknown> = {}) {
  currentLookupId = id;
  messages.set(id, {
    id,
    organizationId: "org_1",
    direction: "in",
    type: "audio",
    transcript: null,
    ...over,
  });
}

describe("POST /api/bot/messages/[id]/transcript", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
    messages.clear();
    currentLookupId = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mensaje inexistente → 404", async () => {
    currentLookupId = "msg_no_existe";
    const res = await POST(req("msg_no_existe", { text: "hola" }), ctx("msg_no_existe"));
    expect(res.status).toBe(404);
  });

  it("mensaje de OTRA organización → 404 (no distingue de 'no existe')", async () => {
    seed("msg_otra_org", { organizationId: "org_2" });
    const res = await POST(req("msg_otra_org", { text: "hola" }), ctx("msg_otra_org"));
    expect(res.status).toBe(404);
    // Y no se le pisó nada: la fila de la otra organización sigue intacta.
    expect(messages.get("msg_otra_org")?.transcript).toBeNull();
  });

  it("mensaje saliente (direction=out) → 404: solo transcribe entrantes", async () => {
    seed("msg_saliente", { direction: "out" });
    const res = await POST(req("msg_saliente", { text: "hola" }), ctx("msg_saliente"));
    expect(res.status).toBe(404);
  });

  it("tipo no transcribible (text) → 404", async () => {
    seed("msg_texto", { type: "text" });
    const res = await POST(req("msg_texto", { text: "hola" }), ctx("msg_texto"));
    expect(res.status).toBe(404);
  });

  it.each(["audio", "document", "image"])("%s entrante → 200, guarda la transcripción", async (type) => {
    seed(`msg_${type}`, { type });
    const res = await POST(req(`msg_${type}`, { text: "transcripción de prueba" }), ctx(`msg_${type}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transcript?: string };
    expect(body.transcript).toBe("transcripción de prueba");
    expect(messages.get(`msg_${type}`)?.transcript).toBe("transcripción de prueba");
  });

  it("primera escritura gana: un segundo POST con OTRO texto no pisa lo ya guardado", async () => {
    seed("msg_audio_2");
    const first = await POST(req("msg_audio_2", { text: "primera transcripción" }), ctx("msg_audio_2"));
    expect((await first.json() as { transcript: string }).transcript).toBe("primera transcripción");

    const second = await POST(req("msg_audio_2", { text: "segunda, no debería quedar" }), ctx("msg_audio_2"));
    expect(second.status).toBe(200);
    const body = (await second.json()) as { transcript?: string };
    expect(body.transcript).toBe("primera transcripción"); // la de antes, no la nueva
    expect(messages.get("msg_audio_2")?.transcript).toBe("primera transcripción");
  });

  it("body vacío → 422 (no guarda nada)", async () => {
    seed("msg_audio_3");
    const res = await POST(req("msg_audio_3", { text: "" }), ctx("msg_audio_3"));
    expect(res.status).toBe(422);
    expect(messages.get("msg_audio_3")?.transcript).toBeNull();
  });

  it("sin API key → 401", async () => {
    seed("msg_audio_4");
    const res = await POST(
      new Request("http://localhost/api/bot/messages/msg_audio_4/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hola" }),
      }),
      ctx("msg_audio_4")
    );
    expect(res.status).toBe(401);
  });
});
