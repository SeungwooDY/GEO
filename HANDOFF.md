# Aperture — session handoff

Read this first. It carries the full context from the previous session so we can continue without repeating.

## What this project is
**Aperture** (working name, will likely change) — a GEO (Generative Engine Optimization) control layer. You point it at a website or GitHub repo, and it lets you control how AI systems read, retain, and cite your site, then generates the files that enforce that choice and analyzes the result.

- Repo: `~/Desktop/GEO` (cloned from `github.com/SeungwooDY/GEO`, which was empty — we are building greenfield). Remote origin is that repo.
- Reference/competitor context: **GEOforge** (`github.com/MetaPhase-Consulting/geoforge`) emits static AI-ready files (robots.txt, sitemap.xml, ai.txt) but only fetches ONE page, never crawls, has no JSON-LD and no llms.txt. **Profound** (tryprofound.com) is the analytics/observability side (tracks AI citations). Aperture's thesis: be the causal control loop between them — sensor (measure citations) → controller (decide the fix) → actuator (write files/PR) → re-measure.

## The three exposure modes (core hook)
A camera-**aperture / iris** metaphor (we ditched an earlier light-switch idea). Selecting a mode re-themes the whole page and opens/closes the iris:
- **Cloak** — iris closed, lights off (near-black theme). Site invisible to AI crawlers.
- **Mirror** — iris half open (mid grey). AI sees exactly what a person sees, faithful reflection.
- **Amplify** — iris wide open (warm paper/light theme). Max retention: structured, quotable, citation-ready.

## Current front-end state (working, on localhost:5173)
Vite + React + GSAP. The user is the front-end designer; I build scaffolding, they art-direct.

Flow (single screen, NO scroll on landing; About is a separate routed page):
1. **enter** — GSAP ScrambleText unscrambles to "Point Aperture at your site." Brand "Aperture" fades in center-top, About link top-right (delayed). Prompt shifts up, GitHub/URL input fades in (GitHub preferred, icon toggle). Enter button lights up when a value is typed.
2. **aperture** — the iris SVG (blades + real transparent masked hole) centered, with a CONDENSED side toggle (Amplify/Mirror/Cloak) to the right, small description that scrambles on change, "Analyze site" CTA. No GEO score here.
3. **analysis** — scaffold only right now: mock scan of core docs (robots.txt, sitemap.xml, llms.txt, JSON-LD, meta, freshness) with found/missing. This is where the real repo scan + "score" (not necessarily one number) will live.

Key files:
- `src/App.jsx` — hash router (`#/`, `#/about`) + nav + ambient layer
- `src/Landing.jsx` — the three stages + GSAP timelines (ScrambleTextPlugin registered)
- `src/Aperture.jsx` — the iris SVG component (openness 0..1)
- `src/modes.js` — mode defs (label, tag, line, openness)
- `src/About.jsx` — About page
- `src/index.css` — all styles + per-mode theme tokens on `:root[data-mode=...]`
- `src/icons.jsx` — GitHub / link / arrow icons

Design language: Inter (sans, bold display — we tried Instrument Serif and rejected it as too corny/ugly), JetBrains Mono for labels/machine text. Minimal, lots of whitespace, one accent per theme. Avoid the "vibecoded" giant-bold-sans-on-dark generic look.

Run it: `cd ~/Desktop/GEO && npm run dev` (port 5173).

## Higgsfield (set up and ready)
- `@higgsfield/cli` v1.1.26 installed globally (`higgsfield`/`higgs`/`hf`). Authenticated as calvink12602@gmail.com, workspace "Private", `plus` plan (~110 credits). Generations cost credits — do not run `generate` without an explicit request.
- 8 companion skills installed in `.agents/skills/` (higgsfield-generate, -video-explainer, -websites, -soul-id, -product-photoshoot, -brandkit, -marketplace-cards, -youtube-thumbnail). They run with full agent permissions.
- Use for hero visuals / motion / marketing, NOT for building the UI code itself.

## Skills available
- **design-loop** (`~/.claude/skills/design-loop/SKILL.md`) — builder + 3 fresh-context critics vs a real reference until all agree ours wins. This is what the user wants to run next on the Aperture UI. Invoke with `/design-loop`.

## Hackathon tracks in play
Primary: **Best Use of ANS** (Agent Name Service) — Aperture makes sites discoverable/verifiable to AI agents; natural fit. Secondary/cheap: Cloudforce HokieAI (Most Viral + raffle). Others don't fit.

## Immediate next step
Run `/design-loop` against the Aperture UI. When it asks its Phase 1 questions, the user will provide the reference "bar." Likely pieces to split: the scramble entry, the aperture/iris exposure selector, the analysis stage. Craft critic should use the built-in browser (`preview_start` / screenshots at localhost:5173) to render our output.
