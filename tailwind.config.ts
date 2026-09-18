import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Los nombres semánticos existentes (background, primary, muted…) se remapean
 * a los tokens del sistema de diseño de Vocero (la marca de vocerocrm.com) para
 * que toda la app comparta el tema activo (claro u oscuro, ver globals.css);
 * la escala `brand-*` expone el acento white-label y las escalas de estado
 * exponen la tríada tint/soft/text.
 *
 * Dos reglas para no romper el tema oscuro:
 * 1. Nada de colores literales en la UI (`text-white`, `bg-black`, hex suelto).
 *    Excepción deliberada: la paleta de identidad (avatares, puntos de etapa,
 *    palomita azul de WhatsApp) son tonos medios legibles en ambos temas.
 * 2. Nada de modificador de opacidad (`bg-brand/20`) sobre estos nombres:
 *    Tailwind 3 no sabe aplicarlo a un color `var(--x)` y descarta la regla en
 *    silencio. Usa un token propio (p. ej. `--accent-veil`) o `opacity-*`.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        input: "var(--border-strong)",
        ring: "var(--accent)",
        background: "var(--bg)",
        foreground: "var(--text)",
        subtle: "var(--bg-subtle)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-fg)",
        },
        secondary: {
          DEFAULT: "var(--bg-panel)",
          foreground: "var(--text-2)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "var(--danger-fg)",
        },
        muted: {
          DEFAULT: "var(--bg-panel)",
          foreground: "var(--text-3)",
        },
        accent: {
          DEFAULT: "var(--bg-hover)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--bg)",
          foreground: "var(--text)",
        },
        popover: {
          DEFAULT: "var(--bg)",
          foreground: "var(--text)",
        },
        brand: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          tint: "var(--accent-tint)",
          text: "var(--accent-text)",
          fg: "var(--accent-fg)",
          veil: "var(--accent-veil)",
        },
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        "text-4": "var(--text-4)",
        chat: "var(--chat-bg)",
        "bubble-in": "var(--bubble-in)",
        "bubble-in-border": "var(--bubble-in-border)",
        "bubble-out": "var(--bubble-out)",
        "bubble-out-border": "var(--bubble-out-border)",
        "bubble-out-text": "var(--bubble-out-text)",
        success: {
          DEFAULT: "var(--success)",
          tint: "var(--success-tint)",
          soft: "var(--success-soft)",
          text: "var(--success-text)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          tint: "var(--warning-tint)",
          soft: "var(--warning-soft)",
          text: "var(--warning-text)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          tint: "var(--danger-tint)",
          soft: "var(--danger-soft)",
          text: "var(--danger-text)",
        },
        info: {
          DEFAULT: "var(--info)",
          tint: "var(--info-tint)",
          soft: "var(--info-soft)",
          text: "var(--info-text)",
        },
        /* ── Dawn → Dusk ────────────────────────────────────────────────
           Nombres del sistema, disponibles en toda la app. Solo tienen valor
           propio bajo [data-saas="true"] (ver globals.css); en la instancia
           Vocero los alias de arriba siguen mandando y estos no se usan. */
        ground: {
          DEFAULT: "var(--ground)",
          2: "var(--ground-2)",
          3: "var(--ground-3)",
          4: "var(--ground-4)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          60: "var(--ink-60)",
          40: "var(--ink-40)",
        },
        hairline: "var(--hairline)",
        rule: {
          DEFAULT: "var(--rule)",
          hard: "var(--rule-hard)",
        },
        sky: {
          night: "var(--sky-night)",
          cobalt: "var(--sky-cobalt)",
          violet: "var(--sky-violet)",
          magenta: "var(--sky-magenta)",
          ember: "var(--sky-ember)",
        },
        lit: {
          dawn: "var(--lit-dawn)",
          dusk: "var(--lit-dusk)",
        },
        "on-sky": "var(--on-sky)",
        assist: {
          DEFAULT: "var(--assist)",
          dim: "var(--assist-dim)",
        },
        "agent-out": "var(--agent-out)",
        "stage-won": {
          DEFAULT: "var(--stage-won)",
          ink: "var(--stage-won-ink)",
        },
        wa: {
          green: "var(--wa-green)",
          screen: "var(--wa-screen)",
          in: "var(--wa-in)",
          out: "var(--wa-out)",
          ink: "var(--wa-ink)",
          ticks: "var(--wa-ticks)",
        },
        status: {
          ok: "var(--status-ok)",
          info: "var(--status-info)",
          warn: "var(--status-warn)",
          risk: "var(--status-risk)",
          lost: "var(--status-lost)",
        },
        overlay: "var(--overlay)",
        knob: "var(--knob)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        btn: "var(--radius-btn)",
        card: "var(--radius-card)",
        xl: "var(--radius-xl)",
        plate: "var(--radius-plate)",
        bubble: "var(--radius-bubble)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        pop: "var(--shadow-pop)",
      },
      // Las tres voces de la marca (ver src/app/layout.tsx, donde next/font
      // las descarga en build y las sirve self-hosted, sin CDN en runtime).
      fontFamily: {
        sans: ["var(--font-sans)", "Archivo", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["var(--font-serif)", "Instrument Serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "IBM Plex Mono", "ui-monospace", "Cascadia Code", "monospace"],
        // Solo para `macro` (pie y cartel). Nunca un párrafo.
        poster: ["var(--font-poster)", "Archivo Black", "Helvetica Neue", "Impact", "sans-serif"],
      },
      // motion.md: una curva para todo, y la propiedad SIEMPRE nombrada.
      transitionTimingFunction: {
        dd: "var(--ease-out)",
      },
      transitionDuration: {
        btn: "var(--dur-btn)",
        card: "var(--dur-card)",
      },
    },
  },
  plugins: [animate],
};

export default config;
