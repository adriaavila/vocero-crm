import { redirect } from "next/navigation";

/**
 * 019 (upstream) — Resultados reemplaza a Analítica en el nav y mide más de
 * lo que esta pantalla media.
 *
 * `/analytics` queda como redirección nada más: NO se borra
 * `src/server/agencia/analitica.ts` ni `AnalyticsClient` (capa de agencia,
 * ingresos) — puede volver a enlazarse si hace falta. Solo se desconecta del
 * nav y de esta ruta.
 */
export default function AnalyticsPage() {
  redirect("/results");
}
