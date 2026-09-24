# De dónde sale el sistema

La marca vive en **allok-fun** (allok.fun), rediseñada el 2026-09-20 sobre el
concepto «status-driven» del brand board: `all ● k`, Cloud y tinta, y el color
como estado de la operación. Las fuentes de verdad:

- `allok-fun/src/lib/brand.ts` — paleta y los cuatro estados (punto, tinta, suave).
- `allok-fun/src/app/globals.css`, bloque `.allok` — tipografía, botones, superficies.
- `allok-fun/src/components/brand/AllokLogo.tsx` — construcción del logotipo.

Acá se refleja en:

- `src/app/globals.css`, bloque `[data-saas="true"]` — los tokens.
- `src/lib/estado.ts` — los estados y sus reglas; `STATE_DOT` repite los puntos
  para el icono de la pestaña.
- `src/lib/branding.ts` — `SAAS_BRANDING` (acento tinta) y su inversión en oscuro.
- `src/lib/favicon.ts` — `ALLOK_MARK`, espejo de `MARK` (el símbolo, desde el
  2026-09-23). Lo copian `src/app/icon.svg`, `src/app/apple-icon.png` y los dos
  PNG de `public/`; `tests/unit/favicon.test.ts` falla si `icon.svg` se separa.

Si la marca cambia allá, se cambian estos cuatro, los íconos y `design.md`. Reemplaza al
sistema Dawn → Dusk (cielo magenta), que quedó retirado.
