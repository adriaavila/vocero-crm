# Guion E2E — vertical restaurante: de la conversación al pedido

Automatizado en `scripts/e2e-restaurante.mjs`.

**Historia**: un restaurante recibe pedidos por WhatsApp. Su agente conoce el
menú, arma el pedido con los precios del menú y lo deja «por confirmar»; una
persona lo revisa, pone el envío y lo pasa a cocina. Cada paso le avisa al
cliente con el total real.

## Preparación

- App viva con los mocks (`WA_MOCK_ENABLED=true`, ai-mock).
- El guion enciende el vertical del negocio (`organization.metadata.vertical =
  "restaurante"`) y al terminar lo deja como estaba.

## Pasos y lo que se observa

1. **Sin el vertical, la superficie no existe**: `/api/restaurante/menu` → 404
   `vertical_disabled`.
2. **Menú**: se carga el de ejemplo «Doña Brasa» (o ya había uno); alta de un
   producto con extras; un precio negativo se rechaza (422).
3. **El agente arma el pedido** («Escríbele como cliente», conversación de
   prueba): el cliente pide 2 Doble queso sin cebolla, papas y 2 Coca-Cola para
   envío. La respuesta la escribe el servidor con los precios del menú, no dice
   «confirmado», y queda un pedido `por_confirmar`, `isTest`, armado por el
   agente, con el subtotal exacto.
4. **Lo que no está en el menú no entra**: pedir «pizza» no crea ni cambia un
   pedido; el cliente lee que no está en el menú.
5. **Agotado por hoy**: se marca el flan agotado en Menú; al pedirlo, el agente
   dice que hoy no queda y no lo agrega.
6. **Solo una persona confirma**: sin modalidad no se confirma (409); con envío
   y su costo, el total es subtotal + envío; al confirmar, el cliente de prueba
   lee «Confirmado tu pedido #N. Total …» y nada sale a WhatsApp.
7. **Estados que solo avanzan**: de `en_cocina` no se salta a `entregado`
   (409); un pedido en cocina ya no se edita (409).
8. **Conversación real**: una persona arma un pedido a mano desde la bandeja,
   para retiro; al confirmarlo y marcarlo listo, el cliente recibe los dos
   avisos por WhatsApp (wa-mock). Se registra el cobro en efectivo.
9. **Pantallas**: el pedido aparece en la conversación (panel de detalles), en
   el tablero de Pedidos, y el menú muestra el producto agotado.
10. **Otro negocio no lo ve**: con el vertical apagado, todo vuelve a 404.
