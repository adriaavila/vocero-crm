"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { signUp } from "@/lib/auth/client";
import { SIGNUP_HOST_HINT } from "@/lib/tenant-host";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<"basic" | "pro">("basic");

  useEffect(() => {
    const requestedPlan = new URLSearchParams(window.location.search).get("plan");
    setPlan(requestedPlan === "pro" ? "pro" : "basic");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signUp.email({ name, email, password });
    if (err) {
      setLoading(false);
      if (err.status === 403) {
        setError(err.message?.startsWith(SIGNUP_HOST_HINT)
          ? err.message
          : "El registro está cerrado: esta instancia ya tiene su organización. Pide acceso al propietario.");
      } else if (err.status === 429) {
        setError("Demasiados intentos. Espera unos minutos.");
      } else {
        setError(err.message ?? "No se pudo crear la cuenta.");
      }
      return;
    }
    const checkout = await fetch("/api/saas/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    }).catch(() => null);
    const payload = (await checkout?.json().catch(() => null)) as
      { url?: string; error?: { code?: string } } | null;
    if (checkout?.ok && payload?.url) {
      window.location.assign(payload.url);
      return;
    }
    // El cobro es el paso 2 de 7, no un extra. Si el checkout no abrió por algo
    // que el dueño puede reintentar, la siguiente pantalla es Facturación y no
    // el panel: cayendo en el panel, la cuenta se queda sin pagar y sin que
    // nadie se entere. `billing_unconfigured` es la excepción — eso lo arregla
    // quien administra la instancia, no el cliente.
    const destino = payload?.error?.code === "billing_unconfigured"
      ? "/overview?billing=unavailable"
      : "/settings/billing?checkout=failed";
    const tenant = await fetch("/api/saas/tenant").then((response) =>
      response.ok ? response.json().catch(() => null) : null
    ) as { url?: string | null } | null;
    if (tenant?.url && new URL(tenant.url).origin !== window.location.origin) {
      window.location.assign(`${tenant.url}${destino}`);
      return;
    }
    router.push(destino);
    router.refresh();
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3"><span className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] text-brand-fg">1</span> Tu espacio</span><span className="normal-case tracking-normal text-text-4">1 de 7</span></div>
        <CardTitle>Empieza con tu negocio</CardTitle>
        <CardDescription>
          En unos minutos podrás conectar WhatsApp, probar respuestas y decidir cuándo activar Allok.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-soft bg-brand-tint px-3 py-2.5 text-sm"><span><span className="block text-xs text-text-3">Plan seleccionado</span><span className="font-semibold">Allok {plan === "pro" ? "Pro" : "Básico"}</span></span><Link href="https://allok.fun/#precios" className="text-xs font-semibold text-brand-text hover:underline">Cambiar</Link></div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre del negocio</Label>
            <Input
              id="name"
              required
              placeholder="Clínica Pérez"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se usará para sugerir tu subdominio, por ejemplo clinica-perez.allok.fun.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creando tu espacio…" : <>Continuar <ArrowRight className="ml-2 h-4 w-4" /></>}
          </Button>
          <div className="grid gap-2 rounded-lg border bg-subtle p-3 text-xs text-text-3"><p className="flex items-center gap-2 font-medium text-text-2"><Check className="h-3.5 w-3.5 text-success" /> Después conectas tu WhatsApp</p><p className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-success" /> Ajustas horarios e información</p><p className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-success" /> Pruebas antes de activar respuestas</p></div>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs leading-relaxed text-text-3"><ShieldCheck className="h-3.5 w-3.5 text-success" /> No se enviarán mensajes durante la configuración.</p>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
