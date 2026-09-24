import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";
import { AllokAuthFrame } from "@/components/agencia/allok/auth-frame";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import { isAllokBrand, isAllokSaaSMode, isKnownAllokHost, isLegacyAppHost, tenantSlugFromHost } from "@/lib/tenant-host";

/**
 * Pantalla de entrada: papel frío, rejilla difuminada y dos resplandores
 * (azul y cian) detrás del formulario, con el nombre del negocio configurado
 * en Configuración → Marca.
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const tenantSlug = tenantSlugFromHost(host);
  if (isAllokSaaSMode() && !isKnownAllokHost(host)) notFound();
  // Fuera del SaaS la instancia tiene una sola organización y se resuelve sola:
  // `undefined` la busca, `null` la descarta y deja la marca por defecto.
  const organizationId = isAllokSaaSMode()
    ? (await resolveOrganizationIdForHost(host) ??
        (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null))
    : undefined;
  if (tenantSlug && !organizationId) notFound();
  // Capa de agencia: la entrada es la portada de allok.fun, en el SaaS y en
  // una dedicada.
  if (isAllokBrand()) return <AllokAuthFrame>{children}</AllokAuthFrame>;
  const branding = await getBranding(organizationId).catch(() => DEFAULT_BRANDING);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="brand-glow brand-glow-a" aria-hidden />
      <div className="brand-glow brand-glow-b" aria-hidden />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <BrandLogo branding={branding} size="lg" />
          <div>
            <h1 className="sr-only">{branding.name}</h1>
            <p className="text-sm text-text-3">CRM de WhatsApp con agente de IA</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
