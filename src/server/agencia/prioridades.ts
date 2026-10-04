import { and, desc, eq, gte, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { LIVE_MS, WINDOW_MS, type SystemState } from "@/lib/estado";
import { mediaLabel } from "@/components/inbox/helpers";

/**
 * Capa de agencia (fork) — «Por dónde arrancar»: qué conversaciones esperan
 * por una persona, ordenadas por lo que se pierde si no se atienden. Es la
 * respuesta de Inicio a «¿qué atiendo ahora?». Determinista y de servidor:
 * ningún modelo decide el orden.
 *
 * Candidatas (reales, no archivadas, con un entrante en los últimos 7 días):
 *  - la última palabra es del cliente y nadie contestó después (un saliente
 *    que falló no cuenta; si el agente decidió callar —`none`/`silent`—, tampoco
 *    se espera a nadie). Un traspaso al que el agente ya contestó («te paso con
 *    alguien») cuenta como contestado: es la regla del punto del logotipo.
 *
 * Es LA regla de «esperando»: `getSystemState` (punto, barra, icono) y el
 * encabezado de Inicio salen de aquí, así que nunca discrepan.
 *
 * Orden: con la ventana de 24 h abierta primero, la que menos tiempo tiene;
 * después las cerradas (solo plantilla), la más reciente arriba.
 */

export type PriorityReason = "persona" | "precio" | "anuncio" | "sin_respuesta";

/** Quién tiene la conversación ahora: el agente, que la está contestando, o tú. */
export type PriorityHandler = "agente" | "persona";

export type PriorityCard = {
  conversationId: string;
  contactId: string;
  name: string;
  reason: PriorityReason;
  /** La razón en pocas palabras: «Pidió una persona». */
  reasonLabel: string;
  /** Solo en traspasos: por qué, en palabras llanas. */
  reasonDetail: string | null;
  /** Lo último que dijo el cliente (≤ 90 caracteres). */
  preview: string | null;
  lastInboundAt: string;
  windowOpen: boolean;
  /** Milisegundos que le quedan a la ventana de 24 h (0 = cerrada). */
  remainingMs: number;
  windowLabel: string;
  handler: PriorityHandler;
  state: SystemState;
};

export type Prioridades = {
  /** Las primeras `limit`, ya en orden. */
  cards: PriorityCard[];
  /** Cuántas hay en total (las que no caben van en «Ver todas»). */
  total: number;
  /** Se llegó al techo de lo que se evalúa: `total` es «200+», no un número exacto. */
  capped: boolean;
  /** El estado de cada candidata, para pintar la línea del día con la MISMA regla. */
  stateById: Record<string, SystemState>;
  /** Ventana abierta y le toca a una persona: lo que el encabezado cuenta. */
  needsYou: number;
  /** El agente las está contestando ahora mismo. */
  live: number;
  /** Ventana cerrada: solo se les escribe con plantilla. */
  closed: number;
};

export const PRIORITY_DAYS = 7;
export const PRIORITY_MAX_CARDS = 8;
export const PREVIEW_MAX = 90;
const NAME_MAX = 120;
/** Techo de lo que se evalúa por consulta; con 7 días de margen sobra. */
export const CANDIDATE_CAP = 200;

/* ---------- Piezas puras ---------- */

/**
 * ¿Preguntó el precio? Se mira sin tildes y por palabra entera: «vale» suelto
 * se dejó fuera (en Venezuela es muletilla: «dime, vale») y lo cubre «cuánto».
 *
 * ponytail: una lista de palabras; no entiende «¿y eso me sale caro?», cuenta
 * «cuanto antes» como precio y no mira el contexto de la conversación. El
 * siguiente paso es inteligencia por mensaje (intención del turno), que ya
 * figura como no construido en docs/data-spine.md.
 */
const PRICE_RE = /\b(?:precios?|cuanto|costos?|cuestan?|valen|tarifas?|planes?)\b/;

export function asksPrice(text: string | null | undefined): boolean {
  if (!text) return false;
  const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return PRICE_RE.test(plain);
}

export const REASON_LABEL: Record<PriorityReason, string> = {
  persona: "Pidió una persona",
  precio: "Preguntó el precio",
  anuncio: "Llegó por un anuncio",
  sin_respuesta: "Sin respuesta",
};

/** Por qué pasó a una persona, en palabras llanas (el motivo de `handoff_reason`). */
const HANDOFF_DETAIL: Record<string, string> = {
  modelo: "El agente no supo cómo seguir.",
  error: "La respuesta automática falló.",
  ventana: "La ventana se cerró antes de contestar.",
  hostilidad: "Conversación delicada: mejor la llevas tú.",
};

/** Cuando no fue el cliente quien lo pidió, «Pidió una persona» sería falso. */
function personaLabel(handoffReason: string | null): string {
  return handoffReason === "cliente" || handoffReason === null ? REASON_LABEL.persona : "Pasó a una persona";
}

/**
 * La razón de más peso, en este orden: traspaso pendiente, precio, anuncio
 * (primer contacto sin contestar) y, si nada de eso, sin respuesta.
 */
export function pickReason(i: {
  pendingHandoff: boolean;
  turnText: string | null;
  fromAdUnanswered: boolean;
}): PriorityReason {
  if (i.pendingHandoff) return "persona";
  if (asksPrice(i.turnText)) return "precio";
  if (i.fromAdUnanswered) return "anuncio";
  return "sin_respuesta";
}

/** Lo que le queda a la ventana de 24 h. A las 24:00 en punto ya está cerrada. */
export function windowRemaining(lastInboundAt: Date | string, now: Date | number = Date.now()): number {
  const last = new Date(lastInboundAt).getTime();
  const at = typeof now === "number" ? now : now.getTime();
  return Math.max(0, last + WINDOW_MS - at);
}

export const WINDOW_CLOSED_LABEL = "Ventana cerrada: solo con plantilla";

export function windowLabel(remainingMs: number): string {
  if (remainingMs <= 0) return WINDOW_CLOSED_LABEL;
  const totalMin = Math.floor(remainingMs / 60_000);
  // Con menos de una hora, el verbo cambia: ya no es información, es un aviso.
  if (totalMin < 1) return "Se cierra en menos de 1 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `Se cierra en ${m} min`;
  return m === 0 ? `Quedan ${h} h` : `Quedan ${h} h ${m} min`;
}

/** Corta por caracteres (no por unidades UTF-16: un emoji no se parte). */
export function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

const REASON_RANK: Record<PriorityReason, number> = { persona: 0, precio: 1, anuncio: 2, sin_respuesta: 3 };

/**
 * Abiertas primero, la que se cierra antes arriba; después las cerradas, la
 * que escribió hace menos arriba. Ante un empate, la razón de más peso.
 */
export function sortCards<T extends Pick<PriorityCard, "windowOpen" | "remainingMs" | "lastInboundAt" | "reason" | "conversationId">>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => {
    if (a.windowOpen !== b.windowOpen) return a.windowOpen ? -1 : 1;
    if (a.windowOpen) {
      if (a.remainingMs !== b.remainingMs) return a.remainingMs - b.remainingMs;
    } else if (a.lastInboundAt !== b.lastInboundAt) {
      return a.lastInboundAt < b.lastInboundAt ? 1 : -1;
    }
    const byReason = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    return byReason || a.conversationId.localeCompare(b.conversationId);
  });
}

export type CandidateRow = {
  conversationId: string;
  contactId: string;
  name: string;
  aiEnabled: boolean;
  handoffAt: Date | null;
  handoffReason: string | null;
  lastInboundAt: Date;
  pendingHandoff: boolean;
  hasAd: boolean;
  everReplied: boolean;
  /** Lo que el cliente dijo desde la última respuesta, del más nuevo al más viejo. */
  turn: { text: string | null; type: string }[];
};

/** Un entrante leído de la base (`at`: ms desde epoch, para compararlo con la última respuesta). */
type InboundRow = { text: string | null; type: string; at: number };

/** Texto que se muestra del último entrante: lo escrito, la transcripción o el tipo de adjunto. */
function previewOf(turn: CandidateRow["turn"]): string | null {
  const last = turn[0];
  if (!last) return null;
  const text = last.text?.trim();
  return text ? clip(text, PREVIEW_MAX) : mediaLabel(last.type);
}

/** Las filas candidatas, ya como tarjetas ordenadas. Pura: el `now` entra por parámetro. */
export function buildCards(rows: CandidateRow[], agentOn: boolean, now: Date | number = Date.now()): PriorityCard[] {
  const at = typeof now === "number" ? now : now.getTime();
  const cards = rows.map((r): PriorityCard => {
    const remainingMs = windowRemaining(r.lastInboundAt, at);
    const windowOpen = remainingMs > 0;
    const reason = pickReason({
      pendingHandoff: r.pendingHandoff,
      turnText: r.turn.map((t) => t.text ?? "").join(" ") || null,
      fromAdUnanswered: r.hasAd && !r.everReplied,
    });
    // El agente solo «la tiene» mientras la está contestando (misma regla que
    // el punto: pasados 10 minutos sin respuesta, le toca a una persona).
    const live =
      windowOpen && agentOn && r.aiEnabled && !r.handoffAt && at - r.lastInboundAt.getTime() < LIVE_MS;
    return {
      conversationId: r.conversationId,
      contactId: r.contactId,
      name: clip(r.name, NAME_MAX),
      reason,
      reasonLabel: reason === "persona" ? personaLabel(r.handoffReason) : REASON_LABEL[reason],
      reasonDetail: reason === "persona" ? (HANDOFF_DETAIL[r.handoffReason ?? "cliente"] ?? null) : null,
      preview: previewOf(r.turn),
      lastInboundAt: r.lastInboundAt.toISOString(),
      windowOpen,
      remainingMs,
      windowLabel: windowLabel(remainingMs),
      handler: live ? "agente" : "persona",
      state: !windowOpen ? "pausado" : live ? "atendiendo" : "atencion",
    };
  });
  return sortCards(cards);
}

export function summarize(cards: PriorityCard[], limit = PRIORITY_MAX_CARDS): Prioridades {
  return {
    cards: cards.slice(0, limit),
    total: cards.length,
    capped: cards.length >= CANDIDATE_CAP,
    stateById: Object.fromEntries(cards.map((c) => [c.conversationId, c.state])),
    needsYou: cards.filter((c) => c.windowOpen && c.handler === "persona").length,
    live: cards.filter((c) => c.handler === "agente").length,
    closed: cards.filter((c) => !c.windowOpen).length,
  };
}

/* ---------- Lectura ---------- */

/** La conversación de afuera, con su nombre de tabla ESCRITO (ver `analytics/bot.ts`). */
const cv = {
  id: sql.raw(`"conversation"."id"`),
  org: sql.raw(`"conversation"."organization_id"`),
  handoffAt: sql.raw(`"conversation"."handoff_at"`),
};

const outboundAfterHandoffByPerson = sql`exists (
  select 1 from "message" mh
  where mh."organization_id" = ${cv.org} and mh."conversation_id" = ${cv.id}
    and mh."direction" = 'out' and mh."origin" in ('operator', 'manual') and mh."status" <> 'failed'
    and mh."created_at" > ${cv.handoffAt}
)`;

/** Traspaso sin contestar: pasó a una persona, y ninguna contestó (el desde teléfono ya es una). */
const pendingHandoff: SQL<boolean> = sql<boolean>`(
  ${schema.conversation.handoffAt} is not null
  and ${schema.conversation.handoffReason} is distinct from 'manual_reply'
  and not ${outboundAfterHandoffByPerson}
)`;

const everReplied: SQL<boolean> = sql<boolean>`exists (
  select 1 from "message" mr
  where mr."organization_id" = ${cv.org} and mr."conversation_id" = ${cv.id}
    and mr."direction" = 'out' and mr."status" <> 'failed'
)`;

/** Mismo criterio que la ficha: una publicación (`post`) no cuenta como anuncio. */
const hasAd: SQL<boolean> = sql<boolean>`exists (
  select 1 from "ad_attribution" aa
  where aa."organization_id" = ${cv.org} and aa."conversation_id" = ${cv.id}
    and coalesce(aa."source_type", 'ad') <> 'post'
)`;

/**
 * Esperando a una persona: lo último que dijo el cliente no tiene respuesta
 * posterior. Un saliente que falló no cuenta (el cliente no lo recibió), y si
 * lo último que decidió el agente después de eso fue «no responder» (`none` /
 * `silent`: el «gracias» que cierra una charla), tampoco se espera a nadie. Un
 * traspaso al que el agente ya contestó («te paso con alguien») cuenta como
 * contestado, igual que en el punto del logotipo. Esta es LA regla: el
 * encabezado, el punto, la barra, el icono y la línea del día salen de aquí.
 * Ambas horas son de nuestro reloj (`created_at`), no la de WhatsApp.
 */
const lastInboundCreatedAt = sql`coalesce((
  select max(mi."created_at") from "message" mi
  where mi."organization_id" = ${cv.org} and mi."conversation_id" = ${cv.id} and mi."direction" = 'in'
), '-infinity'::timestamp)`;

const unanswered: SQL<boolean> = sql<boolean>`(
  not exists (
    select 1 from "message" mu
    where mu."organization_id" = ${cv.org} and mu."conversation_id" = ${cv.id}
      and mu."direction" = 'out' and mu."status" <> 'failed'
      and mu."created_at" > ${lastInboundCreatedAt}
  )
  and not coalesce((
    select dn."action" in ('none', 'silent') from "agent_decision" dn
    where dn."organization_id" = ${cv.org} and dn."conversation_id" = ${cv.id}
      and dn."created_at" > ${lastInboundCreatedAt}
    order by dn."created_at" desc limit 1
  ), false)
)`;

const lastOutboundAt = sql<Date | null>`(
  select max(mo."created_at") from "message" mo
  where mo."organization_id" = ${cv.org} and mo."conversation_id" = ${cv.id}
    and mo."direction" = 'out' and mo."status" <> 'failed'
)`.mapWith(schema.message.createdAt);

/**
 * `agentOn`: el agente de este negocio está encendido (el que ya calcula
 * `getCentro`). `now` solo se cambia en las pruebas.
 */
export async function getPrioridades(
  organizationId: string,
  opts: { agentOn: boolean; now?: Date; limit?: number; light?: boolean },
): Promise<Prioridades> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - PRIORITY_DAYS * 86_400_000);
  const c = schema.conversation;
  const ct = schema.contact;

  const candidates = await db
    .select({
      conversationId: c.id,
      contactId: c.contactId,
      name: ct.name,
      aiEnabled: c.aiEnabled,
      handoffAt: c.handoffAt,
      handoffReason: c.handoffReason,
      lastInboundAt: c.lastInboundAt,
      pendingHandoff,
      hasAd,
      everReplied,
      lastOutboundAt,
    })
    .from(c)
    .innerJoin(ct, and(eq(ct.id, c.contactId), eq(ct.organizationId, c.organizationId)))
    .where(
      scoped(
        c.organizationId,
        organizationId,
        eq(c.isTest, false),
        isNull(ct.archivedAt),
        isNotNull(c.lastInboundAt),
        gte(c.lastInboundAt, since),
        unanswered,
        gte(c.lastMessageAt, since),
      ),
    )
    .orderBy(desc(c.lastInboundAt))
    .limit(CANDIDATE_CAP);

  const turns = new Map<string, InboundRow[]>();
  // `light`: solo se necesitan los conteos (el punto), no el texto de las tarjetas.
  if (candidates.length > 0 && !opts.light) {
    const ids = sql.join(
      candidates.map((r) => sql`${r.conversationId}`),
      sql`, `,
    );
    // Hasta 6 entrantes por conversación, los más nuevos: sobra para saber qué
    // pidió y evita traer hilos enteros de las que escriben mucho. La hora sale
    // como epoch: un `timestamp` crudo llega sin zona y `new Date()` lo leería
    // en la del servidor.
    const rows = (await db.execute(sql`
      select conversation_id, text, transcript, type, at_ms from (
        select m.conversation_id, m.text, m.transcript, m.type,
               (extract(epoch from m.created_at) * 1000)::float8 as at_ms,
               row_number() over (partition by m.conversation_id order by m.created_at desc) as rn
        from message m
        where m.organization_id = ${organizationId} and m.direction = 'in'
          and m.conversation_id in (${ids}) and m.created_at >= ${since.toISOString()}::timestamp
      ) t where rn <= 6 order by conversation_id, at_ms desc
    `)) as unknown as { conversation_id: string; text: string | null; transcript: string | null; type: string; at_ms: number }[];
    for (const r of rows) {
      const list = turns.get(r.conversation_id) ?? [];
      list.push({ text: r.text ?? r.transcript, type: r.type, at: Number(r.at_ms) });
      turns.set(r.conversation_id, list);
    }
  }

  const rows: CandidateRow[] = candidates.map((r) => {
    const lastOut = r.lastOutboundAt?.getTime() ?? -Infinity;
    const all = turns.get(r.conversationId) ?? [];
    // «El turno»: lo que dijo desde la última respuesta. Si no hay (un
    // traspaso al que el agente ya contestó), vale el último entrante.
    const sinceReply = all.filter((t) => t.at > lastOut);
    return {
      conversationId: r.conversationId,
      contactId: r.contactId,
      name: r.name,
      aiEnabled: r.aiEnabled,
      handoffAt: r.handoffAt,
      handoffReason: r.handoffReason,
      lastInboundAt: r.lastInboundAt as Date,
      pendingHandoff: r.pendingHandoff,
      hasAd: r.hasAd,
      everReplied: r.everReplied,
      turn: (sinceReply.length > 0 ? sinceReply : all.slice(0, 1)).map(({ text, type }) => ({ text, type })),
    };
  });

  return summarize(buildCards(rows, opts.agentOn, now), opts.limit);
}
