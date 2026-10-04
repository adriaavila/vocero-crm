#!/usr/bin/env bash
# Crea en Stripe lo que necesita el cobro SaaS: los productos, sus precios
# mensuales, el webhook y el portal del cliente (cambio de plan y cancelación). Idempotente por lookup_key y por URL del webhook:
# correrlo dos veces no duplica nada. Imprime las variables para Coolify.
#
#   STRIPE_KEY=sk_live_… scripts/stripe-saas-setup.sh
#
# El whsec sólo se ve la vez que se crea el webhook: guárdalo en
# ~/CreativOS/_secrets/ en ese momento.
set -euo pipefail
: "${STRIPE_KEY:?pon STRIPE_KEY=sk_live_… (o sk_test_…)}"
WEBHOOK_URL="${WEBHOOK_URL:-https://whatsapp.allok.fun/api/saas/billing/webhook}"
api() { curl -sS -u "$STRIPE_KEY:" "https://api.stripe.com/v1/$1" "${@:2}"; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

echo "Cuenta: $(api account | field "d['id'], d['settings']['dashboard']['display_name'], 'cobros:', d['charges_enabled']")"
case "$STRIPE_KEY" in sk_live_*|rk_live_*) echo "MODO REAL";; *) echo "modo prueba";; esac

price() { # lookup_key nombre centavos
  local id
  id=$(api "prices?lookup_keys[]=$1&active=true" | field "d['data'][0]['id'] if d['data'] else ''")
  if [ -z "$id" ]; then
    local product
    product=$(api products -d "name=$2" -d "metadata[plan]=$1" | field "d['id']")
    id=$(api prices -d product="$product" -d currency=usd -d unit_amount="$3" \
      -d "recurring[interval]=month" -d lookup_key="$1" | field "d['id']")
  fi
  echo "$id"
}
BASIC=$(price allok_saas_basic_monthly "allok · Esencial" 4900)
PRO=$(price allok_saas_pro_monthly "allok · Completo" 9900)
INMO=$(price allok_saas_inmobiliaria_monthly "allok · Agencia" 29900)
product_of() { api "prices/$1" | field "d['product']"; }

HOOK=$(api "webhook_endpoints?limit=100" | field "next((w['id'] for w in d['data'] if w['url']=='$WEBHOOK_URL'), '')")
if [ -z "$HOOK" ]; then
  SECRET=$(api webhook_endpoints -d url="$WEBHOOK_URL" \
    -d "api_version=2026-04-22.dahlia" \
    -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=customer.subscription.created" \
    -d "enabled_events[]=customer.subscription.updated" \
    -d "enabled_events[]=customer.subscription.deleted" \
    -d "enabled_events[]=invoice.paid" \
    -d "enabled_events[]=invoice.payment_failed" | field "d['secret']")
else
  SECRET="(ya existía $HOOK: usa el whsec que guardaste)"
fi

# Portal del cliente: sin esto no puede cambiar de plan ni cancelar solo. Se
# actualiza la configuración por defecto (o se crea si no hay), así que correrlo
# dos veces deja lo mismo. Esencial y Completo se intercambian; Agencia no entra
# (se vende hablando).
PORTAL=$(api "billing_portal/configurations?limit=20" | field "next((c['id'] for c in d['data'] if c['is_default']), '')")
PORTAL_ARGS=(
  -d "business_profile[headline]=Tu plan de allok"
  -d "features[invoice_history][enabled]=true"
  -d "features[payment_method_update][enabled]=true"
  -d "features[subscription_cancel][enabled]=true"
  -d "features[subscription_cancel][mode]=at_period_end"
  -d "features[subscription_update][enabled]=true"
  -d "features[subscription_update][default_allowed_updates][]=price"
  -d "features[subscription_update][proration_behavior]=create_prorations"
  -d "features[subscription_update][products][0][product]=$(product_of "$BASIC")"
  -d "features[subscription_update][products][0][prices][]=$BASIC"
  -d "features[subscription_update][products][1][product]=$(product_of "$PRO")"
  -d "features[subscription_update][products][1][prices][]=$PRO"
)
if [ -z "$PORTAL" ]; then
  PORTAL=$(api billing_portal/configurations "${PORTAL_ARGS[@]}" | field "d['id']")
  PORTAL_NOTE="creada $PORTAL (si no queda como predeterminada, márcala en Stripe: Ajustes > Facturación > Portal del cliente)"
else
  api "billing_portal/configurations/$PORTAL" "${PORTAL_ARGS[@]}" | field "d['id']" >/dev/null
  PORTAL_NOTE="actualizada $PORTAL (cambiar entre Esencial y Completo, cancelar al final del periodo, actualizar pago)"
fi
echo "Portal del cliente: $PORTAL_NOTE"

cat <<EOF

Variables para Coolify (vocero-crm):
ALLOK_SAAS_STRIPE_SECRET_KEY=<la misma clave que usaste aquí>
ALLOK_SAAS_STRIPE_BASIC_PRICE_ID=$BASIC
ALLOK_SAAS_STRIPE_PRO_PRICE_ID=$PRO
ALLOK_SAAS_STRIPE_INMO_PRICE_ID=$INMO
ALLOK_SAAS_STRIPE_WEBHOOK_SECRET=$SECRET
EOF
