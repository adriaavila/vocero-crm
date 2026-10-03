import { createHash } from "node:crypto";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookPayload, WebhookValue } from "@/server/inbox/webhook";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import {
  getCredentialsByOrg,
  getCredentialsByPhoneNumberId,
  getCredentialsByWabaId,
} from "@/server/whatsapp/credentials";
import {
  processHistoryValue,
  processSmbAppStateSyncValue,
  type HistoryFieldValue,
  type SmbAppStateSyncValue,
} from "@/server/agencia/whatsapp-signup/history-sync";
import {
  finishRawEvent,
  insertRawEvent,
  listReplayableRawEvents,
  type RawEventRow,
  type RawEventStatus,
} from "@/server/agencia/raw-events-store";

/**
 * Data spine — captura. Cada cambio del webhook se guarda TAL COMO LLEGÓ
 * (`raw_event`) antes de procesarse, y el proceso deja constancia de cómo
 * terminó. Así nada se pierde por un bug, un número aún sin conectar o un
 * estado que llegó antes que su mensaje: se repite con `replayRawEvents`.
 *
 * Lo derivado (message, contact, lead…) sigue naciendo de los mismos
 * procesadores de siempre y es idempotente por `wa_message_id`; este módulo
 * solo decide a cuál llamar, anota el desenlace y reparte reintentos.
 *
 * Ver docs/data-spine.md.
 */

const CHANNEL = "whatsapp";
const TEMPLATE_FIELD = "message_template_status_update";
const UNPARSED_FIELD = "_unparsed";

/** Un `changes[]` del payload de Meta, con el `entry.id` que lo trajo. */
export type WaChange = { entryId: string | null; field: string; value: unknown };

/**
 * Desenlace de procesar un cambio. `failed` aquí es el de un procesador que no
 * lanzó pero tampoco pudo con todo (un echo); un procesador que lanza también
 * deja `failed`, y además pide reintento a Meta (503).
 */
export type RawOutcome = "processed" | "unrouted" | "unmatched" | "ignored" | "failed";

/* ---------- Utilidades puras ---------- */

/** JSON con las llaves ordenadas: el mismo cambio siempre da la misma cadena. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** sha256(field + JSON canónico del value): la llave de dedupe del reintento de Meta. */
export function dedupeKeyFor(field: string, value: unknown): string {
  return createHash("sha256").update(field).update("\n").update(canonicalJson(value)).digest("hex");
}

const NUL = /\u0000/g;
// Sustitutos UTF-16 sueltos: JSON.stringify los escapa y jsonb los rechaza.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * jsonb no admite `\u0000` ni sustitutos sueltos: un mensaje con uno haría
 * fallar el INSERT para siempre y Meta terminaría desactivando el webhook.
 * Lo único que cambia respecto a lo recibido es esa basura.
 */
export function jsonbSafe<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(NUL, "").replace(LONE_SURROGATE, "�") as T;
  }
  if (Array.isArray(value)) return value.map(jsonbSafe) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[jsonbSafe(k)] = jsonbSafe(v);
    return out as T;
  }
  return value;
}

/**
 * Texto corto y seguro para `raw_event.error` y los logs: nombre, código y la
 * primera línea del mensaje. Drizzle envuelve el error del driver y su mensaje
 * trae el SQL con los PARÁMETROS (o sea, el contenido del mensaje): de ese solo
 * se toma la causa.
 */
export function safeErrorText(err: unknown): string {
  let root: unknown = err;
  if (err instanceof Error && err.cause instanceof Error && err.message.startsWith("Failed query:")) {
    root = err.cause;
  }
  if (!(root instanceof Error)) return "unknown_error";
  const code = (root as { code?: unknown }).code;
  const label =
    typeof code === "string" || typeof code === "number" ? `${root.name} ${code}` : root.name;
  const text = `${label}: ${root.message.split("\n")[0] ?? ""}`;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** `entry[].changes[]` aplanado; el orden de llegada se conserva. */
export function extractChanges(payload: unknown): WaChange[] {
  const entries = (payload as WebhookPayload | null)?.entry;
  if (!Array.isArray(entries)) return [];
  const out: WaChange[] = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      out.push({
        entryId: typeof entry?.id === "string" ? entry.id : null,
        field: typeof change?.field === "string" && change.field ? change.field : "unknown",
        value: change?.value ?? null,
      });
    }
  }
  return out;
}

/* ---------- Enrutado ---------- */

type Route = {
  /** phone_number_id (o WABA id en eventos de plantilla). */
  accountRef: string | null;
  organizationId: string | null;
  /** Fallo al enrutar (BD caída…): se vuelve el fallo del procesamiento. */
  error?: unknown;
};

function accountRefFor(change: WaChange): string | null {
  if (change.field === TEMPLATE_FIELD) return change.entryId;
  const id = (change.value as WebhookValue | null)?.metadata?.phone_number_id;
  return typeof id === "string" && id ? id : null;
}

/** Nunca lanza: guardar el evento va primero, aunque no se pueda enrutar. */
async function routeChange(change: WaChange): Promise<Route> {
  const accountRef = accountRefFor(change);
  if (!accountRef) return { accountRef, organizationId: null };
  try {
    const creds =
      change.field === TEMPLATE_FIELD
        ? await getCredentialsByWabaId(accountRef)
        : await getCredentialsByPhoneNumberId(accountRef);
    return { accountRef, organizationId: creds?.organizationId ?? null };
  } catch (error) {
    return { accountRef, organizationId: null, error };
  }
}

/* ---------- Proceso de un cambio ---------- */

async function runChange(
  change: WaChange,
  route: Route,
  rawEventId: string | undefined
): Promise<RawOutcome> {
  if (route.error) throw route.error;
  const value = change.value;
  if (!value || typeof value !== "object") return "ignored";
  const ctx = { rawEventId };

  switch (change.field) {
    case "messages": {
      if (!route.organizationId) return "unrouted";
      const result = await processMessagesValue(value as WebhookValue, ctx);
      return result === "unmatched" ? "unmatched" : "processed";
    }
    case "smb_message_echoes": {
      // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
      if (!route.organizationId) return "unrouted";
      const result = await processEchoesValue(value as WebhookValue, ctx);
      return result === "failed" ? "failed" : "processed";
    }
    case TEMPLATE_FIELD:
      if (!route.organizationId) return "unrouted";
      await processTemplateStatusValue(change.entryId, value as WebhookValue);
      return "processed";
    // Fork — Embedded Signup: estos dos jamás se ven como un mensaje nuevo.
    case "history":
      if (!route.organizationId) return "unrouted";
      await processHistoryValue(value as unknown as HistoryFieldValue);
      return "processed";
    case "smb_app_state_sync":
      if (!route.organizationId) return "unrouted";
      await processSmbAppStateSyncValue(value as unknown as SmbAppStateSyncValue);
      return "processed";
    default:
      return "ignored"; // otros fields: guardados, sin procesar
  }
}

function logLine(stage: string, fields: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v ?? "-"}`);
  return `[spine] ${stage} ${parts.join(" ")}`;
}

/**
 * Procesa UN cambio y deja el desenlace en su `raw_event` (si existe). `retry`
 * es true solo si un procesador lanzó: eso es lo que pide un 503 a Meta.
 */
async function processChange(
  row: RawEventRow | null,
  change: WaChange,
  route: Route
): Promise<{ outcome: RawOutcome; retry: boolean }> {
  const started = Date.now();
  const rev = row?.id ?? "-";
  let outcome: RawOutcome;
  let error: string | null = null;
  let retry = false;
  try {
    outcome = await runChange(change, route, row?.id);
    if (outcome === "failed") error = "echo_ingest_failed";
  } catch (err) {
    outcome = "failed";
    error = safeErrorText(err);
    retry = true;
  }

  if (row) {
    try {
      await finishRawEvent(row.id, {
        status: outcome,
        error,
        organizationId: route.organizationId,
      });
    } catch (err) {
      // El evento se procesó (o falló) igual; solo no quedó anotado.
      console.error(logLine("finish_failed", { rev, err: safeErrorText(err) }));
    }
  }

  const ms = Date.now() - started;
  if (outcome === "failed") console.error(logLine("failed", { rev, err: error }));
  else if (outcome === "unrouted") {
    console.warn(logLine("unrouted", { rev, account: route.accountRef }));
  } else if (outcome === "unmatched") console.warn(logLine("unmatched", { rev, ms }));
  else if (outcome === "ignored") console.log(logLine("ignored", { rev, field: change.field }));
  else console.log(logLine("processed", { rev, ms }));
  return { outcome, retry };
}

/* ---------- Entrada del webhook ---------- */

/** El cuerpo ilegible (o sin cambios) también se guarda: jamás se pierde en silencio. */
async function storeUnparsed(rawBody: string, status: "failed" | "ignored", error: string) {
  try {
    const { row } = await insertRawEvent({
      channel: CHANNEL,
      organizationId: null,
      accountRef: null,
      field: UNPARSED_FIELD,
      dedupeKey: dedupeKeyFor(UNPARSED_FIELD, rawBody),
      payload: jsonbSafe({ body: rawBody }),
      status,
      error,
    });
    console.warn(logLine("stored", { rev: row.id, field: UNPARSED_FIELD, org: null }));
  } catch (err) {
    console.error(logLine("store_failed", { field: UNPARSED_FIELD, err: safeErrorText(err) }));
  }
}

/**
 * Recibe el cuerpo de un POST YA verificado (firma válida): guarda un
 * `raw_event` por cambio, ANTES de procesar nada, y luego procesa en el orden
 * de siempre (`messages` primero).
 *
 *  - Un duplicado (mismo `dedupe_key`) ya `processed` no se vuelve a procesar;
 *    uno en cualquier otro estado sí (Meta reintenta tras nuestro 503).
 *  - Un procesador que lanza deja el evento `failed` y pide reintento
 *    (`retry`); el resto de los cambios se procesan igual (son independientes
 *    e idempotentes).
 *  - Si guardar el evento falla, se procesa de todos modos: perder la copia
 *    cruda es mejor que dejar de atender mensajes.
 */
export async function receiveWhatsAppWebhook(rawBody: string): Promise<{ retry: boolean }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Cuerpo ilegible: 200 igualmente (Meta reintenta y termina desactivando).
    await storeUnparsed(rawBody, "failed", "invalid_json");
    return { retry: false };
  }

  const changes = extractChanges(parsed);
  if (changes.length === 0) {
    await storeUnparsed(rawBody, "ignored", "no_changes");
    return { retry: false };
  }

  type Item = { change: WaChange; route: Route; row: RawEventRow | null };
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const dedupeKey = dedupeKeyFor(change.field, change.value);
    if (seen.has(dedupeKey)) continue; // el mismo cambio dos veces en un POST
    seen.add(dedupeKey);

    const route = await routeChange(change);
    let row: RawEventRow | null = null;
    try {
      const stored = await insertRawEvent({
        channel: CHANNEL,
        organizationId: route.organizationId,
        accountRef: route.accountRef,
        field: change.field,
        dedupeKey,
        payload: jsonbSafe({ entryId: change.entryId, field: change.field, value: change.value }),
      });
      row = stored.row;
      if (stored.created) {
        console.log(
          logLine("stored", { rev: row.id, field: change.field, org: route.organizationId })
        );
      } else if (row.status === "processed") {
        console.log(logLine("duplicate", { rev: row.id, status: row.status }));
        continue; // ya se procesó: nada que repetir
      }
    } catch (err) {
      console.error(logLine("store_failed", { field: change.field, err: safeErrorText(err) }));
    }
    items.push({ change, route, row });
  }

  // `messages` PRIMERO, siempre: la conversación en curso no espera a que
  // termine una importación de historial. El resto, en el orden de llegada.
  const ordered = [
    ...items.filter((i) => i.change.field === "messages"),
    ...items.filter((i) => i.change.field !== "messages"),
  ];
  let retry = false;
  for (const item of ordered) {
    const result = await processChange(item.row, item.change, item.route);
    if (result.retry) retry = true;
  }
  return { retry };
}

/* ---------- Replay ---------- */

export type ReplaySummary = { scanned: number } & Record<RawOutcome, number>;

const DEFAULT_REPLAY_STATUSES: RawEventStatus[] = ["failed", "unrouted", "unmatched"];

/**
 * Vuelve a procesar eventos que no terminaron bien: los que fallaron, los de un
 * número que todavía no estaba conectado y los estados que llegaron antes que su
 * mensaje. Usa el mismo procesador por cambio que el webhook, así que repetir lo
 * ya aplicado no duplica nada (todo es idempotente por `wa_message_id`).
 *
 * Con `organizationId` incluye también los eventos SIN enrutar cuyo
 * `account_ref` es el número (o WABA) de esa organización. OJO: reprocesar
 * `messages` viejos corre la ingesta completa, agente incluido (la ventana de
 * 24 h lo frena si ya pasó).
 */
export async function replayRawEvents(
  opts: {
    organizationId?: string;
    statuses?: RawEventStatus[];
    since?: Date;
    limit?: number;
  } = {}
): Promise<ReplaySummary> {
  const summary: ReplaySummary = {
    scanned: 0,
    processed: 0,
    unrouted: 0,
    unmatched: 0,
    ignored: 0,
    failed: 0,
  };

  let accountRefs: string[] | undefined;
  if (opts.organizationId) {
    const creds = await getCredentialsByOrg(opts.organizationId);
    accountRefs = creds ? [creds.phoneNumberId, creds.wabaId] : [];
  }

  const rows = await listReplayableRawEvents({
    organizationId: opts.organizationId,
    accountRefs,
    statuses: opts.statuses ?? DEFAULT_REPLAY_STATUSES,
    since: opts.since,
    limit: opts.limit ?? 500,
  });

  for (const row of rows) {
    summary.scanned++;
    const stored = row.payload as { entryId?: unknown; field?: unknown; value?: unknown } | null;
    const change: WaChange = {
      entryId: typeof stored?.entryId === "string" ? stored.entryId : null,
      field: row.field,
      value: stored?.value ?? null,
    };
    // Se vuelve a enrutar: el número pudo conectarse después de que llegó.
    const route = await routeChange(change);
    const { outcome } = await processChange(row, change, route);
    summary[outcome]++;
  }
  return summary;
}
