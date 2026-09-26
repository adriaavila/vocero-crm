import { redirect } from "next/navigation";

/**
 * 019 (upstream) — Resultados reemplaza a Analítica en el nav y mide más de
 * lo que esa pantalla medía.
 *
 * `/analytics` queda como redirección nada más. La pantalla vieja (capa de
 * agencia, ingresos) sí se borró — `src/server/agencia/analitica.ts`,
 * `AnalyticsClient` y su guion e2e — porque nada la seguía enlazando y
 * `pnpm test:e2e` (que corre cada `scripts/e2e-*.mjs` por glob) la
 * ejercitaba contra una ruta que ya no existe.
 */
export default function AnalyticsPage() {
  redirect("/results");
}
