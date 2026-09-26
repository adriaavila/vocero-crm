import { notFound } from "next/navigation";
import { AdsClient } from "@/components/settings/ads-client";
import { requireOwnerSession } from "@/lib/auth/session";
import { atribucionEnabled } from "@/server/attribution/flag";

export const dynamic = "force-dynamic";

export default async function AdsSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia — para
  // cualquiera, dueño o no: se revisa antes que la sesión.
  if (!atribucionEnabled()) notFound();
  // El dataset y el token publican en nombre del negocio en Meta: solo el
  // propietario, igual que Ajustes → Facturación.
  await requireOwnerSession();
  return <AdsClient />;
}
