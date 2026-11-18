# Vertical restaurante: de la conversación al pedido

Módulo opcional por organización (`organization.metadata.vertical =
"restaurante"`), como el inmobiliario. Apagado, su superficie responde 404 y
el agente no puede nombrar la acción de pedidos. Se enciende en el panel
admin («Encender menú y pedidos») o con `DEFAULT_VERTICAL=restaurante`.

## Qué agrega

| Pieza | Dónde |
|---|---|
| Reglas puras (precios del menú, estados, textos al cliente) | `src/lib/restaurante/pedido.ts` |
| Menú (categorías, productos, extras, «agotado por hoy») | `src/server/agencia/restaurante/menu.ts` · pantalla `/menu` |
| Pedidos (armar, editar, cambiar de estado, registrar cobro) | `src/server/agencia/restaurante/pedidos.ts` · pantalla `/pedidos` |
| La acción del agente `prepare_order` | `accion.ts` (esquema) · `turno.ts` (ejecución) |
| El pedido dentro de la conversación | `src/components/agencia/restaurante/pedido-panel.tsx` |
| Menú de ejemplo «Doña Brasa» (inventado) | `demo.ts` · `POST /api/restaurante/menu/demo` |
| Rutas | `/api/restaurante/menu`, `/api/restaurante/pedidos` (guardia `withRestaurante`) |
| Tablas | `menu_category`, `menu_item`, `customer_order`, `customer_order_item` |

## Las reglas que no se negocian

1. **El agente no escribe precios.** `prepare_order` solo lleva nombres,
   cantidades, extras y notas; el esquema no tiene dónde poner un monto. El
   servidor busca cada producto en el menú y escribe la respuesta al cliente
   con esos precios.
2. **Lo que no está en el menú no entra.** Un producto desconocido, apagado,
   agotado por hoy o con un extra que no existe vuelve como rechazo y el
   cliente lo lee; un nombre ambiguo no elige ninguno.
3. **Todo pedido nace «por confirmar».** A cocina solo lo pasa una persona con
   sesión (`POST /api/restaurante/pedidos/:id/estado`). El texto del agente
   nunca dice «confirmado».
4. **Los estados solo avanzan**: por confirmar → en cocina → listo → (en
   camino) → entregado; cancelar se puede hasta antes de entregar. Un pedido
   en cocina ya no se edita.
5. **allok registra el pago, no cobra.** `payment_status` lo marca una persona
   (QR o efectivo).
6. **Un pedido de prueba no sale a WhatsApp** (`is_test`): los avisos se
   guardan en la conversación de prueba y el tablero lo marca «Prueba».

## Lo que todavía no hace

- Con Nea como cerebro externo (`NEA_DISPATCH_URL`) el agente no arma pedidos:
  la acción vive en el agente interno. El menú sí le llega en el catálogo.
- Zonas de envío con su costo, pagos con enlace, inventario por cantidad,
  métricas de pedidos en Resultados y seguimientos a clientes que aceptaron.

## Probarlo

`node --env-file=.env scripts/e2e-restaurante.mjs` con la app y los mocks
arriba (guion `tests/e2e/us-restaurante.md`).
