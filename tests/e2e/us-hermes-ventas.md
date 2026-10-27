# Guion E2E — Reporte de ventas para Hermes

Automatizado en `scripts/e2e-hermes-ventas.mjs`.

1. Un cliente escribe al WhatsApp del negocio.
2. Hermes pide `GET /api/hermes/ventas` con `X-API-Key: $HERMES_API_KEY`.
3. La respuesta trae `texto` listo para el celular (negrita de WhatsApp por
   defecto, HTML con `formato=telegram`), las `sugerencias` y los `datos`.
4. El reporte cuenta al cliente que escribió (una conversación más que antes) y
   el texto dice esa cifra. Ningún teléfono sale en la respuesta.

Camino infeliz: sin llave o con otra llave, 401; un `periodo` que no existe,
400; un `negocio` que no existe, 404. Sin `HERMES_API_KEY` en el servidor, la
ruta responde 404 (módulo apagado).
