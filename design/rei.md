# rei.md — Rei CRM (superficie pública y SaaS)

La versión legible por agentes del sistema de la marca Rei dentro del CRM.
Si te piden «construí esta pantalla en el lenguaje de Rei», lee esto. Solo
aplica bajo `[data-brand="rei"]` (`BRAND=rei`); allok y una instancia Vocero
sin marca no heredan nada de acá.

## De dónde sale

Portado de `adriaavila/vocero-inmobiliario` (fork de Vocero para
inmobiliarias, vendido bajo la marca REI en `reiprop.tech`). Las fuentes de
verdad allá:

- `src/app/globals.css`, tokens `--rei-*` — paleta esmeralda, plata, tinta.
- `src/app/rei-motion.css` — el vocabulario de movimiento (`.rei-reveal`,
  `.rei-lift`, `.rei-press`…), copiado literal a `src/app/rei-motion.css`.
- `tailwind.config.ts` del fork — Geist / Instrument Serif / Geist Mono.

Acá se refleja en `src/app/globals.css`, bloques `[data-brand="rei"]` (claro)
y `[data-theme="dark"][data-brand="rei"]` (oscuro), y en `src/lib/brand.ts`
(`defaultAccent`, contacto, precio, mensajes de WhatsApp). Si la marca cambia
allá, se cambian esos bloques, `src/lib/favicon.ts` (`REI_MARK_ACCENT`,
`reiFaviconSvg`) y este archivo.

## La idea

Rei es un CRM de WhatsApp para inmobiliarias: el catálogo (venta, alquiler,
anticrético) es el centro, y el agente de IA califica y agenda visitas sobre
ese catálogo, nunca inventa un precio ni una propiedad que no existe. La
identidad es **esmeralda sobre blanco**, con un filete dorado como único
acento editorial (nunca un botón). Es algo más cálido y menos "operación en
vivo" que allok: acá el punto de apoyo es el catálogo, no un estado que
cambia minuto a minuto.

## Color

Paleta ya resuelta en alias de la app (nunca un hex en un componente):

| rol | claro | oscuro | uso |
|---|---|---|---|
| página | `--bg-subtle` `#fafcfc` | `#08110e` (noir) | fondo de pantalla |
| tarjeta | `--bg` `#ffffff` | `#10201a` | paneles, listas, formularios |
| panel hundido | `--bg-panel` `#f5f8f9` (rei-paper) | `#142822` | sidebar, cabecera de tabla |
| texto | `--text` `#0f1417` · `--text-2` `#55606a` · `--text-3` `#6e7a84` | `#f2f6f4` · `#b3c0ba` · `#7d8a85` | jerarquía de lectura |
| reglas | `--border` 10% tinta · `--border-strong` 18% | 10%/18% Cloud | bordes, separadores |
| acento | esmeralda `#0a7350` (`defaultAccent`, `lib/brand.ts`) | se aclara vía `resolveAccentSet` | CTA, enlaces, foco. El negocio lo cambia en Marca |
| éxito | = acento (`#0a7350`) — a propósito: el éxito de una inmobiliaria es que el trato avance | | |
| aviso | `#c08a12` (dorado apagado) | `#d79b1a` | algo espera |
| error | `#c2321f` | `#e0574a` | falla o borrado, nunca un estado del negocio |

El dorado (`--rei-gold-500` `#b08a2e`) es **acento editorial**: filetes,
sellos, una cifra destacada. Nunca un CTA ni un fondo.

## Tipografía

Tres voces, no negociable:

- **Geist** (`--font-sans`, ya cargada para allok: `--font-grotesk`) — la
  interfaz, cada palabra.
- **Instrument Serif** (`--font-serif` → `--font-instrument-serif`, misma
  fuente de Vocero bajo su propio nombre de variable, sin apagar a normal
  como hace allok) — reservada para un título largo puntual; no es un
  adorno obligatorio en cada pantalla.
- **Geist Mono** (`--font-mono` → `--font-geist-mono`, nueva) — cifras,
  horas, `.kicker` (etiquetas en mayúscula).

## Movimiento

Vocabulario en `src/app/rei-motion.css` (clases `.rei-*`, importado siempre,
inerte fuera de `[data-brand="rei"]`):

| clase | qué hace | dónde |
|---|---|---|
| `.rei-reveal` / `-fade` / `-scale` / `-side` | entra una vez (nunca en bucle) | hero, tarjetas de precio |
| `.rei-stagger-auto` | escalona hasta 6 hijos (0, 55, 110… ms) | pasos de «cómo funciona» |
| `.rei-lift` / `.rei-lift-strong` | profundidad al pasar el cursor (superficies) | tarjetas |
| `.rei-press` | `scale(0.975)` al tocar (botones y enlaces) | CTAs |
| `.rei-underline` | subrayado que crece desde la izquierda | nav |
| `.rei-skeleton` / `.rei-progress` | carga | listas, formularios |
| `.rei-ai-scan` / `.rei-ai-dots` | "el agente está pensando" | chat en vivo (si se usa) |

Duraciones: instant 90 ms, fast 140 ms, base 220 ms, slow 340 ms, reveal
520 ms — todas con `--rei-ease-out` (`cubic-bezier(0.22,1,0.36,1)`), que
también reasigna el `--ease-out` genérico bajo esta marca. Botones con
esquina de 10px (`--btn-radius`), nunca píldora — `--btn-press: 0.975`,
`--btn-lift: 0`. `prefers-reduced-motion` colapsa todo a un fade de 140 ms;
`rei-motion.css` trae su propia regla, no depende de la de allok.

## Piezas

- **El sello** (`REI_MARK_ACCENT`, `src/lib/favicon.ts`, `reiFaviconSvg`):
  cuadrado esmeralda de esquina suave con una "R" en serif blanca. Geometría
  fija (no depende del nombre del negocio), como `ALLOK_MARK`. Va en el
  favicon (sin logo subido) y en la imagen para compartir
  (`opengraph-image.tsx`). Sin degradados, sin emoji.
- **La superficie pública** (`src/app/(marketing)`, solo en el host de alta,
  `isMarketingHost` en `src/lib/marketing.ts`): `/inicio`, `/precios` y los
  tres legales. Usa los mismos tokens/alias que el resto de la app — nunca un
  hex suelto — más `.rei-*` para el movimiento.
- **El resto del producto** (Bandeja, Ventas, Inicio del SaaS) se comparte
  con allok: son la misma funcionalidad (conversaciones, embudo, agenda), solo
  repintada con estos tokens. La excepción es el remate «all ● k» de allok
  (el logotipo con el punto de estado, el marco de login «Mientras duermes») —
  eso es la identidad de allok en sí misma y Rei no lo hereda: su login y su
  barra lateral usan el encabezado llano (mosaico + nombre del negocio), como
  cualquier instancia Vocero blanca de marca.

## Sí / No

- **Sí**: tokens por nombre, nunca hex en un componente; el dorado solo como
  filete o sello; catálogo y agenda primero; español, segunda persona (tú),
  Bolivia como mercado de referencia (venta, alquiler, **anticrético**).
- **No**: degradados, emoji en la interfaz, botones en píldora, un precio
  inventado cuando el plan real dice «a convenir», el «all ● k» ni el punto de
  estado de allok, hipérbole de venta.
