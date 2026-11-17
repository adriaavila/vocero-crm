/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: number;
  phoneNumberId: string;
  to: string;
  type: string;
  body: unknown;
  at: string;
  /**
   * Id que se le devolvió al CRM. Lo expone el outbox para que un self-test
   * pueda mandarle un webhook de estado a ESE mensaje sin adivinar el formato.
   */
  waMessageId?: string;
};

export type MockTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  body: string;
  /** Componentes tal cual los mandó el CRM: Meta valida aquí los `example`. */
  components?: unknown[];
};

/**
 * 016 — Un evento de Conversions API que el CRM le mandó al mock. El self-test
 * lo inspecciona para verificar la FORMA del payload: el modo de fallar de ese
 * endpoint es un 200 con `events_received: 0`, donde un campo mal puesto se ve
 * idéntico a uno bien puesto.
 */
export type CapiMockEvent = {
  n: number;
  datasetId: string;
  eventName: string;
  ctwaClid: string | null;
  customData: Record<string, unknown> | null;
  body: unknown;
  at: string;
};

/**
 * Fork — Embedded Signup en la app: cada `POST {phone}/smb_app_data`. Meta no
 * tiene un GET para releer esto, así que el self-test lo verifica por aquí
 * (mismo patrón que `capiEvents`/`outbox`).
 */
export type MockSmbAppDataRequest = {
  n: number;
  phoneNumberId: string;
  syncType: "history" | "smb_app_state_sync";
  requestId: string;
  at: string;
};

/**
 * La suscripción de la app a una WABA (`{WABA}/subscribed_apps`), con su
 * override de callback si alguien lo configuró. Existe para que el self-test
 * pueda comprobar que guardar la conexión NO borra el override de un cerebro
 * externo: en Meta, un POST sin cuerpo lo elimina, y el mock hace lo mismo.
 * El alta guiada del fork (Embedded Signup) relee aquí el override que fijó.
 */
export type MockWabaSubscription = {
  overrideCallbackUri: string | null;
};

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  capiEvents: CapiMockEvent[];
  /** Por WABA ID. Sin entrada = la app no está suscrita a esa WABA. */
  wabaSubscriptions: Record<string, MockWabaSubscription>;
  counter: number;
  // Fork — Embedded Signup en la app.
  registeredPhones: Set<string>;
  smbAppDataRequests: MockSmbAppDataRequest[];
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

function freshState(counter = 0): WaMockState {
  return {
    outbox: [],
    templates: [],
    capiEvents: [],
    wabaSubscriptions: {},
    counter,
    registeredPhones: new Set(),
    smbAppDataRequests: [],
  };
}

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = freshState();
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  // El CONTADOR no se reinicia. El sello de arranque protege de reiniciar el
  // servidor, pero no de correr el self-test dos veces contra la misma base:
  // el segundo `_reset` volvía a emitir `…out.<sello>.1`, que ya existía, y el
  // envío moría con un 500 por el UNIQUE de `wa_message_id`. Se leía como un
  // fallo del producto y no lo era.
  globalForMock.__waMockState = freshState(globalForMock.__waMockState?.counter ?? 0);
}

export function nextN(): number {
  return ++getWaMockState().counter;
}

/**
 * Sello único por arranque del proceso. Sin él, el contador del mock reinicia
 * al reiniciar `pnpm dev` y vuelve a emitir `wamid.mock.out.1`, que choca con
 * el UNIQUE de `wa_message_id` en la BD de una corrida anterior (500 al
 * enviar). No es un fallo del producto: la idempotencia hace su trabajo.
 */
const boot = Math.random().toString(36).slice(2, 8);

export function nextOutboundWamid(): string {
  return `wamid.mock.out.${boot}.${nextN()}`;
}

/** Lo mismo para lo que «llega» (entrantes y ecos): sin el sello, la segunda corrida tras reiniciar se descarta como duplicado. */
export function nextMockWamid(kind: "in" | "echo"): string {
  return `wamid.mock.${kind}.${boot}.${nextN()}`;
}
