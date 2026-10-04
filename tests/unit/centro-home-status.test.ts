import { describe, expect, it } from "vitest";
import { actionLabel, fmtNumber, homeStatus } from "@/lib/centro";
import type { SystemSnapshot } from "@/lib/estado";

const snapshot = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  state: "activo",
  reason: "Todo en orden. allok contesta por ti.",
  href: null,
  whatsapp: { status: "connected", phone: "+58 412 0000000" },
  waiting: 0,
  working: 0,
  ...over,
});

const base = { billingActive: true, agentOn: true, needsYou: 0, live: 0, closed: 0, productLabel: "allok", owner: true };

describe("la línea bajo el saludo", () => {
  it("sin nadie esperando: todo al día, con el punto «all ok»", () => {
    const s = homeStatus({ ...base, snapshot: snapshot() });
    expect(s.headline).toEqual({ state: "activo", text: "Todo al día. Nadie espera respuesta." });
  });

  it("cuenta las que te necesitan, en singular y plural", () => {
    expect(homeStatus({ ...base, snapshot: snapshot(), needsYou: 1 }).headline).toEqual({
      state: "atencion",
      text: "1 conversación te necesita ahora.",
    });
    expect(homeStatus({ ...base, snapshot: snapshot(), needsYou: 3 }).headline.text).toBe("3 conversaciones te necesitan ahora.");
  });

  it("dice cuántas tienen la ventana cerrada, sin sumarlas a las que te necesitan", () => {
    const s = homeStatus({ ...base, snapshot: snapshot(), needsYou: 2, closed: 4 });
    expect(s.headline.text).toBe("2 conversaciones te necesitan ahora. 4 con la ventana cerrada.");
  });

  it("solo ventanas cerradas: nadie espera con la ventana abierta, y el punto es gris, no verde", () => {
    const s = homeStatus({ ...base, snapshot: snapshot(), closed: 3 });
    expect(s.headline).toEqual({ state: "pausado", text: "Nadie espera con la ventana abierta. 3 con la ventana cerrada." });
  });

  it("si el agente las está contestando, no te necesitan", () => {
    const s = homeStatus({ ...base, snapshot: snapshot(), live: 2 });
    expect(s.headline.state).toBe("atendiendo");
    expect(s.headline.text).toContain("allok está respondiendo 2 conversaciones");
  });

  it("usa el nombre de la marca que le pasan", () => {
    expect(homeStatus({ ...base, snapshot: snapshot(), live: 1, productLabel: "Rei" }).headline.text).toContain("Rei está respondiendo 1 conversación");
  });
});

describe("lo que impide funcionar manda sobre las tarjetas", () => {
  it("sin WhatsApp: la línea es la razón del sistema, y la acción conecta", () => {
    const snap = snapshot({
      state: "atencion",
      reason: "Conecta tu WhatsApp para empezar a atender.",
      href: "/settings/whatsapp",
      whatsapp: { status: "missing", phone: null },
    });
    const s = homeStatus({ ...base, snapshot: snap, needsYou: 5 });
    expect(s.headline).toEqual({ state: "atencion", text: "Conecta tu WhatsApp para empezar a atender." });
    expect(s.strip).toMatchObject({ state: "atencion", reason: null, href: "/settings/whatsapp", actionLabel: "Conectar WhatsApp" });
  });

  it("un miembro (sin enlace) ve el motivo pero ninguna acción", () => {
    const snap = snapshot({ state: "atencion", reason: "Meta cortó el acceso: reconecta tu WhatsApp.", href: null, whatsapp: { status: "reconnect_required", phone: null } });
    const s = homeStatus({ ...base, snapshot: snap });
    expect(s.strip.href).toBeNull();
    expect(s.strip.actionLabel).toBeNull();
  });

  it("con el plan inactivo también manda el sistema", () => {
    const snap = snapshot({ state: "atencion", reason: "Reactiva tu plan para que allok siga contestando.", href: "/settings/billing" });
    const s = homeStatus({ ...base, snapshot: snap, billingActive: false });
    expect(s.headline.text).toMatch(/Reactiva tu plan/);
    expect(s.strip.actionLabel).toBe("Ver mi plan");
  });
});

describe("la tarjeta de estado compacta", () => {
  it("todo en orden: all ok y quién contesta", () => {
    const s = homeStatus({ ...base, snapshot: snapshot() });
    expect(s.strip).toEqual({ state: "activo", reason: "allok contesta por ti.", href: null, actionLabel: null });
  });

  it("con el agente apagado y nada pendiente: pausado, con su única acción", () => {
    const snap = snapshot({ state: "pausado", reason: "El agente está apagado: contestas tú.", href: "/agent" });
    const s = homeStatus({ ...base, snapshot: snap, agentOn: false });
    expect(s.strip).toEqual({ state: "pausado", reason: "El agente está apagado: contestas tú.", href: "/agent", actionLabel: "Encender el agente" });
    // La línea de arriba sigue diciendo que nadie espera.
    expect(s.headline.state).toBe("activo");
  });

  it("el agente apagado se enciende desde la tarjeta aunque el estado de la barra apunte a la bandeja; un miembro no ve la acción", () => {
    const snap = snapshot({ state: "atencion", reason: "2 conversaciones esperan por ti.", href: "/inbox" });
    expect(homeStatus({ ...base, snapshot: snap, agentOn: false, needsYou: 2 }).strip).toMatchObject({ href: "/agent", actionLabel: "Encender el agente" });
    expect(homeStatus({ ...base, snapshot: snap, agentOn: false, needsYou: 2, owner: false }).strip).toMatchObject({ href: null, actionLabel: null });
  });

  it("la tarjeta describe al sistema y nunca repite «Requiere atención» de la línea", () => {
    const s = homeStatus({ ...base, snapshot: snapshot(), needsYou: 2 });
    expect(s.headline.state).toBe("atencion");
    expect(s.strip).toMatchObject({ state: "activo", reason: "allok contesta por ti." });
    const working = homeStatus({ ...base, snapshot: snapshot(), needsYou: 2, live: 1 });
    expect(working.strip).toMatchObject({ state: "atendiendo", reason: "allok está respondiendo ahora." });
  });

  it("al llegar al techo dice «200+», no un número exacto", () => {
    const s = homeStatus({ ...base, snapshot: snapshot(), needsYou: 200, capped: true });
    expect(s.headline.text).toBe("200+ conversaciones te necesitan ahora.");
  });
});

describe("piezas sueltas", () => {
  it("los miles llevan punto", () => {
    expect(fmtNumber(0)).toBe("0");
    expect(fmtNumber(999)).toBe("999");
    expect(fmtNumber(2145)).toBe("2.145");
    expect(fmtNumber(1234567)).toBe("1.234.567");
  });
  it("el botón del estado", () => {
    expect(actionLabel({ href: "/inbox", whatsapp: { status: "connected", phone: null } })).toBe("Abrir conversaciones");
    expect(actionLabel({ href: null, whatsapp: { status: "connected", phone: null } })).toBeNull();
  });
});
