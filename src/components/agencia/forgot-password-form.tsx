"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "limited">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    // La misma respuesta exista o no la cuenta: la pantalla no confirma correos.
    setState(error?.status === 429 ? "limited" : "sent");
  }

  if (state === "sent") {
    return (
      <p className="text-sm" role="status">
        Si hay una cuenta con <strong>{email}</strong>, te llegó un enlace para
        elegir una contraseña nueva. Vale una hora.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Correo de tu cuenta</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {state === "limited" && (
        <p className="text-sm text-destructive">Demasiados intentos. Espera unos minutos.</p>
      )}
      <Button type="submit" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? "Enviando…" : "Enviarme el enlace"}
      </Button>
    </form>
  );
}
