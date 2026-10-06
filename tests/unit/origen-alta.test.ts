import { describe, expect, it } from "vitest";
import { fuenteDeOrigen, origenFromMetadata, parseOrigen, ORIGEN_MAX } from "@/lib/origen-alta";
import { origenDesdeNavegador } from "@/components/agencia/origen-alta";

describe("parseOrigen", () => {
  it("se queda solo con las claves de la lista", () => {
    expect(
      parseOrigen({ utm_source: "facebook", utm_medium: "cpc", password: "x", email: "a@b.c", ref: "ana", gclid: "g1" }),
    ).toEqual({ utm_source: "facebook", utm_medium: "cpc", ref: "ana", gclid: "g1" });
  });

  it("recorta y pone tope de 200 a cada valor", () => {
    const largo = "a".repeat(500);
    const origen = parseOrigen({ fbclid: largo, utm_campaign: "  lanzamiento  " });
    expect(origen?.fbclid).toHaveLength(ORIGEN_MAX);
    expect(origen?.utm_campaign).toBe("lanzamiento");
  });

  it("del referente guarda solo el host", () => {
    expect(parseOrigen({ referrer: "https://www.Google.com/search?q=crm+whatsapp" })).toEqual({ referrer: "www.google.com" });
    expect(parseOrigen({ referrer: "l.facebook.com" })).toEqual({ referrer: "l.facebook.com" });
    expect(parseOrigen({ referrer: "no es un host" })).toBeNull();
  });

  it("la página de entrada es una ruta de allok.fun", () => {
    expect(parseOrigen({ landing: "/precios?x=1" })).toEqual({ landing: "/precios" });
    expect(parseOrigen({ landing: "https://allok.fun/clinicas" })).toEqual({ landing: "/clinicas" });
    expect(parseOrigen({ landing: "https://evil.example/x" })).toBeNull();
    expect(parseOrigen({ landing: "//evil.example/x" })).toBeNull();
  });

  it("vacíos, no-texto y entradas que no son objeto → null", () => {
    expect(parseOrigen({ utm_source: "   ", ref: "", gclid: 42, fbclid: { a: 1 } })).toBeNull();
    expect(parseOrigen({})).toBeNull();
    expect(parseOrigen(null)).toBeNull();
    expect(parseOrigen("utm_source=x")).toBeNull();
    expect(parseOrigen(["utm_source"])).toBeNull();
  });

  it("un valor raro no tumba a los demás", () => {
    expect(parseOrigen({ utm_source: "ig", utm_term: 12 })).toEqual({ utm_source: "ig" });
  });
});

describe("fuenteDeOrigen", () => {
  it("UTM, luego referido, luego referente, luego directo", () => {
    expect(fuenteDeOrigen({ utm_source: "Facebook", ref: "ana", referrer: "google.com" })).toBe("facebook");
    expect(fuenteDeOrigen({ ref: "ana", referrer: "google.com" })).toBe("ref:ana");
    expect(fuenteDeOrigen({ referrer: "google.com", landing: "/" })).toBe("google.com");
    expect(fuenteDeOrigen({ landing: "/" })).toBe("directo");
    expect(fuenteDeOrigen(null)).toBe("directo");
  });
});

describe("origenFromMetadata", () => {
  it("lee allok.origen sin tocar billing y limpia lo guardado", () => {
    const raw = JSON.stringify({
      allok: { billing: { plan: "pro" }, origen: { utm_source: "test", basura: "x", at: "2026-10-01T00:00:00.000Z" } },
    });
    expect(origenFromMetadata(raw)).toEqual({ utm_source: "test", at: "2026-10-01T00:00:00.000Z" });
  });

  it("sin origen, sin metadata o JSON roto → null", () => {
    expect(origenFromMetadata(JSON.stringify({ allok: { billing: {} } }))).toBeNull();
    expect(origenFromMetadata(null)).toBeNull();
    expect(origenFromMetadata("{roto")).toBeNull();
  });
});

describe("origenDesdeNavegador (registro)", () => {
  it("toma las claves de la URL, la ruta y el referente ajeno", () => {
    expect(
      origenDesdeNavegador("?utm_source=test&plan=pro&ref=ana", "https://l.instagram.com/x", "https://app.allok.fun", "/register"),
    ).toEqual({ utm_source: "test", ref: "ana", landing: "/register", referrer: "l.instagram.com" });
  });

  it("el referente del mismo sitio no cuenta", () => {
    expect(origenDesdeNavegador("", "https://app.allok.fun/login", "https://app.allok.fun", "/register")).toEqual({ landing: "/register" });
  });
});
