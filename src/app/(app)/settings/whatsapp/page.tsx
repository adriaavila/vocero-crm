import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  const guidedAvailable = Boolean(
    process.env.ALLOK_SAAS_LINK_URL?.trim() &&
    process.env.ALLOK_SAAS_LINK_SECRET?.trim(),
  );
  return <WhatsappWizard saasMode={isAllokSaaSMode()} guidedAvailable={guidedAvailable} />;
}
