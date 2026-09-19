# GEO handoff

Written 2026-09-19 for a teammate picking this up cold. Read this first, then `PLAN.md` (roadmap and hard constraints) and `CLAUDE.md` (current-state notes).

## The project in one paragraph

GEO (Generative Engine Optimization) helps local businesses get crawled and cited correctly by AI answer engines (ChatGPT, Claude, Perplexity). Phase 1 is a set of URL-only diagnostics. Phase 2 is a proxy that sits in front of a business's site and decides what verified AI crawlers receive, without touching the business's code or repo.

**Hackathon scope (current):**
- Phase 0 (the citation-source demand check) is **skipped** for the event.
- Bot-identity verification plus a minimal proxy is the **demo centerpiece**; a diagnostics dashboard is the product wrapper and comes second.
- ANS was evaluated and **rejected**. Verification is IP-range based only.
- `origin/crawler-agent-pipeline` has newer PLAN.md text (hackathon scope, GitHub App design) that is **not merged** into this branch.

**Hard constraint:** the cloaking policy. Bot-served content must be the same substance as what people see, in a cleaner format, never different claims. Much of the code exists to enforce this.

## State of the repo

- Branch `proxy-server`. Work is **uncommitted** as of this writing (fill in the commit hash here once it is committed: `________`).
- Everything below is built and tested. `npm test` runs 133 tests, all passing (8 more are skipped unless `GEO_LIVE_TESTS=1`).

### How a request flows through the proxy

```
person (no bot UA)            -> origin, untouched
UA claims to be an AI bot:
  mode cloak                  -> 403 (keyed on the UA claim; no IP check needed)
  mode amplify / mirror       -> source IP inside that vendor's published ranges?
        yes                   -> the saved, gate-approved artifact
        no (spoof)            -> origin, as an ordinary visitor
any fault in our own logic    -> origin (fail open); dead origin -> plain 502
```

### Modes (per tenant)

- **amplify**: a generated, structured page (markdown plus JSON-LD) built from the business profile.
- **mirror**: a rendered snapshot of exactly what a person sees, so JavaScript-built pages aren't blank to bots.
- **cloak**: AI crawlers are blocked. This is *honest blocking*, not the deceptive bot-vs-human cloaking the policy forbids. The name clashes with the policy term and is still unresolved.

### File map

| Path | What it is |
| --- | --- |
| `src/crawlers/` | Phase 1 probes: robots, UA-diff, rendering gap, schema, content signals, per-bot signals. `botUserAgents.ts` is the bot registry (tokens, UA strings, `ipRangeUrls`). `renderPage.ts` renders a URL in headless Chromium. |
| `src/runDiagnostics.ts` | Phase 1 CLI. `npm run demo [-- url]` (no URL = the mock site). |
| `src/mock-site/` | Deliberately flawed local business site on port 4173 (bot cloaking, JS-only content, ClaudeBot blocked) plus `profile.ts`, the business facts behind it. |
| `src/verification/` | `botIdentity.ts` (verify a claimed bot by IP range; ranges cached 1h, stale kept if a refresh fails) and `ipRanges.ts` (dependency-free IPv4/IPv6 CIDR). |
| `src/proxy/` | `handler.ts` (portable `Request`/`Response`, multi-tenant), `node.ts` (local `node:http` wrapper), `tenants.ts`, `crawlLog.ts` (JSONL request log). |
| `src/generators/` | `BusinessProfile` (validated JSON), template-only generators (markdown, JSON-LD, robots.txt, llms.txt), `publishAmplify`, `publishMirror`. |
| `src/validation/` | The gate. `facts.ts` (layer 1, deterministic), `judge.ts` (layer 2, Claude judge), `gate.ts` (pass / reject / review). |
| `src/store/approvedStore.ts` | Where gate-approved artifacts live (memory and file-backed). |
| `src/runProxyDemo.ts` | `npm run demo:proxy`: person vs verified bot vs spoofed bot, in each mode. |

## Run it

```
npm install
npx playwright install chromium     # one-time; the download lives outside the repo
npm test                            # GEO_LIVE_TESTS=1 also hits the real vendor IP-range endpoints
npx tsc --noEmit
npm run demo                        # Phase 1 diagnostics on the mock site
npm run demo:proxy                  # Phase 2 side-by-side demo
```

Setting `ANTHROPIC_API_KEY` makes `demo:proxy` run the real LLM judge instead of skipping layer 2 (it prints which). That makes real API calls.

## Decisions and why

- **Template-only generation.** Every generated line maps to a profile field, so the output can't assert anything the business didn't tell us. An LLM-written layer is optional later, only behind the gate.
- **Two-layer gate.** Layer 1 extracts hard facts (phone, hours, days, prices, ratings, address, claims like "24/7" or "licensed") and fails on anything *added* versus the source. Layer 2 is an LLM judge for fuzzy claims ("best in town"). It **fails closed**: a judge error, an "unsure" verdict, or no judge means *review*, never *pass*. Only *pass* is served.
- **Everything is pre-generated.** Generation and validation happen ahead of time; the proxy only serves saved, approved artifacts. No LLM or browser in the request path, so the proxy stays fast and doesn't depend on an API being up. A rejected publish leaves the last approved artifact serving.
- **Amplify is also checked against the live human page**, not just the profile. The policy is about what people can read, so a profile fact that the page doesn't show is rejected.
- **Client IP is the socket peer, never `X-Forwarded-For`**, which anyone can forge. Behind another load balancer, verification would fail closed (bots get the plain site).
- **The judge defaults to `claude-sonnet-5`** (override with `GEO_JUDGE_MODEL`), following the plan's "low-cost tier" default. It is one line to change.
- **Removed a planned `cloakLeak` log flag.** Cloak's block does no I/O and can't fault, so the flag could never fire. The real leak paths (unlisted bots, browser-UA spoofing) are invisible to the log.

## Verified vs assumed

Verified:
- Vendor IP-range file URLs and their JSON format (OpenAI, Perplexity, Anthropic), fetched live in Sept 2026. `GEO_LIVE_TESTS=1 npx vitest run src/verification` re-checks them.
- The OpenAI and Perplexity UA strings, against vendor docs.
- The proxy over real HTTP, and Mirror against real headless Chromium.

Assumed or unproven:
- **The LLM judge has only run against a mocked client, never the real API.** Its request shape typechecks against the SDK types. Nobody has seen a real verdict.
- **Anthropic publishes tokens and one shared IP list, but no full UA strings.** The three Claude UA strings in `botUserAgents.ts` are modelled on the documented pattern. Matching only uses the tokens, but the strings themselves are unconfirmed.
- Phase 0 was never run, so there's no data on whether AI answers cite business-owned sites at all.

## Known gaps

- **Artifacts go stale.** The human-page check happens once, at publish. If the business changes its phone number or hours, bots keep getting the old facts while people see new ones, which is exactly what the policy forbids. Nothing detects this yet.
- **The crawl log is written but never read.** The log-based diagnostics (last crawled, freshness lag, zero-crawl) don't exist.
- **The proxy has no runnable entry point** beyond the demo script. Nothing loads real tenants with a persistent store and log.
- **No suggestions engine and no dashboard.**
- Our own scanner isn't a verified bot IP, so it never sees the Amplify version. `uaDiffChecker.ts` and `perBotSignals.ts` are unchanged and can't flag it. To see what bots get, read the store directly.
- Google-Extended never fetches, so robots.txt is the only lever for it.
- Cloak can't catch bots missing from `AI_BOTS` or bots spoofing a browser UA.
- Mirror's gate compares facts between two renders, so it misses prose-only differences.
- Proxy redirects aren't rewritten (an origin `Location` header still names the origin host).
- No auth anywhere. Not deployed: Node wrapper only, no Cloudflare Worker entry.

## Next steps (recommended order)

| # | Step | Done when | Needs |
| --- | --- | --- | --- |
| 1 | **N4: run the judge for real.** `judgeSmoke.ts` sends fixtures (faithful text, fuzzy claims, a credential claim, a prompt-injection attempt) through the real judge. Tune the prompt if it misses. | Verdicts look right and token cost is recorded. | An `ANTHROPIC_API_KEY` and OK to spend a few small requests. |
| 2 | **N0: runnable proxy.** `npm run proxy` loading tenants, a file-backed store and a persistent JSONL log; `npm run publish -- <tenant>` to create artifacts. Add `data/` to `.gitignore`. | The proxy runs standalone and an operator can publish without writing code. | Nothing. |
| 3 | **N1: drift audit.** Re-render the live page, re-check every stored artifact, and expire stale ones (add `delete` to `ApprovedStore`) so the proxy falls back to the ordinary page. Run on an interval. | Changing the mock site's phone makes the audit flag it and the proxy stop serving the old artifact. | Nothing. |
| 4 | **N2: log diagnostics.** A pure `crawlStats` over the log: last verified crawl, spoof attempts, zero-crawl bots, freshness lag. | Fixture logs produce the expected report. | Step 2. |
| 5 | **N3: suggestions engine plus dashboard.** Rule-based `DiagnosticReport` to ranked recommendations, then a small server-rendered page: scan a URL, see suggestions, tenant view with mode, artifact, audit and crawl stats. Escape all HTML. Bind to 127.0.0.1, no auth. | A scan of the mock site shows sensible suggestions and the tenant view renders. | Steps 3 and 4 for its data. |
| 6 | **N5 (stretch): Worker deploy.** A Cloudflare Worker wrapping `handleRequest`, using `CF-Connecting-IP` as the client IP. | A public demo URL, if the event needs one. | A decision that it's needed. |

Suggested split for two people: one takes N1 and N2 (correctness and log work, all pure logic with tests); the other takes N3 (the suggestions engine is pure, the dashboard depends on the others' data). Steps 1 and 2 are small and can go to either.

## Open questions

- Is a public or deployed demo needed, or is running locally at the event fine?
- Rename the `cloak` mode (Hide / Opt out / Block) to avoid the clash with the cloaking policy? Customer copy should also say "we stop AI crawlers from fetching your site", **not** that nothing is retained. We can't control what vendors already hold.
- Default mode for new tenants? (Proposed: mirror, the safest.)
- OK to spend API credit on the judge tests, and who holds the key?
- Dashboard as a server-rendered Node page (proposed, matches the repo's dependency-light style) or a React/Vite front end?

## Gotchas

- The mock site is fixed on port 4173, so don't run two demos at once.
- `vitest` 5 needs `vite` installed separately (already in `package.json`).
- Git prints "LF will be replaced by CRLF" warnings on Windows. Harmless.
- Playwright's Chromium is installed per machine, outside the repo. Tests that need it skip themselves if it's missing.
- Claude-User and Claude-SearchBot UA strings are unconfirmed (see above); don't treat a UA-string mismatch on those as a proxy bug.
