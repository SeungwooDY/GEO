# GEO Project

Generative Engine Optimization (GEO) product for local businesses — diagnostics, suggestions, and automated changes to improve how sites get crawled and cited by AI answer engines.

**Read `PLAN.md` before building anything.** It contains the phased roadmap (Phase 0–4), hard constraints (e.g., the cloaking policy), and open decisions that gate implementation — notably, Phase 0's kill/pivot criterion determines whether later phases target on-site content or aggregator/directory optimization.

## Current state: Phase 1 probes + Phase 2 proxy (branch `proxy-server`)

TypeScript/Node project (`package.json`, `tsconfig.json`, `src/`). Setup: `npm install && npx playwright install chromium`. Run: `npx tsx src/runDiagnostics.ts [url]` (no URL = local mock site). Typecheck: `npx tsc --noEmit`. Tests: `npm test` (vitest; add `GEO_LIVE_TESTS=1` to also hit the real vendor IP-range endpoints). Phase 2 demo: `npm run demo:proxy` (person vs verified bot vs spoofed bot, per mode).

**Hackathon scope (decided):** Phase 0 is skipped; bot-identity verification + a minimal proxy are the demo centerpiece; ANS was evaluated and rejected, so verification is IP-range based only.

**Phase 2 (built, `src/`)**
- `mode.ts` — per-tenant `DeliveryMode`: `amplify` (generated structured page), `mirror` (rendered snapshot of the human page), `cloak` (AI bots get a 403; honest blocking, *not* the deceptive bot-vs-human cloaking the policy forbids).
- `generators/` — `BusinessProfile` (validated JSON), template-only markdown / JSON-LD / robots.txt / llms.txt generators, `publishAmplify`, `publishMirror`. Every generated line maps to a profile field.
- `validation/` — the cloaking-policy gate. Layer 1 `facts.ts` (deterministic: phone/time/day/price/rating/address/claims; anything *added* vs the source fails). Layer 2 `judge.ts` (Claude judge, default `claude-sonnet-5`, override with `GEO_JUDGE_MODEL`; cached; never in the request path). `gate.ts` returns pass/reject/review and fails closed (judge error or "unsure" = review, never pass). `publishAmplify` also checks the artifact against the *live human page* text, since the policy is about what people can read, not just the profile.
- `store/approvedStore.ts` — only gate-passing artifacts are stored; a rejected publish leaves the last approved one serving.
- `verification/` — `botIdentity.ts` verifies a claimed bot UA against the vendor's published IP ranges (`ipRanges.ts`, dependency-free IPv4/IPv6 CIDR). Ranges are cached 1h and served stale if a refresh fails; unverifiable = treated as an ordinary visitor.
- `proxy/` — `handler.ts` (portable `Request`/`Response`, multi-tenant, fail-open to origin), `node.ts` (local `node:http` wrapper; client IP is the socket peer, never `X-Forwarded-For`), `tenants.ts`, `crawlLog.ts` (JSONL log for the deferred log-based diagnostics).
- Bot registry (`crawlers/botUserAgents.ts`) now carries `ipRangeUrls` per bot and includes `OAI-SearchBot` and `Claude-SearchBot`. Tokens, OpenAI/Perplexity UA strings and range URLs were checked against vendor docs; Anthropic publishes tokens + one shared IP list (`claude.com/crawling/bots.json`) but no full UA strings, so the three Claude UA strings are pattern-based (matching keys on tokens).

**Known gaps (Phase 2)**
- Log-based diagnostics (last-crawled, freshness lag, zero-crawl) are not built; the proxy writes the log they need.
- `uaDiffChecker.ts` and `perBotSignals.ts` are unchanged and will flag legitimate Amplify output as a "difference" (hash/word-count/schema-completeness compare). Also, our scanner isn't a verified bot IP, so it never sees the bot version through the proxy.
- Google-Extended can only be controlled via robots.txt (it never fetches). Cloak can't block bots that aren't in `AI_BOTS` or that spoof a browser UA; the crawl log can't see those either.
- Mirror's gate only compares facts between two renders, so it doesn't catch prose-only differences. Proxy redirects aren't rewritten (an origin `Location` header still names the origin host). Not deployed anywhere: Node wrapper only, Worker entry not written.
- Layer 2 has only been run against a mocked client, never the real API.

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
