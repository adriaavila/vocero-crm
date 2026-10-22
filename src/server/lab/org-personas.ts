import { isRealtyOrg } from "@/server/agencia/vertical";
import { listProperties } from "@/server/realty/properties";
import { buildRealtyPersonas, PERSONAS, type Persona } from "@/server/lab/personas";

/** El Laboratorio no puede probar a esta agencia todavía (falta cargar algo). */
export class LabNotReadyError extends Error {}

/**
 * Las personas con las que se prueba a ESTA organización: una inmobiliaria
 * se prueba con clientes que preguntan por SUS propiedades; el resto, con las
 * genéricas. Sin propiedades disponibles no hay nada que probar con sentido,
 * y correr igual solo da un rojo que no explica nada: se avisa antes.
 */
export async function personasForOrg(organizationId: string): Promise<Persona[]> {
  if (!(await isRealtyOrg(organizationId))) return PERSONAS;
  const { properties } = await listProperties(organizationId, {
    status: "disponible",
    pageSize: 50,
  });
  const personas = buildRealtyPersonas(properties);
  if (personas.length === 0) {
    throw new LabNotReadyError(
      "Carga al menos una propiedad disponible en Propiedades: el Laboratorio prueba a tu agente con tus propias casas"
    );
  }
  return personas;
}
