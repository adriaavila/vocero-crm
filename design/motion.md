# Motion

Little, and always with a static signal beside it — never movement as the only cue.

- **The thread enters in sequence.** Bubbles fade and rise 9px, 420ms, `cubic-bezier(.23, 1, .32, 1)`, each 520ms after the last (`allok-bubble-in`). Once, on load. It is the site's only stepped animation, because the order of a conversation is the product. Reduced motion shows the thread complete.
- **Press.** `scale(press)` (0.96) on `:active` is a button's one tactile response; link-cards use 0.98.
- **Curve and duration.** `cubic-bezier(.23, 1, .32, 1)` on the site, `--ease-out` in the app; 160ms buttons, 200ms cards, 220ms base, 420ms `--dur-slow` for app panels only.
- **Name the property.** `transition-property` is always listed. Never `transition: all`.
- **Hover is for mice.** Every hover change lives inside `@media (hover: hover) and (pointer: fine)`.
- **A status dot may pulse** (`animate-pulse`) only while something is in flight — a send, a sync. Never as decoration.
- **The sentence that lights up** (`Reveal.tsx`, one per page): words go `ink-40` → `ink` as the paragraph climbs, driven by `animation-timeline: view()`; the dimmed state lives in the `from` keyframe so any fallback renders full ink.
- **The sky moves with the scroll.** `--sky-t` on `<html>` pans the ramp; no component knows about scroll.
