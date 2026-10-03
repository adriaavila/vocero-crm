"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function ForgotPasswordForm({
  enabled,
  helpUrl,
  channelSuffix,
}: {
  /** El conector de correo está encendido (resuelto en el servidor). */
  enabled: boolean;
  /** Dónde escribir cuando no hay correo; null si la marca no tiene contacto. */
  helpUrl: string | null;
  /** "por WhatsApp" / "por correo". */
  channelSuffix: string;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await authClient
      .requestPasswordReset({ email, redirectTo: "/reset-password" })
      .catch(() => ({ error: { status: 0 } }));
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : "No pudimos enviar la solicitud. Intenta de nuevo.",
      );
      return;
    }
    // La misma respuesta exista o no la cuenta: no se puede averiguar qué
    // correos están registrados.
    setSent(true);
  }

  if (!enabled) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Restablecer contraseña</CardTitle>
          <CardDescription>
            {helpUrl
              ? "Por ahora lo hacemos contigo. Escríbenos desde el correo de tu cuenta y te devolvemos el acceso."
              : "Pide al propietario de la instancia que restablezca tu contraseña."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {helpUrl && (
            <a href={helpUrl} className={cn(buttonVariants(), "h-11 w-full")}>
              Escribir {channelSuffix}
            </a>
          )}
          <BackToLogin />
        </CardContent>
      </Card>
    );
  }

  if (sent) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Revisa tu correo</CardTitle>
          <CardDescription role="status">
            Si existe una cuenta con ese correo, te mandamos un enlace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Si no lo ves en unos minutos, mira en spam. El enlace vale 1 hora.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            Usar otro correo
          </Button>
          <BackToLogin />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Restablecer contraseña</CardTitle>
        <CardDescription>
          Escribe tu correo y te mandamos un enlace para elegir una nueva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              className="min-h-11"
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={loading}>
            {loading ? "Enviando…" : "Enviar enlace"}
          </Button>
          <BackToLogin />
        </form>
      </CardContent>
    </Card>
  );
}

function BackToLogin() {
  return (
    <p className="text-center text-sm text-muted-foreground">
      <Link href="/login" className="inline-flex min-h-11 items-center text-primary hover:underline">
        Volver a iniciar sesión
      </Link>
    </p>
  );
}
