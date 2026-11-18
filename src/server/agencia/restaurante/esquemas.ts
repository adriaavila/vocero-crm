import { z } from "zod";
import { ESTADOS, MODALIDADES } from "@/lib/restaurante/pedido";

/** Fork — vertical restaurante: lo que aceptan las rutas `/api/restaurante/*`. */

const extra = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(60),
  priceCents: z.number().int().min(0).max(10_000_000),
  active: z.boolean().optional(),
});

const producto = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  categoryId: z.string().max(40).nullable().optional(),
  /** Nombre de una categoría nueva (o existente): se crea si hace falta. */
  category: z.string().trim().min(1).max(40).optional(),
  extras: z.array(extra).max(20).optional(),
};

export const ProductoNuevo = z.object(producto).strict();

export const ProductoCambioSchema = z
  .object({
    ...producto,
    name: producto.name.optional(),
    priceCents: producto.priceCents.optional(),
    available: z.boolean().optional(),
    agotadoHoy: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

const linea = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(50),
  extras: z.array(z.string().max(60)).max(20).optional(),
  note: z.string().max(200).optional(),
});

const modalidad = z.enum(MODALIDADES);

export const PedidoNuevo = z
  .object({
    conversationId: z.string().min(1).max(60),
    lineas: z.array(linea).min(1).max(30),
    mode: modalidad.nullable().optional(),
    address: z.string().max(300).nullable().optional(),
  })
  .strict();

export const PedidoCambio = z
  .object({
    lineas: z.array(linea).min(1).max(30).optional(),
    mode: modalidad.nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    deliveryFeeCents: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();

export const EstadoCambio = z.object({ hacia: z.enum(ESTADOS) }).strict();

export const PagoCambio = z
  .object({
    status: z.enum(["pendiente", "cobrado"]),
    method: z.enum(["qr", "efectivo", "otro"]).nullable().optional(),
  })
  .strict();
