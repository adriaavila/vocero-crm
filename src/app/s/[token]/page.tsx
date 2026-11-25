import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSalaPublica, salaVentaEnabled } from "@/server/agencia/sala-venta";
import { SalaPublicaView } from "@/components/agencia/sala/sala-publica";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** La sala no se indexa: es de una persona, no del catálogo. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const sala = salaVentaEnabled() ? await getSalaPublica(token) : null;
  const nombre = sala?.nombre?.split(" ")[0];
  return {
    title: sala ? `${nombre ? `${nombre}, tu` : "Tu"} sala en ${sala.negocio.nombre}` : "Sala",
    robots: { index: false, follow: false },
  };
}

export default async function SalaPage({ params }: Props) {
  if (!salaVentaEnabled()) notFound();
  const { token } = await params;
  const sala = await getSalaPublica(token);
  if (!sala) notFound();
  return <SalaPublicaView token={token} sala={sala} />;
}
