# Design-loop progress

Bar: **linear.app** (craft) + **teenage.engineering** (iris detail). See [bar.md](bar.md), [design-system.md](design-system.md).

## Pieces
| # | Piece | Builder | Brief | System | Craft | Round |
|---|---|---|---|---|---|---|
| 1 | Scramble entry (random unscramble, bold display font, bigger, brand→home→replay) | ✅ built + self-verified | ⏳ | ⏳ | ⏳ | 1 |
| 2 | Iris detail (engineered depth, no clutter) | ✅ built + verified in all 3 modes | ⏳ | ⏳ | live-approved | 1 |
| 3 | Hero background (Higgsfield B&W video) | ✅ built, removed on request | — | — | — | held |

## Report redesign + CLI + polish — DONE
- **Horizontal multi-screen deck:** Report rebuilt as 6 pinned panels (Score / Crawler access / Cloaking / Extraction / ANS identity / Observability) — GSAP ScrollTrigger horizontal scroll (free plugin, no ScrollSmoother), fixed bottom console chrome (progress + counter + Exposure back), reduced-motion fallback to vertical stack. Fewer elements per screen; grid removed earlier for legibility. Verified: pin scroll advances panels, ANS centerpiece gets its own screen, back button restores no-scroll + reverts ScrollTrigger.
- **Consistency:** all corners sharpened (input box, buttons, toggle, status dots square) — landing now matches the console.
- **Scramble flicker:** each char runs a one-shot flicker animation as it locks (`.sc-in`), on top of the random-order scramble.
- **Validation:** entry accepts only a real GitHub repo URL (owner/repo) or a valid site URL; go button disabled + inline error otherwise.
- **CLI:** `cli/aperture.js` (dependency-free Node 18+), `bin.aperture` + `npm run scan`, real live checks (robots/UA-diff/schema + rendering heuristic) + shared `computeGeoScore` (renormalizes without crawl logs). Docs: `docs/cli.md`, top-level `README.md`.
- "Gotham": no literal string in code; interpreted as shedding the over-dense ops look (done via reorg).

## Console build ("execute all") — DONE
Palantir-inspired ops console (sharp corners, hairline borders, bracket panels, mono readouts, blinking status, tactical grid). New: `src/Report.jsx` (7 sections: GEO score + factor bars, robots.txt access table, UA-diff/cloaking table, rendering-gap bars, schema, **ANS 3-lane verification**, observability = per-bot sparklines + path coverage), `src/data/diagnostics.js` (fixtures matching crawlers `DiagnosticReport` shape verbatim + `computeGeoScore` + ansLanes + metrics + `generateConfig`). Iris→config-preview tabs in aperture stage. Report stage forced dark.
Data note: front consumes the exact `crawlers` `DiagnosticReport` type — fed by fixtures now, drop-in for a real `runDiagnostics` endpoint. Did NOT git-merge `origin/crawlers` (its Node/TS package.json would clobber our untracked Vite one). Proper integration = thin API endpoint later.
Palantir video: reference page is bot-gated (couldn't screenshot); can regenerate hero clip in monochrome wireframe/tactical register.

## Emil design-eng pass (applied)
Press feedback (`:active` scale) on all buttons; `transition: all` → scoped props; hover gated behind `@media (hover:hover)`; staggers tightened (aperture 0.14→0.06, analysis 0.09→0.05); theme cross-fade 1s→0.65s; input reveal y+scale; `prefers-reduced-motion` in CSS + scramble.js + Landing GSAP guards.

## Piece 2 — iris (round 1)
Aperture.jsx: lit blade linear-gradient (`bladeGrad`), recessed inner shadow at opening (blurred polygon stroke), crisp inner edge highlight, metallic rim gradient (`rimGrad`) + inner shade line. All theme-token driven (color-mix on --accent/--fg/--bg), verified Cloak/Mirror/Amplify.

## Piece 1 — STATUS: matches all user feedback (live-iterated)
Final scramble: monospace (JetBrains Mono, reference = Emil Kowalski demo), **random in-place** resolve, **no fade** (scramble glyphs same colour as resolved), time-based glyph cycling (90ms), fixed-width slots (no shudder), word-grouped (no mid-word break), landing 2.5s / aperture-line 0.9s. Smaller centered link box. Brand→home→replay confirmed. Video background built then removed on request (file + CSS retained for one-line re-add).
Open font note: line is MONO (matches reference), which overrode the earlier "use Inter" request — awaiting final call.

## Piece 1 — build notes (round 1)
- Random-order scramble: new `src/scramble.js` (per-char spans, random resolve thresholds, dim→bright settle). Replaced GSAP left-to-right scrambleText on both the entry line and the mode-description line. Verified first-resolvers were indices 9,26 (not 0,1) → random order confirmed.
- Bold display font: added **Space Grotesk** (600), new `--display` token. Entry line now `clamp(32px,5.4vw,56px)`, tight tracking. (Font is a candidate — Craft critic to judge against bar.)
- Brand → home + replay: `App.jsx` brand onClick remounts Landing via `key={replay}`, re-running the entry timeline; navigates home first if on About.

## Gap history
- (none yet — critics not yet run)

## Higgsfield video (piece 3 asset)
- Trial is **MCP-only** (`only_mcp_usage_on_trial_is_available`). CLI blocked. Connector `https://mcp.higgsfield.ai/mcp` added, status **pending** (awaiting user OAuth). Canvas fallback is the default regardless.
