import { apiError } from "@/lib/api";
import { cargarMenuDemo } from "@/server/agencia/restaurante/demo";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { leerMenu } from "@/server/agencia/restaurante/menu";

export const dynamic = "force-dynamic";

/** Carga el menú de ejemplo «Doña Brasa». Solo con el menú vacío. */
export const POST = withRestaurante(async (session) => {
  const cargado = await cargarMenuDemo(session.organizationId);
  if (!cargado) return apiError(409, "not_empty", "Tu menú ya tiene productos");
  return Response.json({ menu: await leerMenu(session.organizationId) }, { status: 201 });
});
