"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";

/**
 * Fork — «Avísame en este teléfono». Cuando el agente pasa una conversación a
 * una persona o agenda una cita, al dueño le llega una notificación aunque no
 * tenga allok abierto (src/server/agencia/avisos.ts). Sin esto, el cliente que
 * pidió hablar con alguien esperaba hasta que el dueño abriera la bandeja.
 */

type Estado =
  | { kind: "cargando" }
  | { kind: "sin_soporte"; iphone: boolean }
  | { kind: "bloqueado" }
  | { kind: "apagado" }
  | { kind: "encendido"; endpoint: string };

function esIphoneSinInstalar(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function aBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registro(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function AvisosCelular() {
  const notify = useToast();
  const [estado, setEstado] = useState<Estado>({ kind: "cargando" });
  const [ocupado, setOcupado] = useState(false);

  const leer = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setEstado({ kind: "sin_soporte", iphone: esIphoneSinInstalar() });
      return;
    }
    if (Notification.permission === "denied") {
      setEstado({ kind: "bloqueado" });
      return;
    }
    try {
      const reg = await registro();
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setEstado({ kind: "apagado" });
        return;
      }
      const res = await fetch(`/api/avisos?endpoint=${encodeURIComponent(sub.endpoint)}`);
      const data = res.ok ? ((await res.json()) as { subscribed: boolean }) : { subscribed: false };
      setEstado(data.subscribed ? { kind: "encendido", endpoint: sub.endpoint } : { kind: "apagado" });
    } catch {
      setEstado({ kind: "apagado" });
    }
  }, []);

  useEffect(() => {
    void leer();
  }, [leer]);

  async function activar() {
    setOcupado(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? { kind: "bloqueado" } : { kind: "apagado" });
        return;
      }
      const { publicKey } = (await (await fetch("/api/avisos")).json()) as { publicKey: string };
      const reg = await registro();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(publicKey) });
      }
      const res = await fetch("/api/avisos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("no se guardó");
      setEstado({ kind: "encendido", endpoint: sub.endpoint });
      notify("Listo: te avisamos en este teléfono.");
    } catch {
      notify("No pudimos activar los avisos en este navegador. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  async function probar() {
    setOcupado(true);
    try {
      const res = await fetch("/api/avisos/prueba", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      notify(data.ok ? "Te mandamos un aviso de prueba." : "No pudimos mandar el aviso. Vuelve a activarlos.");
      if (!data.ok) void leer();
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    if (estado.kind !== "encendido") return;
    setOcupado(true);
    try {
      await fetch("/api/avisos", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: estado.endpoint }),
      });
      const reg = await navigator.serviceWorker.getRegistration("/");
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      setEstado({ kind: "apagado" });
    } finally {
      setOcupado(false);
    }
  }

  if (estado.kind === "cargando") return null;

  if (estado.kind === "encendido") {
    return (
      <section aria-label="Avisos en tu teléfono" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border bg-background px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-[14px] text-text-2">
          <Check className="h-4 w-4 text-foreground" aria-hidden />
          Te avisamos en este teléfono cuando un cliente te necesite.
        </p>
        <span className="ml-auto flex gap-1">
          <button type="button" disabled={ocupado} onClick={probar} className="min-h-11 rounded-[10px] px-3 text-sm font-semibold hover:underline disabled:opacity-60">
            Probar
          </button>
          <button type="button" disabled={ocupado} onClick={apagar} className="min-h-11 rounded-[10px] px-3 text-sm text-text-3 hover:underline disabled:opacity-60">
            Dejar de avisarme
          </button>
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Avisos en tu teléfono" className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[16px] border bg-background px-4 py-3 md:px-5">
      <div className="min-w-0 max-w-xl">
        <p className="mb-1 flex items-center gap-2.5 text-[15px] font-semibold">
          <BellRing className="h-4 w-4" aria-hidden />
          Entérate cuando un cliente te necesite
        </p>
        <p className="text-[14px] leading-relaxed text-text-2">
          {estado.kind === "apagado" &&
            "Si un cliente pide hablar contigo o tu agente agenda una cita, te llega un aviso al teléfono aunque no tengas la app abierta."}
          {estado.kind === "bloqueado" &&
            "Los avisos están bloqueados en este navegador. Actívalos en los permisos del sitio (el candado junto a la dirección) y recarga."}
          {estado.kind === "sin_soporte" &&
            (estado.iphone
              ? "En iPhone: toca Compartir y luego «Agregar a inicio». Abre la app desde ese ícono y activa los avisos aquí."
              : "Este navegador no puede recibir avisos. Ábrelo en Chrome o en Safari para activarlos.")}
        </p>
      </div>
      {estado.kind === "apagado" && (
        <button
          type="button"
          disabled={ocupado}
          onClick={activar}
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform] active:scale-[0.97] disabled:opacity-60"
        >
          Avísame en este teléfono
        </button>
      )}
    </section>
  );
}
