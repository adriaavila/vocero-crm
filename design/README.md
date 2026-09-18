allok is a WhatsApp CRM with an agent inside it. The customer writes at 3:14 in the morning; the agent answers in four seconds with the real number — the free slot, the date, the price — and the conversation lands in a pipeline a human can see. Vocero is the same engine pointed at a client's own systems. This system exists so every surface of that product — the site that sells it, the phone that demonstrates it, the inbox that runs it — reads as one thing. **The conversation is the product. The sky is the brand. Everything else is paper and ink.**

## Content fundamentals

- Spanish for the site and the product, second person, lowercase product names: *allok*, *rei*, *vocero*. The house is `allok`; a product signs `allok × rei` with the house in `ink-40` and the product in `ink`.
- **Show the product, never describe it.** Every commercial page puts one object under its headline: the phone with the thread on `/`, the stage board on `/rei`, the agent's reply on `/vocero`. The object is the product, not an illustration, and it is labelled as an example — *Los mensajes son un ejemplo, no la conversación de ningún cliente.*
- **Numbers are facts.** A price comes from `PLANS` (Starter 29 · Growth 59 · Pro 99), a count from data, a Meta rate from `META_RATES`. An invented number on a product page is a bug.
- **The agent is supervised.** Nothing in the UI implies an autonomous send. Every assistant rendering carries one of five states, as words: *Sugerencia · Revisar antes de enviar · Programado · Enviado · Requiere atención.* Status is always a word plus a `status-*` dot, never a dot alone.
- The reply is the whole pitch, so write replies like the product does: the fact first, then the next step, then the one question. *Sí — quedan 4 cupos en el de 9:00 y 2 en el de 11:30. Son 8 clases, empiezan el 4 de octubre.*
- Labels are `mono`, uppercase, ≤ 4 words: `CONSULTA DESDE UN ANUNCIO · RESPUESTA EN 4 S`. The arrow `→` is the brand's glyph; `↗` marks a link that leaves the page. No emoji.
- The sentence on every commercial page: *allok cobra el software, no las conversaciones.*

## Page rhythm

A page is a sequence of promises, each proven by one object. Learned from the best product sites and from our own `/`:

- **The headline is a promise in the customer's time**, not a feature: *Tu negocio contesta. Aunque no estés.* — never "CRM de WhatsApp con IA". The `mono` line above it says what it is; the headline says what changes.
- **One object per section.** Headline, one line of support, one thing shown: the phone, the board, the thread, the plans, the cost calculator. Two objects in a section means two sections.
- **One aside per page**, in parentheses, that says the thing a friend would say — *(sí, los mensajes te los cobra Meta, no nosotros)*. It is the only place the voice loosens.
- **One CTA sentence, repeated.** *Probar el agente en WhatsApp* — in the header pill, under the hero, and on the sky closer. It opens a WhatsApp thread with a prefilled first message, because the product is the demo. Secondary actions are `outline` and say where they go: *Ver planes →*.
- **Proof is real or absent.** When there are customer quotes, they go in a `Proof` block: a real sentence, a real first name and business, the channel it came from. Until then the block does not exist — the phone is the proof. Never a rating with no reviews behind it, never a logo wall of businesses that have not paid.

## The rule of the sky

The sky is a moment, not wallpaper. **Open on void** — the hero is `ground` in the void theme with the headline in `hero` and the product lit by one `Void` bloom. **Close on sky** — the last block of every page is a `SkyPlate`, once. **Paper in between**, with air and `hairline` rules. The ramp also lives in the sky `Button`, the mail link, the slider track, the scrollbar and the mark. Budget: ~80% paper and ink, ~15% sky, ~5% `sky-magenta`.

The ramp at 96°: `sky-night` 0% → `sky-cobalt` 26% → `sky-violet` 58% → `sky-magenta` 82% → `sky-ember` 100%, with two radial glows blurred by `blur-glow`: `lit-dawn` left at `glow-dawn`, `lit-dusk` right at `glow-dusk`. One number, `--sky-t`, pans it. The anchors are in `src/lib/sky.ts`, `.sky-plate` and `.allok-sky` — change one, change all three.

## Colour

- **Site (paper).** Text is `ink`; supporting copy `ink-60`; labels `ink-40` (never a paragraph — 2.8:1). Borders `hairline`. The accent is `sky-magenta`: numbering, bullets, inline links, the focus ring.
- **Hero and product (void).** Text is `ink` (void value); the accent is `lit-dawn` (`sky-magenta` fails on black at 3.5:1). The inbox, the assistant and the board in the app run on `ground` → `ground-4` in the void theme, hierarchy by surface step, not colour.
- **Inside the phone.** WhatsApp's own colours, and only there: `wa-green` bar and send button, `wa-screen` wallpaper, `wa-in` / `wa-out` bubbles, `wa-ink` text, `wa-ticks`. This is the one place on the site that is not ours, because it is where the product lives.
- **The assistant speaks in `assist`.** The ✦ icon, the *Sugerencia* badge on `assist-dim`, the unread dot, an opportunity's value. It is the product's inheritance from the old lime and stays there; it is never text on paper.
- **States.** `status-ok` sent, `status-info` scheduled, `status-warn` review, `status-risk` attention or overdue, `status-lost` lost or destructive — each at 15% as a badge ground with the full colour as its text, always beside the word.
- The agent's reply on paper is `agent-out`; incoming is `ground-2`. The won column is `stage-won` with a `stage-won-ink` count.
- Text on the sky is `on-sky`, constant across the ramp; `lit-dusk` for titles on it.

## Type

Three faces, one job each; Comfortaa is retired. **Geist** (`grotesk`) for every word, separated by weight and tracking (`hero` −0.042em, `display` −0.03em). **Archivo Black** (`poster`) for `macro` — the footer address and the poster lockup only. **JetBrains Mono** (`mono`) for labels, counts and times; `mono-time` for timestamps and badges, `tabular-nums` so numbers don't jitter as they change.

Inside the product the scale drops: `bubble` 13.5px in the phone, `thread` 14.5px in a card, `inbox` 14px/500 for a name (600 unread), 12px `ink-60` for the preview line. Sizes on the site are `clamp()` over `vw`; the token values are the ceilings.

## Surfaces

- The product card that breaks a hero's edge: `ground` (paper theme, white in code), `radius-card`, `hairline` border, `shadow-card` — the one big shadow on paper. The hero's `space-hero-tail` and the card's `-130px` move together.
- The phone: `radius-device` bezel with `shadow-device`, `radius-screen` screen, the island in the bezel's colour. Max width 340px. Bubbles `radius-bubble`, 86% max width, timestamp bottom-right at 10px.
- In the app: `radius-md` on items and cards, `hairline` borders on `ground-3`, active items on `ground-4` with a `rule` border. No shadows below `shadow-2`.
- Board columns are `ground-2` at `radius-md`; cards inside are white at 10px with a `hairline` border.
- Buttons `radius-btn`; sky plates as cards `radius-plate`.

## Layout

Gutters `space-5` / `space-10`; sections `space-16` / `space-24`. The plan row is three cards with Growth featured on `ink`. Mobile at 375px: no horizontal scroll; the header collapses to mark + one action; the board stacks to two columns below `lg`.

## Motion

Little, and always beside a static signal — see the Motion section. The one stepped animation on the site is the thread: bubbles enter in sequence, once, because order is what a conversation is.

## Iconography

Lucide, 1.5px stroke, 16px in the app (✦ `Sparkles` for the assistant, `Clock` for a next task), `currentColor`. Arrows in copy are glyphs. The brand's marks — house, CRM, agent — are in Brand assets; all three are the same stroke.

The portfolio (`.rig`: Archivo Black macro type, hard rules, the lens, the seal) is a separate register and is out of this system's scope.
