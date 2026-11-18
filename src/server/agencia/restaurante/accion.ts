import { z } from "zod";

/**
 * Fork — vertical restaurante: la acción con la que el agente ARMA un pedido.
 *
 * Solo nombres y cantidades: el precio no existe en este esquema a propósito.
 * Lo pone el servidor desde el menú (`lib/restaurante/pedido`). `reply` es la
 * frase de entrada; el detalle con montos lo escribe el servidor.
 *
 * Sin dependencias de base de datos: `server/ai/actions.ts` lo importa.
 */
export const prepareOrderAction = z.object({
  action: z.literal("prepare_order"),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.coerce.number().optional(),
        extras: z.array(z.string()).optional(),
        note: z.string().optional(),
      })
    )
    .min(1)
    .max(30),
  mode: z.string().optional(),
  address: z.string().optional(),
  reply: z.string().optional(),
});

export type PrepareOrderAction = z.infer<typeof prepareOrderAction>;
