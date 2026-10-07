import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

/**
 * El sitio de allok.fun de mentira para el self-test: solo la ruta que lee la
 * cuenta que nace de una demo (`server/agencia/demo-importar.ts`, con
 * `ALLOK_SITE_URL` apuntando aquí). Tras `mockGuard()`: 404 en producción.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { slug } = await ctx.params;
  if (slug !== "clinica-de-prueba") return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    businessName: "Clínica de Prueba",
    website: "https://clinica.example",
    profile: {
      summary: "Clínica dental familiar en la colonia Del Valle.",
      services: [{ name: "Limpieza dental", price: "$650 MXN", duration: "45 min" }],
      hours: ["Lunes a viernes de 9:00 a 19:00"],
      address: "Av. Coyoacán 1200, Del Valle, CDMX",
      payment: ["Efectivo", "Tarjeta"],
      faqs: [{ q: "¿Atienden a niños?", a: "Sí, desde los 4 años." }],
    },
  });
}
