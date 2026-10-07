"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import { capturarOrigenAlta, enviarOrigenAlta } from "@/components/agencia/origen-alta";
import { SETUP_STEP_META, SETUP_STEP_ORDER } from "@/lib/setup-steps";
import { signUp } from "@/lib/auth/client";
import { registerFailure, type RegisterFailure } from "@/lib/auth/register-error";
import { isSaaSPlan, PLAN_CATALOG } from "@/lib/saas-plans";
import type { SaaSPlan } from "@/server/saas/billing";
import type { Brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Adonde va el dueño recién registrado: el primer paso de la puesta en marcha. */
const FIRST_SETUP_HREF = SETUP_STEP_META[SETUP_STEP_ORDER[0]].href;

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export default function RegisterForm({
  adminMode = false,
  soldPlans,
  selfServe = false,
  brand,
  exampleHost,
}: {
  adminMode?: boolean;
  soldPlans: SaaSPlan[];
  /** Alta de autoservicio: 7 días gratis, sin checkout; lo siguiente es conectar WhatsApp. */
  selfServe?: boolean;
  /**
   * Resuelta en el servidor (`brand()` lee `process.env.BRAND`, que no es
   * `NEXT_PUBLIC_`): un componente cliente no puede leerla directo, siempre
   * baja por prop.
   */
  brand: Pick<Brand, "id" | "Name" | "pricingHref">;
  /** `clinica-perez.<dominio-raíz>`, también resuelto en el servidor. */
  exampleHost: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Un correo que ya tiene cuenta no es un fallo: el siguiente paso es entrar.
  const [existingAccount, setExistingAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const defaultPlan = soldPlans[0] ?? "basic";
  const [plan, setPlan] = useState<SaaSPlan>(defaultPlan);
  const [created, setCreated] = useState<{ email: string; url: string | null } | null>(null);
  // Fork (agencia): en el autoservicio también se puede pagar desde el alta.
  // Los 7 días gratis se respetan igual: Stripe empieza a cobrar al terminar.
  const [payNow, setPayNow] = useState(false);
  const payPlans: SaaSPlan[] = soldPlans.filter((p) => p === "basic" || p === "pro");

  useEffect(() => {
    const requestedPlan = new URLSearchParams(window.location.search).get("plan");
    // En el autoservicio, sin plan en la URL se sugiere Completo: es el de la prueba.
    const fallback = selfServe && soldPlans.includes("pro") ? "pro" : defaultPlan;
    setPlan(requestedPlan && isSaaSPlan(requestedPlan) && soldPlans.includes(requestedPlan) ? requestedPlan : fallback);
    if (new URLSearchParams(window.location.search).get("pagar") === "1") setPayNow(true);
  }, [soldPlans, defaultPlan, selfServe]);

  // Fork (agencia): de dónde llegó el alta (UTM, referido, referente). Primer toque.
  useEffect(() => {
    if (!adminMode) capturarOrigenAlta();
  }, [adminMode]);

  function setFailure(failure: RegisterFailure) {
    setError(failure.message);
    setExistingAccount(failure.existingAccount);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExistingAccount(false);
    setLoading(true);
    if (adminMode) {
      // Alta hecha por allok: el servidor crea la cuenta sin tocar la sesión
      // del admin y sin abrir el checkout.
      const response = await fetch("/api/saas/businesses", {
        method: "POST",
        // La ruta reenvía los headers a Better Auth: con la zona del navegador
        // el horario del negocio nace en ella y no en Ciudad de México.
        headers: { "content-type": "application/json", "x-timezone": browserTimeZone() },
        body: JSON.stringify({ name, email, password }),
      }).catch(() => null);
      const payload = (await response?.json().catch(() => null)) as
        { url?: string | null; message?: string } | null;
      setLoading(false);
      if (!response?.ok) {
        setError(payload?.message ?? "No se pudo crear el negocio.");
        return;
      }
      setCreated({ email, url: payload?.url ?? null });
      return;
    }
    let err: Awaited<ReturnType<typeof signUp.email>>["error"] | { status: number } | null;
    try {
      ({ error: err } = await signUp.email(
        { name, email, password },
        // El horario de respuesta del negocio nace en la zona del navegador.
        { headers: { "x-timezone": browserTimeZone() } },
      ));
    } catch {
      // Sin respuesta del servidor (sin internet, servidor caído).
      err = { status: 0 };
    }
    if (err) {
      setLoading(false);
      setFailure(registerFailure(err));
      return;
    }
    // Fork (agencia): anota el origen con tope de 2,5 s; nunca frena el alta.
    await enviarOrigenAlta();
    if (selfServe && !payNow) {
      // Prueba de 7 días sin tarjeta: el siguiente paso es el primero de la
      // puesta en marcha («Tu negocio»), en el subdominio del negocio. El
      // cobro llega después, desde Facturación.
      await goToTenant(FIRST_SETUP_HREF);
      return;
    }
    const checkout = await fetch("/api/saas/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: selfServe ? selfServePlan : plan }),
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
    // En el autoservicio la prueba ya corre: sin checkout configurado sigue
    // como si hubiera elegido probar gratis.
    const destino = payload?.error?.code === "billing_unconfigured"
      ? selfServe ? FIRST_SETUP_HREF : "/overview?billing=unavailable"
      : "/settings/billing?checkout=failed";
    await goToTenant(destino);
  }

  const selfServePlan: SaaSPlan = payPlans.includes(plan) ? plan : payPlans.includes("pro") ? "pro" : payPlans[0] ?? plan;

  async function goToTenant(path: string) {
    const tenant = await fetch("/api/saas/tenant").then((response) =>
      response.ok ? response.json().catch(() => null) : null
    ) as { url?: string | null } | null;
    if (tenant?.url && new URL(tenant.url).origin !== window.location.origin) {
      window.location.assign(`${tenant.url}${path}`);
      return;
    }
    router.push(path);
    router.refresh();
  }

  if (created) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Negocio creado</CardTitle>
          <CardDescription>
            {created.email} ya puede entrar{created.url ? <> en <a href={`${created.url}/login`} className="font-medium text-foreground hover:underline">{created.url.replace(/^https?:\/\//, "")}</a></> : null} con la contraseña que pusiste. Pídele que la cambie en Cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="w-full" onClick={() => { setCreated(null); setName(""); setEmail(""); setPassword(""); }}>
            Crear otro
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Empieza con tu negocio</CardTitle>
        <CardDescription>
          En unos minutos podrás conectar WhatsApp, probar respuestas y decidir cuándo activar tu agente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {selfServe ? (
          <fieldset className="mb-4 space-y-2">
            <legend className="sr-only">Cómo quieres empezar</legend>
            <label className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm ${payNow ? "border-border" : "border-brand-soft bg-brand-tint"}`}>
              <input type="radio" name="inicio" className="mt-1 accent-[var(--accent)]" checked={!payNow} onChange={() => setPayNow(false)} />
              <span>
                <span className="block font-semibold">Probar 7 días gratis</span>
                <span className="block text-xs text-text-3">Sin tarjeta. Eliges plan cuando termine la prueba.</span>
              </span>
            </label>
            {payPlans.length > 0 && (
              <label className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm ${payNow ? "border-brand-soft bg-brand-tint" : "border-border"}`}>
                <input type="radio" name="inicio" className="mt-1 accent-[var(--accent)]" checked={payNow} onChange={() => setPayNow(true)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Elegir mi plan ahora</span>
                  <span className="block text-xs text-text-3">Igual tienes tus 7 días gratis: el primer cobro llega cuando terminan.</span>
                  {payNow && (
                    <span className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
                      {payPlans.map((id) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={selfServePlan === id}
                          onClick={() => setPlan(id)}
                          className={`min-h-11 rounded-md border px-2 py-1.5 text-left ${selfServePlan === id ? "border-brand bg-background" : "border-border bg-background"}`}
                        >
                          <span className="block text-xs font-semibold">{PLAN_CATALOG[id].name}</span>
                          <span className="block text-xs text-text-3">US${PLAN_CATALOG[id].priceUsd}/mes</span>
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            )}
          </fieldset>
        ) : (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-soft bg-brand-tint px-3 py-2.5 text-sm"><span><span className="block text-xs text-text-3">Plan seleccionado</span><span className="font-semibold">{brand.Name} {PLAN_CATALOG[plan].name}</span></span><Link href={brand.pricingHref} className="inline-flex min-h-11 items-center text-xs font-semibold text-brand-text hover:underline">Cambiar</Link></div>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre del negocio</Label>
            <Input
              className="min-h-11"
              id="name"
              required
              placeholder={brand.id === "rei" ? "Inmobiliaria Pérez" : "Clínica Pérez"}
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se usará para sugerir tu subdominio, por ejemplo {exampleHost}.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              className="min-h-11"
              id="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={existingAccount || undefined}
              aria-describedby={existingAccount ? "register-error" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              className="min-h-11"
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p id="register-error" role="alert" className="text-sm text-destructive">
              {error}
              {existingAccount && (
                <>
                  {" "}
                  <Link href="/login" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                    Inicia sesión
                  </Link>
                </>
              )}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={loading}>
            {loading ? "Creando tu espacio…" : <>{selfServe && payNow ? "Continuar al pago" : "Continuar"} <ArrowRight className="ml-2 h-4 w-4" /></>}
          </Button>
          {selfServe && (
            <p className="text-center text-xs text-text-3">
              {payNow
                ? "Pagas con tarjeta en Stripe. Puedes cancelar antes de que terminen los 7 días."
                : "7 días gratis del plan Completo. Después eliges tu plan."}
            </p>
          )}
          <div className="rounded-lg border bg-subtle p-3">
            <p className="kicker">Lo que sigue</p>
            <ol className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-text-2">
              {SETUP_STEP_ORDER.map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <StateDot state="pausado" size={8} decorative />
                  {SETUP_STEP_META[key].label}
                </li>
              ))}
            </ol>
          </div>
          <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-text-3">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
            Tu agente empieza en pausa: no le escribe a nadie hasta que tú lo actives.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="inline-flex min-h-11 items-center text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
