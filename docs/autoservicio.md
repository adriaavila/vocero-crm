# Autoservicio del SaaS

Decisión de Adrian, 2026-10-03: abrir el autoservicio. Un desconocido entra por
allok.fun, se registra, prueba 7 días el plan Completo (tope de 300 respuestas
de IA), conecta su WhatsApp y, si olvida la contraseña, la recupera solo.

Todo el código ya está detrás de variables y apagado por defecto. Esta página
es la lista de lo que hay que encender, en orden. Nada de aquí se ejecuta
solo: cada paso lo hace una persona con acceso a Coolify, Stripe, Meta y
Resend.

## Encender el autoservicio

El orden importa: primero el CRM completo, al final los botones públicos de
allok.fun. Mientras `SAAS_SELF_SERVE` no sea `true`, `/register` solo sirve a
los admins de allok y a nadie más.

1. **Fusionar los dos PRs del CRM** (`feat/onboarding-simple` y
   `feat/self-serve-open`, repo `vocero-crm`) y desplegar.
   Cambia: el alta guiada y la recuperación de contraseña existen en el
   código. No enciende nada: sigue todo detrás de las variables de abajo.

2. **Correo para recuperar la contraseña.** En Coolify, app `vocero-crm`,
   variables de runtime:
   - `RESEND_API_KEY`: llave de Resend con permiso "Sending access".
   - `EMAIL_FROM`: remitente de un dominio verificado en Resend (Domains, con
     sus registros SPF y DKIM en el DNS), por ejemplo
     `allok <no-reply@allok.fun>`.
   - Confirma que `APP_BASE_URL` es el host de la app: el enlace del correo se
     arma con él.

   Cambia: `/login` pasa de "Escríbenos por WhatsApp" a "¿Olvidaste tu
   contraseña?", que lleva a `/forgot-password`. El enlace vale 1 hora, se usa
   una vez y cierra las sesiones abiertas de la cuenta. Con una sola de las dos
   variables el conector queda apagado y nada se envía.

3. **Stripe en modo real**, en las mismas variables de Coolify:
   - `ALLOK_SAAS_STRIPE_SECRET_KEY`: `sk_live_` o `rk_live_`, no `_test_`.
   - `ALLOK_SAAS_STRIPE_BASIC_PRICE_ID` (Esencial, US$49) y
     `ALLOK_SAAS_STRIPE_PRO_PRICE_ID` (Completo, US$99): ids de precio del modo
     real.
   - `ALLOK_SAAS_STRIPE_WEBHOOK_SECRET`: de un webhook del modo real hacia
     `<host de la app>/api/saas/billing/webhook` con los eventos
     `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid` e `invoice.payment_failed`.

   Cambia: quien termina los 7 días puede pagar desde Facturación. Sin esto la
   prueba vence y nadie puede convertirse en cliente.

4. **Embedded Signup de Meta, versión 4.** Variables: `META_APP_ID`,
   `META_ES_CONFIG_ID` (coexistencia) y, si quieres ofrecer número nuevo,
   `META_ES_CONFIG_ID_CLOUD_API`. En developers.facebook.com, en la app:
   - La configuración de Facebook Login for Business usada está en v4 (v2 y v3
     se retiran el 2026-10-15).
   - Allowed Domains for the JavaScript SDK incluye el host de
     `ALLOK_SAAS_APP_URL`. El flujo corre siempre en ese host, nunca en
     `<negocio>.allok.fun`, así que no hacen falta comodines.
   - La app está en modo Live y con los permisos `whatsapp_business_management`
     y `whatsapp_business_messaging` aprobados para clientes que no son tuyos.

   Cambia: "Conectar WhatsApp" abre el flujo dentro de la app. Sin estas
   variables cae al enlace guiado de allok.fun (`ALLOK_SAAS_LINK_URL` y
   `ALLOK_SAAS_LINK_SECRET`), que sí requiere a allok en el medio.

5. **Abrir el registro.** En Coolify, `SAAS_SELF_SERVE=true` en `vocero-crm` y
   redeploy.
   Cambia: `/register` y `POST /api/auth/sign-up/email` aceptan a cualquiera
   en el host de la app. Cada alta nace con 7 días de Completo, sin tarjeta y
   con tope de 300 respuestas de IA, sin importar el `?plan=` del enlace. Rei
   no participa: su alta sigue pasando por el checkout.

6. **Encender los botones públicos.** Fusionar el PR de allok.fun (repo
   `creativ3`, rama `feat/self-serve-open`) y desplegar.
   Cambia: `SELF_SERVE` en `src/lib/plans.ts` pasa a `true`; los dos planes
   del sitio apuntan a `<CRM_APP_URL>/register?plan=...` en vez de "Hablemos".
   Hasta este paso nadie nuevo llega solo, así que es el interruptor de
   entrada.

7. **Una prueba real, de punta a punta, en un teléfono.**
   - Desde allok.fun, tocar un plan y registrarse con un correo propio.
   - Conectar un número de WhatsApp real y mandarle un mensaje: debe
     contestar el agente.
   - En otro navegador, pedir "¿Olvidaste tu contraseña?" con ese correo:
     debe llegar el correo (revisa spam la primera vez), el enlace debe abrir
     la pantalla de contraseña nueva y la contraseña nueva debe entrar.
   - En Facturación, comprobar que se ven los días de prueba y que pagar abre
     el checkout del modo real (se puede cancelar antes de pagar).

## Apagarlo

Se apaga en el mismo orden inverso y sin tocar datos:
`SAAS_SELF_SERVE=false` (o quitar la variable) y redeploy cierra el registro
público; `SELF_SERVE = false` en allok.fun devuelve los botones a "Hablemos".
Las cuentas ya creadas siguen funcionando.

## Pendiente a propósito

- **Verificación de correo al registrarse.** `requireEmailVerification` sigue
  en `false` (R1 de `specs/019-allok-producto/auditoria.md`): alguien puede
  registrarse con el correo de otra persona. El conector de correo ya permite
  resolverlo; falta decidir si bloquea el acceso hasta verificar.
- **Plantilla de correo por negocio.** El correo sale con la marca del
  despliegue (`BRAND`), no con la del negocio.
