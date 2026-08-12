import { SettingsNav } from "@/components/settings/settings-nav";
import { requireOwnerSession } from "@/lib/auth/session";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireOwnerSession();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">Configuración</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SettingsNav />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
