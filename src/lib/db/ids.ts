import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  leadStageEvent: "lse",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  // 015 — motor de agenda
  calendarSettings: "cal",
  booking: "bk",
  offeredSlot: "ofs",
  zoomCredentials: "zcred",
  googleCredentials: "gcred",
  // 016 — atribución de anuncios
  adAttribution: "att",
  conversionEvent: "cve",
  capiSettings: "capi",
  saasBillingEvent: "sbe",
  saasAdminAudit: "saa",
  agentJob: "aj",
  aiCredential: "aic",
  // Nea sin estado (dispatch v2)
  dispatch: "dsp",
  // Fork — gasto de anuncios cargado a mano (Cloud lo tiene, upstream no).
  adSpend: "asp",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}

/**
 * Id determinista de la respuesta de Nea a UN despacho: mismo
 * (org, conversación, dispatchId, seq) siempre produce el mismo id. Es lo que
 * vuelve idempotente `POST /api/bot/messages` (`ON CONFLICT (id) DO NOTHING`)
 * y lo que deja detectar, en un reintento del turno, si la respuesta ya había
 * llegado y solo se perdió la confirmación HTTP de vuelta — sin eso, un
 * reintento normal duplicaría el mensaje saliente.
 *
 * Formato `msg_` + 20 hex — mismo prefijo y largo que `newId("message")`
 * (nanoid de 20 caracteres), para que un mensaje despachado no se distinga a
 * simple vista de uno con id aleatorio.
 */
export function neaMessageId(
  organizationId: string,
  conversationId: string,
  dispatchId: string,
  seq: number
): string {
  const hash = createHash("sha256")
    .update(`${organizationId}:${conversationId}:${dispatchId}:${seq}`)
    .digest("hex");
  return `msg_${hash.slice(0, 20)}`;
}
