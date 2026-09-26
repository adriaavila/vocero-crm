"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  AdSpendListDto,
  AdsBlockDto,
  BotBlockDto,
  HygieneBlockDto,
  SalesBlockDto,
} from "@/lib/analytics";
import { AdsSection } from "./ads-section";
import { BotSection } from "./bot-section";
import { HygieneSection } from "./hygiene-section";
import { defaultRange, RangePicker, type Range } from "./range-picker";
import { SalesSection } from "./sales-section";

type Block<T> = { data: T | null; loading: boolean; error: string | null };

const inicial = <T,>(): Block<T> => ({ data: null, loading: true, error: null });

/**
 * Pide un bloque y lo deja en su estado. Mientras llega, CONSERVA lo anterior
 * (la sección lo atenúa): vaciar en cada cambio de rango haría saltar la
 * pantalla. Una respuesta que llega tarde, de un rango que ya no es el
 * elegido, se descarta con el `AbortSignal`.
 */
async function cargar<T>(
  url: string,
  set: (update: (prev: Block<T>) => Block<T>) => void,
  signal: AbortSignal
): Promise<void> {
  set((prev) => ({ ...prev, loading: true, error: null }));
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    if (signal.aborted) return;
    set(() => ({ data: null, loading: false, error: "No se pudo cargar. Revisa tu conexión." }));
    return;
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (signal.aborted) return;
  if (!res.ok || !body) {
    set(() => ({
      data: null,
      loading: false,
      error: body?.error?.message ?? "No se pudo calcular este bloque.",
    }));
    return;
  }
  set(() => ({ data: body, loading: false, error: null }));
}

/**
 * 019 — Pantalla Resultados.
 *
 * Cada bloque carga por su cuenta: son una veintena de consultas repartidas en
 * cuatro grupos, y en una sola respuesta el más lento retrasaría a los tres
 * rápidos. Así la pantalla pinta en cascada y un bloque roto muestra su propio
 * error sin tumbar el resto.
 */
export function ResultsClient({
  currency,
  agenda,
  today,
  timezone,
}: {
  currency: string;
  agenda: boolean;
  /** Hoy en la zona del negocio (`YYYY-MM-DD`), resuelto en el servidor. */
  today: string;
  timezone: string;
}) {
  const [range, setRange] = useState<Range>(() => defaultRange(today));
  const [sales, setSales] = useState<Block<SalesBlockDto>>(inicial);
  const [ads, setAds] = useState<Block<AdsBlockDto>>(inicial);
  const [bot, setBot] = useState<Block<BotBlockDto>>(inicial);
  const [hygiene, setHygiene] = useState<Block<HygieneBlockDto>>(inicial);
  // Fork — gasto de anuncios cargado a mano (Cloud lo tiene, upstream no).
  const [spend, setSpend] = useState<Block<AdSpendListDto>>(inicial);

  // Un ref por sección: "Reintentar"/"recargar" y el efecto de rango
  // comparten el mismo controlador. Sin esto, una respuesta lenta de una
  // llamada que ya no corresponde al rango elegido (el dueño cambió el rango,
  // o recargó el gasto, mientras esperaba) llegaba de todos modos y pisaba el
  // dato correcto — el AbortController del efecto no sabía nada del otro.
  const salesCtl = useRef<AbortController | null>(null);
  const adsCtl = useRef<AbortController | null>(null);
  const botCtl = useRef<AbortController | null>(null);
  const hygieneCtl = useRef<AbortController | null>(null);
  const spendCtl = useRef<AbortController | null>(null);

  function pedir<T>(
    ref: RefObject<AbortController | null>,
    url: string,
    set: (update: (prev: Block<T>) => Block<T>) => void
  ) {
    ref.current?.abort();
    const ctl = new AbortController();
    ref.current = ctl;
    void cargar(url, set, ctl.signal);
  }

  useEffect(() => {
    const q = `from=${range.from}&to=${range.to}`;
    pedir(salesCtl, `/api/analytics/sales?${q}`, setSales);
    pedir(adsCtl, `/api/analytics/ads?${q}`, setAds);
    pedir(botCtl, `/api/analytics/bot?${q}`, setBot);
    pedir(spendCtl, `/api/analytics/spend?${q}`, setSpend);
    // Se quiere el controlador VIGENTE al desmontar (el que "Reintentar" pudo
    // reemplazar después de este render), no una copia congelada de este
    // momento — por eso se lee `.current` en la limpieza en vez de cerrar
    // sobre una variable capturada aquí arriba.
    return () => {
      /* eslint-disable react-hooks/exhaustive-deps */
      salesCtl.current?.abort();
      adsCtl.current?.abort();
      botCtl.current?.abort();
      spendCtl.current?.abort();
      /* eslint-enable react-hooks/exhaustive-deps */
    };
  }, [range]);

  // La higiene describe el AHORA: no depende del rango elegido.
  useEffect(() => {
    pedir(hygieneCtl, "/api/analytics/hygiene", setHygiene);
    return () => {
      /* eslint-disable-next-line react-hooks/exhaustive-deps */
      hygieneCtl.current?.abort();
    };
  }, []);

  // "Reintentar"/"recargar" repite exactamente la misma petición que ya
  // falló (o que acaba de cambiar el gasto), sin recargar la página entera
  // ni perder el rango elegido.
  const q = `from=${range.from}&to=${range.to}`;
  const reintentarSales = () => pedir(salesCtl, `/api/analytics/sales?${q}`, setSales);
  const reintentarAds = () => pedir(adsCtl, `/api/analytics/ads?${q}`, setAds);
  const reintentarBot = () => pedir(botCtl, `/api/analytics/bot?${q}`, setBot);
  const reintentarHygiene = () => pedir(hygieneCtl, "/api/analytics/hygiene", setHygiene);
  const reloadSpend = () => pedir(spendCtl, `/api/analytics/spend?${q}`, setSpend);

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Resultados</h2>
          <p className="text-xs text-text-3">
            Ventas, el trabajo del agente, de dónde llegan y qué se está cayendo.
          </p>
        </div>
        <RangePicker value={range} onChange={setRange} today={today} timezone={timezone} />
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6">
        <SalesSection {...sales} currency={currency} onRetry={reintentarSales} />
        <AdsSection
          {...ads}
          spend={spend}
          currency={currency}
          today={today}
          onSpendChanged={reloadSpend}
          onRetry={reintentarAds}
        />
        <BotSection {...bot} agenda={agenda} onRetry={reintentarBot} />
        <HygieneSection {...hygiene} currency={currency} onRetry={reintentarHygiene} />
      </div>
    </div>
  );
}
