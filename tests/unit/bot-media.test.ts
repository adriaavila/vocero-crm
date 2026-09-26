import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL, Table } from "drizzle-orm";
import type { schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimit } from "@/lib/rate-limit";
import { saveMediaFile } from "@/server/whatsapp/media";
// Estático a propósito (ver bot-profile.test.ts): la ruta nace con los mocks.
import { GET } from "@/app/api/bot/media/[mediaId]/route";

/**
 * GET /api/bot/media/{mediaId}: la copia local de la organización primero,
 * Graph solo cuando no la hay. Auth real (`requireBotKey` +
 * `resolveInstanceOrg` con X-Organization-Id), disco real en un MEDIA_DIR
 * temporal; solo Graph y las credenciales de WhatsApp son falsos.
 */

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { getTableName } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const camel = (col: string) =>
    col.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  // BD falsa que SÍ filtra: evalúa las igualdades del WHERE (`"col" = $n`)
  // contra filas en memoria. Solo entiende igualdades unidas por AND, que es
  // todo lo que consultan la ruta y resolveInstanceOrg.
  const select = () => ({
    from: (table: Table) => ({
      where: (cond: SQL) => ({
        limit: async (n: number) => {
          const { sql, params } = dialect.sqlToQuery(cond);
          const eqs = [...sql.matchAll(/"(\w+)" = \$(\d+)/g)];
          return (db.tables[getTableName(table)] ?? [])
            .filter((row) =>
              eqs.every(
                ([, col = "", i = ""]) => row[camel(col)] === params[Number(i) - 1]
              )
            )
            .slice(0, n);
        },
      }),
    }),
  });
  return { ...actual, getDb: () => ({ select }) };
});

const { getCredentialsByOrg, downloadGraphMedia } = vi.hoisted(() => ({
  getCredentialsByOrg: vi.fn(),
  downloadGraphMedia: vi.fn(),
}));

vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg }));

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/whatsapp/media")>();
  return { ...actual, downloadGraphMedia };
});

type MediaAsset = typeof schema.mediaAsset.$inferSelect;

const KEY = "clave-de-servicio-larga-0123456789abcdef";
const MB = 1024 * 1024;

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  const organizationId = overrides.organizationId ?? "org_a";
  const id = overrides.id ?? "ma_1";
  return {
    id,
    organizationId,
    kind: "audio",
    waMediaId: "wamid.MEDIA",
    mimeType: "audio/ogg; codecs=opus",
    fileName: null,
    fileSize: null,
    caption: null,
    payload: null,
    storagePath: `${organizationId}/${id}`,
    fetchStatus: "available",
    fetchError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Como la ingesta: el archivo al volumen y su fila `available`. */
async function guardarLocal(row: MediaAsset, bytes: Buffer): Promise<void> {
  await saveMediaFile(row.organizationId, row.id, bytes);
  db.tables.media_asset!.push({ ...row, fileSize: bytes.byteLength });
}

function pedir(org: string, mediaId: string, key: string | null = KEY) {
  const headers: Record<string, string> = { "x-organization-id": org };
  if (key) headers["x-api-key"] = key;
  return GET(
    new Request(`http://localhost/api/bot/media/${mediaId}`, { headers }),
    { params: Promise.resolve({ mediaId }) }
  );
}

async function texto(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString();
}

describe("GET /api/bot/media/[mediaId]", () => {
  let mediaDir: string;

  beforeEach(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), "vocero-bot-media-"));
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("MEDIA_DIR", mediaDir);
    vi.stubEnv("BOT_API_KEY", KEY);
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    resetEnvCacheForTests();
    resetRateLimit();
    db.tables = {
      organization: [{ id: "org_a" }, { id: "org_b" }],
      media_asset: [],
    };
    getCredentialsByOrg.mockReset();
    getCredentialsByOrg.mockResolvedValue(null);
    downloadGraphMedia.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvCacheForTests();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it("auth igual que el resto de /api/bot/*: sin key → 401, org desconocida → 409 no_org", async () => {
    expect((await pedir("org_a", "wamid.MEDIA", null)).status).toBe(401);
    const res = await pedir("org_x", "wamid.MEDIA");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_org");
  });

  it("copia local → sus bytes y su content-type, sin WhatsApp conectado y sin tocar Graph", async () => {
    await guardarLocal(asset(), Buffer.from("OggS nota de voz"));

    const res = await pedir("org_a", "wamid.MEDIA");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/ogg; codecs=opus");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await texto(res)).toBe("OggS nota de voz");
    expect(getCredentialsByOrg).not.toHaveBeenCalled();
    expect(downloadGraphMedia).not.toHaveBeenCalled();
  });

  it("aislamiento: la copia de otra organización con el mismo mediaId jamás se sirve", async () => {
    await guardarLocal(
      asset({ id: "ma_b", organizationId: "org_b", mimeType: "image/png" }),
      Buffer.from("secreto de org_b")
    );
    // La fila sí sirve para su dueña: el 'no' de abajo es por el tenant.
    expect(await texto(await pedir("org_b", "wamid.MEDIA"))).toBe("secreto de org_b");

    // Sin copia propia, org_a va a Graph con SU token; nunca recibe la de org_b.
    getCredentialsByOrg.mockImplementation(async (org: string) =>
      org === "org_a" ? { token: "tok_a" } : null
    );
    downloadGraphMedia.mockResolvedValue({
      data: Buffer.from("desde graph"),
      mimeType: "image/jpeg",
      fileSize: 11,
    });
    const res = await pedir("org_a", "wamid.MEDIA");
    expect(res.status).toBe(200);
    expect(await texto(res)).toBe("desde graph");
    expect(downloadGraphMedia).toHaveBeenCalledWith("tok_a", "wamid.MEDIA", 16 * MB);

    // Con copia propia del mismo mediaId (guardada DESPUÉS de la de org_b),
    // cada una recibe la suya: la consulta filtra por tenant, no solo el disco.
    await guardarLocal(
      asset({ id: "ma_a", organizationId: "org_a" }),
      Buffer.from("copia de org_a")
    );
    expect(await texto(await pedir("org_a", "wamid.MEDIA"))).toBe("copia de org_a");
    expect(await texto(await pedir("org_b", "wamid.MEDIA"))).toBe("secreto de org_b");
  });

  it.each([
    ["no hay fila", async () => {}],
    [
      "la descarga sigue en curso y el archivo está a medias",
      async () => {
        await saveMediaFile("org_a", "ma_1", Buffer.from("a med"));
        db.tables.media_asset!.push(asset({ fetchStatus: "pending", storagePath: null }));
      },
    ],
    [
      "la fila dice disponible pero el volumen no tiene el archivo",
      async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        db.tables.media_asset!.push(asset({ fileSize: 10 }));
      },
    ],
  ])("sin copia local (%s) → Graph con el token de la org y el tope de 16 MB", async (_caso, preparar) => {
    await preparar();
    getCredentialsByOrg.mockResolvedValue({ token: "tok_a" });
    downloadGraphMedia.mockResolvedValue({
      data: Buffer.from("desde graph"),
      mimeType: "audio/mpeg",
      fileSize: 11,
    });

    const res = await pedir("org_a", "wamid.MEDIA");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(await texto(res)).toBe("desde graph");
    expect(downloadGraphMedia).toHaveBeenCalledWith("tok_a", "wamid.MEDIA", 16 * MB);
  });

  it("sin copia local y sin WhatsApp conectado → 409 no_connection, como antes", async () => {
    const res = await pedir("org_a", "wamid.MEDIA");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_connection");
    expect(downloadGraphMedia).not.toHaveBeenCalled();
  });

  it("tope de 16 MB por el tamaño real del archivo, no el de la fila, y sin pedir a Graph", async () => {
    await guardarLocal(asset({ id: "ma_justo" }), Buffer.alloc(16 * MB));
    expect((await pedir("org_a", "wamid.MEDIA")).status).toBe(200);

    db.tables.media_asset = [];
    await saveMediaFile("org_a", "ma_grande", Buffer.alloc(16 * MB + 1));
    // La fila trae un tamaño viejo: manda el archivo.
    db.tables.media_asset.push(asset({ id: "ma_grande", fileSize: 10 }));
    const res = await pedir("org_a", "wamid.MEDIA");
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("too_large");

    expect(downloadGraphMedia).not.toHaveBeenCalled();
  });
});
