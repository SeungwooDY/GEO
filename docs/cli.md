# Aperture CLI

Phase-1 GEO diagnostics for a single URL, from the terminal. Same checks and
scoring formula as the web console — no browser required.

The CLI proves what a **URL alone** can prove (per `PLAN.md`, Phase 1): crawler
access, cloaking, structured data, and a rendering-gap heuristic. Crawl-log
metrics (freshness, hit volume, path coverage) require the Phase-2 middleware
and are intentionally not part of the CLI.

## Requirements

- **Node 18+** (uses the built-in `fetch`). No dependencies to install.

## Install / run

From the repo:

```bash
# one-off, no install
node cli/aperture.js https://example.com

# via the npm script
npm run scan -- https://example.com

# link it as a global `aperture` command
npm link
aperture https://example.com
```

## Usage

```
aperture <url> [options]

options:
  --mode <cloak|mirror|amplify>   exposure target to label the report
  --json                          print the raw DiagnosticReport + score as JSON
  --no-color                      disable ANSI color
  -h, --help                      show help
```

### Examples

```bash
aperture https://example.com
aperture example.com --mode amplify
aperture https://your-site.com --json > report.json
```

## What it checks

| Section | What it does | Source |
| --- | --- | --- |
| **GEO Score** | 0–100 + letter grade, renormalized over the factors it can measure | shared formula (`src/data/diagnostics.js`) |
| **Crawler access** | Parses `robots.txt` per bot (GPTBot, ClaudeBot, PerplexityBot, Google-Extended); longest-match Allow/Disallow for the target path | live `robots.txt` |
| **Cloaking · UA-diff** | Fetches the page as a browser vs. each AI bot UA; flags `blocked` (non-200/empty) and `mismatch` (visible-text length diverges >30%) | live fetches |
| **Rendering gap** | Heuristic: raw visible-text length + empty-shell/`<div id="root">` + script density → `js-dependent`. Exact gap needs the headless engine. | live fetch |
| **Structured data** | Extracts `application/ld+json` blocks, resolves `@graph`/arrays, lists `@type`s | live fetch |

## Scoring

The score is the weighted, **renormalized** average of the factors that could
be measured (so a CLI run with no crawl logs still scores fairly):

| Factor | Weight |
| --- | --- |
| Crawler access | 35 |
| Freshness | 30 — *skipped in the CLI (needs crawl logs)* |
| Extractability (rendering gap) | 20 |
| Structured data | 15 |

Grades: **A** ≥80 · **B** ≥65 · **C** ≥50 · **D** ≥35 · **F** <35.

This is the exact `computeGeoScore()` the web console uses; the CLI passes
`fresh = null` so the freshness factor is dropped and the remaining weights are
renormalized.

## JSON output

`--json` prints `{ report, score }` where `report` matches the `DiagnosticReport`
shape (`src/crawlers/types.ts` on the `crawlers` branch). Pipe it into other
tools:

```bash
aperture https://example.com --json | jq '.score.score'
aperture https://example.com --json | jq '.report.robots.data.perBot'
```

## Exit codes

- `0` — scan completed (a low GEO score is still a successful scan)
- `1` — invalid/missing URL, or an unexpected error

## Relationship to the full engine

The CLI is deliberately dependency-free and does everything achievable over
HTTP. The **`crawlers` branch** contains the full engine (`runDiagnostics`,
headless-Chromium rendering-gap, richer parsers). When that engine is merged and
exposed as an endpoint, the CLI and web console can both point at it for the
exact rendering gap and log-backed metrics; the report shape is already shared,
so nothing downstream changes.
