import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isNeaBrain } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import { renderKb } from "@/server/ai/prompts";
import { computeScore, judgeCase } from "@/server/lab/judge";
import type { Persona } from "@/server/lab/personas";
import { personasForOrg } from "@/server/lab/org-personas";
import { nextClientLine } from "@/server/lab/client-sim";
import { getAiRuntimeConfig } from "@/server/ai/credentials";
import { catalogoParaPrompt } from "@/server/agencia/catalogo-agente";

/**
 * Runner del Laboratorio (FR-030/FR-034): corrida en segundo plano DENTRO del
 * proceso (sin cola externa), turnos secuenciales con debounce 0, timeout
 * global (10 minutos; 30 con Nea — un turno despachado puede tardar bastante
 * más que una llamada directa al LLM, con reintentos incluidos), y lock de
 * concurrencia por índice parcial UNIQUE en BD (máx. 1 corrida `running` por
 * organización).
 *
 * Sandbox (FR-031): las conversaciones se crean con is_test=true; el pipeline
 * del agente persiste las respuestas sin tocar la API, y el sender real lanza
 * si algo intenta enviarlas.
 */

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_TIMEOUT_MS_NEA = 30 * 60 * 1000;
const RUN_TIMEOUT_MS_ADAPTIVE = 20 * 60 * 1000;

export class RunConflictError extends Error {}

export async function startRun(
  organizationId: string
): Promise<{ runId: string; total: number }> {
  const db = getDb();
  // Antes de abrir la corrida: si faltan datos para probar con sentido,
  // LabNotReadyError sale al POST como un aviso, no como una corrida en rojo.
  const personas = await personasForOrg(organizationId);
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({ id: newId("testRun"), organizationId, status: "running" })
      .returning();
    runId = inserted[0]!.id;
  } catch (err) {
    // Violación del índice parcial UNIQUE → ya hay una corrida activa.
    if (isUniqueViolation(err)) {
      throw new RunConflictError("Ya hay una corrida en curso");
    }
    throw err;
  }

  await db.insert(schema.agentTestCase).values(
    personas.map((p) => ({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: p.key,
      status: "pending" as const,
    }))
  );

  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  void executeRun(runId, organizationId, personas).catch(async (err) => {
    console.error("[lab] corrida falló:", err);
    await failRun(runId, organizationId, String(err), personas.length);
  });

  return { runId, total: personas.length };
}

async function executeRun(
  runId: string,
  organizationId: string,
  personas: Persona[]
): Promise<void> {
  const controller = new AbortController();
  // El cliente que contesta suma turnos y llamadas: la corrida inmobiliaria
  // tiene más margen para no terminar entera en `failed` con un proveedor lento.
  const adaptive = personas.some((p) => p.goal);
  const timeoutMs = isNeaBrain()
    ? RUN_TIMEOUT_MS_NEA
    : adaptive
      ? RUN_TIMEOUT_MS_ADAPTIVE
      : RUN_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) =>
    (timer = setTimeout(
      () => {
        controller.abort();
        reject(new Error(`timeout de ${Math.round(timeoutMs / 60_000)} minutos superado`));
      },
      timeoutMs
    ))
  );
  try {
    await Promise.race([
      runAllCases(runId, organizationId, personas, controller.signal),
      timeout,
    ]);
  } catch (err) {
    await failRun(runId, organizationId, String(err), personas.length);
  } finally {
    clearTimeout(timer!);
  }
}

async function runAllCases(
  runId: string,
  organizationId: string,
  personas: Persona[],
  signal: AbortSignal
): Promise<void> {
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId))
    .orderBy(asc(schema.agentTestCase.createdAt));

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  const behaviorText = profile
    ? [
        `Nombre: ${profile.name}`,
        profile.tone ? `Tono: ${profile.tone}` : null,
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        profile.escalationRules ? `Escalado: ${profile.escalationRules}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const aiConfig = await getAiRuntimeConfig(organizationId);
  // El juez ve lo mismo que el agente: sin el catálogo no puede comprobar una
  // casa o un precio que el agente sacó de Propiedades.
  const catalogo = personas.some((p) => p.goal)
    ? await catalogoParaPrompt(organizationId)
    : null;
  const judgeKb = catalogo ? `${kbText}\n\n${catalogo}` : kbText;

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    if (signal.aborted) return;
    const persona = personas.find((p) => p.key === testCase.persona);
    if (!persona) continue;

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(eq(schema.agentTestCase.id, testCase.id));

    let transcript: { role: "cliente" | "agente"; text: string }[];
    let conversationId: string;
    let handedOff: boolean;
    try {
      ({ transcript, conversationId, handedOff } = await runConversation(
        organizationId,
        persona,
        signal,
        aiConfig.providers
      ));
    } catch (err) {
      // Un despacho a Nea que agota sus reintentos (o cualquier otro fallo
      // del turno) no debe tumbar la corrida entera: se marca ESTA persona y
      // se sigue con las demás. No hay un status "failed" propio en el
      // esquema — "judge_failed" ya significa "este caso se queda sin
      // veredicto", que es exactamente lo que pasó aquí también.
      console.error(`[lab] turno falló para ${persona.key}:`, err);
      await db
        .update(schema.agentTestCase)
        .set({ status: "judge_failed" })
        .where(eq(schema.agentTestCase.id, testCase.id));
      done += 1;
      publishProgress(organizationId, runId, "running", done, total);
      continue;
    }
    if (signal.aborted) return;

    const outcome = await judgeCase({
      personaKey: persona.key,
      transcript,
      kbText: judgeKb,
      behaviorText,
      expectations: persona.expectations,
      handedOff,
      credentials: aiConfig.providers,
    });
    if (signal.aborted) return;

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.verdict.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.verdict.hallazgos : null,
      })
      .where(eq(schema.agentTestCase.id, testCase.id));

    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
  }

  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  const score = computeScore(finalCases);
  if (signal.aborted) return;

  const completed = await getDb()
    .update(schema.agentTestRun)
    .set({ status: "done", score, finishedAt: new Date() })
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.status, "running")
      )
    )
    .returning({ id: schema.agentTestRun.id });
  if (!completed[0]) return;
  publishProgress(organizationId, runId, "done", done, total, score);
}

/**
 * Conversa contra el agente real; corta al primer handoff. Con guion fijo, las
 * líneas salen tal cual; con `goal`, el cliente simulado contesta lo que el
 * agente le pregunta (`client-sim.ts`).
 */
async function runConversation(
  organizationId: string,
  persona: Persona,
  signal: AbortSignal,
  credentials?: Parameters<typeof nextClientLine>[0]["credentials"]
): Promise<{
  transcript: { role: "cliente" | "agente"; text: string }[];
  conversationId: string;
  /** Terminó porque el agente la pasó a una persona: el juez tiene que saberlo. */
  handedOff: boolean;
}> {
  const db = getDb();

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, persona);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  let transcript: { role: "cliente" | "agente"; text: string }[] = [];
  let handedOff = false;
  for (let turn = 0; ; turn += 1) {
    // El timeout de la corrida (o un cancel) puede llegar a mitad de guion —
    // se revisa ANTES de cada turno, no solo entre personas.
    if (signal.aborted) break;
    const next = await nextClientLine({ persona, turn, transcript, credentials });
    if (!next || signal.aborted) break;
    const line = next.text;
    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: convId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, convId));

    // Turno REAL del agente, secuencial y sin debounce (FR-030).
    await runAgentTurn(convId);

    const convRows = await db
      .select({
        handoffAt: schema.conversation.handoffAt,
        handoffReason: schema.conversation.handoffReason,
      })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convId))
      .limit(1);
    if (convRows[0]?.handoffAt) {
      // Un turno que falló también pausa la conversación, pero eso no lo
      // decidió el agente: para el juez no es un traspaso.
      handedOff = convRows[0].handoffReason !== "error";
      break; // primer handoff → fin del guion
    }
    if (next.done) break;
    // Solo el cliente que contesta necesita leer al agente entre turnos.
    if (persona.goal) transcript = await readTranscript(convId);
  }

  return { conversationId: convId, transcript: await readTranscript(convId), handedOff };
}

async function readTranscript(
  conversationId: string
): Promise<{ role: "cliente" | "agente"; text: string }[]> {
  const messages = await getDb()
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(asc(schema.message.createdAt));
  return messages
    .filter((m) => m.text)
    .map((m) => ({
      role: m.direction === "in" ? ("cliente" as const) : ("agente" as const),
      text: m.text!,
    }));
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      waIdentity: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    // Ídem que en el alta manual: desde 014 el índice único incluye `channel`,
    // y un ON CONFLICT que no lo nombra no corresponde a ningún índice. Sin
    // esto, TODA corrida del Laboratorio muere antes de la primera persona.
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, persona.phone)
      )
    )
    .limit(1);
  return rows[0]!.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: string,
  total: number
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "failed", 0, total);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  publish(organizationId, {
    type: "lab.run",
    data: { runId, status, progress: { done, total }, score },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
