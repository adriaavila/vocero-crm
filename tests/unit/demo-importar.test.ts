import { describe, expect, it } from "vitest";
import { borradorFromDemo, importarDemo, type DemoPerfil } from "@/server/agencia/demo-importar";

const perfil: DemoPerfil = {
  summary: "Clínica dental en Polanco.",
  services: [
    { name: "Limpieza", price: "$600 MXN", duration: "45 min" },
    { name: "Valoración" },
  ],
  hours: ["Lun a Vie 9:00 a 19:00", "Sáb 9:00 a 14:00"],
  address: "Av. Presidente Masaryk 123, Polanco",
  booking: "Por WhatsApp o en la web.",
  payment: ["Efectivo", "Tarjeta"],
  faqs: [
    { q: "¿Atienden niños?", a: "Sí, desde los 4 años." },
    { q: "?", a: "pregunta rota" },
  ],
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("Cuenta que nace de una demo: lo que la demo aprendió va a «Tu negocio»", () => {
  it("acomoda el perfil en los tres campos y las preguntas", () => {
    const b = borradorFromDemo(perfil);
    expect(b.oferta).toContain("Clínica dental en Polanco.");
    expect(b.oferta).toContain("Servicios: Limpieza, Valoración.");
    expect(b.oferta).toContain("Para agendar: Por WhatsApp o en la web.");
    expect(b.precios).toBe("Limpieza: $600 MXN (45 min)\nFormas de pago: Efectivo, Tarjeta.");
    expect(b.zona).toBe("Av. Presidente Masaryk 123, Polanco\nHorario: Lun a Vie 9:00 a 19:00; Sáb 9:00 a 14:00.");
    expect(b.preguntas).toEqual([{ pregunta: "¿Atienden niños?", respuesta: "Sí, desde los 4 años." }]);
  });

  it("un slug raro ni sale a la red", async () => {
    let called = false;
    const r = await importarDemo("../admin", (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 400, code: "bad_demo" });
    expect(called).toBe(false);
  });

  it("pide el perfil al sitio fijo, nunca a otro host", async () => {
    let asked = "";
    await importarDemo("clinica-sonrisa-cdmx", (async (url: string | URL | Request) => {
      asked = String(url);
      return new Response(JSON.stringify({ profile: perfil }), { status: 200 });
    }) as typeof fetch);
    expect(asked).toBe("https://allok.fun/api/demo/clinica-sonrisa-cdmx/perfil");
  });

  it("demo inexistente, sitio caído o respuesta rara degradan con mensaje", async () => {
    expect(await importarDemo("no-existe", fakeFetch(404, {}))).toMatchObject({ ok: false, status: 404 });
    expect(await importarDemo("x", fakeFetch(500, {}))).toMatchObject({ ok: false, status: 503 });
    expect(await importarDemo("x", fakeFetch(200, { nada: true }))).toMatchObject({ ok: false, status: 503 });
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect(await importarDemo("x", down)).toMatchObject({ ok: false, code: "demo_unreachable" });
  });

  it("perfil vacío no llena nada", async () => {
    const r = await importarDemo("vacia", fakeFetch(200, { profile: { services: [], hours: [], payment: [], faqs: [] } }));
    expect(r).toMatchObject({ ok: false, status: 422, code: "nothing_found" });
  });

  it("lo que viene mal formado en un campo no tira los demás", async () => {
    const r = await importarDemo("x", fakeFetch(200, { profile: { summary: "Academia de inglés.", services: "no-es-lista", hours: [], payment: [], faqs: [] } }));
    expect(r.ok && r.borrador.oferta).toBe("Academia de inglés.");
  });
});
