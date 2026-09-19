import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";
import { Check, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import { isAllokSaaSMode, isKnownAllokHost, isLegacyAppHost, tenantSlugFromHost } from "@/lib/tenant-host";

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
  const branding = await getBranding(organizationId).catch(() => DEFAULT_BRANDING);
  const saasMode = isAllokSaaSMode();

  if (saasMode) {
    const benefits = [
      { icon: MessageCircle, label: "Conecta tu WhatsApp con Meta" },
      { icon: Sparkles, label: "Prueba respuestas antes de activarlas" },
      { icon: ShieldCheck, label: "Tú decides cuándo responder" },
    ];

    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4 sm:p-6 lg:p-10">
        <div className="brand-grid absolute inset-0" aria-hidden />
        <div className="brand-glow brand-glow-a" aria-hidden />
        <div className="brand-glow brand-glow-b" aria-hidden />

        <div className="relative grid w-full max-w-5xl overflow-hidden rounded-plate border bg-background shadow-pop lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="dd-void relative hidden overflow-hidden p-9 lg:flex lg:flex-col">
            <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-assist-dim blur-3xl" aria-hidden="true" />
            <div className="relative">
              <BrandLogo branding={branding} size="lg" className="[&>span:last-child]:text-ink" />
              <p className="mt-10 max-w-sm text-4xl font-semibold leading-[0.98] tracking-[-0.06em]">
                Tu negocio sigue presente, incluso cuando tú no estás.
              </p>
              <p className="mt-5 max-w-sm text-sm leading-6 text-ink-60">
                Configura una vez. Responde con la información real de tu negocio. Retoma cada conversación con contexto.
              </p>
              <div className="mt-10 grid gap-4 text-sm">
                {benefits.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-3 text-ink">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-assist text-ground"><Icon className="size-4" aria-hidden="true" /></span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative mt-auto flex items-center gap-2 pt-12 text-xs text-ink-60"><Check className="size-3.5 text-assist" /> Sin mensajes enviados durante la configuración</div>
          </aside>

          <div className="relative p-5 sm:p-9">
            <div className="mb-8 flex flex-col items-center gap-4 text-center lg:hidden">
              <BrandLogo branding={branding} size="lg" />
              <p className="max-w-xs text-sm text-text-3">Tu WhatsApp responde aunque estés cerrado.</p>
            </div>
            <div className="mx-auto w-full max-w-sm">{children}</div>
          </div>
        </div>
      </main>
    );
  }

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
