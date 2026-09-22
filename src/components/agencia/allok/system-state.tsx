"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { STATE_DOT, type SystemSnapshot } from "@/lib/estado";
import { allokFaviconSvg } from "@/lib/favicon";
import { useEvents } from "@/components/use-events";

const ICON_ID = "allok-state-icon";

const SystemStateContext = createContext<{ snapshot: SystemSnapshot; revision: number } | null>(null);

/** El estado de la operación, o null fuera del SaaS. */
export function useSystemState(): SystemSnapshot | null {
  return useContext(SystemStateContext)?.snapshot ?? null;
}

/** Sube cada vez que el estado se relee: quien muestra datos del momento
 *  (Inicio) lo usa para refrescarse sin abrir otra conexión. */
export function useSystemRevision(): number {
  return useContext(SystemStateContext)?.revision ?? 0;
}

/**
 * Capa de agencia: mantiene vivo el estado de la operación en todo el
 * cascarón. Llega resuelto del servidor (sin parpadeo: el punto nunca arranca
 * en un verde que no sabe si es cierto) y se relee cuando algo cambia.
 *
 * ponytail: abre su propio EventSource junto al de la bandeja; si el número
 * de conexiones por pestaña llega a importar, compartir uno en use-events.
 */
export function SystemStateProvider({
  initial,
  customFavicon,
  children,
}: {
  initial: SystemSnapshot;
  /** El negocio subió su icono: la pestaña es suya, no se toca. */
  customFavicon: boolean;
  children: React.ReactNode;
}) {
  const [{ snapshot, revision }, setValue] = useState({ snapshot: initial, revision: 0 });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh() {
    // Un mensaje trae dos eventos (mensaje + conversación): una sola lectura.
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(async () => {
      const res = await fetch("/api/estado").catch(() => null);
      if (!res?.ok) return;
      const next = (await res.json()) as SystemSnapshot;
      setValue((v) => ({ snapshot: next, revision: v.revision + 1 }));
    }, 400);
  }

  useEvents({
    onMessageNew: refresh,
    onConversationUpdated: refresh,
    onReconnect: refresh,
  });

  // «Atendiendo» caduca solo (diez minutos sin respuesta pasan a «te toca»):
  // sin eventos no hay quién lo note, así que se relee cada minuto a la vista.
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    return () => {
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  // El icono de la pestaña lleva el mismo punto: una pestaña fijada avisa en
  // ámbar sin que haya que mirarla. Va en un <link> propio y no en el de los
  // metadatos: ese lo maneja React, que lo repone al refrescar. Con varios
  // iconos igual de buenos el navegador usa el ÚLTIMO, así que el nuestro se
  // mantiene al final del <head> aunque Next agregue otro después.
  const state = snapshot.state;
  useEffect(() => {
    if (customFavicon) return;
    let link = document.getElementById(ICON_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = ICON_ID;
      link.rel = "icon";
      link.type = "image/svg+xml";
    }
    link.href = `data:image/svg+xml,${encodeURIComponent(allokFaviconSvg(STATE_DOT[state]))}`;
    const icon = link;
    const keepLast = () => {
      if (document.head.lastElementChild !== icon) document.head.appendChild(icon);
    };
    keepLast();
    const observer = new MutationObserver(keepLast);
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [state, customFavicon]);
  // Fuera del SaaS (al cerrar sesión) vuelve el icono de los metadatos.
  useEffect(() => () => document.getElementById(ICON_ID)?.remove(), []);

  return (
    <SystemStateContext.Provider value={{ snapshot, revision }}>{children}</SystemStateContext.Provider>
  );
}
