# Aperture (GEO project)

**Before doing anything, read [HANDOFF.md](HANDOFF.md).** It carries the full context from the session that set this project up — the product vision, the current front-end state, the aperture/iris exposure modes, the Higgsfield setup, and the immediate next step.

## Quick facts
- **Aperture** = a GEO (Generative Engine Optimization) control layer. Point it at a site/GitHub repo → choose how much AI can read/retain/cite it (Cloak / Mirror / Amplify, a camera-iris metaphor) → generate the enforcing files → analyze.
- Stack: Vite + React + GSAP (ScrambleTextPlugin). Run with `npm run dev` (port 5173).
- Key files: `src/App.jsx` (hash router + nav), `src/Landing.jsx` (3 stages: enter → aperture → analysis), `src/Aperture.jsx` (iris SVG), `src/modes.js`, `src/index.css` (per-mode theme tokens), `src/About.jsx`.
- Design language: Inter + JetBrains Mono, minimal, one accent per theme. No serif (rejected). Avoid generic "vibecoded" giant-bold-sans look.

## Immediate next step
Run **`/design-loop`** on the Aperture UI. The skill will ask three interview questions first — let the user answer (especially the reference "bar"). Likely pieces: the scramble entry, the aperture/iris selector, the analysis stage. The Craft critic renders our output via the built-in browser (`preview_start` / screenshots at localhost:5173).

## Higgsfield
CLI installed + authenticated (workspace "Private", plus plan, ~110 credits). `generate` costs credits — never run one without an explicit request. 8 companion skills in `.agents/skills/`.
