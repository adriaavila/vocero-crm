/*
 * Fork — avisos al celular. Este service worker solo hace dos cosas: mostrar
 * el aviso que manda el servidor (src/server/agencia/avisos.ts) y, al tocarlo,
 * abrir la conversación. No cachea nada: la app sigue siendo 100 % en línea.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "allok", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Tienes un aviso";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      // El mismo tag reemplaza al aviso anterior; `renotify` hace que suene igual.
      renotify: Boolean(data.tag),
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      data: { url: data.url || "/inbox" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (v.url.startsWith(self.location.origin) && "focus" in v) {
          v.navigate(url).catch(() => {});
          return v.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
