# us-recuperar — Clientes que no volvieron

Automatizado en `scripts/e2e-recuperar.mjs`.

1. Tres clientes llevan 120 días sin escribir: Ana vino a una cita, Beto
   solo preguntó, Caro vino y tiene otra cita en 5 días.
2. El ajuste nace apagado; encenderlo sin mensaje responde 422.
3. En «Tu negocio», «Mandar el mensaje a Meta» crea `recuperar_clientes`
   (MARKETING) y la tarjeta dice que espera la aprobación.
4. Meta la aprueba; el dueño elige «90 días» y queda guardado.
5. A las 23:00 locales la pasada no escribe; a las 15:00 le escribe a Ana con
   su nombre y el del negocio. A Beto y a Caro no. Una segunda pasada no
   repite.
6. Ana contesta y Ajustes cuenta que volvió.
7. Infelices: plantilla inexistente 422, días negativos 422.
