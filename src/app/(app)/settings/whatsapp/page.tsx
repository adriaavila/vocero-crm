import { eq } from "drizzle-orm";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { isEmbeddedSignupConfigured } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { brand } from "@/lib/brand";
import { getDb, schema } from "@/lib/db";
import { getSetupProgress } from "@/server/agencia/setup-progress";
import { appOrigin } from "@/server/saas/billing";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  const guidedAvailable = Boolean(
    process.env.ALLOK_SAAS_LINK_URL?.trim() &&
    process.env.ALLOK_SAAS_LINK_SECRET?.trim(),
  );
  const session = await requireSession().catch(() => null);

  // Fork — Embedded Signup en la app: el botón principal solo aparece si hay
  // a dónde mandar al dueño (el bridge vive en el host de la app, nunca en el
  // subdominio del inquilino — Meta solo permite dominios fijos).
  let bridgeUrl: string | null = null;
  if (session && isEmbeddedSignupConfigured()) {
    const org = (await getDb()
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, session.organizationId))
      .limit(1))[0];
    if (org?.slug) {
      bridgeUrl = `${appOrigin()}/conectar-whatsapp?org=${encodeURIComponent(org.slug)}`;
    }
  }

  // El avance de la puesta en marcha lo ve solo el dueño (es quien la hace).
  const progress = session?.role === "owner"
    ? await getSetupProgress(session.organizationId).catch(() => null)
    : null;

  return (
    <WhatsappWizard
      saasMode={isAllokSaaSMode()}
      guidedAvailable={guidedAvailable}
      bridgeUrl={bridgeUrl}
      initialProgress={progress}
      brandName={brand().name}
    />
  );
}
