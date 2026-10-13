import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { resolveMembershipForHost, resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import { isAllokSaaSMode, isKnownAllokHost, isLegacyAppHost, isSaaSAppHost, tenantSlugFromHost } from "@/lib/tenant-host";
import { hasSaaSPlan } from "@/server/agencia/entitlements";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class TenantNotFoundError extends Error {
  constructor() {
    super("Tenant no encontrado");
    this.name = "TenantNotFoundError";
  }
}

export class SaaSMemberPlanRequiredError extends Error {
  constructor() {
    super("El acceso del equipo requiere el plan Completo");
    this.name = "SaaSMemberPlanRequiredError";
  }
}

export type SessionOptions = {
  allowSaaSAppHost?: boolean;
};

/**
 * La sesión de Better Auth de esta petición. En un render (layout + página)
 * se lee una sola vez: antes el layout, la página y `requireSession` la
 * pedían cada uno por su lado, con sus consultas. En un route handler
 * `cache` no guarda nada y cada llamada lee, como siempre.
 */
export const getAuthSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(options: SessionOptions = {}): Promise<SessionContext> {
  return resolveSession(Boolean(options.allowSaaSAppHost));
}

// Una sola resolución por render y por opción (el layout y la página la piden igual).
const resolveSession = cache(async (allowSaaSAppHost: boolean): Promise<SessionContext> => {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (isAllokSaaSMode() && !isKnownAllokHost(host)) {
    throw new TenantNotFoundError();
  }
  const tenantSlug = tenantSlugFromHost(host);
  if (isAllokSaaSMode() && tenantSlug && !(await resolveOrganizationIdForHost(host))) {
    throw new TenantNotFoundError();
  }
  if (
    isAllokSaaSMode() &&
    !tenantSlug &&
    !isLegacyAppHost(host) &&
    !(allowSaaSAppHost && isSaaSAppHost(host))
  ) {
    throw new UnauthorizedError("La organización se resuelve desde su subdominio");
  }

  const session = await getAuthSession();
  if (!session) throw new UnauthorizedError();
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembershipForHost(session.user.id, host);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  if (
    isAllokSaaSMode() &&
    membership.role !== "owner" &&
    !(await hasSaaSPlan(membership.organizationId, "pro"))
  ) {
    throw new SaaSMemberPlanRequiredError();
  }
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  };
});

export async function requireOwnerSession(options: SessionOptions = {}): Promise<SessionContext> {
  const session = await requireSession(options);
  if (session.role !== "owner") redirect("/overview");
  return session;
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
