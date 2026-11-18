import { rechazoParaCliente, resumenParaCliente } from "@/lib/restaurante/pedido";
import { isRestauranteOrg } from "@/server/agencia/vertical";
import type { PrepareOrderAction } from "./accion";
import { armarPedido } from "./pedidos";

/**
 * Fork — vertical restaurante: el turno en que el agente arma un pedido.
 *
 * El modelo solo nombró productos; aquí se buscan en el menú, se guarda el
 * pedido «por confirmar» y se ESCRIBE la respuesta con los precios reales.
 * El texto que vuelve nunca dice «confirmado»: eso lo hace una persona.
 */

/** ¿Este negocio toma pedidos? Decide si el modelo puede nombrar la acción. */
export async function tomaPedidos(organizationId: string): Promise<boolean> {
  try {
    return await isRestauranteOrg(organizationId);
  } catch {
    return false;
  }
}

export async function turnoDePedido(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  isTest: boolean;
  action: PrepareOrderAction;
}): Promise<{ ok: boolean; text: string; summary: string }> {
  const { pedido, rechazos } = await armarPedido({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    isTest: input.isTest,
    lineas: input.action.items.map((i) => ({
      name: i.name,
      quantity: i.quantity ?? 1,
      extras: i.extras,
      note: i.note,
    })),
    mode: input.action.mode,
    address: input.action.address,
    createdBy: "agente",
  });
  if (!pedido) {
    return { ok: false, text: rechazoParaCliente(rechazos), summary: "nada de lo pedido está en el menú" };
  }
  const resumen = resumenParaCliente({
    intro: rechazos.length ? "Lo demás te lo dejé armado:" : input.action.reply,
    lineas: pedido.items.map((i) => ({ ...i, menuItemId: i.menuItemId ?? "" })),
    subtotalCents: pedido.subtotalCents,
    currency: pedido.currency,
    modalidad: pedido.mode,
  });
  return {
    ok: true,
    text: rechazos.length ? `${rechazoSinPregunta(rechazos)}\n${resumen}` : resumen,
    summary: `pedido #${pedido.number} por confirmar`,
  };
}

function rechazoSinPregunta(rechazos: Parameters<typeof rechazoParaCliente>[0]): string {
  return rechazoParaCliente(rechazos).replace(/ ¿Lo cambiamos por otra cosa del menú\?$/, "");
}
