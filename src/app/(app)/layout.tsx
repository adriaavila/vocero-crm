import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { AppNav } from "@/components/app-nav";
import { ToastProvider } from "@/components/ui/toast-provider";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <AppNav
          branding={branding}
          userName={authSession?.user.name ?? "Usuario"}
          role={session.role}
        />
        <main className="min-w-0 flex-1 overflow-hidden pb-16 md:pb-0">{children}</main>
      </div>
    </ToastProvider>
  );
}
