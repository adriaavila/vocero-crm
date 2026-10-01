# Guion E2E — Embedded Signup de Meta EN la app (fork)

> Automatizado en `scripts/e2e-embedded-signup.mjs` contra `pnpm dev` con
> wa-mock (`META_GRAPH_BASE_URL` → wa-mock/graph) y
> `META_APP_ID`/`META_ES_CONFIG_ID` configurados. Sin ellos, `/settings/whatsapp`
> sigue mostrando el enlace guiado de allok.fun (fallback) y este guion no
> aplica.

## Camino feliz (coexistencia)

1. `/settings/whatsapp` con Embedded Signup configurado muestra UN botón
   principal "Conectar WhatsApp" (ya no el enlace guiado de allok.fun).
2. El botón navega a `${appOrigin}/conectar-whatsapp?org=<slug>` (host de la
   app, nunca el subdominio del inquilino).
3. El bridge: carga el SDK de Meta, ofrece "Ya uso WhatsApp Business" (default)
   y, si `META_ES_CONFIG_ID_CLOUD_API` está configurado, "Número nuevo".
4. Tras `FB.login` (en el self-test, un `code` de mock en vez del popup real):
   `POST /api/whatsapp/embedded-signup/complete` guarda credenciales, fija el
   override del webhook a ESTA instancia, lo verifica releyendo
   `subscribed_apps`, y pide el sync de coexistencia (`smb_app_state_sync` +
   `history`) UNA sola vez.
   ✅ Respuesta `{ok:true, displayPhoneNumber, verifiedName, mode, redirectTo}`.
   ✅ `GET /api/settings/whatsapp` refleja el WABA/número nuevos, `status:
   "connected"`.
   ✅ El mock ve el override apuntando a `/api/webhooks/wa/<verify_token>` de
   esta instancia (mismo valor que `/api/provision`).
5. Reconectar el MISMO número no repite el sync (guard en
   `organization.metadata.allok.whatsappSignup`).

## Caminos infelices

6. Token sin `whatsapp_business_management`/`whatsapp_business_messaging` →
   403 con la lista de permisos faltantes; nada se guarda.
7. Meta invalida el token de negocio (`debug_token.is_valid=false`) → 502.
8. El número ya está conectado a OTRA organización → 409 `phone_in_use` (unit:
   `whatsapp-signup-complete.test.ts`; el e2e solo tiene una organización).
9. Estado firmado que no coincide con la cookie vigente (vencido, reusado, o
   de otra sesión) → 403; el bridge muestra "Tu sesión de conexión expiró".
10. Plan SaaS inactivo → 402 en `/config`; el bridge (o la página, si el
    fetch nunca llega a ocurrir) muestra "Activa tu plan".

## Webhook — campos que siguen al override

11. `smb_app_state_sync` hace upsert de nombres de contacto; JAMÁS crea
    conversación ni mensaje.
12. `history` inserta mensajes pasados, idempotente por `wa_message_id`;
    nunca publica en el bus de eventos ni dispara un turno del agente ni
    toca `conversation.lastMessageAt`/`unreadCount`.
13. Un payload con forma inesperada en cualquiera de los dos campos se
    descarta (contado, no lanzado) y no afecta el procesamiento de
    `messages` en el mismo payload.
