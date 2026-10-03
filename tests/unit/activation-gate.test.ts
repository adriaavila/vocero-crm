import { describe, expect, it } from "vitest";
import { gateStateFromResponse } from "@/components/agencia/activation-gate";

const blocker = { code: "onboarding_incomplete", step: "probar", title: "Prueba tu agente", detail: "Falta la prueba.", href: "/lab", cta: "Probar" };
const activation = (overrides: Record<string, unknown> = {}) => ({
  enforced: true,
  blockers: [],
  number: null,
  schedule: null,
  handoff: null,
  handoffSuggested: false,
  restrictions: [],
  knowledgeCount: 0,
  ...overrides,
});

describe("gateStateFromResponse: el freno cierra ante la duda", () => {
  it.each([
    ["no hubo respuesta", null],
    ["la respuesta está vacía", {}],
    ["falta la parte de activación", { progress: {} }],
    ["enforced no es un booleano", { activation: activation({ enforced: "sí" }) }],
    ["los bloqueos no son una lista", { activation: activation({ blockers: "nada" }) }],
    ["un bloqueo viene mal formado", { activation: activation({ blockers: [{ code: 3 }] }) }],
  ])("%s → error (no se puede activar)", (_label, payload) => {
    expect(gateStateFromResponse(payload)).toEqual({ kind: "error" });
  });

  it("con bloqueos que el servidor aplica → blocked", () => {
    expect(gateStateFromResponse({ activation: activation({ blockers: [blocker] }) }).kind).toBe("blocked");
  });

  it("sin bloqueos → ready", () => {
    expect(gateStateFromResponse({ activation: activation() }).kind).toBe("ready");
  });

  it("fuera del SaaS los pendientes son consejos → ready, con la lista para mostrar", () => {
    const state = gateStateFromResponse({ activation: activation({ enforced: false, blockers: [blocker] }) });
    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" && state.activation.blockers).toHaveLength(1);
  });
});
