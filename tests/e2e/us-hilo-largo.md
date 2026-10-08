# Historia — un chat largo abre rápido

Un cliente con meses de mensajes no debe hacer que su chat tarde en abrir ni
que cada envío vuelva a bajar todo el historial.

1. Llega un cliente y escribe 95 mensajes (con la IA pausada en su chat).
2. Al abrir el chat se ven los últimos 80 y, arriba, «Ver mensajes anteriores».
3. La API entrega la última página con `hasMore: true` y la anterior con
   `?beforeId=<el más viejo cargado>`, sin repetir ni perder ninguno.
4. Un toque en «Ver mensajes anteriores» trae el primer mensaje y el botón
   desaparece.
5. El dueño contesta: su respuesta aparece al final y lo ya cargado se queda.

Automatizado en `scripts/e2e-hilo-largo.mjs`.
