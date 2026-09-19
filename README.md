# Aperture

**Generative Engine Optimization (GEO) for local businesses** — diagnose and
improve how a site gets crawled, extracted, and cited by AI answer engines
(Perplexity, ChatGPT, Gemini), and control that exposure.

Two faces over one diagnostics engine:

- **Web console** — a landing → exposure selector → diagnostic report. Point it
  at a site/repo, pick an exposure level (**Cloak / Mirror / Amplify**, a
  camera-iris metaphor), and read a GEO score, per-bot crawler access, cloaking
  (UA-diff), rendering gap, structured-data, **ANS agent-identity verification**,
  and crawl observability.
- **CLI** — the same Phase-1 checks and score in the terminal, no browser
  needed. See **[docs/cli.md](docs/cli.md)**.

> Product roadmap, phases, and hard constraints live in **[PLAN.md](PLAN.md)** —
> read it before building. The earlier Aperture front-end vision is preserved in
> **[CLAUDE.aperture.md](CLAUDE.aperture.md)**.

## Quick start

```bash
npm install

# web console (Vite + React + GSAP) on http://localhost:5173
npm run dev

# CLI diagnostics on any URL
npm run scan -- https://example.com
# or: node cli/aperture.js https://example.com
```

## CLI

```bash
aperture <url> [--mode cloak|mirror|amplify] [--json] [--no-color]
```

Full reference: **[docs/cli.md](docs/cli.md)**.

## Layout

```
src/
  App.jsx            hash router + nav (brand → home + replay)
  Landing.jsx        enter → aperture (exposure + config preview) → report
  Aperture.jsx       the camera-iris SVG (openness 0..1)
  Report.jsx         the diagnostics/ANS/observability console
  data/diagnostics.js DiagnosticReport shape, computeGeoScore, ANS lanes, config gen
  modes.js           exposure mode definitions
  index.css          theme tokens + ops-console styles
cli/
  aperture.js        dependency-free Node CLI (Node 18+ fetch)
docs/
  cli.md             CLI reference
```

## Diagnostics & scoring

Both the web console and CLI share `computeGeoScore()` and the `DiagnosticReport`
shape (matching the `crawlers` branch engine). The score is a renormalized
weighted average of the factors that can be measured:

| Factor | Weight | Available in CLI |
| --- | --- | --- |
| Crawler access (robots.txt) | 35 | ✅ |
| Freshness | 30 | ⏳ needs crawl logs (Phase-2 middleware) |
| Extractability (rendering gap) | 20 | ✅ heuristic (exact needs headless) |
| Structured data (JSON-LD) | 15 | ✅ |

## Status

Front-end is fixture-fed against the real report shape — a drop-in for a live
`runDiagnostics` endpoint. The full crawler engine (headless rendering-gap,
richer parsers) is on the **`crawlers`** branch.
