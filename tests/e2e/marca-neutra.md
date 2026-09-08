# Guion E2E — Marca neutra

> Conducido por API (`fetch`, sin navegador) contra `pnpm dev` con mocks.
> Automatizado en `scripts/e2e-marca-neutra.mjs`.

De-branding: se retira la marca de `vocerocrm.com` (Kevin Belier, MIT) de todo
lo que se renderiza. `DEFAULT_BRANDING.name` pasa a `"CRM"`; el logo especial
("v" caligráfica con remate cian) desaparece — toda instancia dibuja siempre
la inicial del nombre configurado sobre su acento. Alcance **"solo cara al
usuario"**: comentarios de código, `README`, `CLAUDE.md`,
`specs/001-vocero-core/`, `package.json:name` y los identificadores internos
(`__voceroBus`, `localStorage["vocero.panelOpen"]`, la cookie de tema) se
quedan como están a propósito — no son parte de este guion.

## Superficies públicas (sin sesión)

1. `/login` no contiene la palabra "Vocero" ni el trazo de la "v" caligráfica
   (`M0 32 Q2.08…`), sea cual sea el nombre configurado en la organización.
2. `/manifest.webmanifest` no menciona Vocero.
3. `/icon.svg` (icono estático del PWA) ya no es la onda lima de
   `vocerocrm.com` — es el glifo neutro nuevo.
4. `/opengraph-image` sigue respondiendo un PNG válido.

## Blanco/negro: cualquier nombre se refleja igual

5. `PUT /api/settings/branding` con un nombre cualquiera → el login público
   (sin sesión, `router.refresh()` de por medio) muestra ESE nombre de
   inmediato, y sigue sin mencionar Vocero.
6. El favicon generado (`/api/branding/favicon`) dibuja la inicial del nombre
   nuevo — nunca el logo especial, ni siquiera para el nombre que antes lo
   disparaba (`isVoceroName()` ya no existe: no hay segunda rama que probar).

## Regresión de unidad (ya cubierta, no se repite aquí)

- `tests/unit/branding.test.ts`: `normalizeBranding(null).name === "CRM"`.
- `tests/unit/favicon.test.ts`: el icono generado siempre es `<text>` con la
  inicial; el nombre vacío cae a `"C"`, no a `"V"`.
