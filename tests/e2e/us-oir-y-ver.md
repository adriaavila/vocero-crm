# us-oir-y-ver — el agente oye las notas de voz y ve las fotos

**Historia**: un cliente manda una nota de voz o la foto de un comprobante. El
agente contesta lo que dijo o lo que se ve (no repite su respuesta anterior), y
el dueño ve en la bandeja lo mismo que entendió el agente.

## Turno del agente (Rei) — `tests/unit/oir-y-ver-realdb.test.ts`

Contra Postgres real, con el turno real y un proveedor de IA falso:

1. «hola» → respuesta → nota de voz: la respuesta trata lo que dijo la nota
   (antes contestaba «hola» otra vez) y la transcripción queda en el mensaje.
2. El turno siguiente no vuelve a transcribir la misma nota.
3. Foto con pie «ya pagué»: el agente lee lo que se ve y el pie de foto.
4. Nota de voz que no se pudo bajar: el agente pide que se lo escriban; nada
   queda guardado y el turno no se cae.

## Bandeja — `scripts/e2e-oir-y-ver.mjs`

1. Llegan por el webhook una foto con pie y una nota de voz.
2. Se guarda lo que se vio y lo que se oyó (primera escritura gana).
3. En la bandeja, bajo la foto: «El agente vio: …»; bajo la nota:
   «Transcripción: …»; el pie de foto sigue visible.
