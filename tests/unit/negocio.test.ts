import { describe, expect, it, vi } from "vitest";
import {
  isSuggestedHandoff,
  SUGGESTED_HANDOFF,
  negocioBlockContent,
  negocioFromEntries,
  parseNegocioBlock,
  planNegocioSave,
  postKbEntry,
  type NegocioCurrent,
} from "@/lib/negocio";

const empty: NegocioCurrent = { oferta: null, precios: null, zona: null };
const draft = (overrides: Partial<Record<"oferta" | "precios" | "zona", string>> = {}) => ({
  oferta: "",
  precios: "",
  zona: "",
  ...overrides,
});

describe("bloques de «Tu negocio»", () => {
  it("escribe el rótulo en voz del negocio y se vuelve a leer igual", () => {
    const content = negocioBlockContent("precios", "  El pan va desde $2.  ");
    expect(content).toBe("Precios y cómo cotizamos:\nEl pan va desde $2.");
    expect(parseNegocioBlock(content)).toEqual({ key: "precios", text: "El pan va desde $2." });
  });

  it("un bloque libre cualquiera no es un dato de «Tu negocio»", () => {
    expect(parseNegocioBlock("Horarios: de lunes a viernes")).toBeNull();
    expect(parseNegocioBlock(null)).toBeNull();
  });

  it("encuentra lo ya guardado e ignora las preguntas frecuentes", () => {
    const current = negocioFromEntries([
      { id: "kb_1", kind: "block", question: null, answer: null, content: "Qué hacemos o vendemos:\nPan" },
      { id: "kb_2", kind: "qa", question: "¿Envían?", answer: "Sí", content: null },
      { id: "kb_3", kind: "block", question: null, answer: null, content: "Otro dato suelto" },
    ]);
    expect(current).toEqual({ oferta: { id: "kb_1", text: "Pan" }, precios: null, zona: null });
  });
});

describe("planNegocioSave", () => {
  it("campos vacíos y nada guardado: no hay nada que escribir (no se inventa nada)", () => {
    expect(planNegocioSave(empty, draft())).toEqual([]);
    expect(planNegocioSave(empty, draft({ oferta: "   " }))).toEqual([]);
  });

  it("un dato nuevo crea un bloque con lo que escribió el dueño", () => {
    expect(planNegocioSave(empty, draft({ oferta: "Pan de masa madre" }))).toEqual([
      { type: "create", key: "oferta", content: "Qué hacemos o vendemos:\nPan de masa madre" },
    ]);
  });

  it("solo manda lo que cambió", () => {
    const current: NegocioCurrent = {
      oferta: { id: "kb_1", text: "Pan" },
      precios: { id: "kb_2", text: "Desde $2" },
      zona: null,
    };
    expect(planNegocioSave(current, draft({ oferta: "Pan", precios: "Desde $3", zona: "Chacao" }))).toEqual([
      { type: "update", key: "precios", id: "kb_2", content: "Precios y cómo cotizamos:\nDesde $3" },
      { type: "create", key: "zona", content: "Zona o dirección:\nChacao" },
    ]);
  });

  it("vaciar un campo guardado borra ese dato", () => {
    const current: NegocioCurrent = { oferta: { id: "kb_1", text: "Pan" }, precios: null, zona: null };
    expect(planNegocioSave(current, draft())).toEqual([{ type: "delete", key: "oferta", id: "kb_1" }]);
  });
});

describe("postKbEntry: un guardado que falla no se traga el texto", () => {
  const json = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("ok cuando el servidor guarda", async () => {
    expect(await postKbEntry({ kind: "block", content: "x" }, json(201, { entry: {} }) as never)).toEqual({ ok: true });
  });

  it("devuelve el motivo del servidor, para mostrarlo y conservar el campo", async () => {
    const result = await postKbEntry(
      { kind: "block", content: "x".repeat(9000) },
      json(400, { error: { message: "El texto es demasiado largo" } }) as never,
    );
    expect(result).toEqual({ ok: false, message: "El texto es demasiado largo" });
  });

  it("un fallo de red también es un fallo, con un motivo genérico", async () => {
    const result = await postKbEntry({ kind: "block", content: "x" }, vi.fn(async () => { throw new Error("offline"); }) as never);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/No se pudo guardar/);
  });
});

describe("isSuggestedHandoff: la regla sugerida no es todavía «su regla»", () => {
  it("el texto con el que nace un negocio nuevo es la sugerencia", () => {
    expect(isSuggestedHandoff(SUGGESTED_HANDOFF)).toBe(true);
    expect(isSuggestedHandoff(`  ${SUGGESTED_HANDOFF}\n`)).toBe(true);
  });

  it("los textos con los que nacieron los negocios anteriores también", () => {
    expect(
      isSuggestedHandoff(
        "Pasa la conversación a un humano si el cliente lo solicita, si pide una excepción o decisión que no esté documentada, si hay una queja sensible o si la información necesaria no está en la knowledge base.",
      ),
    ).toBe(true);
  });

  it("lo que el dueño escribió o cambió ya es su regla", () => {
    expect(isSuggestedHandoff("Avísame si piden un descuento.")).toBe(false);
    expect(isSuggestedHandoff(`${SUGGESTED_HANDOFF} También los domingos.`)).toBe(false);
    expect(isSuggestedHandoff("")).toBe(false);
    expect(isSuggestedHandoff(null)).toBe(false);
  });
});
