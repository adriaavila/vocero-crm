import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { requireSession, SaaSMemberPlanRequiredError, UnauthorizedError } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
// Capa de agencia: los avisos de las pantallas propias (Mi cuenta, Inicio).
import { ToastProvider } from "@/components/ui/toast-provider";
import { resolveBuildCommit } from "@/lib/version";
import { agendaEnabled } from "@/server/agenda/flag";
import { isAllokSaaSMode, isKnownAllokHost, tenantSlugFromHost } from "@/lib/tenant-host";
import { resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import { getOrganizationBilling } from "@/server/saas/billing";
// Capa de agencia: el estado de la operación (el punto de all ● k).
import { getSystemState } from "@/server/agencia/estado";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const saasMode = isAllokSaaSMode();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const tenantSlug = tenantSlugFromHost(host);
  if (saasMode && !isKnownAllokHost(host)) notFound();
  if (saasMode && tenantSlug && !(await resolveOrganizationIdForHost(host))) notFound();
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    if (error instanceof SaaSMemberPlanRequiredError) redirect("/member-access-paused");
    if (saasMode && tenantSlug && !(error instanceof UnauthorizedError && error.message === "No autenticado")) notFound();
    session = null;
  }
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const [billing, systemState] = saasMode
    ? await Promise.all([
        getOrganizationBilling(session.organizationId),
        getSystemState(session.organizationId, session.role === "owner"),
      ])
    : [null, null];
  const authSession = await getAuth().api.getSession({
    headers: requestHeaders,
  });
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      commit={resolveBuildCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      agenda={agendaEnabled()}
      saasMode={saasMode}
      saasPlan={billing?.status === "active" || billing?.status === "trialing" ? billing.plan : null}
      systemState={systemState}
    >
      <ToastProvider>{children}</ToastProvider>
    </AppShell>
  );
}
