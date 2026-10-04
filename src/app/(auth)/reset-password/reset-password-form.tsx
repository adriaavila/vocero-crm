"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(token === null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);
    const { error: err } = await authClient
      .resetPassword({ newPassword: password, token })
      .catch(() => ({ error: { status: 0, code: "NETWORK" } }));
    setLoading(false);
    if (err) {
      if (err.status === 429) {
        setError("Demasiados intentos. Espera unos minutos.");
      } else if (err.code === "INVALID_TOKEN") {
        // Venció mientras escribías, o el enlace ya se usó.
        setExpired(true);
      } else {
        setError("No pudimos cambiar la contraseña. Intenta de nuevo.");
      }
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Contraseña actualizada</CardTitle>
          <CardDescription role="status">
            Ya puedes entrar con la nueva. Cerramos tus otras sesiones por seguridad.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className={cn(buttonVariants(), "h-11 w-full")}>
            Iniciar sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (expired) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Este enlace ya no sirve</CardTitle>
          <CardDescription role="alert">
            Venció o ya se usó. Pide uno nuevo y te lo mandamos al correo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link href="/forgot-password" className={cn(buttonVariants(), "h-11 w-full")}>
            Pedir un enlace nuevo
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="inline-flex min-h-11 items-center text-primary hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Elige una contraseña nueva</CardTitle>
        <CardDescription>Mínimo 8 caracteres.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña nueva</Label>
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={loading}>
            {loading ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
