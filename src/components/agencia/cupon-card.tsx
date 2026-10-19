"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Fork (agencia): canjear un código de plan gratis desde Facturación
 * (`/api/saas/billing/cupon`). Es el respaldo del registro: si el código no
 * sirvió al crear la cuenta, o el negocio ya existía, se prueba aquí.
 */
export function CuponCard({ initialError = null }: { initialError?: string | null }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function canjear(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch("/api/saas/billing/cupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo }),
    }).catch(() => null);
    setLoading(false);
    if (response?.ok) {
      router.refresh();
      return;
    }
    const payload = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
    setError(payload?.error?.message ?? "No pudimos revisar el código. Intenta de nuevo.");
  }

  return (
    <form onSubmit={canjear} className="rounded-lg border bg-background p-5">
      <Label htmlFor="cupon-facturacion" className="text-sm font-semibold">¿Tienes un código de cupón?</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input
          id="cupon-facturacion"
          className="min-h-11 max-w-xs uppercase"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={60}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "cupon-error" : undefined}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
        />
        <Button type="submit" variant="outline" className="min-h-11" disabled={loading || !codigo.trim()}>
          {loading ? "Revisando…" : "Activar"}
        </Button>
      </div>
      {error && <p id="cupon-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </form>
  );
}
