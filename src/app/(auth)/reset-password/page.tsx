"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Better Auth redirige aquí con ?error=INVALID_TOKEN si el enlace caducó.
  if (!token || params.get("error")) {
    return (
      <p className="text-sm text-muted-foreground">
        Este enlace ya no sirve.{" "}
        <Link href="/forgot-password" className="text-primary hover:underline">
          Pide uno nuevo
        </Link>
        .
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (err) {
      setError(
        err.code === "PASSWORD_TOO_SHORT"
          ? "La contraseña necesita al menos 8 caracteres."
          : "El enlace caducó o ya se usó. Pide uno nuevo."
      );
      return;
    }
    router.push("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Guardando…" : "Guardar contraseña"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Elige una contraseña nueva</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
