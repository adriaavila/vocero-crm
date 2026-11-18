import { apiError } from "@/lib/api";
import type { Fallo } from "./pedidos";

const MENSAJE: Record<Fallo["code"], [number, string]> = {
  no_existe: [404, "Pedido no encontrado"],
  ya_no_se_edita: [409, "Este pedido ya pasó a cocina: no se edita"],
  sin_lineas: [422, "Algo de eso no está en el menú o está agotado"],
  falta_modalidad: [409, "Falta decir si es envío o retiro"],
  transicion: [409, "El pedido ya no está en ese paso"],
};

export function respuestaDeFallo(fallo: Fallo): Response {
  const [status, message] = MENSAJE[fallo.code];
  return apiError(status, fallo.code === "no_existe" ? "not_found" : fallo.code, message);
}
