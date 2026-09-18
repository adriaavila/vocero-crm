# Tareas — 018 SaaS multi-tenant

Lo que queda sin marcar está **bloqueado por acceso, dinero o una decisión**, y
ésa es la definición de hecho de este repo: no se marca por estar desplegado ni
por estar en verde local.

## Aterrizado (2026-09-12)

- [x] Commitear la capa SaaS: inquilinos por subdominio, cobro con Stripe,
      derechos por plan, horario de atención, cola durable del agente y panel
      interno (`7e7f708`).
- [x] Renombrar las migraciones del fork al rango `9xxx` antes de que upstream
      choque con ellas (`9003`–`9006`).
- [x] Mover el host del producto a `whatsapp.allok.fun` sin dejar el aviso de
      registro apuntando a una dirección muerta (`41ed1d9`).
- [x] Arreglar la regresión que dejaba a las instancias self-hosted sin su marca
      ni su logo en el favicon público y en el login (`c2359f0`).
- [x] Cerrar las tres puertas a WhatsApp sin plan activo, y mandar un checkout
      fallido a Facturación en vez de al panel (`c2359f0`).
- [x] Entrega automática del número al terminar el Embedded Signup, y su
      reintento cuando falla (`4dd741c` + `allok-fun d7dcab1`).
- [x] Decir la verdad cuando el token muere: "reconéctalo", no "conéctalo"
      (`8f713bf`).
- [x] Dejar el arnés de comportamiento verde de punta a punta sobre base nueva
      (457 comprobaciones) y el de aislamiento en 24/24.
- [x] Escribir el runbook único del alta y el inventario de clientes
      (`ssh-c001/docs/runbooks/alta-cliente-whatsapp.md`,
      `docs/operations/clients.md`).

## Desplegado (2026-09-13)

- [x] `main` empujado en `vocero-crm` y en `allok-fun`.
- [x] `crm.allok.fun` corriendo `b3cc862` **sin** `ALLOK_SAAS_MODE`: la capa
      nueva es no-op, y la instancia se llevó el fix de marca. `/api/health` ok,
      `/login` 200, `running:healthy`.
- [x] Las dos rutas del puente vivas en `allok.fun`
      (`/api/meta/tenant-onboarding-link` y `/api/meta/tenant-handover/retry`,
      401 sin Bearer, que es lo correcto).
- [x] Variables pareadas cargadas en los dos lados, con secretos generados y
      nunca impresos: `PROVISION_API_KEY` ↔ `ALLOK_SAAS_PROVISION_SECRET`,
      `ALLOK_SAAS_LINK_SECRET` en ambos, más `ALLOK_SAAS_LINK_URL`,
      `ALLOK_ROOT_DOMAIN`, `ALLOK_SAAS_APP_URL`, `ALLOK_LEGACY_HOST`,
      `ALLOK_ADMIN_EMAILS`, `ALLOK_SAAS_PROVISION_URL` y
      `NEXT_PUBLIC_SAAS_APP_URL`. Aplican en el próximo deploy de cada lado.
- [x] `coolify_manager.py deploy` usaba GET y Coolify ya exige POST; sin este
      arreglo `new-app.sh --deploy` —y por tanto `alta-vocero.sh`— moría en el
      último paso.

## Aterrizado (2026-09-18)

- [x] **Token de Cloudflare** resuelto. `~/CreativOS/_secrets/cloudflare.env`
      (chmod 600) verifica contra la API y ve la zona `allok.fun` activa. Con
      él se crearon los tres registros A proxied que faltaban:
      `whatsapp.allok.fun`, `admin.allok.fun` y `*.allok.fun` → 168.231.71.46.
      `crm.allok.fun` y `allok.fun` comprobados intactos después.
- [x] Stripe en **modo prueba**, cuenta `allok LLC` (`acct_1UDsQAQssTDjutCk`):
      precios Básico USD 49/mes (`price_1UH1v0QssTDjutCkvzEHBp2p`) y Pro
      USD 99/mes (`price_1UH1v2QssTDjutCkz7XyPXiT`), producto y precio de
      Implementación USD 499 pago único (`price_1UH1vIQssTDjutCkEydrB7yk`), y
      el endpoint de webhook (`we_1UH1vPQssTDjutCkRK6X9Z7z`) apuntando a
      `https://whatsapp.allok.fun/api/saas/billing/webhook` con los seis
      eventos que la ruta acepta. Los ids y el `whsec` quedaron en
      `~/CreativOS/_secrets/allok-saas-stripe-test.env` (chmod 600).
- [x] Precio decidido: Básico pasa de 29 a **49**; Pro se queda en 99; la
      implementación a medida se vende aparte a **499** de pago único. En vivo
      todavía está el precio de 29 — se archiva al pasar a producción, porque
      los precios de Stripe son inmutables.
- [x] La oferta ya no está incoherente entre el producto y `allok.fun`: la
      landing vende exactamente los dos planes que la app conoce (`basic`,
      `pro`) y su copia sale de lo que `hasSaaSPlan(org, "pro")` cierra de
      verdad. El botón de cada plan lleva a `/register?plan=…` de la app, no al
      Stripe del sitio, así que ya no existe el camino "paga y no recibe nada".

## Bloqueado — necesita a Adrian
- [ ] Certificado Origin CA `*.allok.fun` cargado en Coolify, con Cloudflare en
      Full (strict). El token de zona que tenemos es `Zone:DNS:Edit` y no puede
      ni leer el modo SSL ni emitir un Origin CA (eso usa
      `X-Auth-User-Service-Key`), así que este paso se hace en el panel. Hoy el
      origen sirve Let's Encrypt para `crm.allok.fun` y `TRAEFIK DEFAULT CERT`
      + 503 para cualquier subdominio no configurado — comprobado contra
      168.231.71.46 directo.
- [ ] `ALLOK_SAAS_WEBHOOK_VERIFY_TOKEN` en Vercel = el
      `META_WEBHOOK_VERIFY_TOKEN` de la instancia. La API de Coolify **no
      devuelve valores** de variables (bien por ella), así que hay que copiarlo
      desde su panel. Rotarlo no vale: el token es el path del webhook y
      cambiarlo deja el número actual sin recibir nada hasta rehacer el override
      en Meta.
- [ ] **Clave secreta de prueba de Stripe** (`sk_test_`) de la cuenta
      `allok LLC`. Stripe no la expone por API y no hay ninguna en la máquina:
      se copia de `dashboard.stripe.com/test/apikeys` con esa cuenta
      seleccionada y se pega en la línea vacía de
      `~/CreativOS/_secrets/allok-saas-stripe-test.env`. Sin ella el embudo no
      se puede probar sin dinero real. Los precios y el webhook ya están.
- [x] Decidir si Pro lleva prueba gratuita: sí, 7 días. `trialDaysForPlan`
      en `src/server/saas/billing.ts`, wireado al checkout (2026-09-15).
- [ ] Encender: añadir los dominios `whatsapp.` + `admin.` + `*.allok.fun` al
      mismo app de Coolify, poner `ALLOK_SAAS_MODE=true` y desplegar los dos
      lados. Se dejó sin hacer a propósito: añadir dominios sin DNS ni
      certificado toca el Traefik del número que hoy funciona.

## Pendiente después del despliegue

- [ ] Alta real de punta a punta con un segundo número propio: registro, pago en
      modo prueba, Embedded Signup, mensaje entrante en la bandeja del inquilino
      correcto y `override_callback_uri` confirmado en Meta.
- [ ] Camino infeliz en vivo: tumbar `PROVISION_API_KEY` un minuto, ver el fallo
      y recuperarlo con "Recuperar mi conexión".
- [ ] Comprobar que `crm.allok.fun` sigue funcionando como inquilino legacy con
      el número de siempre, sin reconectar nada.
- [x] Correr `scripts/alta-vocero.sh` completo por primera vez — no con un
      slug de prueba descartable, sino de verdad, con Mística (2026-09-15).
      Encontró un bug real en el momento: `new-app.sh` asumía `internal_db_url`
      en la respuesta de Coolify, que esta versión (4.3.19) nunca devuelve
      (ni el password), así que `DATABASE_URL` no se ponía y el deploy quedaba
      `exited:unhealthy` en silencio. Se resolvió a mano para el alta de hoy.
- [x] Arreglar `new-app.sh` de raíz (`ssh-c001/scripts/new-app.sh`,
      2026-09-15): arma `DATABASE_URL` con el password que el propio script
      genera al crear el Postgres, en vez de leerlo de vuelta de la API. Si el
      Postgres ya existía (password desconocido), ahora sale con `exit 1` y un
      mensaje claro en vez de desplegar roto en silencio. Verificado en vivo:
      ciclo completo alta→baja con un proyecto/app/Postgres/DNS de prueba,
      `DATABASE_URL` puesto solo, migraciones corriendo sin intervención
      manual, y todo el recurso de prueba borrado al final.
- [x] Escribir el runbook de **baja** de cliente:
      `ssh-c001/docs/runbooks/baja-cliente-whatsapp.md` (2026-09-15).

## Decisiones abiertas

- [ ] La cookie de sesión vive en `.allok.fun`, así que viaja a todos los
      productos de la raíz. Aislarla cuesta USD 10/mes de Advanced Certificate
      Manager y cambiar `ALLOK_ROOT_DOMAIN`. Hoy se mitiga reservando cada
      subdominio de producto.
- [x] Las escalas de precio incoherentes: resueltas entre el producto y
      `allok.fun` (49/99 + 499). Quedan `/desk` —retirado y `noindex`— y la
      oferta del wiki, que no son superficie de venta viva.
