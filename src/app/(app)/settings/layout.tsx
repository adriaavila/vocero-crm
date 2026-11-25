import { SettingsHeader, SettingsNav } from "@/components/settings/settings-nav";
import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { isChannelEnabled } from "@/server/channels/enabled";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { requireSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { getSetupProgress } from "@/server/agencia/setup-progress";

// La bandera se lee en cada petición: si esto se resolviera al construir, la
// imagen quedaría con la agenda apagada para siempre y encenderla en la
// plataforma no haría nada.
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  const saas = isAllokSaaSMode();
  const saasPro = saas && await hasSaaSPlan(session.organizationId, "pro");
  // El dueño en el paso «Conectar WhatsApp» de una alta que nunca se activó ve
  // esa pantalla sin la fila de pestañas, y SOLO esa (ver `SettingsNav`): desde
  // cualquier otro paso Configuración es la de siempre y Facturación está a un
  // toque. La misma lectura la hace la página de WhatsApp (`cache` de React).
  const setupWhatsapp =
    saas && session.role === "owner"
      ? await getSetupProgress(session.organizationId)
          .then((progress) => progress.active && progress.current === "whatsapp")
          .catch(() => false)
      : false;
  return (
    <div className="flex h-full flex-col">
      <SettingsHeader setupWhatsapp={setupWhatsapp} />
      {/* En móvil las pestañas van arriba (en fila), no como columna lateral. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <SettingsNav
          agenda={agendaEnabled()}
          // El dataset y el token de Meta son de propietario (misma razón que
          // WhatsApp); un miembro que la viera solo llegaría a un 403 y una
          // pantalla vacía que parece un bug, no un permiso.
          atribucion={atribucionEnabled() && session.role === "owner"}
          messenger={isChannelEnabled("messenger")}
          saas={saas}
          saasPro={saasPro}
          setupWhatsapp={setupWhatsapp}
        />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
