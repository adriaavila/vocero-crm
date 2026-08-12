"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CircleUserRound,
  FlaskConical,
  Gauge,
  Inbox,
  Kanban,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";

const MAIN = [
  { href: "/overview", label: "Inicio", icon: Gauge },
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
] as const;
const AUTOMATION = [
  { href: "/agent", label: "Agente", icon: Sparkles },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical },
] as const;

export function AppNav({ branding, userName, role }: { branding: Branding; userName: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [connection, setConnection] = useState<"connected" | "reconnecting">("connected");
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const owner = role === "owner";

  async function refetchUnread() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversations: { unreadCount: number }[] };
    setUnread(data.conversations.reduce((sum, item) => sum + item.unreadCount, 0));
  }

  useEffect(() => { void refetchUnread(); }, []);
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEvents({
    onMessageNew: () => void refetchUnread(),
    onConversationUpdated: () => void refetchUnread(),
    onConnectionChange: setConnection,
  });

  async function logout() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const navLink = (item: { href: string; label: string; icon: typeof Gauge; badge?: boolean }) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        className={cn(
          "group flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:justify-center md:px-0",
          collapsed ? "xl:justify-center xl:px-0" : "xl:justify-start xl:px-3",
          active ? "border border-border-strong bg-background text-foreground shadow-sm" : "text-text-2 hover:bg-accent"
        )}
      >
        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand" : "text-text-3 group-hover:text-text-2")} strokeWidth={1.7} />
        <span className={cn("flex-1 md:hidden", collapsed ? "xl:hidden" : "xl:block")}>{item.label}</span>
        {item.badge && unread > 0 && (
          <span className={cn("flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white md:absolute md:ml-5 md:-mt-5", collapsed ? "xl:absolute xl:ml-5 xl:-mt-5" : "xl:static xl:ml-0 xl:mt-0")}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      <aside className={cn("relative z-30 hidden w-[72px] shrink-0 flex-col border-r bg-subtle px-2.5 pb-3 pt-4 transition-[width] md:flex", collapsed ? "xl:w-[72px] xl:px-2.5" : "xl:w-60 xl:px-4")}>
        <div className={cn("mb-5 flex items-center justify-center gap-2.5 px-1", !collapsed && "xl:justify-start")}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-sm font-bold text-white shadow-sm">
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <span className={cn("min-w-0 md:hidden", collapsed ? "xl:hidden" : "xl:block")}>
            <span className="block truncate text-[17px] font-[680] tracking-tight">{branding.name}</span>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-text-3">CRM · WhatsApp</span>
          </span>
          <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expandir navegación" : "Contraer navegación"} title={collapsed ? "Expandir navegación" : "Contraer navegación"} className={cn("ml-auto hidden rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground xl:block", collapsed && "absolute -right-3 top-5 border bg-background shadow-sm")}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {connection === "reconnecting" && (
          <div className="mb-3 rounded-md border border-[#ece2cf] bg-[#faf7f0] px-2 py-1.5 text-center text-[10px] text-[#8a6d3b] xl:text-left">Reconectando…</div>
        )}

        <p className={cn("mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4 md:hidden", collapsed ? "xl:hidden" : "xl:block")}>Principal</p>
        <nav className="space-y-1">{MAIN.map((item) => navLink(item))}</nav>

        {owner && (
          <>
            <p className={cn("mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4 md:hidden", collapsed ? "xl:hidden" : "xl:block")}>Automatización</p>
            <nav className="space-y-1">{AUTOMATION.map((item) => navLink(item))}</nav>
          </>
        )}

        <div className="flex-1" />
        <nav className="space-y-1">
          {owner && navLink({ href: "/settings", label: "Ajustes", icon: Settings })}
          {navLink({ href: "/account", label: "Mi cuenta", icon: CircleUserRound })}
        </nav>
        <div className="mt-3 flex items-center justify-center gap-2.5 rounded-md border bg-background p-2 xl:justify-start">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">{initials(userName)}</span>
          <span className={cn("min-w-0 flex-1 md:hidden", collapsed ? "xl:hidden" : "xl:block")}>
            <span className="block truncate text-[12px] font-semibold">{userName}</span>
            <span className="block text-[10px] text-text-3">{owner ? "Propietario" : "Equipo"}</span>
          </span>
          <button onClick={() => void logout()} aria-label="Cerrar sesión" title="Cerrar sesión" className={cn("hidden rounded p-1 text-text-3 hover:text-foreground xl:block", collapsed && "xl:hidden")}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {connection === "reconnecting" && <div className="fixed inset-x-0 top-0 z-50 bg-[#8a6d3b] px-3 py-1 text-center text-xs font-medium text-white md:hidden">Reconectando…</div>}

      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t bg-background/95 px-2 backdrop-blur md:hidden">
        {MAIN.slice(0, 3).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={cn("relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-brand" : "text-text-3")}>
              <item.icon className="h-5 w-5" />{item.label}
              {"badge" in item && item.badge && unread > 0 && <span className="absolute right-[28%] top-2.5 rounded-full bg-brand px-1 text-[9px] text-white">{unread}</span>}
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-text-3">
          <Menu className="h-5 w-5" />Más
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-xl border-t bg-background p-4 pb-8 shadow-pop" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#20242c] font-bold text-white">{branding.name.charAt(0)}</span><div><p className="font-semibold">{branding.name}</p><p className="text-xs text-text-3">{userName} · {owner ? "Propietario" : "Equipo"}</p></div></div>
              <button onClick={() => setMoreOpen(false)} aria-label="Cerrar menú" className="rounded-md border p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MobileLink href="/contacts" icon={Users} label="Contactos" />
              <MobileLink href="/account" icon={CircleUserRound} label="Mi cuenta" />
              {owner && <MobileLink href="/agent" icon={Sparkles} label="Agente" />}
              {owner && <MobileLink href="/lab" icon={FlaskConical} label="Laboratorio" />}
              {owner && <MobileLink href="/settings" icon={Settings} label="Ajustes" />}
              <button onClick={() => void logout()} className="flex items-center gap-3 rounded-md border p-3 text-left text-sm"><LogOut className="h-4 w-4 text-text-3" />Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileLink({ href, icon: Icon, label }: { href: string; icon: typeof Gauge; label: string }) {
  return <Link href={href} className="flex items-center gap-3 rounded-md border p-3 text-sm"><Icon className="h-4 w-4 text-text-3" />{label}</Link>;
}
