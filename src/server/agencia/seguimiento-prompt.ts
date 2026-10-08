import { z } from "zod";

/**
 * Fork — seguimiento: lo que el modelo recibe además del prompt del agente, y
 * lo que debe devolver. Puro (sin red ni base) para probarlo solo y para que
 * el ai-mock lo reconozca por el marcador.
 */

export const SEGUIMIENTO_MARKER = "[[SEGUIMIENTO]]";

export const seguimientoSchema = z.object({
  send: z.boolean().catch(false),
  text: z.string().trim().max(600).catch(""),
});
export type SeguimientoDecision = z.infer<typeof seguimientoSchema>;

export function seguimientoInstruccion(horas: number): string {
  return `${SEGUIMIENTO_MARKER}
TAREA AHORA: el cliente dejó de contestar hace unas ${horas} horas, después de tu último mensaje. Decide si vale la pena escribirle UNA vez para retomar.

Escríbele (send=true) solo si la conversación quedó abierta: preguntó algo, pidió precio, estaba por agendar o comprar, o le hiciste una pregunta que no contestó.
NO le escribas (send=false, text="") si la conversación terminó: se despidió, dio las gracias y cerró, dijo que no le interesa, ya agendó o compró, pidió que no le escriban, o se habló con una persona del equipo.

Si escribes:
- Un solo mensaje corto (una o dos frases), en el mismo tono y trato (tú/usted) de la conversación.
- Retoma lo concreto que quedó pendiente y ofrece el siguiente paso (resolver su duda, apartar un horario, enviarle algo).
- Sin presión, sin culpa («¿sigues ahí?», «no me has contestado»), sin urgencias falsas ni descuentos que no estén en tu información.
- No inventes datos: usa solo lo que está en tu información y en la conversación.

Responde SOLO un JSON: {"send": true|false, "text": "el mensaje o vacío"}`;
}
