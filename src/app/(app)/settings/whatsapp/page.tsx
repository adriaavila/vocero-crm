import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  return <WhatsappWizard saasMode={isAllokSaaSMode()} />;
}
