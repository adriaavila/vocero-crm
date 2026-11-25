import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { formatoMonto, fraseAlquiler } from "@/lib/sala-cuotas";
import { agruparPagos } from "@/lib/sala-whatsapp";
import { getSalaPublica, salaVentaEnabled } from "@/server/agencia/sala-venta";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; casaId: string }> };

const DIR_FUENTES = join(process.cwd(), "src/server/agencia/fonts");
let fuentes: Promise<{ name: string; data: Buffer; weight: 400 | 600; style: "normal" | "italic" }[]> | null = null;

/** Las mismas voces de REI: Geist para leer, Instrument Serif itálica para el título. */
function cargarFuentes() {
  fuentes ??= Promise.all([
    readFile(join(DIR_FUENTES, "geist-400.ttf")).then((data) => ({ name: "Geist", data, weight: 400 as const, style: "normal" as const })),
    readFile(join(DIR_FUENTES, "geist-600.ttf")).then((data) => ({ name: "Geist", data, weight: 600 as const, style: "normal" as const })),
    readFile(join(DIR_FUENTES, "instrument-serif-italic.ttf")).then((data) => ({ name: "Instrument Serif", data, weight: 400 as const, style: "italic" as const })),
  ]).catch((err) => {
    fuentes = null;
    throw err;
  });
  return fuentes;
}

const C = {
  fondo: "#f7f8f6",
  tarjeta: "#ffffff",
  tinta: "#0f2028",
  tinta2: "#4a5a62",
  tinta3: "#7d8b91",
  borde: "#e3e8e6",
  esmeralda: "#0a7350",
  esmeraldaTinte: "#edf7f2",
};

/**
 * Pública por token, como la sala: la imagen del cálculo que la sala manda
 * dentro de WhatsApp. Meta la descarga por su URL al enviar el mensaje.
 */
export async function GET(_req: Request, ctx: Params) {
  if (!salaVentaEnabled()) return new Response(null, { status: 404 });
  const { token, casaId } = await ctx.params;
  const sala = await getSalaPublica(token);
  const casa = sala?.casas.find((c) => c.id === casaId);
  if (!sala || !casa?.calculo || !sala.plan) return new Response(null, { status: 404 });

  const fmt = (n: number) => formatoMonto(n, casa.moneda);
  const filas = agruparPagos(casa.calculo.pagos);
  const frase = fraseAlquiler(casa.calculo, casa.moneda);
  const nombre = sala.nombre?.split(" ")[0];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.fondo, padding: 64, fontFamily: "Geist", color: C.tinta }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 24, letterSpacing: 4, color: C.esmeralda, fontWeight: 600, textTransform: "uppercase" }}>
          <div style={{ width: 36, height: 2, background: C.esmeralda, opacity: 0.5, marginRight: 16 }} />
          {sala.negocio.nombre}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 76, lineHeight: 1.02 }}>
          {nombre ? `${nombre}, esto pagarías` : "Esto pagarías"}
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 30, color: C.tinta2 }}>
          {`${casa.titulo} · ${fmt(casa.precio)}`}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 40, background: C.tarjeta, border: `2px solid ${C.borde}`, borderRadius: 28, padding: "12px 36px" }}>
          {filas.map((f, i) => (
            <div key={`${f.desde}-${f.etiqueta}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0", borderTop: i === 0 ? "none" : `2px solid ${C.borde}` }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 30, fontWeight: 600 }}>{f.etiqueta}</div>
                <div style={{ fontSize: 24, color: C.tinta3, marginTop: 4 }}>{f.cuando[0]!.toUpperCase() + f.cuando.slice(1)}</div>
              </div>
              <div style={{ fontSize: 34, fontWeight: 600 }}>{`${f.veces > 1 ? `${f.veces} × ` : ""}${fmt(f.monto)}`}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0", borderTop: `2px solid ${C.borde}` }}>
            <div style={{ fontSize: 30, color: C.tinta2 }}>Total</div>
            <div style={{ fontSize: 34, fontWeight: 600 }}>{fmt(casa.calculo.total)}</div>
          </div>
        </div>

        {frase && (
          <div style={{ display: "flex", marginTop: 28, background: C.esmeraldaTinte, borderRadius: 24, padding: "26px 32px", fontSize: 30, lineHeight: 1.35, color: C.tinta }}>
            {frase}
          </div>
        )}

        <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: C.tinta3, lineHeight: 1.4 }}>
          {`Plan «${sala.plan.nombre}»${sala.planAprobadoPor ? `, aprobado por ${sala.planAprobadoPor}` : ""}. Los montos se confirman en el contrato de reserva.`}
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: await cargarFuentes(),
      headers: { "cache-control": "public, max-age=300" },
    }
  );
}
