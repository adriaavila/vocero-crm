import { describe, expect, it } from "vitest";
import { textoParaAgente } from "@/lib/medios-agente";

const entra = (over: Partial<Parameters<typeof textoParaAgente>[0]> = {}) => ({
  direction: "in" as const,
  type: "text",
  text: null,
  transcript: null,
  ...over,
});
const medio = (kind: string, over: Record<string, unknown> = {}) => ({
  kind,
  caption: null,
  fileName: null,
  payload: null,
  ...over,
});

describe("textoParaAgente", () => {
  it("el texto pasa tal cual", () => {
    expect(textoParaAgente(entra({ text: "hola" }), null)).toBe("hola");
    expect(textoParaAgente(entra({ text: "  " }), null)).toBeNull();
  });

  it("una nota de voz oída llega como lo que dijo", () => {
    expect(textoParaAgente(entra({ type: "audio", transcript: "atienden el sábado?" }), medio("audio"))).toBe(
      "[Nota de voz] atienden el sábado?",
    );
  });

  it("una nota de voz sin oír le dice al agente qué hacer, no se pierde", () => {
    const t = textoParaAgente(entra({ type: "audio" }), medio("audio"));
    expect(t).toMatch(/no se pudo escuchar/);
    expect(t).toMatch(/escriba/);
  });

  it("la imagen llega con lo que se vio y su pie de foto", () => {
    expect(
      textoParaAgente(entra({ type: "image", transcript: "un comprobante por $450" }), medio("image", { caption: "ya pagué" })),
    ).toBe("[Imagen: un comprobante por $450] ya pagué");
  });

  it("sin descripción, el pie de foto no se pierde", () => {
    expect(textoParaAgente(entra({ type: "image" }), medio("image", { caption: "¿cuánto cuesta esto?" }))).toBe(
      "[Mandó una imagen que no puedes ver] ¿cuánto cuesta esto?",
    );
    expect(textoParaAgente(entra({ type: "image" }), medio("image"))).toMatch(/Pregúntale qué necesita/);
  });

  it("documento, ubicación, contacto y sticker se nombran", () => {
    expect(textoParaAgente(entra({ type: "document" }), medio("document", { fileName: "cotizacion.pdf" }))).toBe(
      "[Documento «cotizacion.pdf»]",
    );
    expect(
      textoParaAgente(entra({ type: "location" }), medio("location", { payload: { latitude: 19.4, longitude: -99.1, name: "Mi casa" } })),
    ).toBe("[Ubicación: Mi casa]");
    expect(textoParaAgente(entra({ type: "location" }), medio("location", { payload: { latitude: 19.4, longitude: -99.1 } }))).toBe(
      "[Ubicación: 19.4, -99.1]",
    );
    expect(
      textoParaAgente(
        entra({ type: "contacts" }),
        medio("contacts", { payload: [{ name: { formatted_name: "Ana" }, phones: [{ phone: "+52 1" }] }] }),
      ),
    ).toBe("[Tarjeta de contacto: Ana +52 1]");
    expect(textoParaAgente(entra({ type: "sticker" }), medio("sticker"))).toBe("[Sticker]");
  });

  it("lo que se le envió también se ve, sin hablar por el cliente", () => {
    expect(textoParaAgente({ ...entra({ type: "image" }), direction: "out" }, medio("image", { caption: "el catálogo" }))).toBe(
      "[Se le envió una imagen] el catálogo",
    );
  });
});
