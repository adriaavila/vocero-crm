import type { MessageDto } from "@/lib/types";

/**
 * Funde una página de mensajes con lo que el hilo ya tiene: lo que llega gana
 * (trae el estado más nuevo), nada se duplica y el orden es cronológico, con
 * el id para desempatar dos mensajes del mismo instante.
 */
export function fundirMensajes(actuales: MessageDto[], llegan: MessageDto[]): MessageDto[] {
  if (actuales.length === 0) return llegan;
  const porId = new Map(actuales.map((m) => [m.id, m]));
  for (const m of llegan) porId.set(m.id, m);
  return [...porId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1
  );
}
