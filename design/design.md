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
- El rojo (#e5484d) no es un estado: es un fallo o algo que se borra.
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
- **Inicio** (`control-center.tsx`): la primera línea contesta «¿está
  funcionando?»; debajo, **la línea del día** (`day-line.tsx`, la firma de la
  pantalla: un punto por conversación de hoy a su hora, el horario del equipo
  y el turno del agente), lo de hoy (conversaciones, atendidas solas de las de
  hoy con su anillo, leads, esperan por ti) y las conversaciones, primero las
  que esperan.
- **Embudo** (`embudo.tsx`, a partir del de rei-crm): cuántos llegaron al
  menos a cada etapa y qué parte pasó desde la anterior; por el centro bajan
  puntos. Vertical en Inicio, acostado arriba del tablero. Sin Pro, la forma
  vacía y ninguna cifra.
- **La semana del agente** (`agent-week.tsx`): 7 × 24 puntos, uno por hora:
  verde contesta el agente, tinta el equipo, hueco nadie. Se redibuja mientras
  el dueño edita el horario.
- **Portada** (`auth-frame.tsx` + `noche.tsx`): «Mientras duermes», un tablero
  de conversaciones de una noche cualquiera en el código de color. Es la
  promesa, no un dato: no lleva cifras.
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
- **No**: colores de adorno, degradados, emoji en la interfaz, un verde que no
  signifique «todo bien», un número inventado, un movimiento que no diga nada.
