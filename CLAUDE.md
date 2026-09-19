# GEO Project

Generative Engine Optimization (GEO) product for local businesses — diagnostics, suggestions, and automated changes to improve how sites get crawled and cited by AI answer engines.

**Read `PLAN.md` before building anything.** It contains the phased roadmap (Phase 0–4), hard constraints (e.g., the cloaking policy), and open decisions that gate implementation — notably, Phase 0's kill/pivot criterion determines whether later phases target on-site content or aggregator/directory optimization.

## Current state: Phase 1 diagnostic probes (branch `crawlers`, uncommitted)

TypeScript/Node project (`package.json`, `tsconfig.json`, `src/`). Setup: `npm install && npx playwright install chromium`. Run: `npx tsx src/runDiagnostics.ts [url]` (no URL = local mock site). Typecheck: `npx tsc --noEmit`.

**What exists** (all in `src/crawlers/`, orchestrated by `src/runDiagnostics.ts`; each check returns a `CheckOutcome` so one failure doesn't kill the report):
- `robotsParser.ts` — per-bot robots.txt rules (RFC 9309 longest-match, Allow wins ties).
- `uaDiffChecker.ts` — browser UA vs. each bot UA, visible-text hash diff (cloaking risk).
- `renderingGapScorer.ts` — raw fetch vs. Playwright-rendered text (JS-dependent if gap >= 15%, a guessed threshold).
- `schemaChecker.ts` — JSON-LD types, local-field completeness %, schema phone vs. visible text.
- `contentSignals.ts` — word count, headings, stat/quote/outbound-link counts, question headings (from raw HTML).
- `perBotSignals.ts` — runs schema + content per bot UA and reports differences vs. the browser view.
- `botUserAgents.ts` — bot list: GPTBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended (`tokenOnly`: robots token, never fetched). Claude-User/Perplexity-User UA strings were written from memory, not verified against vendor docs.
- `src/mock-site/server.ts` — deliberately flawed local site (ClaudeBot blocked, bot cloaking, JS-only content, valid LocalBusiness schema) used as the default target.

**Key decisions and findings**
- MetaPhase-Consulting/geoforge is a robots/sitemap/ai.txt *generator*, not a set of crawlers; its analyzer is a single-UA browser-side fetch using third-party CORS proxies. We built our own probes to match PLAN.md's Phase 1 spec instead.
- These probes are **simulated**: our code sends requests with bot UA strings. No real bot visits are observed. Real crawl frequency/coverage needs server logs (Phase 2).
- Bot-protected sites (e.g. amazon.com returns 202 + empty body, even to a browser UA) make plain-fetch checks unreliable. Checks now report `INCONCLUSIVE` instead of false findings when the baseline fetch is challenged/empty.
- Perplexity-User may ignore robots.txt, so its robots result doesn't guarantee behavior.
- Rendering gap uses a single browser fetch and is not per-bot (real AI crawlers likely don't run JS; Googlebot does — unverified).
- Content/stat heuristics (regex stat counter, 10% word-count tolerance) are rough candidate features, not validated. Fit scoring weights against Phase 0 citation data rather than hand-picking.

**Not built / next ideas**
- Detect bot-protection layer from headers (`server: cloudflare`, `cf-mitigated`, `x-amzn-waf-action`) so INCONCLUSIVE names the cause.
- Split `ttfb+body` (currently total request time) into true TTFB and download time.
- Extract phone numbers from `tel:` links/visible text (currently schema-only); NAP consistency vs. directories.
- Scoring formula (keep sub-scores separate: crawlability, content, structured data, activity, citations) — hold until Phase 0 panel results exist.
- Phase 2: bot-identity (IP-range) verification and log-based metrics.
