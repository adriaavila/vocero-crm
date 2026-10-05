import { embudoPorFuente, type EmbudoConteo, type EmbudoTenant } from "@/server/agencia/embudo";

/**
 * Capa de agencia — el embudo del SaaS arriba de la lista de negocios en
 * /admin: por canal de entrada y por semana de alta. Componente de servidor,
 * sin estado: cuenta la misma lista que ya leyó la página.
 */

const COLUMNAS: { key: keyof EmbudoConteo; label: string }[] = [
  { key: "altas", label: "Altas" },
  { key: "whatsappConectado", label: "WhatsApp conectado" },
  { key: "agenteActivo", label: "Agente activo" },
  { key: "pagando", label: "Pagando" },
  { key: "mrrUsd", label: "MRR" },
];

const SEMANAS_VISIBLES = 8;

function celda(conteo: EmbudoConteo, key: keyof EmbudoConteo): string {
  const value = conteo[key];
  if (key === "mrrUsd") return `US$${value}`;
  if (key === "altas" || conteo.altas === 0) return String(value);
  return `${value} · ${Math.round((value / conteo.altas) * 100)}%`;
}

function Tabla({ titulo, primera, filas }: {
  titulo: string;
  primera: string;
  filas: (EmbudoConteo & { nombre: string })[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="kicker">{titulo}</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-subtle text-xs text-text-3">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{primera}</th>
              {COLUMNAS.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.nombre} className="border-t">
                <th scope="row" className="max-w-[12rem] truncate px-3 py-2 font-medium" title={fila.nombre}>{fila.nombre}</th>
                {COLUMNAS.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right font-mono text-xs tabular-nums text-text-2">{celda(fila, c.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminEmbudo({ tenants }: { tenants: readonly EmbudoTenant[] }) {
  const embudo = embudoPorFuente(tenants);
  if (embudo.total.altas === 0) return null;
  return (
    <section aria-labelledby="embudo-titulo" className="mt-6 rounded-xl border bg-background p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="embudo-titulo" className="text-lg font-semibold tracking-tight">De dónde llegan y cuántos pagan</h2>
        <p className="text-xs text-text-3">
          {embudo.total.altas} altas · {embudo.total.pagando} pagando · MRR US${embudo.total.mrrUsd}
        </p>
      </div>
      <p className="mt-1 text-xs text-text-3">
        Pagando = suscripción de Stripe activa o con cobro por reintentar; la prueba gratis no cuenta.
      </p>
      <div className="mt-4 grid gap-5">
        <Tabla
          titulo="Por canal"
          primera="Canal"
          filas={embudo.porFuente.map(({ fuente, ...conteo }) => ({ nombre: fuente, ...conteo }))}
        />
        <Tabla
          titulo={`Por semana de alta (últimas ${SEMANAS_VISIBLES})`}
          primera="Semana"
          filas={embudo.porSemana.slice(0, SEMANAS_VISIBLES).map(({ semana, ...conteo }) => ({ nombre: semana, ...conteo }))}
        />
      </div>
    </section>
  );
}
