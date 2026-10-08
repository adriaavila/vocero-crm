# Guion E2E — «Enséñaselo a tu agente»

Automatizado en `scripts/e2e-ensenar.mjs`.

1. Llega un mensaje de un cliente con una pregunta que el agente no sabía.
2. El dueño la contesta desde la bandeja.
3. Bajo su respuesta aparece «Enséñaselo a tu agente».
4. Al tocarlo, el diálogo trae la pregunta del cliente y la respuesta del dueño ya puestas.
5. «Guardar» la deja como pregunta y respuesta del conocimiento (`/api/kb`), y el aviso dice «Listo: tu agente ya lo sabe».
6. El botón deja de ofrecerse, también al recargar.

Camino infeliz: si el guardado falla, el diálogo dice «No se pudo guardar» y no se cierra.
Solo el dueño ve el botón (el conocimiento es de `withOwner`).
