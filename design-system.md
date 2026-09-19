# Aperture — design system

Objective, checkable rules. The System critic judges adherence to THIS file only.

## Type
- Two families only: **display/UI grotesk** (`--display`, `--sans`) and **mono** (`--mono`, JetBrains Mono) for labels/machine text/tags.
- No serif. Ever. (Instrument Serif was tried and rejected.)
- Display weight is 500–700, tight: `letter-spacing` between −0.01em and −0.035em, `line-height` ≤ 1.15 for display sizes.
- Decisive scale: hero/display text is ≥ 3× the body size. Avoid timid mid-sizes.
- Mono is used ONLY for: eyebrows, tags, machine readouts, input text, URLs. Never for display headlines.

## Color
- All color comes from per-mode CSS tokens on `:root[data-mode=...]`: `--bg --fg --muted --accent --line --ambient`. No hard-coded hex in components (except intentional pure-white nav via mix-blend).
- One accent per theme, used sparingly (≤ ~2 emphatic uses per screen).
- Backgrounds/foregrounds are off-black / off-white per token — never raw #000/#fff in content.
- Three modes must remain visually distinct: Cloak (near-black), Mirror (mid grey), Amplify (warm paper/light).

## Motion
- Standard easing token `--ease`; GSAP entrances use power3.
- Entrances resolve once and settle (no infinite distracting loops in the foreground; ambient background loops are allowed but must be subtle/low-contrast).
- Scramble/kinetic text must resolve in **random character order**, not left-to-right.
- Durations: entrances 0.7–1.6s. Nothing important animates < 0.4s.

## Layout
- Landing is a single screen, no scroll (`body.no-scroll`). About is the only scrolling route.
- Generous whitespace; content never crammed against the top.
- Consistent radii and 1px `--line` borders for surfaces; no heavy drop shadows except the intentional "lit" CTA glow.

## Voice / restraint
- Minimal. Avoid the generic "giant-bold-sans-on-dark, everything centered and glowing" vibecoded look.
- Detail should read as engineered/intentional, not decorative filler.
