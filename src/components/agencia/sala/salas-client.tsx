"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatoMonto, validarPlan, type PasoPlan } from "@/lib/sala-cuotas";
import { palabrasProhibidas } from "@/lib/sala-palabras";

type Sala = {
  id: string;
  contactId: string;
  nombre: string;
  url: string;
  aperturas: number;
  motivo: string | null;
  ultimaAperturaAt: string | null;
};
type Plan = {
  id: string;
  nombre: string;
  reserva: number;
  mesEntrega: number;
  pasos: PasoPlan[];
  aprobadoPor: string;
};

/** El plan más común de una preventa, para no arrancar de una hoja en blanco. */
const PLANTILLA: PasoPlan[] = [
  { tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 30, mes: 0 },
  { tipo: "unico", etiqueta: "Saldo contra entrega", porcentaje: 70, mes: 6 },
];

/**
 * Fork — salas de venta. Arriba, a quién llamar hoy y por qué; abajo, todas
 * las salas y los planes de pago que aprobó la constructora.
 */
export function SalasClient() {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [llamar, setLlamar] = useState<Sala[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    const [rSalas, rPlanes] = await Promise.all([fetch("/api/salas"), fetch("/api/salas/planes")]);
    if (rSalas.ok) {
      const json = (await rSalas.json()) as { salas: Sala[]; llamarHoy: Sala[] };
      setSalas(json.salas);
      setLlamar(json.llamarHoy);
    }
    if (rPlanes.ok) setPlanes(((await rPlanes.json()) as { planes: Plan[] }).planes);
    setCargando(false);
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6">
      <header>
        <p className="kicker">Salas de venta</p>
        <h1 className="mt-1 font-serif text-3xl">
          {llamar.length > 0
            ? `${llamar.length === 1 ? "Este está listo" : `Estos ${llamar.length} están listos`}: llámalos hoy`
            : "Nadie para llamar todavía"}
        </h1>
        <p className="mt-2 text-sm text-text-3">
          Cada comprador tiene un link con sus casas y lo que le quedaría pagando. Aquí aparecen
          los que lo abrieron, usaron la calculadora o pidieron visita en los últimos días.
        </p>
      </header>

      {llamar.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-3">
          {llamar.map((s) => (
            <li key={s.id} className="rounded-[var(--radius-lg)] border border-brand bg-brand-tint p-4">
              <p className="font-semibold">{s.nombre}</p>
              <p className="mt-1 text-sm text-text-2">{s.motivo}</p>
              <a href={`/inbox?contact=${s.contactId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-text">
                <Phone className="h-3.5 w-3.5" /> Abrir conversación
              </a>
            </li>
          ))}
        </ol>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Todas las salas ({salas.length})</h2>
        {cargando ? (
          <p className="text-sm text-text-3">Cargando…</p>
        ) : salas.length === 0 ? (
          <p className="text-sm text-text-3">
            Todavía no hay salas. Ármala desde el panel de un contacto en la bandeja, con «Armar su sala».
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {salas.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{s.nombre}</span>
                  <span className="text-text-3">
                    {s.motivo ?? (s.aperturas === 0 ? "Todavía no la abre" : `La abrió ${s.aperturas} ${s.aperturas === 1 ? "vez" : "veces"}`)}
                  </span>
                </span>
                <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 text-text-3 hover:text-foreground">
                  Ver sala
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlanesDePago planes={planes} onCambio={recargar} />
    </div>
  );
}

function PlanesDePago({ planes, onCambio }: { planes: Plan[]; onCambio: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [reserva, setReserva] = useState("3000");
  const [mesEntrega, setMesEntrega] = useState("6");
  const [aprobadoPor, setAprobadoPor] = useState("");
  const [pasos, setPasos] = useState<PasoPlan[]>(PLANTILLA);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const plan = {
    nombre,
    reserva: Number(reserva) || 0,
    mesEntrega: Number(mesEntrega) || 0,
    pasos,
  };
  const prohibidas = palabrasProhibidas([nombre, ...pasos.map((p) => p.etiqueta)].join(" "));
  const errores = [
    ...validarPlan(plan),
    ...(prohibidas.length > 0 ? [`No uses ${prohibidas.map((p) => `«${p}»`).join(", ")}: la constructora no puede decirlo sin aprobación legal`] : []),
  ];

  function cambiarPaso(i: number, cambio: Partial<PasoPlan>) {
    setPasos((prev) => prev.map((p, j) => (j === i ? ({ ...p, ...cambio } as PasoPlan) : p)));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/salas/planes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...plan, aprobadoPor }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        setError(json?.error?.message ?? "No se pudo guardar el plan");
        return;
      }
      setAbierto(false);
      setNombre("");
      setAprobadoPor("");
      setPasos(PLANTILLA);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  }

  async function archivar(id: string) {
    await fetch(`/api/salas/planes/${id}`, { method: "DELETE" });
    await onCambio();
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Planes de pago</h2>
        {!abierto && (
          <Button size="sm" variant="secondary" onClick={() => setAbierto(true)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo plan
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-text-3">
        La calculadora de cada sala usa solo estos planes. Cárgalos tal como los aprobó la
        constructora: el agente nunca calcula una cuota por su cuenta.
      </p>

      {planes.length > 0 && (
        <ul className="mb-4 divide-y divide-border rounded-[var(--radius)] border border-border">
          {planes.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="block font-medium">{p.nombre}</span>
                <span className="text-text-3">
                  Reserva {formatoMonto(p.reserva, "USD")} ·{" "}
                  {p.pasos.map((s) => `${s.porcentaje} % ${s.etiqueta.toLowerCase()}`).join(" · ")} · entrega mes{" "}
                  {p.mesEntrega} · aprobó {p.aprobadoPor}
                </span>
              </span>
              <button
                aria-label={`Archivar ${p.nombre}`}
                onClick={() => void archivar(p.id)}
                className="rounded p-1 text-text-3 hover:bg-accent hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <div className="space-y-3 rounded-[var(--radius)] border border-border p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-text-3">Nombre</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Estándar" />
            </label>
            <label className="space-y-1">
              <span className="text-text-3">Quién lo aprobó</span>
              <Input value={aprobadoPor} onChange={(e) => setAprobadoPor(e.target.value)} placeholder="Sergio, SAMER" />
            </label>
            <label className="space-y-1">
              <span className="text-text-3">Reserva (US$)</span>
              <Input inputMode="decimal" value={reserva} onChange={(e) => setReserva(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-text-3">Entrega (meses desde la reserva)</span>
              <Input inputMode="numeric" value={mesEntrega} onChange={(e) => setMesEntrega(e.target.value)} />
            </label>
          </div>

          <p className="text-text-3">Pasos (la reserva se descuenta del primero)</p>
          {pasos.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Paso"
                value={p.etiqueta}
                onChange={(e) => cambiarPaso(i, { etiqueta: e.target.value })}
                className="w-44"
              />
              <Input
                aria-label="Porcentaje"
                inputMode="decimal"
                value={String(p.porcentaje)}
                onChange={(e) => cambiarPaso(i, { porcentaje: Number(e.target.value) || 0 })}
                className="w-16"
              />
              <span className="text-text-3">%</span>
              <select
                aria-label="Cuándo"
                value={p.tipo}
                onChange={(e) =>
                  setPasos((prev) =>
                    prev.map((x, j) =>
                      j !== i
                        ? x
                        : e.target.value === "mensual"
                          ? { tipo: "mensual", etiqueta: x.etiqueta, porcentaje: x.porcentaje, desdeMes: 1, hastaMes: Number(mesEntrega) || 1 }
                          : { tipo: "unico", etiqueta: x.etiqueta, porcentaje: x.porcentaje, mes: 0 }
                    )
                  )
                }
                className="h-9 rounded border border-border-strong bg-background px-2"
              >
                <option value="unico">un pago en el mes</option>
                <option value="mensual">cuotas mensuales del mes</option>
              </select>
              {p.tipo === "unico" ? (
                <Input
                  aria-label="Mes"
                  inputMode="numeric"
                  value={String(p.mes)}
                  onChange={(e) => cambiarPaso(i, { mes: Number(e.target.value) || 0 })}
                  className="w-16"
                />
              ) : (
                <>
                  <Input
                    aria-label="Desde el mes"
                    inputMode="numeric"
                    value={String(p.desdeMes)}
                    onChange={(e) => cambiarPaso(i, { desdeMes: Number(e.target.value) || 0 })}
                    className="w-16"
                  />
                  <span className="text-text-3">al</span>
                  <Input
                    aria-label="Hasta el mes"
                    inputMode="numeric"
                    value={String(p.hastaMes)}
                    onChange={(e) => cambiarPaso(i, { hastaMes: Number(e.target.value) || 0 })}
                    className="w-16"
                  />
                </>
              )}
              {pasos.length > 1 && (
                <button
                  aria-label="Quitar paso"
                  onClick={() => setPasos((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-1 text-text-3 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setPasos((prev) => [...prev, { tipo: "unico", etiqueta: "Otro pago", porcentaje: 0, mes: 0 }])}
            className="text-brand-text"
          >
            + Agregar paso
          </button>

          {nombre && errores.length > 0 && (
            <ul className="list-disc pl-5 text-danger-text">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {error && <p className="text-danger-text">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={guardando || !nombre.trim() || aprobadoPor.trim().length < 2 || errores.length > 0}
              onClick={() => void guardar()}
            >
              Guardar plan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
