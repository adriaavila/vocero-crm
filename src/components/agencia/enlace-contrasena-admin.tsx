"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Link = { url: string; email: string; expiresAt: string };

/**
 * Fork (agencia): en /admin, el enlace para que un usuario del negocio elija
 * una contraseña nueva. Sin correo de por medio: el admin lo copia y se lo
 * manda por WhatsApp. Vale una hora y una sola vez; crear otro anula el
 * anterior.
 */
export function EnlaceContrasenaAdmin({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function create() {
    setPending(true);
    setError("");
    setCopied(false);
    const response = await fetch(`/api/saas/businesses/${tenantId}/password-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(email.trim() ? { email: email.trim() } : {}),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as (Link & { message?: string }) | null;
    setPending(false);
    if (!response?.ok || !data?.url) {
      setLink(null);
      setError(data?.message ?? "No se pudo crear el enlace.");
      return;
    }
    setLink({ url: data.url, email: data.email, expiresAt: data.expiresAt });
  }

  async function copy() {
    if (!link) return;
    const ok = await navigator.clipboard?.writeText(link.url).then(() => true, () => false);
    setCopied(Boolean(ok));
  }

  if (!open) {
    return (
      <Button className="h-11" variant="ghost" onClick={() => setOpen(true)}>
        Enlace para cambiar contraseña
      </Button>
    );
  }

  const until = link ? new Date(link.expiresAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="mt-3 w-full rounded-md border border-border bg-subtle px-3 py-3 text-xs text-text-2">
      <p>
        Crea un enlace de un solo uso para que un usuario de {tenantName} elija una contraseña nueva. Vale una hora
        y anula los enlaces anteriores. Mándalo solo a esa persona.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          className="h-11 w-[260px] text-xs"
          type="email"
          placeholder="Correo del usuario (vacío = el dueño)"
          aria-label={`Correo del usuario de ${tenantName}`}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button className="h-11" variant="outline" disabled={pending} onClick={() => void create()}>
          {pending ? "Creando…" : link ? "Crear otro" : "Crear enlace"}
        </Button>
        <Button className="h-11" variant="ghost" onClick={() => { setOpen(false); setLink(null); setError(""); }}>
          Cerrar
        </Button>
      </div>
      {link && (
        <div className="mt-3">
          <p>
            Para <strong>{link.email}</strong>, vale hasta las {until}:
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code data-testid="enlace-contrasena" className="block max-w-full break-all rounded bg-card px-2 py-1.5 font-mono text-[11px]">
              {link.url}
            </code>
            <Button className="h-11" variant="outline" onClick={() => void copy()}>
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
