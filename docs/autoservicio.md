# Autoservicio del SaaS

Decisión de Adrian, 2026-10-03: abrir el autoservicio. Un desconocido entra por
allok.fun, se registra, prueba 7 días el plan Completo (tope de 300 respuestas
de IA), conecta su WhatsApp y, si olvida la contraseña, la recupera solo.

Todo el código ya está detrás de variables y apagado por defecto. Esta página
es la lista de lo que hay que encender, en orden. Nada de aquí se ejecuta
solo: cada paso lo hace una persona con acceso a Coolify, Stripe, Meta y
Resend.

## Encender autoservicio

Lista ordenada. Cada paso dice quién lo hace, dónde y qué cambia. Nada se ejecuta
solo. Los pasos 1 a 3 no cambian nada visible; el registro se abre en el 6 y los
botones públicos en el 7.

### 0. Orden de fusión (GitHub)

1. `vocero-crm#52` (migración 9014).
2. `vocero-crm#51` (`feat/self-serve-open`: correo, recuperar contraseña).
3. `vocero-crm#53` (`feat/onboarding-simple`: puesta en marcha en 4 pasos).
4. `vocero-crm` `feat/saas-completo` (prueba visible, cobro, portal, correos).
5. `creativ3#39` (`feat/self-serve-open`: botones de allok.fun).

Desplegar el CRM después del 4 (Coolify lo hace al fusionar). Ninguno enciende
nada: todo sigue detrás de las variables de abajo.

### 1. Stripe en modo real (lo haces tú: crea objetos reales)

```bash
STRIPE_KEY=<ALLOK_SAAS_STRIPE_SECRET_KEY_LIVE de ~/CreativOS/_secrets/allok-saas-stripe.env> \
WEBHOOK_URL=https://whatsapp.allok.fun/api/saas/billing/webhook \
scripts/stripe-saas-setup.sh
```

Es idempotente. Crea (o reutiliza) los productos y precios de Esencial, Completo
y Agencia, el webhook (fijado a la versión `2026-04-22.dahlia`) y deja el portal
del cliente configurado: actualizar pago, cambiar entre Esencial y Completo y
cancelar al final del periodo. Imprime los ids de precio. **El `whsec_` del
webhook se ve una sola vez**: guárdalo en `~/CreativOS/_secrets/` en ese momento.
Si el webhook ya existía, usa el que guardaste.

Además, en el panel de Stripe (modo real): Ajustes, Facturación, Suscripciones y
correos: activa "Enviar correos por cobros fallidos" y los reintentos
automáticos. Es lo que avisa al cliente cuando su tarjeta falla.

### 2. Variables del CRM (Coolify, app `vocero-crm`, runtime)

| Variable | Valor |
|---|---|
| `ALLOK_SAAS_STRIPE_SECRET_KEY` | `sk_live_` o `rk_live_` (nunca `_test_`) |
| `ALLOK_SAAS_STRIPE_WEBHOOK_SECRET` | el `whsec_` del paso 1 |
| `ALLOK_SAAS_STRIPE_BASIC_PRICE_ID` | Esencial, US$49 |
| `ALLOK_SAAS_STRIPE_PRO_PRICE_ID` | Completo, US$99 |
| `ALLOK_SAAS_STRIPE_INMO_PRICE_ID` | Agencia (solo si `SAAS_PLANS` la incluye) |
| `RESEND_API_KEY` | llave de Resend, permiso "Sending access" |
| `EMAIL_FROM` | `allok <no-reply@allok.fun>` (dominio verificado en Resend con SPF y DKIM) |
| `META_APP_ID` | app de Meta |
| `META_ES_CONFIG_ID` | configuración de Embedded Signup (coexistencia) |
| `META_ES_CONFIG_ID_CLOUD_API` | opcional, número nuevo |
| `ALLOK_SAAS_APP_URL` | host de la app (sin él, `app.<dominio raíz>`) |
| `APP_BASE_URL` | déjala como está |

Cambia: Facturación abre el checkout real; sin `RESEND_API_KEY` y `EMAIL_FROM` no
sale ningún correo (ni recuperar contraseña ni los avisos de la prueba).

### 3. Meta, Embedded Signup v4 (developers.facebook.com, la app)

- La configuración de Facebook Login for Business está en v4 (v2 y v3 se retiran
  el 2026-10-15).
- Allowed Domains for the JavaScript SDK incluye el host de `ALLOK_SAAS_APP_URL`.
  El flujo corre siempre en ese host, no en `<negocio>.allok.fun`: no hacen falta
  comodines.
- App en modo Live, con `whatsapp_business_management` y
  `whatsapp_business_messaging` aprobados para clientes que no son tuyos.

### 4. Desplegar y revisar

Redeploy del CRM con las variables. Comprobar `GET /api/health` en verde.

### 5. Prueba de humo con el registro todavía cerrado

Con tu sesión de admin de allok, crea un negocio de prueba y recorre: conectar
WhatsApp, probar, activar, y en Facturación abrir el checkout (con la clave real
se puede cancelar antes de pagar). No pagues con una tarjeta tuya salvo que
quieras reembolsarla.

### 6. Abrir el registro

`SAAS_SELF_SERVE=true` en Coolify y redeploy. Cada alta nace con 7 días de
Completo, sin tarjeta y con tope de 300 respuestas de IA, sin importar el
`?plan=`. Rei no participa. Desde aquí corren los correos de la prueba ("termina
en 2 días", "terminó").

### 7. Encender los botones públicos

`NEXT_PUBLIC_SELF_SERVE=true` en el proyecto de allok.fun en Vercel y redeploy
(Next la lee en el build). La portada, la cabecera y los planes pasan a "Crear mi
cuenta"; los mensajes de venta de `/ops` mandan el registro en vez del Payment
Link; `/rei` y "A tu medida" siguen en WhatsApp.

### 8. Prueba de humo ya encendido (en un teléfono)

1. En allok.fun tocar "Crear mi cuenta" y registrarse con un correo propio.
2. Conectar un número real; mandarle un mensaje: contesta el agente.
3. Inicio muestra "Prueba gratis de Completo: te quedan 7 días" y las respuestas
   usadas. "Elegir plan" lleva a Facturación.
4. Elegir plan y pagar con una tarjeta propia (o cancelar antes). Al volver,
   Inicio dice "Pago recibido…" y a los segundos "Listo: tu plan está activo".
5. "Cambiar plan o cancelar" abre el portal de Stripe: ahí se ve el cambio entre
   Esencial y Completo y la cancelación.
6. En otro navegador: "¿Olvidaste tu contraseña?" llega el correo (revisa spam).
7. Reembolsa y cancela la suscripción de prueba en Stripe.

### Comprobación automática

`pnpm test:e2e:autoservicio` (contra un servidor local con Stripe en modo prueba,
el wa-mock y el correo apuntando a un registro local) falla si falta una pieza:
el tramo 0 lista las variables de arriba. Cubre registro, Embedded Signup, los
estados del plan, el cobro con eventos firmados, el equipo y los correos.

## Apagarlo

En orden inverso y sin tocar datos: quitar `NEXT_PUBLIC_SELF_SERVE` (o ponerla en
otro valor) en allok.fun y redeploy devuelve los botones a "Hablemos";
`SAAS_SELF_SERVE=false` (o quitar la variable) en el CRM y redeploy cierra el
registro público y detiene los correos de la prueba. Las cuentas ya creadas siguen
funcionando y los cobros activos siguen su curso en Stripe.

## Pendiente a propósito

- **Verificación de correo al registrarse.** `requireEmailVerification` sigue
  en `false` (R1 de `specs/019-allok-producto/auditoria.md`): alguien puede
  registrarse con el correo de otra persona. El conector de correo ya permite
  resolverlo; falta decidir si bloquea el acceso hasta verificar.
- **El registro revela correos existentes.** Con `SAAS_SELF_SERVE=true`,
  `POST /api/auth/sign-up/email` contesta 422 `USER_ALREADY_EXISTS` si el
  correo ya tiene cuenta, así que cualquiera puede comprobar si una persona es
  cliente. La pantalla de recuperación no lo hace (contesta igual exista o no),
  pero el registro sí. Se cierra junto con la verificación de correo.
- **Una persona escribe a un lead de `/ops` y se registra sola:** el pago ya no cierra ese lead automáticamente (el registro no lleva su id); se marca a mano.
- **Plantilla de correo por negocio.** El correo sale con la marca del
  despliegue (`BRAND`), no con la del negocio.
