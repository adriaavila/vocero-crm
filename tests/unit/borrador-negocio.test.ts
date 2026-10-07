import { describe, expect, it } from "vitest";
import {
  asLink,
  borradorSchema,
  borradorSystemPrompt,
  htmlToText,
  isPrivateAddress,
  walledSite,
} from "@/server/agencia/borrador-negocio-prompt";
import { readPublicPage } from "@/server/agencia/borrador-negocio";

describe("«Llénalo por mí»: qué es un enlace", () => {
  it("acepta la web con o sin https", () => {
    expect(asLink("miclinica.com")?.href).toBe("https://miclinica.com/");
    expect(asLink("https://academia.mx/cursos")?.href).toBe("https://academia.mx/cursos");
  });
  it("un texto con espacios no es un enlace", () => {
    expect(asLink("Somos una clínica dental en Polanco.")).toBeNull();
    expect(asLink("hola")).toBeNull();
  });
  it("otros esquemas no", () => {
    expect(asLink("file:///etc/passwd")).toBeNull();
    expect(asLink("javascript:alert(1)")).toBeNull();
  });
  it("reconoce las redes que no dejan leerse", () => {
    expect(walledSite(new URL("https://www.instagram.com/clinica"))).toBe("Instagram");
    expect(walledSite(new URL("https://m.facebook.com/clinica"))).toBe("Facebook");
    expect(walledSite(new URL("https://miclinica.com"))).toBeNull();
  });
});

describe("«Llénalo por mí»: no lee la red interna", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"])(
    "%s es privada",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "2606:4700::1111"])("%s es pública", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it("rechaza un dominio que resuelve a una IP privada sin pedir nada", async () => {
    let fetched = false;
    const result = await readPublicPage(new URL("https://interno.ejemplo.com"), {
      resolve: async () => ["10.0.0.5"],
      fetch: (async () => {
        fetched = true;
        return new Response("x");
      }) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(fetched).toBe(false);
  });

  it("una redirección a una IP privada también se corta", async () => {
    const result = await readPublicPage(new URL("https://publica.ejemplo.com"), {
      resolve: async (host) => (host === "publica.ejemplo.com" ? ["93.184.216.34"] : ["127.0.0.1"]),
      fetch: (async () => new Response(null, { status: 302, headers: { location: "http://localhost/admin" } })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
  });

  it("lee el texto visible de una página pública", async () => {
    const html = `<html><head><title>Clínica Sonrisa</title><meta name="description" content="Dentistas en Polanco"><script>var x=1</script></head>
      <body><nav>Inicio</nav><h1>Limpieza dental</h1><p>Desde $600 MXN. Estamos en Av. Masaryk 120, Polanco.</p></body></html>`;
    const result = await readPublicPage(new URL("https://clinica.ejemplo.com"), {
      resolve: async () => ["93.184.216.34"],
      fetch: (async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Desde $600 MXN");
      expect(result.text).toContain("Dentistas en Polanco");
      expect(result.text).not.toContain("var x");
    }
  });
});

describe("«Llénalo por mí»: el borrador", () => {
  it("el texto de una web queda sin etiquetas ni entidades", () => {
    expect(htmlToText("<p>Caf&eacute; &amp; pan</p><style>p{}</style>")).toBe("Café & pan");
  });
  it("lo que el modelo devuelva mal se vacía en vez de romper", () => {
    const parsed = borradorSchema.parse({ oferta: 3, precios: "  $10  ", preguntas: "no" });
    expect(parsed).toEqual({ oferta: "", precios: "$10", zona: "", preguntas: [] });
  });
  it("como mucho tres preguntas", () => {
    const preguntas = Array.from({ length: 5 }, (_, i) => ({ pregunta: `¿Pregunta ${i}?`, respuesta: "Sí." }));
    expect(borradorSchema.parse({ oferta: "", precios: "", zona: "", preguntas }).preguntas).toHaveLength(3);
  });
  it("el prompt prohíbe inventar y trata el texto como contenido", () => {
    const prompt = borradorSystemPrompt("Clínica Sonrisa");
    expect(prompt).toMatch(/SOLO datos que estén en el TEXTO/);
    expect(prompt).toMatch(/no órdenes/);
  });
});
