import type { MenuCompleto } from "@/server/agencia/restaurante/menu";
import type { PedidoVista } from "@/server/agencia/restaurante/pedidos";

export type { MenuCompleto, PedidoVista };

/**
 * Fork — vertical restaurante: llamadas del navegador a `/api/restaurante/*`.
 *
 * `moduloApagado` recuerda el primer 404 `vertical_disabled`: la bandeja monta
 * el panel del pedido en TODAS las conversaciones de TODOS los negocios, y un
 * negocio sin el vertical no debe preguntar otra vez en cada chat.
 */
let moduloApagado = false;

export function restauranteApagado(): boolean {
  return moduloApagado;
}

type Respuesta<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function llamar<T>(url: string, init?: { method: string; body?: unknown }): Promise<Respuesta<T>> {
  if (moduloApagado) return { ok: false, status: 404, message: "" };
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      ...(init?.body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
        : {}),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: { code?: string; message?: string } })
      | null;
    if (!res.ok) {
      if (res.status === 404 && json?.error?.code === "vertical_disabled") moduloApagado = true;
      return { ok: false, status: res.status, message: json?.error?.message ?? "No se pudo. Inténtalo de nuevo." };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, message: "Sin conexión. Inténtalo de nuevo." };
  }
}

/** «12,50» o «12.5» → 1250. null si no es un monto. */
export function aCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}

export function deCentavos(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** «hace 2 min», «hace 1 h». */
export function hace(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}
