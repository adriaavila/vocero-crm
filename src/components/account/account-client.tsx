"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast-provider";

export function AccountClient() {
  const notify = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    setError(null);
    if (newPassword !== confirmPassword) return setError("Las contraseñas nuevas no coinciden.");
    setSaving(true);
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setSaving(false);
    if (result.error) return setError("No se pudo cambiar. Comprueba tu contraseña actual.");
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    notify("Contraseña actualizada; cerramos tus otras sesiones.");
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace)]">
      <header className="border-b bg-background px-4 py-4 md:px-6"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-4">Cuenta</p><h1 className="mt-1 text-lg font-[680]">Mi cuenta</h1></header>
      <main className="mx-auto max-w-xl p-4 md:p-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand" />Cambiar contraseña</CardTitle><CardDescription>Al guardar se cerrarán tus otras sesiones abiertas.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="current-password">Contraseña actual</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="new-password">Nueva contraseña</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="confirm-password">Confirmar contraseña</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button disabled={saving || currentPassword.length < 8 || newPassword.length < 8 || confirmPassword.length < 8} onClick={() => void changePassword()}>{saving ? "Guardando…" : "Cambiar contraseña"}</Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
