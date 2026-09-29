import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { canAutomate } from "@/server/agencia/entitlements";
import { tenantOrigin } from "@/server/saas/billing";
import { resolveOwnerForOrgSlug } from "@/server/agencia/whatsapp-signup/auth";
import { isEmbeddedSignupConfigured } from "@/lib/env";
import { EmbeddedSignupBridge } from "@/components/agencia/whatsapp-signup/embedded-signup-bridge";

export const dynamic = "force-dynamic";

/**
 * `/conectar-whatsapp?org=<slug>` — bridge de Embedded Signup en el host de
 * la app (fork). Meta solo permite dominios fijos en Allowed Domains, así que
 * este flujo NUNCA corre en el subdominio del inquilino.
 */
export default async function ConectarWhatsappPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orgSlugParam = params.org;
  const orgSlug = (Array.isArray(orgSlugParam) ? orgSlugParam[0] : orgSlugParam)?.trim().toLowerCase();

  if (!isEmbeddedSignupConfigured() || !orgSlug) {
    return <ErrorCard title="Conexión no disponible" message="Este enlace no es válido." />;
  }

  const requestHeaders = await headers();
  const resolved = await resolveOwnerForOrgSlug(
    requestHeaders,
    orgSlug
  );

  if (!resolved.ok) {
    if (resolved.reason === "no_session") redirect("/login");
    if (resolved.reason === "not_owner") {
      return (
        <ErrorCard
          title="Solo el propietario puede conectar WhatsApp"
          message="Pídele a quien creó el negocio que haga esta conexión."
        />
      );
    }
    return <ErrorCard title="Negocio no encontrado" message="No encontramos ese negocio en esta instancia." />;
  }

  const { context } = resolved;

  if (isAllokSaaSMode() && !(await canAutomate(context.organizationId))) {
    const pseudoRequest = new Request("http://internal", { headers: requestHeaders });
    const billingUrl = `${tenantOrigin(context.organizationSlug, pseudoRequest)}/settings/billing`;
    return (
      <ErrorCard title="Activa tu plan" message="Necesitas un plan activo para conectar un número de WhatsApp.">
        <a href={billingUrl} className={buttonVariants({ className: "mt-4" })}>
          Ir a Facturación
        </a>
      </ErrorCard>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <EmbeddedSignupBridge orgSlug={context.organizationSlug} organizationName={context.organizationName} />
    </main>
  );
}

function ErrorCard({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-tint text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </span>
          <p className="font-medium text-danger-text">{title}</p>
          <p className="text-sm text-text-3">{message}</p>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
