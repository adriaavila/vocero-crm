import { EventEmitter } from "node:events";

/**
 * Bus de eventos in-process por organización (contrato sse.md).
 * Publicar SIEMPRE después del commit de BD. Una instancia = un proceso,
 * así que un EventEmitter es suficiente (sin colas externas — Constitución II).
 */

export type SseEvent =
  | { type: "message.new"; data: { conversationId: string; message: unknown } }
  | {
      type: "message.status";
      data: {
        conversationId: string;
        messageId: string;
        status: string;
        /** Motivo del fallo, presente solo cuando status = "failed". */
        error?: string | null;
        /**
         * Nea sin estado — la transcripción que acaba de guardar
         * `POST /api/bot/messages/{id}/transcript` (item 10): el mismo
         * evento de "actualización de un mensaje ya en el hilo", solo con
         * este campo además de `status` (que viaja sin cambiar).
         */
        transcript?: string | null;
      };
    }
  | { type: "conversation.updated"; data: { conversation: unknown } }
  /** 015 — algo cambió en la agenda: la pantalla de Citas se refresca sola. */
  | { type: "booking.updated"; data: { bookingId: string } }
  | {
      type: "lab.run";
      data: {
        runId: string;
        status: string;
        progress: { done: number; total: number };
        score?: number | null;
      };
    };

const globalForBus = globalThis as unknown as { __voceroBus?: EventEmitter };

function getBus(): EventEmitter {
  if (!globalForBus.__voceroBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(200);
    globalForBus.__voceroBus = bus;
  }
  return globalForBus.__voceroBus;
}

const globalForVersions = globalThis as unknown as { __voceroOrgVersions?: Map<string, number> };

function versions(): Map<string, number> {
  if (!globalForVersions.__voceroOrgVersions) globalForVersions.__voceroOrgVersions = new Map();
  return globalForVersions.__voceroOrgVersions;
}

/**
 * Cuántos eventos lleva publicados la organización en este proceso: un
 * contador que solo sube. Lo usan las lecturas caras que se repiten en cada
 * pantalla (el estado del logotipo) para saber si su copia sigue vigente sin
 * suscribirse al bus.
 */
export function orgVersion(organizationId: string): number {
  return versions().get(organizationId) ?? 0;
}

export function publish(organizationId: string, event: SseEvent): void {
  versions().set(organizationId, orgVersion(organizationId) + 1);
  getBus().emit(`org:${organizationId}`, event);
}

export function subscribe(
  organizationId: string,
  listener: (event: SseEvent) => void
): () => void {
  const bus = getBus();
  const channel = `org:${organizationId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}
