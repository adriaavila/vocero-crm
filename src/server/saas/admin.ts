import { headers } from "next/headers";
import { count, desc } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode, isSaaSAdminHost } from "@/lib/tenant-host";
import { billingFromMetadata, type SaaSBillingState } from "@/server/saas/billing";

export class SaaSAdminUnauthorized extends Error {
  constructor() {
    super("Panel SaaS no autorizado");
    this.name = "SaaSAdminUnauthorized";
  }
}

export type SaaSAdminIdentity = {
  userId: string;
  email: string;
  name: string;
};

export function isSaaSAdminEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ALLOK_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allowed.includes(email.trim().toLowerCase()));
}

export async function requireSaaSAdmin(action = "view_tenants"): Promise<SaaSAdminIdentity> {
  if (!isAllokSaaSMode()) throw new SaaSAdminUnauthorized();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSaaSAdminHost(host)) throw new SaaSAdminUnauthorized();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const email = session?.user.email ?? null;
  if (!session || !isSaaSAdminEmail(email)) throw new SaaSAdminUnauthorized();

  await getDb().insert(schema.saasAdminAudit).values({
    id: newId("saasAdminAudit"),
    userId: session.user.id,
    action,
  });
  return { userId: session.user.id, email: email!, name: session.user.name };
}

export type SaaSTenantStatus = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  members: number;
  whatsapp: "connected" | "reconnect_required" | "not_connected";
  agentEnabled: boolean;
  billing: Pick<SaaSBillingState, "plan" | "status">;
};

export async function listSaaSTenantStatus(): Promise<SaaSTenantStatus[]> {
  const db = getDb();
  const [organizations, members, credentials, profiles] = await Promise.all([
    db.select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, createdAt: schema.organization.createdAt, metadata: schema.organization.metadata })
      .from(schema.organization)
      .orderBy(desc(schema.organization.createdAt)),
    db.select({ organizationId: schema.member.organizationId, count: count() })
      .from(schema.member)
      .groupBy(schema.member.organizationId),
    db.select({ organizationId: schema.metaCredentials.organizationId, status: schema.metaCredentials.status })
      .from(schema.metaCredentials),
    db.select({ organizationId: schema.agentProfile.organizationId, enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile),
  ]);
  const memberCount = new Map(members.map((row) => [row.organizationId, row.count]));
  const credentialStatus = new Map(credentials.map((row) => [row.organizationId, row.status]));
  const agentStatus = new Map(profiles.map((row) => [row.organizationId, row.enabled]));
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt.toISOString(),
    members: memberCount.get(organization.id) ?? 0,
    whatsapp: credentialStatus.get(organization.id) ?? "not_connected",
    agentEnabled: agentStatus.get(organization.id) === true,
    billing: (({ plan, status }) => ({ plan, status }))(billingFromMetadata(organization.metadata)),
  }));
}
