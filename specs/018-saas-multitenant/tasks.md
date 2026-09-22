# Tareas — 018 SaaS multi-tenant

> **Estado real: el modo SaaS está ENCENDIDO en producción desde el
> 2026-09-19.** Las secciones "Bloqueado" y "Pendiente" de más abajo son de
> antes y han quedado atrás; la rama `feat/dawn-dusk-saas` las actualizó el
> 2026-09-18 y sigue sin fusionar. Lo de hoy está al final, en "Encendido".

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

## Encendido (2026-09-19)

Vivo en `crm.allok.fun` + `whatsapp.allok.fun` + `admin.allok.fun` +
`*.allok.fun`, commit `330b925`. Los tres bloqueadores que quedaban escritos
resultaron ser dos resueltos y uno caduco.

- [x] Reservar `preview` y `staging` en `main` (`330b925`, escogido de
      `feat/dawn-dusk-saas`; el resto de esa rama sigue sin fusionar). Sin esto,
      con el comodín vivo, un negocio podía registrarse como `preview` y
      quedarse con un host que ya usamos.
- [x] Dominios `whatsapp.` y `admin.` añadidos a la app, con certificado Let's
      Encrypt emitido por HTTP-01 **a través del proxy de Cloudflare**
      (comprobado contra el origen: `CN=whatsapp.allok.fun`, `CN=admin.allok.fun`).
- [x] **El comodín no lo puede generar Coolify.** Su versión (4.3.19) sólo
      emite una regla `Host()` por FQDN — no tiene comodines, y en un SaaS
      el subdominio aparece cuando el cliente se registra. Resuelto con un
      router `HostRegexp` en el file-provider de Traefik
      (`/data/coolify/proxy/dynamic/allok-saas-tenants.yaml`, versionado en
      `ssh-c001/deploy/traefik/` con su README). `priority: 1` para que
      cualquier `Host()` concreto le gane. Sin `certResolver` a propósito: LE no
      emite comodines por HTTP-01 y Cloudflare, en modo Full, acepta el
      certificado por defecto de Traefik. Comprobado en vivo:
      `<cualquiera>.allok.fun` devuelve **404 de la app**, no 503 de Traefik.
- [x] **El Origin CA no era bloqueador para funcionar.** Cloudflare está en
      Full (no strict) — se comprobó viendo que deja pasar el 503 del origen en
      vez de devolver un 526. Pasar a Full (strict) sigue pendiente y sigue
      siendo del panel, pero es endurecimiento.
- [x] Stripe cargado desde la cuenta **sandbox** `acct_1UDsQhJ9ye9C94el`, con
      endpoint de webhook nuevo `we_1UHPosJ9ye9C94elgSSFf29C` →
      `https://whatsapp.allok.fun/api/saas/billing/webhook`. El `whsec` en
      `~/CreativOS/_secrets/allok-saas-stripe-whatsapp.env`.
- [x] Webhook de cobro comprobado de verdad, no por inspección: firma válida →
      `200 {"received":true,"ignored":true}`; firma falsa → `400
      invalid_signature`. Nota para el futuro: Cloudflare responde 1010 a
      user-agents como el de `python-urllib`; el de Stripe pasa.
- [x] Alta real de punta a punta por HTTP: registro en `whatsapp.allok.fun` →
      subdominio propio → panel en su host con la cookie compartida de
      `.allok.fun` → host de inquilino inexistente 404. **Aislamiento
      comprobado en vivo:** con la sesión del inquilino de prueba,
      `crm.allok.fun/api/conversations` devuelve `[]`, no los 184 chats del
      legacy — el host no da acceso, lo da la organización de la sesión. El
      inquilino de prueba se borró al terminar.
- [x] `ALLOK_SAAS_WEBHOOK_VERIFY_TOKEN` puesto en Vercel — **pero el bloqueador
      estaba caduco.** Ese valor sólo alimenta el destino *builtin* `vocero`,
      que ya no se usa: el SaaS pide el de `ALLOK_ONBOARDING_DESTINATION`
      (= `crm-principal`), que es una fila en `handover_destinations` y
      responde 200 con un enlace de Embedded Signup válido.

### Lo que se rompió al encender

- [x] **El gate de plan dejó mudo al número que ya funcionaba.** Con
      `ALLOK_SAAS_MODE=true`, `canAutomate()` exige `active`/`trialing`, y
      ninguna organización existente tenía `metadata.allok.billing`. Entre las
      15:11 y las 15:21 UTC la respuesta automática estuvo cerrada en
      `crm.allok.fun`. **No llegó a costar nada:** los mensajes de esa ventana
      se recibieron y se guardaron todos, y caían en una conversación con la IA
      ya apagada — de las 184, sólo 12 la tienen encendida y ninguna recibió
      nada en esos diez minutos. El agujero era real aunque nadie se cayera
      dentro. Resuelto concediendo `pro`/`active` a mano a
      `principal` y a `mistica`, con `source: manual_grant_2026_09_19` para que
      nunca se confunda con una suscripción real.
      **Al runbook:** conceder el plan a las organizaciones existentes **antes**
      del deploy que enciende la bandera, no después.

### Deuda que esto deja

- [ ] Los dos inquilinos de hoy viven de una concesión manual en la base de
      datos, no de Stripe. Mientras el cobro esté en sandbox eso es lo correcto;
      en cuanto pase a producción, hay que decidir qué pasa con ellos.
- [ ] El `META_WEBHOOK_VERIFY_TOKEN` de la instancia salió impreso en la sesión
      de Claude del 2026-09-19 (lo devuelve `/api/provision` dentro de
      `webhook_url`). No abre nada por sí solo —`META_APP_SECRET` sigue
      verificando la firma de todo evento real— pero rotarlo obliga a rehacer
      el override en Meta de **los dos** números. Decisión tuya.

## Mudanza de Mística al SaaS — a medias (2026-09-19)

- [x] Inquilino `mistica` creado (`org_b8s70n4fy48mzx2x90dc`);
      `mistica.allok.fun` responde 200.
- [x] Credencial de WhatsApp entregada por `/api/provision` (200, organización
      "Mística"). El token se descifró dentro del contenedor de la instancia
      dedicada y viajó por la API oficial: no pasó por ninguna máquina de por
      medio ni se imprimió.
- [x] Plan concedido a mano; contraseña temporal en
      `~/CreativOS/_secrets/mistica-saas.env`.
- [ ] **El corte.** Redirigir el `override_callback_uri` de la WABA
      `245315565329406` en Meta. Es irreversible y es lo que mueve los mensajes;
      hasta entonces siguen llegando a `mistica.frontia.app`, que es donde deben
      estar mientras tanto. `retry-connection` **no vale**: busca la conexión
      por `workspace`, y en allok el número está bajo el de la instancia vieja
      → 404.
- [ ] Apagar la instancia dedicada, sólo después de ver un ida y vuelta real en
      el inquilino nuevo.

## Comprobado en vivo con un inquilino real (2026-09-19)

FR-3 y FR-10 sólo tenían evidencia local. Ahora la tienen en producción, con la
sesión de Mística —un inquilino de verdad, no un arnés—:

- [x] **El host no da acceso; lo da la organización de la sesión.** Con su
      sesión, `crm.allok.fun/api/conversations` devuelve `[]` (lo suyo), no las
      184 conversaciones del inquilino legacy. Lo mismo salió antes con una
      cuenta de prueba desechable.
- [x] **El panel interno está cerrado y no se delata.** Mística no está en
      `ALLOK_ADMIN_EMAILS` y recibe `404` en `/admin` desde los tres hosts
      (`admin.`, `crm.` y el suyo) — `notFound()`, no un login que confirme que
      la pantalla existe.
- [x] **El alta está cerrada fuera de su host.** `crm.allok.fun` responde `403`
      con "El registro de Allok empieza en whatsapp.allok.fun". El formulario se
      pinta en todos los hosts a propósito: la pantalla reconoce ese error y lo
      enseña en vez de fallar mudo. Por eso mirar el HTML engaña, y por eso
      `ssh-c001/scripts/check-saas.sh` comprueba la respuesta de la API.
- [x] **Ningún otro producto de la raíz acepta la sesión.** `inmox.allok.fun`
      recibe la cookie —viaja a todo `.allok.fun`— y responde `401`, porque
      tiene otro `BETTER_AUTH_SECRET` y otra base de datos. El riesgo que queda
      no es suplantación sino transmisión: el valor de la cookie llega a todos
      esos orígenes.
- [x] **El embudo de cobro crea checkout de los dos planes**: Básico cobra 49
      el mismo día, Pro cobra 0 sobre 99/mes, que son los 7 días de prueba.
      (`subscription_data` no se devuelve al leer una sesión de Stripe; el dato
      que lo demuestra es `amount_total`.) Todo en sandbox, y el cliente de
      prueba y las sesiones quedaron borrados.

### Lo que no se pudo correr

- [ ] `scripts/saas-isolation-check.mjs` contra producción. El arnés resuelve el
      inquilino mandando `x-forwarded-host` a mano, y detrás de Traefik esa
      cabecera la pone el proxy. Sirve en local, no en vivo; lo de arriba es su
      sustituto en producción.
