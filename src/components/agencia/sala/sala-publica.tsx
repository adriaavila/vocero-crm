"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BedDouble, Bath, Ruler, Trees, MessageCircle } from "lucide-react";
import { calcularCuotas, formatoMonto, fraseAlquiler } from "@/lib/sala-cuotas";
import { agruparPagos } from "@/lib/sala-whatsapp";
import type { SalaPublica } from "@/server/agencia/sala-venta";

/**
 * La sala de venta que ve el comprador: sus casas, su cálculo y un botón para
 * pedir visita. Pensada para el celular, porque llega por WhatsApp.
 *
 * Avisa al CRM lo que hace (abrir, mover la calculadora, pedir visita) desde
 * el navegador: es lo que alimenta "llámalos hoy" del lado del dueño.
 */
export function SalaPublicaView({ token, sala }: { token: string; sala: SalaPublica }) {
  const [casaId, setCasaId] = useState(sala.casas[0]?.id ?? null);
  const [alquiler, setAlquiler] = useState(sala.alquilerActual ? String(sala.alquilerActual) : "");
  const calculadoraAvisada = useRef(false);

  useEffect(() => {
    // Una apertura por pestaña: recargar la página no la vuelve a contar.
    const clave = `sala:${token}:abierta`;
    try {
      if (sessionStorage.getItem(clave)) return;
      sessionStorage.setItem(clave, "1");
    } catch {
      /* sin storage (modo privado): se cuenta igual */
    }
    void avisar(token, "apertura");
  }, [token]);

  const casa = sala.casas.find((c) => c.id === casaId) ?? sala.casas[0] ?? null;
  const alquilerNumero = Number(alquiler.replace(/[^\d.]/g, "")) || null;

  const calculo = useMemo(() => {
    if (!casa || !sala.plan || casa.precio <= 0) return null;
    try {
      return calcularCuotas(casa.precio, sala.plan, alquilerNumero);
    } catch {
      return null;
    }
  }, [casa, sala.plan, alquilerNumero]);

  const primerNombre = sala.nombre?.split(" ")[0] ?? null;
  const textoVisita = `Hola, soy ${primerNombre ?? "yo"}. Vi mi sala${casa ? ` y quiero visitar ${casa.titulo}` : " y quiero agendar una visita"}.`;
  const linkVisita = sala.whatsapp
    ? `https://wa.me/${sala.whatsapp}?text=${encodeURIComponent(textoVisita)}`
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-background px-4 pb-28 pt-8 text-foreground">
      <p className="kicker">{sala.negocio.nombre}</p>
      <h1 className="mt-2 font-serif text-[2.6rem] italic leading-[1.02]">
        {primerNombre ? `Hola, ${primerNombre}.` : "Hola."}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text-2">
        {sala.saludo ||
          `Esta es tu sala. Elegimos ${sala.casas.length === 1 ? "la casa que te sirve" : `las ${sala.casas.length} casas que te sirven`} según lo que nos contaste, con lo que te quedaría pagando.`}
      </p>

      <section className="mt-8 space-y-4" aria-label="Tus casas">
        {sala.casas.map((c) => (
          <article
            key={c.id}
            className={`overflow-hidden rounded-[var(--radius-lg)] border bg-card transition-shadow ${
              c.id === casa?.id ? "border-brand shadow-[var(--shadow-md)]" : "border-border"
            }`}
          >
            {c.fotos.length > 0 && (
              <div className="flex snap-x snap-mandatory overflow-x-auto">
                {c.fotos.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- fotos de R2 o del disco local, sin optimizador
                  <img
                    key={src}
                    src={src}
                    alt={i === 0 ? c.titulo : `${c.titulo}, foto ${i + 1}`}
                    loading={i === 0 ? "eager" : "lazy"}
                    className="aspect-[4/3] w-full shrink-0 snap-center object-cover"
                  />
                ))}
              </div>
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold leading-snug">{c.titulo}</h2>
                {c.estado !== "disponible" && (
                  <span className="shrink-0 rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-text">
                    {c.estado === "apartada" ? "Apartada" : "Vendida"}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-xl">{formatoMonto(c.precio, c.moneda)}</p>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-2">
                {c.dormitorios !== null && (
                  <li className="flex items-center gap-1.5"><BedDouble className="h-4 w-4" />{c.dormitorios} dorm.</li>
                )}
                {c.banos !== null && (
                  <li className="flex items-center gap-1.5"><Bath className="h-4 w-4" />{numero(c.banos)} baños</li>
                )}
                {c.superficie !== null && (
                  <li className="flex items-center gap-1.5"><Ruler className="h-4 w-4" />{numero(c.superficie)} m² construidos</li>
                )}
                {c.terreno !== null && (
                  <li className="flex items-center gap-1.5"><Trees className="h-4 w-4" />{numero(c.terreno)} m² de terreno</li>
                )}
              </ul>
              {c.descripcion && (
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-text-2">{c.descripcion}</p>
              )}
              {sala.casas.length > 1 && sala.plan && c.id !== casa?.id && (
                <button
                  onClick={() => setCasaId(c.id)}
                  className="mt-3 text-sm font-medium text-brand-text underline-offset-4 hover:underline"
                >
                  Calcular con esta casa
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      {sala.plan && casa && calculo && (
        <section className="mt-10" aria-label="Lo que te quedaría pagando">
          <p className="kicker">Tu cálculo</p>
          <h2 className="mt-2 font-serif text-[2rem] italic leading-tight">{casa.titulo}</h2>
          <label className="mt-5 block text-sm font-medium" htmlFor="alquiler">
            ¿Cuánto pagas hoy de alquiler por mes?
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius)] border border-border-strong bg-card px-3 focus-within:border-brand">
            <span className="text-text-3">{casa.moneda === "BOB" ? "Bs" : "US$"}</span>
            <input
              id="alquiler"
              inputMode="decimal"
              value={alquiler}
              placeholder="400"
              onChange={(e) => {
                setAlquiler(e.target.value);
                if (!calculadoraAvisada.current) {
                  calculadoraAvisada.current = true;
                  void avisar(token, "calculadora");
                }
              }}
              className="h-12 w-full bg-transparent font-mono text-lg outline-none"
            />
          </div>

          {fraseAlquiler(calculo, casa.moneda) && (
            <p className="mt-4 rounded-[var(--radius)] bg-brand-tint p-4 text-[15px] leading-relaxed text-foreground">
              {fraseAlquiler(calculo, casa.moneda)}
            </p>
          )}

          <ol className="mt-5 divide-y divide-border rounded-[var(--radius)] border border-border">
            {agruparPagos(calculo.pagos).map((p) => (
              <li key={`${p.desde}-${p.etiqueta}`} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="block font-medium">{p.etiqueta}</span>
                  <span className="text-text-3">{p.cuando[0]?.toUpperCase() + p.cuando.slice(1)}</span>
                </span>
                <span className="shrink-0 font-mono">
                  {p.veces > 1 ? `${p.veces} × ` : ""}
                  {formatoMonto(p.monto, casa.moneda)}
                </span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono">{formatoMonto(calculo.total, casa.moneda)}</span>
            </li>
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-text-3">
            Plan «{sala.plan.nombre}» aprobado por {sala.negocio.nombre}. Los montos se confirman en el
            contrato de reserva; escríbenos si quieres ver otra forma de pago.
          </p>
        </section>
      )}

      {linkVisita && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-4 py-3">
          <a
            href={linkVisita}
            onClick={() => void avisar(token, "visita")}
            className="mx-auto flex h-12 max-w-xl items-center justify-center gap-2 rounded-[var(--btn-radius,var(--radius))] bg-brand text-base font-semibold text-brand-fg hover:bg-brand-hover"
          >
            <MessageCircle className="h-5 w-5" />
            Quiero visitar
          </a>
        </div>
      )}
    </main>
  );
}

/** `148,1` y no `148.1`: decimales de Bolivia. */
const numero = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 2 });

async function avisar(token: string, tipo: "apertura" | "calculadora" | "visita") {
  try {
    await fetch(`/api/s/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipo }),
      keepalive: true,
    });
  } catch {
    /* una señal perdida no rompe la sala */
  }
}
