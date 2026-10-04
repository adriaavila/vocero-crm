# DESIGN.md — allok (superficie SaaS)

La versión legible por agentes del sistema de la marca allok dentro del CRM.
Si te piden «construí esta pantalla en el lenguaje de allok», lee esto. Solo
aplica bajo `[data-saas="true"]` (`ALLOK_SAAS_MODE=true`); una instancia Vocero
self-hosted conserva su marca y no hereda nada.

## La idea

**allok = all systems OK.** El logotipo es `all ● k`: la `o` es un punto de
estado, así que la marca no se puede pintar sin decir cómo está la operación.
En verde se lee, literalmente, «all ok». De ahí sale todo lo demás: la paleta
es casi monocromática (Cloud y tinta) y **el color que queda significa estado**.
No hay ilustración ni robot: el producto es la estética. Los gráficos tampoco
son ilustración: son los datos dibujados con ese mismo punto.

## Color

| rol | claro | oscuro | uso |
|---|---|---|---|
| página | `--ground` #f7f8f8 (Cloud) | #0b0d0e (tinta) | fondo de pantalla (`bg-subtle`) |
| tarjeta | `--bg` #ffffff | #111416 | paneles, listas, formularios (`bg-background`) |
| texto | `--ink` #0b0d0e · `--text-2` #5b6167 · `--text-3` #676d73 | #f7f8f8 · #a7adb2 · #868c92 | `--text-4` (#8a9097) solo decorativo |
| reglas | `--hairline` 9% tinta · `--rule` 15% | 9% / 15% Cloud | bordes, separadores |
| acento | tinta (`SAAS_BRANDING`) | Cloud con letra en tinta | la acción principal; el negocio puede cambiarlo en Marca |

Los cuatro estados (espejo de `allok-fun/src/lib/brand.ts`), cada uno con
**punto** (pinta, y se lee sobre tinta), **tinta** (el estado como texto sobre
Cloud) y **suave** (fondo de píldora):

| estado | punto | tinta | cuándo |
|---|---|---|---|
| `activo` · *all ok* | #20e58d | #0a7a48 | atendido, todo en orden |
| `atendiendo` | #5b8cff | #2348cc | el agente está trabajando ahora |
| `atencion` · *Requiere atención* | #ffb020 | #7a5600 | algo espera por una persona |
| `pausado` | #8a9097 | #5a6066 | apagado a propósito / quieto |

- El verde de marca da 1,56:1 sobre Cloud: es **relleno, nunca letra** en claro.
- Un estado es siempre **punto + palabra**, nunca un punto solo.
- `app/globals.css` los expone como `--st-*`; en un elemento, `data-state="…"`
  fija `--st`, `--st-ink` y `--st-soft` (ya en su versión oscura dentro de tinta).
- El verde de WhatsApp (#d9fdd3) pinta **burbujas** y nada más. allok pinta estado.
- El rojo (#e5484d) no es un estado: es un fallo o algo que se borra. Como
  relleno o punto; el **texto** rojo usa `--danger-text` (`text-destructive-text`,
  #b42318 en claro, #ff6369 en oscuro), porque #e5484d sobre blanco da 3,9:1.
- Signal Blue (#315cff) es «trabajando»; su degradado a verde es de la web, no de la app.

## Tipografía

Geist para cada palabra; el display va por **peso y tracking**, nunca por cara
(títulos 600–700, −0.035em). JetBrains Mono para etiquetas (`.kicker`: 10.5px,
mayúsculas, +0.14em), horas y cifras — siempre `tabular-nums`. Sin serif ni
itálicas de adorno.

## Piezas

- **`AllokWordmark` / `StateDot`** (`components/agencia/allok/mark.tsx`). El
  logotipo recibe el estado real; no tiene default.
- **El símbolo** (`ALLOK_MARK` en `lib/favicon.ts`, espejo de `MARK`): un
  círculo que el punto cierra, Cloud sobre tinta, el punto a 130° en el color
  del estado. Va donde no cabe la palabra: favicon, ícono de la app, imagen para
  compartir. Nunca junto al logotipo (serían dos puntos diciendo lo mismo).
- **Estado vivo** (`system-state.tsx`): llega resuelto del servidor
  (`server/agencia/estado.ts`) y se relee con cada evento SSE y cada minuto. El
  símbolo de la pestaña lleva el mismo punto. Un icono subido en Marca le gana.
- **Cromo en tinta**: la barra lateral (`data-allok-nav`) y la tarjeta de estado
  de Inicio (`.ak-ink`) son tinta en los dos temas: es donde el punto se lee.
- **Inicio** (`control-center.tsx`): el centro de mando. Su trabajo es
  contestar «¿qué atiendo ahora?». De arriba abajo: el saludo y **una línea
  que cuenta** cuántas conversaciones te necesitan (o «Todo al día»), con su
  punto; la tarjeta de estado **compacta** en tinta, que describe SOLO al
  sistema (`activo` «allok contesta por ti», `atendiendo` mientras trabaja,
  `pausado` si el agente está apagado) y nunca repite la línea de arriba;
  **«Por dónde arrancar»**, tarjetas con la ventana de 24 h que le queda a cada
  una (deslizables en el teléfono, rejilla en escritorio) y un solo botón,
  «Responder»; **«Pregúntale a allok»**; **la línea del día** (`day-line.tsx`,
  la firma de la pantalla: un punto por conversación de hoy a su hora, el
  horario del equipo y el turno del agente); y **«Cómo va»** con las cifras de
  Hoy · 7 · 30 · 90 días. La puesta en marcha queda al final.
  - **Una sola regla de «esperando»** (`server/agencia/prioridades.ts`): lo
    último que dijo el cliente no tiene respuesta posterior (un saliente que
    falló no cuenta; si el agente decidió callar, o ya contestó un traspaso,
    tampoco se espera a nadie). El encabezado, el punto del logotipo, la barra,
    el icono de la pestaña y los puntos de la línea del día salen de ella.
  - La tarjeta es punto + palabra: el punto es el estado (`atencion` con la
    ventana abierta, `pausado` con la ventana cerrada, `atendiendo` si el
    agente la está contestando) y la palabra es lo que le queda: «Quedan 3 h»,
    «Ventana cerrada: solo con plantilla». Con menos de una hora el verbo cambia
    y pesa más: **«Se cierra en 7 min»**. La primera tarjeta lleva el botón
    principal; las demás, en contorno. Solo se rotula quién atiende cuando es
    allok («allok la está contestando»): lo demás es tuyo y no hace falta decirlo.
  - El orden es el de la urgencia: las que se cierran antes primero, después
    las cerradas. La razón (pidió una persona, preguntó el precio, llegó por un
    anuncio, sin respuesta) etiqueta; no ordena.
  - Las tres preguntas sugeridas de «Pregúntale» se contestan con los datos en
    el servidor, sin modelo ni cupo; solo el texto libre usa IA, y lo dice.
- **Embudo** (`embudo.tsx`, a partir del de rei-crm): cuántos llegaron al
  menos a cada etapa y «de cuántos» (2 / de 2, no 100 %); en Inicio se rotula
  «Ahora» porque no depende del periodo elegido; por el centro bajan
  puntos. Vertical en Inicio, acostado arriba del tablero. Sin Pro, la forma
  vacía y ninguna cifra.
- **La semana del agente** (`agent-week.tsx`): 7 × 24 puntos, uno por hora:
  verde contesta el agente, tinta el equipo, hueco nadie. Se redibuja mientras
  el dueño edita el horario.
- **Portada** (`auth-frame.tsx` + `noche.tsx`): «Mientras duermes», un tablero
  de conversaciones de una noche cualquiera en el código de color. Es la
  promesa, no un dato: no lleva cifras.
- **Puesta en marcha** (`setup-progress.tsx`, `lib/setup-steps.ts`): cuatro
  pasos, **Conectar WhatsApp · Tu negocio · Probar · Activar**, derivados de la
  preparación del servidor y dibujados igual en WhatsApp, Tu agente, Probar e
  Inicio. Cada paso es punto + palabra: listo es *all ok* (verde, «Listo»), el
  que toca es **un punto de tinta** («Ahora») y el resto *pausado* (gris,
  «Pendiente»). En el teléfono es una fila: los cuatro puntos y el nombre del
  paso de ahora. Crear la cuenta pasa antes y no es un paso. **Sin contadores
  escritos a mano** («paso 2 de 6»): el avance sale del servidor o no se dice.
  Con el agente activo no se dibuja: el dueño que vuelve ve su operación.
- **Tarjeta del número** (`whatsapp-conexion.tsx`): el número y tres hechos por
  separado, cada uno con su evidencia: vinculado, *recibimos mensajes* y
  *enviamos respuestas* (última respuesta que WhatsApp entregó), o «Por
  verificar», que no es un error. Una sola acción principal. IDs, token y
  webhook viven bajo «Conexión manual (soporte)», cerrado.
- **Tu negocio** (`tu-negocio.tsx`): lo primero de Tu agente. Qué vendes,
  precios, zona, preguntas frecuentes y cuándo pasar con una persona, con los
  textos de ejemplo solo como *placeholder*. Lo técnico va en «Avanzado»,
  cerrado. Solo entra lo que el dueño escribió; un guardado que falla conserva
  el texto y dice por qué.
- **Activar** (`activar.tsx`): antes del botón, el número, cuándo responde (y
  quién atiende ahora) y qué hará el agente. Si falta algo, la lista del
  servidor con un enlace para arreglar cada cosa; si no se pudo saber qué
  falta, error con reintentar y **ningún** botón de activar. Pausar es siempre
  inmediato.
- **Probar** (`probar.tsx`): el resultado de la simulación en palabras (pasó,
  pasó antes de que cambiara la información, o no pasó y qué se corrige y
  dónde). Una respuesta que propone el revisor nunca se rellena sola: la
  escribe el dueño.
- **Botones**: esquina de 10px, sin levantar al pasar, presión 0.97 (`--btn-*`).
- **Avatares** neutros: el color es estado, no identidad.
- **Interruptor** encendido: pista verde de estado, perilla en tinta.

## Reglas de estado

`lib/estado.ts` (con su prueba en `tests/unit/estado.test.ts`). Una
conversación: traspasada → atención; última palabra del negocio → all ok;
última del cliente hace menos de 10 min con el agente → atendiendo; sin leer
dentro de la ventana de 24 h → atención; leída o fría → quieta. El negocio:
WhatsApp y el plan primero, después quién espera, después si el agente está
apagado, después si está trabajando.

## Movimiento y gráficos

El punto de `all ● k` es la unidad de todo gráfico: cada conversación y cada
lead es un punto con el color de su estado, y el movimiento es la operación
trabajando. El vocabulario es el de allok.fun, en `globals.css` («Movimiento de
allok»):

| pieza | qué hace | dónde |
|---|---|---|
| `ak-enter` | entra subiendo 10 px (allok-enter) | etiquetas, la tira del embudo |
| `ak-count` · `Cifra` | la cifra sube dígito por dígito (count-up) | cifras de Inicio |
| `ak-grow-x` / `ak-grow-y` | barras y bandas que crecen desde su base | semana, embudo, horario |
| `ak-drop` | un punto cae a su sitio | la línea del día |
| `ak-pop` | un punto aparece; lo que cambia, en ola | la semana del agente |
| `ak-flow` | trazo punteado que avanza (flow-line) | el turno del agente que corre ahora, leads bajando por el embudo |
| `ak-draw` · `Anillo` | un arco que se cierra hasta su valor | atendidas solas |
| `StateDot motion` | el Lottie ok-dot rehecho en CSS: *esperando* respira (atención, pausado), *procesando* gira (atendiendo), *resuelto* se cierra en punto una vez (all ok); *secuencia*, los tres | logotipo, estado de Inicio, portada |
| `ak-night` | una conversación llega, allok la atiende, queda resuelta | portada del login |

- **Lo que se mueve solo dice algo que está pasando**: el turno del agente
  fluye mientras corre, el punto de `atendiendo` gira. Todo lo demás entra una
  vez y se queda quieto, con su palabra al lado.
- Entradas de 280 ms, datos hasta 560 ms, escalonado de 12 a 70 ms; una curva,
  `--ease-out`. El punto *esperando* respira cada 2 s (la web, cada 1 s: el
  CRM se mira todo el día).
- Un punto chico de lista late solo en `atendiendo`; el punto vivo va de 12 px
  para arriba, más chico el anillo no se lee.
- Un gráfico nunca inventa un número: sin datos se dibuja la forma vacía y una
  frase («Cuando alguien escriba, aparece aquí como un punto.»).
- La presión es la única respuesta táctil de un botón. Siempre
  `transition-property` con nombre, nunca `transition: all`.
- `prefers-reduced-motion` deja cada cosa en su estado final: el punto lleno,
  el tablero con lo ya resuelto, los bucles en una vuelta.

## Sí / No

- **Sí**: tokens por nombre, nunca hex en un componente; estado = punto + palabra;
  una acción principal por pantalla; español, segunda persona, `allok` en minúscula.
- **No**: el ámbar para «el paso que toca» (el ámbar es *atención*: algo que
  espera por una persona o está roto; un paso de la puesta en marcha que
  simplemente toca va en tinta), colores de adorno, degradados, emoji en la interfaz, un verde que no
  signifique «todo bien», un número inventado, un movimiento que no diga nada,
  un contador de pasos escrito a mano, jerga al dueño (WABA, token, webhook,
  prompt) fuera de «Avanzado» y «Conexión manual (soporte)», y rellenar con
  texto generado lo que el dueño no escribió.
