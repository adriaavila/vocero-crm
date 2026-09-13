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

## Bloqueado — necesita a Adrian

- [ ] **Token de Cloudflare** `Zone:DNS:Edit` sobre `allok.fun` en
      `~/CreativOS/_secrets/cloudflare.env`. No existe ninguno en la máquina ni
      en el llavero, así que `whatsapp`, `admin` y `*.allok.fun` no se pueden
      crear. **Esto bloquea todo lo demás.**
- [ ] Certificado Origin CA `*.allok.fun` cargado en Coolify, con Cloudflare en
      Full (strict).
- [ ] `ALLOK_SAAS_WEBHOOK_VERIFY_TOKEN` en Vercel = el
      `META_WEBHOOK_VERIFY_TOKEN` de la instancia. La API de Coolify **no
      devuelve valores** de variables (bien por ella), así que hay que copiarlo
      desde su panel. Rotarlo no vale: el token es el path del webhook y
      cambiarlo deja el número actual sin recibir nada hasta rehacer el override
      en Meta.
- [ ] Stripe: sólo hay una clave **restringida y de producción** (`rk_live_`).
      Para probar el embudo sin dinero real hace falta una de prueba
      (`sk_test_`), y para estrenar en vivo, la decisión suya. Crear los precios
      Básico USD 29/mes y Pro USD 99/mes y el endpoint de webhook.
- [ ] Decidir si Pro lleva prueba gratuita (`trial_period_days`). El código ya
      la honra.
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
- [ ] Correr `scripts/alta-vocero.sh` completo con un slug de prueba y borrarlo
      después — el Camino B nunca se ha ejecutado entero.
- [ ] Escribir el runbook de **baja** de cliente. Está esbozado en
      `docs/operations/clients.md` y no existe como procedimiento.

## Decisiones abiertas

- [ ] La cookie de sesión vive en `.allok.fun`, así que viaja a todos los
      productos de la raíz. Aislarla cuesta USD 10/mes de Advanced Certificate
      Manager y cambiar `ALLOK_ROOT_DOMAIN`. Hoy se mitiga reservando cada
      subdominio de producto.
- [ ] Hay cuatro escalas de precio incoherentes entre el producto, `/desk` de
      allok.fun, la oferta del wiki y `src/lib/pricing.ts`. Desplegar con 29/99
      deja las otras tres en evidencia.
