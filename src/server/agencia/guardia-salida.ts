import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  limpiarTexto,
  mensajeAlPasar,
  pideVisita,
  prometeTraspaso,
  reglasPasanVisitas,
} from "@/server/agencia/accion-del-agente";
import {
  DESPEDIDA_SIN_PROHIBIDAS,
  palabrasProhibidas,
  usaProhibida,
} from "@/server/agencia/palabras-prohibidas";

/**
 * Fork — lo que un cerebro EXTERNO (Nea) manda por `/api/bot/messages`,
 * revisado con las mismas reglas que `corregirAccion` aplica al agente
 * interno.
 *
 * En Rei contesta Nea, no el pipeline del CRM: los arreglos de #82 y #84 no le
 * llegaban. En el Laboratorio de SAMER (27-10, nota 64) Nea escribió
 * «inversión y rendimiento», que el dueño prohibió, y «te paso con Marcelo»
 * sin pasarlo. El CRM es el único que ve cada mensaje antes de que salga, así
 * que aquí se cumple lo que el dueño escribió, conteste quien conteste.
 */

export type Revision = {
  /** Lo que sí sale; null si no queda nada que mandar. */
  text: string | null;
  /** Si después de mandarlo la conversación pasa a una persona, y por qué. */
  traspaso: "cliente" | "modelo" | null;
  motivo?: "palabra_prohibida" | "visita_a_persona" | "traspaso_prometido" | "herramienta_en_texto";
};

/** PURA: sin BD. */
export function revisarSalida(input: {
  text: string;
  ultimaDelCliente: string;
  instructions: string | null | undefined;
  escalationRules: string | null | undefined;
}): Revision {
  const alPasar = mensajeAlPasar(input.escalationRules);
  const limpio = limpiarTexto(input.text);

  // Una frase prohibida no sale, aunque el resto esté bien: no hay modelo a
  // quien pedirle que la reescriba, así que la responde una persona.
  if (usaProhibida(limpio.text, palabrasProhibidas(input.instructions))) {
    return { text: alPasar ?? DESPEDIDA_SIN_PROHIBIDAS, traspaso: "modelo", motivo: "palabra_prohibida" };
  }
  if (reglasPasanVisitas(input.escalationRules) && pideVisita(input.ultimaDelCliente)) {
    return {
      text: alPasar ?? "Te paso con una persona del equipo que te va a coordinar la visita. Te escribe por aquí 🙂",
      traspaso: "cliente",
      motivo: "visita_a_persona",
    };
  }
  if (limpio.text && prometeTraspaso(limpio.text)) {
    return { text: limpio.text, traspaso: "modelo", motivo: "traspaso_prometido" };
  }
  if (limpio.traspaso) {
    return { text: limpio.text || alPasar, traspaso: "modelo", motivo: "herramienta_en_texto" };
  }
  if (limpio.text !== input.text.trim()) {
    return { text: limpio.text || null, traspaso: null, motivo: "herramienta_en_texto" };
  }
  return { text: input.text, traspaso: null };
}

/** Lee las reglas del dueño y el último mensaje del cliente, y revisa. */
export async function revisarSalidaDe(
  organizationId: string,
  conversationId: string,
  text: string
): Promise<Revision> {
  const db = getDb();
  const [perfiles, entrantes] = await Promise.all([
    db
      .select({
        instructions: schema.agentProfile.instructions,
        escalationRules: schema.agentProfile.escalationRules,
      })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select({ text: schema.message.text, transcript: schema.message.transcript })
      .from(schema.message)
      .where(
        and(
          scoped(schema.message.organizationId, organizationId),
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "in")
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(1),
  ]);
  const perfil = perfiles[0];
  const ultima = entrantes[0];
  return revisarSalida({
    text,
    ultimaDelCliente: ultima?.text ?? ultima?.transcript ?? "",
    instructions: perfil?.instructions,
    escalationRules: perfil?.escalationRules,
  });
}
