import { z } from "zod";

/**
 * Body de `POST /api/saas/billing/checkout`, en su propio módulo (no dentro
 * de `route.ts`) porque Next.js solo admite exports reconocidos ahí (los
 * verbos HTTP y un puñado de config) — cualquier otro export rompe el build
 * ("no es un campo de Route válido"). Aparte, así se puede probar sin
 * levantar toda la sesión del checkout.
 */
export const checkoutBodySchema = z.object({ plan: z.enum(["basic", "pro", "inmobiliaria"]) });
