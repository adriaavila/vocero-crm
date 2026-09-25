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
No hay ilustración ni robot: el producto es la estética.

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
  funcionando?»; debajo, lo de hoy (conversaciones, atendidas solas, leads,
  esperan por ti) y las conversaciones, primero las que esperan.
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

## Movimiento

Poco, y siempre con una señal quieta al lado. La presión es la única respuesta
táctil. El punto late **solo** en `atendiendo` (algo en vuelo). Siempre
`transition-property` con nombre, nunca `transition: all`. `prefers-reduced-motion`
lo apaga todo.

## Sí / No

- **Sí**: tokens por nombre, nunca hex en un componente; estado = punto + palabra;
  una acción principal por pantalla; español, segunda persona, `allok` en minúscula.
- **No**: colores de adorno, degradados, emoji en la interfaz, un verde que no
  signifique «todo bien», un número inventado.
