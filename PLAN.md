# GEO Project Plan

**What this project is:** A Generative Engine Optimization (GEO) product for local businesses — diagnosing and improving how their web presence gets crawled, extracted, and cited by AI answer engines (Perplexity, ChatGPT, Gemini).

**How to read this file:** Phases 0–4 are the build sequence. The "Open questions & decisions" section records constraints and pivots agreed during planning — check it before building anything, since some phase details are contingent on Phase 0 results.

---

## Hackathon scope

**Decision (2026-09-19): ANS integration dropped.** Cryptographic agent verification isn't load-bearing for this product: a request claiming a crawler UA is agentic-traffic signal whether or not it's spoofed (nobody sends `GPTBot` UAs except AI-adjacent tooling), the bot-served content is public and substance-identical (so serving a spoofer costs nothing), and major operators haven't adopted ANS anyway. Classify agent traffic by **claimed UA**; treat verification (IP-range check → Web Bot Auth → ANS) as a future confidence-scoring layer, not a gate. The log schema keeps a nullable `verified`/`method` field so verification can be added later without a migration.

- **Demo centerpiece (back to the original plan):** the end-to-end GEO loop — submit a URL → diagnostics run (robots, UA-diff, rendering gap, schema) → citation panel results → suggestions report → (stretch) harness turns a suggestion into a PR. Agent-traffic observation runs on the sandbox site with simulated claimed-UA bots.
- **Build order for the event:** diagnostics + report first (it's the product); sandbox traffic simulation + logging second; harness PR flow third; dashboard polish throughout.

### Team split (4 people)

| Role | Owns (plan sections) | Delivers |
| --- | --- | --- |
| **UI/frontend** | Phase 1 dashboard + accounts | URL submission → report view; live agent-traffic view (which claimed agents hit the sandbox, when, what they fetched); PR-created confirmation |
| **Harness** | Phase 3 GitHub App + agent engine | GitHub App registration, orchestrator, Claude agent session, change-spec → PR pipeline |
| **GEO analysis** (data → conclusions) | Phase 1 diagnostic fetchers, citation query panel, suggestions engine, data store | Per-site diagnostic report (JSON) + suggestions; the suggestions output doubles as the harness's change spec |
| **Crawler enablement** | Phase 2 middleware + agent-traffic simulation | Simulated agent traffic (claimed-UA bots hitting the sandbox site), crawl-traffic log capture, claimed-UA classification |

### Interface contracts (agree on these first — they're the integration risk)

1. **Report schema** (GEO analysis → UI): the JSON shape of diagnostics + suggestions the dashboard renders.
2. **Change spec** (GEO analysis → Harness): the suggestions engine's structured output IS the harness's input — see Phase 3 "Instruction contract."
3. **Agent-traffic events** (Crawler enablement → UI + GEO analysis): per-request `{claimed_agent, ua, path, timestamp, response_served, verified?: null, method?: null}` — feeds the live demo view and the crawl-history diagnostics. `verified`/`method` stay null for now; reserved so verification can be layered in later without a schema change.
4. **Crawl logs** (Crawler enablement → GEO analysis): the middleware's captured traffic unlocks the "crawled but never cited" class of conclusions.

---

## Sequencing logic (one line)

Diagnostics-and-suggestions requires nothing from a vendor and validates demand fastest; the content/config generators are the shared engine both automation paths need; middleware is lower-trust and ships before the GitHub App, which needs a higher trust bar and vendor approval; real pilot businesses come last because they need something real to test.

---

## Phase 0 — Prove the core assumption before building anything

Before writing product code: confirm actual demand. Sample real local-intent prompts across Perplexity, ChatGPT, and Gemini and check whether local answers are sourced from Maps/Yelp-style structured aggregator data versus a business's own site prose. Cheap to check, expensive to skip.

- **Kill/pivot criterion (define before running):** if less than ~20% of citations across the panel come from business-owned domains, the on-site-content wedge is dead and the product pivots to aggregator/directory optimization (GBP, Yelp, NAP consistency) — which still fits the Phase 1 shape (diagnostics + suggestions, no write access).
- **Extend the panel** to record *which* aggregators dominate per vertical and geography. That data is product input either way.
- **Start sandbox sites now, not in Phase 4.** Aged domains and crawl-rotation inclusion take months — longest lead-time item in the plan, near-zero cost to start.
- Expect noise: citation results vary by day, phrasing, and session. Use many prompt variants, repeated runs, rolling averages.

## Phase 1 — Diagnostics and suggestions only (no write access needed)

Fastest path to a sellable product: requires nothing from a vendor except a URL.

- **Diagnostic fetcher set** — robots.txt parser (per-bot rule detection, not just file presence); rendering-gap scorer (raw HTTP fetch vs. headless-browser fetch, diffed); UA-diff checker (browser UA vs. GPTBot/ClaudeBot UA, diffed — flag both absence of routing and substance mismatches as cloaking risk); schema/JSON-LD presence check.
- **Citation query panel** — fixed local-intent prompt set run on a schedule against Perplexity's Sonar API, OpenAI's Responses API with web search, and Gemini's grounding API, storing returned source lists. (This is the same panel built for Phase 0 — Phase 0's tooling becomes the product's monitoring core.)
- **Suggestions engine** — translation layer turning diagnostic + citation results into specific recommendations ("40% of this page is JS-only and invisible to crawlers," "crawled but never cited — rewrite for extraction").
- **Minimal data store** — vendor records, diagnostic history, citation history over time. Needed from day one: "before/after" is meaningless without stored history.
- **Scheduler** for recurring panel runs and re-checks.
- **Thin dashboard + accounts/auth** — sign up, submit a URL, see the suggestions report.

Notes and constraints:

- **Crawl-log-dependent diagnostics do NOT belong in Phase 1.** "Last-crawled," freshness-lag, and "high traffic, zero crawl" require server logs, which only exist once the Phase 2 middleware is live (or via a vendor's Cloudflare AI-crawler analytics / log upload). Keep Phase 1 to what a URL alone can prove.
- **GTM: the one-shot diagnostic report is free** (lead-gen scanner, the SEO-auditor playbook). Monitoring, history, and suggestions are the paid layer.
- **Pull 1–2 pilot businesses forward into this phase** to validate willingness-to-pay for the diagnosis itself.

Ship this first. It validates whether vendors value the diagnosis before building the automated-changes layer.

## Observability tiers (how we see agent traffic on sites we don't own)

You cannot passively observe a third party's inbound traffic — every tier is a different level of vendor participation, and the funnel monetizes the upgrade:

- **Tier 0 — URL only (the "non-invasive" promise):** observations we generate ourselves — static diagnostics via our own fetches (robots, rendering gap, UA-diff, schema) + the citation panel. Key inference: *citation implies crawl*, so from outside we can establish "cited (∴ crawled)", "blocked", and "unknown" — but we cannot split "unknown" into crawled-but-never-cited (extraction problem) vs. never-crawled (discoverability problem). That gap is the upsell.
- **Tier 1 — permission, no infrastructure change:** vendor grants read access to Cloudflare's AI-crawler analytics (many SMB sites are already behind Cloudflare), or exports server logs to us. Note: a JS analytics snippet does NOT work — GPTBot/ClaudeBot don't execute JS.
- **Tier 2 — middleware (one DNS change, no code change):** full request-path observability + the ability to serve bot-optimized responses. This is Phase 2; gated behind the free Tier 0 report proving value first.

Hackathon demo runs on our own sandbox site, where we're in the request path by definition.

## Phase 2 — Automated changes for URL-only vendors (middleware path)

- **Content-generation engine** — turns structured local-business inputs (hours, services, area, reviews) into citation-friendly output. Built once; feeds both the middleware and the GitHub App delivery paths.
  - **Cloaking policy (hard constraint, in the spec not just in heads):** bot-served content must be *same substance, cleaner format* — markdown/schema equivalents of the human-visible page. Never different claims or content for bots.
- **Config-file generator** — robots.txt, llms.txt, schema/JSON-LD. Its own simpler component (lower-risk, easy-to-automate tier). Note: generate llms.txt because it's nearly free, but do not sell it as impact — no major crawler currently honors it.
- **Middleware/edge proxy** — bot detection by claimed UA, serving generated markdown/schema without vendor code changes. Also the layer that captures crawl-traffic logs going forward (unlocking the log-dependent diagnostics deferred from Phase 1).
- **Agent-traffic classification** as a shared utility both diagnostics and middleware depend on. **Decision (2026-09-19): classify by claimed UA; don't gate on verification.** Spoofed-or-not, a crawler UA is agentic-traffic signal; bot-served content is public and substance-identical, so misclassification costs nothing. Verification (IP-range → Web Bot Auth → ANS, in ascending adoption-dependence) is a deferred confidence-scoring layer — the nullable `verified`/`method` fields in the traffic-event schema are the hook. If revisited: agent *operators* publish identities, vendor sites comply with nothing, our middleware is the relying party.

This is where "suggestions" becomes "we made the change for you," for vendors who'll route traffic through us but won't grant repo access.

## Phase 3 — Automated changes for platform-connected vendors

- **Reality check on the segment:** local businesses mostly do not have GitHub repos — they're on WordPress, Wix, Squarespace, GoDaddy builders. A **WordPress plugin** (the Yoast playbook) reaches far more of this market than a GitHub App and has a lower trust bar than middleware. Evaluate plugin-first before committing to App-first.
- **GitHub App** (targets agencies/dev shops managing many local sites, not individual businesses) — registered under our org, "Any account" install scope, minimal permission set (contents + pull_requests + metadata), webhook listener, installation-token auth, PR-based commits only (never direct-to-main), drawing on Phase 2's generators. Ships after Phase 2 — the App has nothing to commit without the generators.
- **Architecture: the App is the identity wrapper; Claude is the engine.** The GitHub App provides authorship (PRs appear from our app), short-lived installation tokens, and webhooks. The actual edits are made by a Claude agent (Claude Agent SDK headless, or Anthropic Managed Agents with a `github_repository` mount) driven by our orchestrator. Flow: suggestion approved in dashboard → orchestrator mints an installation token → agent session clones the repo, makes edits on a branch, pushes, opens a PR via the GitHub API/MCP → PR is authored by our App.
- **Instruction contract (change spec).** The suggestions engine's output IS the agent's input — don't pass free-text prompts. Each run gets a structured change spec (JSON): task list with `type` (add-jsonld | generate-llms-txt | robots-rules | rewrite-for-extraction), target paths/URLs, the structured business inputs (hours, services, area), and hard constraints. The orchestrator renders the spec into the agent's kickoff message; a stable system prompt carries the standing guardrails: branch + PR only (never push to default), minimal diffs, touch only files named in the spec, cloaking policy (same substance, cleaner format), and PR title/body conventions. Post-run validation (schema/JSON-LD validator + diff-scope check that only spec'd files changed) gates PR creation.
- **Terms of Service + Privacy Policy** — required by GitHub before the App goes public; needed anyway given the pseudonymization commitment on the observability side.

## Phase 4 — Real-world validation loop

- Recruit 2–4 willing pilot businesses for a **staggered rollout** (stagger, not strict control/treatment — holding a real business at zero changes indefinitely isn't fair to them), instrumented via the Phase 2 middleware regardless of whether they also connect GitHub. This answers "did our changes actually move citation and crawl behavior" with real data.
- **North-star metric:** citation share on the fixed prompt panel (rolling average). Secondary, customer-visible metric: AI referral traffic (e.g., chatgpt.com referrers).
- Sandbox sites (started in Phase 0) used for fast internal iteration before anything ships to a pilot business.

## Stretch — after Phases 1–3 work

- **Exposure-level toggle** (high/low visibility) — a config setting on the existing middleware and GitHub App, not a new subsystem.
- **GitHub Marketplace listing**, once inbound discovery matters more than direct-link distribution.

---

## Open questions & decisions

| Item | Status |
| --- | --- |
| Does the on-site wedge exist for local, or do aggregators dominate citations? | **Open — Phase 0 answers this.** Kill criterion: <~20% business-owned-domain citations → pivot to directory/GBP optimization. |
| Primary buyer: individual local businesses or agencies managing many? | **Open.** Agency motion fixes CAC and makes the GitHub App persona real. Decide during Phase 1 pilots. |
| WordPress plugin vs. GitHub App priority in Phase 3 | **Leaning plugin-first** for market reach; App retained for the agency/dev segment. |
| Cloaking policy | **Decided:** same substance, cleaner format; never divergent content for bots. |
| Free diagnostic as lead gen | **Decided:** one-shot report free; monitoring/history/suggestions paid. |
| Crawl-log diagnostics timing | **Decided:** deferred to Phase 2 (requires middleware logs or Cloudflare/log-upload integration). |

## Competitive context

Enterprise GEO monitoring is crowded (Profound, Peec, Otterly; Semrush/Ahrefs adding AI-visibility features). Local is under-served — but the reason it's under-served is exactly the Phase 0 question (aggregator data may dominate local answers). Phase 0 validates both demand and why incumbents haven't come down-market.
