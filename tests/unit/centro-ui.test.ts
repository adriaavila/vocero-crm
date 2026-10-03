import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionesClient } from "@/components/agencia/centro/decisiones";
import { PrioridadesSection } from "@/components/agencia/centro/prioridades";
import { MetricasSection } from "@/components/agencia/centro/metricas";
import { buildCards, summarize, type CandidateRow } from "@/server/agencia/prioridades";
import type { CentroMetricas } from "@/server/agencia/centro-metricas";

/**
 * Lo que se ve según quién mira y cuántos datos hay: un miembro no recibe
 * botones que la API le va a negar, y un negocio sin datos recibe una frase,
 * no ceros.
 */

const decision = {
  id: "dec_1",
  conversationId: "cv_1",
  contactId: "ct_1",
  contactName: "Ana",
  brain: "nea" as const,
  action: "replied",
  handoffReason: null,
  steps: [{ tool: "offer_slots", summary: "Ofreció 2 horarios", ok: true }],
  model: "m",
  promptVersion: "a1b2c3d4e5f6",
  latencyMs: 900,
  inputTokens: null,
  outputTokens: null,
  triggerMessageIds: [],
  replyMessageIds: [],
  triggerPreview: "¿tienen horario el jueves?",
  replyPreview: "Sí, tengo dos horarios",
  verdict: null,
  verdictNote: null,
  verdictBy: null,
  verdictAt: null,
  createdAt: "2026-10-03T17:00:00.000Z",
};

const render = (canJudge: boolean, initial = [decision], filter: "todas" | "sin-revisar" | "fallos" = "todas") =>
  renderToStaticMarkup(
    createElement(DecisionesClient, {
      initial,
      nextCursor: null,
      filter,
      conversationId: null,
      onFirstPage: true,
      canJudge,
      timezone: "America/Caracas",
      productLabel: "allok",
    }),
  );

describe("cómo decidió: quién califica", () => {
  it("el propietario ve Bien y Falló y los atajos de teclado", () => {
    const html = render(true);
    expect(html).toContain("Bien</button>");
    expect(html).toContain("Falló");
    expect(html).toContain("mover");
  });

  it("un miembro lee, pero no ve botones que la API le negaría", () => {
    const html = render(false);
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain("<kbd");
    expect(html).toContain("Solo el propietario califica");
    // Lo que sí ve: el turno entero.
    expect(html).toContain("¿tienen horario el jueves?");
    expect(html).toContain("Respondió · ofreció 2 horarios");
    expect(html).toContain("prompt a1b2c3d4e5f6");
  });

  it("sin decisiones: una frase por filtro, no una tabla vacía", () => {
    expect(render(true, [], "todas")).toContain("Todavía no hay decisiones");
    expect(render(true, [], "sin-revisar")).toContain("No hay nada sin revisar");
    expect(render(true, [], "fallos")).toContain("No marcaste ningún fallo");
  });
});

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  conversationId: "cv_1",
  contactId: "ct_1",
  name: "Ana",
  aiEnabled: false,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(Date.now() - 3 * 3_600_000),
  pendingHandoff: false,
  hasAd: false,
  everReplied: false,
  turn: [{ text: "hola", type: "text" }],
  ...over,
});

describe("por dónde arrancar", () => {
  it("cada tarjeta tiene una sola acción y abre su conversación", () => {
    const data = summarize(buildCards([row()], false));
    const html = renderToStaticMarkup(createElement(PrioridadesSection, { data, productLabel: "allok", connected: true }));
    expect(html).toContain('href="/inbox?contact=ct_1"');
    expect(html).toContain(">Responder<");
    expect(html).toContain("Tú atiendes");
    expect(html).toContain("Quedan 21 h");
    expect(html).toContain('href="/decisiones"');
  });

  it("sin nada por atender, una frase; sin WhatsApp, otra", () => {
    const empty = summarize([]);
    expect(renderToStaticMarkup(createElement(PrioridadesSection, { data: empty, productLabel: "allok", connected: true }))).toContain("Nada por atender");
    expect(renderToStaticMarkup(createElement(PrioridadesSection, { data: empty, productLabel: "allok", connected: false }))).toContain("Conecta tu WhatsApp");
  });

  it("una ventana cerrada lo dice con la frase de la plantilla", () => {
    const data = summarize(buildCards([row({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })], false));
    const html = renderToStaticMarkup(createElement(PrioridadesSection, { data, productLabel: "allok", connected: true }));
    expect(html).toContain("Ventana cerrada: solo con plantilla");
  });
});

const metricas = (over: Partial<CentroMetricas> = {}): CentroMetricas => ({
  period: "7d",
  from: "2026-09-27",
  to: "2026-10-03",
  timezone: "America/Caracas",
  granularity: "day",
  current: "2026-10-03",
  hasActivity: true,
  conversations: { total: 0, series: [] },
  leads: { total: 0 },
  replies: { ai: 0, owner: 0 },
  ...over,
});

describe("cómo va", () => {
  const html = (m: CentroMetricas) =>
    renderToStaticMarkup(createElement(MetricasSection, { metricas: m, funnel: [], pro: true, owner: true, productLabel: "allok" }));

  it("un negocio sin un solo mensaje no recibe ceros: recibe una frase y sin selector de periodo", () => {
    const out = html(metricas({ hasActivity: false }));
    expect(out).toContain("Todavía no hay datos que contar");
    expect(out).not.toContain('aria-label="Periodo"');
    expect(out).not.toContain(">0<");
  });

  it("con actividad pero un periodo en silencio, cada cifra lo dice con palabras", () => {
    const out = html(metricas());
    expect(out).toContain("Nadie escribió en este periodo");
    expect(out).toContain("Sin leads nuevos en este periodo");
    expect(out).toContain("Todavía no hay respuestas en este periodo");
  });

  it("el periodo vive en la URL y marca el activo", () => {
    const out = html(metricas({ period: "30d" }));
    expect(out).toContain('href="/overview?p=hoy"');
    expect(out).toContain('href="/overview?p=90d"');
    expect(out).toMatch(/aria-current="true"[^>]*>30 días</);
  });

  it("IA y tú, con miles en punto", () => {
    const out = html(metricas({ replies: { ai: 35, owner: 2145 } }));
    expect(out).toContain("IA 35");
    expect(out).toContain("tú 2.145");
  });
});
