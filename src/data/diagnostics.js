// Front-end data layer for the URL diagnostics engine.
//
// `scanReport(url)` calls the bridge (server/bridge.ts -> the engine's
// runDiagnostics) and returns a real DiagnosticReport whose shape matches
// src/crawlers/types.ts verbatim. `sampleReport()` is the same shape, kept as an
// offline fallback for demos when the bridge isn't running.
//
// URL-only: there is no GitHub path here — the engine has none. Freshness and
// live crawl observability are omitted (they need the proxy running in front of
// the site, which a one-shot URL scan can't produce).

const API = {
  scan: '/api/scan',
  files: '/api/files',
  repoScan: '/api/repo-scan',
  repoPr: '/api/repo-pr',
  robots: (mode) => `/api/robots?mode=${encodeURIComponent(mode)}`,
}

// fetch() rejects with the browser's own wording ("Failed to fetch") when the server can't be reached; say it plainly.
async function post(path, body) {
  try {
    return await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('Couldn’t reach the Aperture server. Check your connection and try again.')
  }
}

// ---- suggested files: POST { url, mode, profile? } -> { files, missing, prefill, evidence, source }.
// `profile` is the user's edited business details; anything omitted falls back to what the server read off the page.
export async function fetchFiles(url, mode, profile) {
  const res = await post(API.files, { url, mode, profile })
  if (!res.ok) {
    let msg = `could not build files (${res.status})`
    try { const e = await res.json(); if (e?.error) msg = e.error } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json()
}

// ---- real scan: POST the url to the bridge, get back a DiagnosticReport ----
export async function scanReport(url) {
  const res = await post(API.scan, { url })
  if (!res.ok) {
    let msg = `scan failed (${res.status})`
    try { const e = await res.json(); if (e?.error) msg = e.error } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json() // DiagnosticReport
}

// ---- repo scan: POST a GitHub URL to the bridge, get back a RepoScanReport
// (six check cards + edit targets; shape matches src/repoScan/types.ts verbatim) ----
export async function repoScanReport(url) {
  // The landing input accepts "github.com/owner/repo"; the bridge requires the full https form.
  const normalized = /^https?:\/\//i.test(url) ? url.replace(/^http:/i, 'https:') : `https://${url}`
  const res = await post(API.repoScan, { url: normalized })
  if (!res.ok) {
    let msg = `repo scan failed (${res.status})`
    try { const e = await res.json(); if (e?.error) msg = e.error } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json() // RepoScanReport
}

// ---- repo PR: POST { url, mode } -> the bridge scans the SUBMITTED repo, writes the config
// files, and opens a PR there as the App. A 409 means the repo owner hasn't installed the App
// yet; the response carries the install link so the UI can offer it.
export async function repoPr(url, mode, profile) {
  const normalized = /^https?:\/\//i.test(url) ? url.replace(/^http:/i, 'https:') : `https://${url}`
  const res = await post(API.repoPr, { url: normalized, mode, profile })
  const body = await res.json().catch(() => null)
  if (res.status === 409 && body?.error === 'app-not-installed') return { needsInstall: true, ...body }
  if (!res.ok) throw new Error(body?.error || `PR request failed (${res.status})`)
  return { needsInstall: false, ...body }
}

// ---- real per-mode robots.txt from the engine (generateAiBotRobots), with a
// templated fallback if the bridge is unreachable ----
export async function fetchRobots(mode) {
  try {
    const res = await fetch(API.robots(mode))
    if (res.ok) return await res.text()
  } catch { /* fall through to templated preview */ }
  return generateConfig(mode).robots
}

// ---- offline fallback report (JS-heavy marketing site), full DiagnosticReport shape ----
export function sampleReport(url = 'https://your-site.com') {
  return {
    url,
    robots: {
      ok: true,
      data: {
        robotsTxtFound: true,
        targetPath: '/',
        perBot: [
          { bot: 'GPTBot', allowedTargetPath: true, matchedRule: 'Allow: /', hasExplicitEntry: true },
          { bot: 'ClaudeBot', allowedTargetPath: true, matchedRule: 'Allow: /', hasExplicitEntry: true },
          { bot: 'PerplexityBot', allowedTargetPath: false, matchedRule: 'Disallow: /', hasExplicitEntry: true },
          { bot: 'Google-Extended', allowedTargetPath: true, matchedRule: null, hasExplicitEntry: false },
        ],
      },
    },
    uaDiff: {
      ok: true,
      data: {
        baseline: { statusCode: 200, contentLength: 48210, textHash: 'a1b2c3' },
        baselineUsable: true,
        perBot: [
          { bot: 'GPTBot', vendor: 'OpenAI', statusCode: 200, contentLength: 12040, textHash: 'd4e5', substanceMismatch: true, blocked: false, error: null },
          { bot: 'ClaudeBot', vendor: 'Anthropic', statusCode: 200, contentLength: 47980, textHash: 'a1b2', substanceMismatch: false, blocked: false, error: null },
          { bot: 'PerplexityBot', vendor: 'Perplexity', statusCode: 403, contentLength: 0, textHash: null, substanceMismatch: false, blocked: true, error: null },
        ],
      },
    },
    renderingGap: {
      ok: true,
      data: { rawStatusCode: 200, rawFetchUsable: true, rawTextLength: 1840, renderedTextLength: 9120, gapPercent: 80, jsDependent: true },
    },
    schema: {
      ok: true,
      data: {
        fetchUsable: true, statusCode: 200, found: true, types: ['Organization'], blockCount: 1,
        fieldCompleteness: { present: ['name', 'url'], missing: ['telephone', 'address', 'openingHours', 'areaServed'], percent: 33 },
        telephone: null, telephoneInVisibleText: null,
      },
    },
    content: {
      ok: true,
      data: {
        fetchUsable: true, statusCode: 200, responseTimeMs: 240, htmlBytes: 48210, wordCount: 320, textToHtmlRatio: 0.08,
        h1Count: 1, h2Count: 4, h3Count: 6, statCount: 3, quoteCount: 0, outboundLinkHosts: 5, questionHeadings: 1, lastModifiedHeader: null,
      },
    },
    perBotSignals: {
      ok: true,
      data: {
        baselineUsable: true,
        perBot: [
          { bot: 'GPTBot', statusCode: 200, fetchUsable: true, schemaTypes: ['Organization'], schemaCompletenessPercent: 33, wordCount: 120, differences: ['word count 120 vs 320 (62% less)'], error: null },
          { bot: 'ClaudeBot', statusCode: 200, fetchUsable: true, schemaTypes: ['Organization'], schemaCompletenessPercent: 33, wordCount: 320, differences: [], error: null },
          { bot: 'PerplexityBot', statusCode: 403, fetchUsable: false, schemaTypes: [], schemaCompletenessPercent: 0, wordCount: 0, differences: [], error: null },
        ],
      },
    },
  }
}

// ---- Deterministic GEO signals. Each is a value in [0,1] describing "how
// exposed / AI-readable the site is" on one axis, derived straight from the
// crawler tests. A signal is omitted (null) when its check errored or ran on a
// bot-challenged baseline, so it never counts as pass or fail. These are
// direction-neutral — a mode decides whether high or low is "good". ----
// robots.txt allow/deny per bot — the site's STATED policy, fetched separately
// from the (often firewall-guarded) HTML, so it usually survives when pages don't.
function robotsAllowMap(report) {
  const m = {}
  if (report.robots?.ok) for (const b of report.robots.data.perBot) m[b.bot] = b.allowedTargetPath
  return m
}

// A bot fetch is an EDGE-PROTECTION challenge (infrastructure), not an AI policy,
// when it returns a challenge status but robots.txt doesn't disallow that bot.
// robots-disallow + a refusal is a consistent INTENTIONAL block; robots-allow + a
// refusal is the firewall turning the bot away regardless of the site's wishes.
function isFirewallBot(bot, status, allowMap) {
  return isChallenge(status) && allowMap[bot] !== false
}

// Bots (by name) that a firewall challenged despite robots allowing them.
export function firewallBots(report) {
  const allow = robotsAllowMap(report)
  const set = new Set()
  if (report.uaDiff?.ok) for (const b of report.uaDiff.data.perBot) if (isFirewallBot(b.bot, b.statusCode, allow)) set.add(b.bot)
  return set
}

function geoSignals(report = sampleReport()) {
  const out = {}
  const add = (key, value, note) => { if (value != null && !Number.isNaN(value)) out[key] = { value, note } }

  // access: share of AI bots robots.txt allows to the target path
  if (report.robots?.ok) {
    const b = report.robots.data.perBot
    const allowed = b.filter((x) => x.allowedTargetPath).length
    add('access', b.length ? allowed / b.length : null, `${allowed}/${b.length} AI bots allowed`)
  }

  // served / uaMatch: of the bot UAs, how many get real content, and how many
  // get content that MATCHES the human baseline (no cloaking mismatch). Bots turned
  // away by edge protection are excluded — that's infrastructure, not the site's AI
  // policy, so it must not count as "blocked". If every bot was firewalled, both
  // signals drop out (null) rather than scoring a wall we can't see past.
  if (report.uaDiff?.ok && report.uaDiff.data.baselineUsable) {
    const allow = robotsAllowMap(report)
    const eligible = report.uaDiff.data.perBot.filter((x) => !isFirewallBot(x.bot, x.statusCode, allow))
    if (eligible.length) {
      const served = eligible.filter((x) => !x.blocked).length
      const matched = eligible.filter((x) => !x.blocked && !x.substanceMismatch).length
      add('served', served / eligible.length, `${served}/${eligible.length} bots served content`)
      add('uaMatch', matched / eligible.length, `${matched}/${eligible.length} match the human view`)
    }
  }

  // extractable: content present in raw HTML (low JS-rendering gap)
  if (report.renderingGap?.ok && report.renderingGap.data.rawFetchUsable) {
    const gap = report.renderingGap.data.gapPercent
    add('extractable', Math.max(0, 1 - gap / 100), `${gap}% JS-only`)
  }

  // structured: schema.org present and complete
  if (report.schema?.ok && report.schema.data.fetchUsable) {
    const found = report.schema.data.found
    const pct = found ? (report.schema.data.fieldCompleteness?.percent ?? 100) : 0
    add('structured', found ? pct / 100 : 0, found ? `schema ${pct}% complete` : 'no schema.org')
  }

  // substance: how much a non-JS crawler actually gets to read (words + structure)
  if (report.content?.ok && report.content.data.fetchUsable) {
    const c = report.content.data
    const words = Math.min(1, c.wordCount / 800)
    const headings = c.h1Count + c.h2Count + c.h3Count
    const struct = Math.min(1, headings / 8)
    const n = (count, one) => `${count.toLocaleString()} ${count === 1 ? one : `${one}s`}`
    add('substance', 0.7 * words + 0.3 * struct, `${n(c.wordCount, 'word')} · ${n(headings, 'heading')}`)
  }

  // parity: share of bots whose page is identical to the browser view (mirror
  // fidelity). Firewall-challenged bots are already unusable, so they're excluded.
  if (report.perBotSignals?.ok && report.perBotSignals.data.baselineUsable) {
    const allow = robotsAllowMap(report)
    const comp = report.perBotSignals.data.perBot.filter((x) => !x.error && x.fetchUsable && !isFirewallBot(x.bot, x.statusCode, allow))
    const same = comp.filter((x) => x.differences.length === 0).length
    if (comp.length) add('parity', same / comp.length, `${same}/${comp.length} bots see the same page`)
  }

  return out
}

const SIGNAL_LABELS = {
  access: 'Crawler access',
  served: 'Bots served',
  uaMatch: 'Human/bot parity',
  extractable: 'Extractability',
  structured: 'Structured data',
  substance: 'Content substance',
  parity: 'Per-bot parity',
}

// ---- Per-mode scoring. Same signals, read through the lens of what the mode is
// TRYING to do. `dir: 1` means high exposure is good (contributes the signal as-is);
// `dir: -1` means the mode wants the opposite, so it contributes (1 - signal): the
// more locked-down the site, the higher the score. The score renormalizes over
// whichever signals were measurable. ----
export const MODE_SCORING = {
  amplify: {
    title: 'Amplify score',
    aim: 'Maximize what AI can read and cite — allowed, extractable, structured, substantial. Higher exposure scores higher.',
    weights: { access: { w: 20, dir: 1 }, extractable: { w: 25, dir: 1 }, structured: { w: 25, dir: 1 }, substance: { w: 20, dir: 1 }, served: { w: 10, dir: 1 } },
  },
  mirror: {
    title: 'Mirror score',
    aim: 'AI should see exactly what a person sees — no cloaking, no JS gap, per-bot parity. Fidelity scores higher.',
    weights: { uaMatch: { w: 30, dir: 1 }, extractable: { w: 25, dir: 1 }, parity: { w: 25, dir: 1 }, access: { w: 20, dir: 1 } },
  },
  cloak: {
    title: 'Shielding score',
    aim: 'Keep AI out — the more crawlers are blocked and un-served, the better. Lower exposure scores higher.',
    weights: { access: { w: 45, dir: -1 }, served: { w: 45, dir: -1 }, extractable: { w: 10, dir: -1 } },
  },
}

// HTTP codes a firewall / bot-manager uses to challenge or refuse automated
// traffic. A page-level check that comes back on one of these wasn't measured —
// it was turned away at the edge, which tells us nothing about the page itself.
const CHALLENGE_CODES = new Set([401, 403, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530])

/** True when an HTTP status is a firewall/bot-manager challenge rather than a real page response. */
export function isChallenge(status) {
  return CHALLENGE_CODES.has(status)
}

// ---- Edge-protection detector. Reads the report for firewall/WAF challenges so
// an indeterminate score can say WHY it's indeterminate, rather than inventing
// "no schema" / "blocks AI" on a page we were never allowed to read. We can see
// the challenge status codes; naming the vendor (Cloudflare / AWS WAF) would need
// the engine to surface response headers, which it doesn't today. ----
export function detectProtection(report) {
  const codes = new Set()
  const checks = []
  const allow = robotsAllowMap(report)
  // page-level (browser-UA) fetches: any challenge status is the firewall
  const flag = (name, status) => {
    if (isChallenge(status)) { codes.add(status); if (!checks.includes(name)) checks.push(name) }
  }
  // per-bot fetches: only a firewall when robots doesn't already disallow the bot
  const flagBot = (name, bot, status) => {
    if (isFirewallBot(bot, status, allow)) { codes.add(status); if (!checks.includes(name)) checks.push(name) }
  }

  if (report.renderingGap?.ok && !report.renderingGap.data.rawFetchUsable) flag('rendering', report.renderingGap.data.rawStatusCode)
  if (report.uaDiff?.ok) {
    if (!report.uaDiff.data.baselineUsable) flag('cloaking baseline', report.uaDiff.data.baseline?.statusCode)
    for (const b of report.uaDiff.data.perBot) flagBot('cloaking', b.bot, b.statusCode)
  }
  if (report.schema?.ok && !report.schema.data.fetchUsable) flag('schema', report.schema.data.statusCode)
  if (report.content?.ok && !report.content.data.fetchUsable) flag('content', report.content.data.statusCode)
  if (report.perBotSignals?.ok) for (const b of report.perBotSignals.data.perBot) flagBot('per-bot', b.bot, b.statusCode)

  // The browser baseline itself being challenged is the strong case: we can't see
  // the site at all, so nothing beyond stated policy (robots.txt) is trustworthy.
  const baselineChallenged =
    (report.uaDiff?.ok && !report.uaDiff.data.baselineUsable && CHALLENGE_CODES.has(report.uaDiff.data.baseline?.statusCode)) ||
    (report.renderingGap?.ok && !report.renderingGap.data.rawFetchUsable && CHALLENGE_CODES.has(report.renderingGap.data.rawStatusCode))

  return { challenged: checks.length > 0, codes: [...codes].sort((a, b) => a - b), checks, baselineChallenged }
}

// Deterministic, mode-aware GEO score. Returns 0-100 + grade + factor breakdown,
// PLUS coverage/indeterminate/reason: if a firewall blocked too much of the
// site to measure (or blocked even the browser baseline), the score is
// indeterminate — we return no confident number and explain why, rather than
// scoring a page we couldn't read. `protection` carries the challenge evidence. ----
export function computeGeoScore(report = sampleReport(), mode = 'mirror') {
  const sig = geoSignals(report)
  const spec = MODE_SCORING[mode] ?? MODE_SCORING.mirror
  const factors = []
  let totalWeight = 0
  let measuredWeight = 0
  let acc = 0

  for (const [key, { w, dir }] of Object.entries(spec.weights)) {
    totalWeight += w
    const s = sig[key]
    if (!s) continue // signal was inconclusive / not measurable — skip, don't penalize
    const pct = dir > 0 ? s.value : 1 - s.value
    factors.push({ key, label: SIGNAL_LABELS[key], weight: w, pct, note: s.note, dir })
    measuredWeight += w
    acc += w * pct
  }

  const coverage = totalWeight ? measuredWeight / totalWeight : 0
  const protection = detectProtection(report)
  const score = measuredWeight ? Math.round((acc / measuredWeight) * 100) : 0

  // Indeterminate when the browser baseline was firewalled (we saw nothing), or
  // when less than half the mode's signal could be measured.
  const indeterminate = protection.baselineChallenged || coverage < 0.5
  let reason = null
  if (indeterminate) {
    if (protection.baselineChallenged) {
      reason = `The site returned firewall challenges (HTTP ${protection.codes.join('/')}) even to an ordinary browser, so nothing beyond stated policy could be verified.`
    } else if (protection.challenged) {
      reason = `Edge protection blocked ${protection.checks.length} page-level check(s) (HTTP ${protection.codes.join('/')}); only ${Math.round(coverage * 100)}% of this mode's signal could be measured — not enough to score.`
    } else {
      reason = `Only ${Math.round(coverage * 100)}% of this mode's signals could be measured — not enough for a confident score.`
    }
  }

  const grade = indeterminate ? '—' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F'
  return { score, grade, factors, title: spec.title, aim: spec.aim, coverage, indeterminate, reason, protection }
}

// ---- Agent identity: how Aperture's proxy decides who gets the exposure
// artifact. This is the engine's real model (verification/botIdentity.ts +
// proxy/handler.ts): a claimed AI bot is served the artifact ONLY if its source
// IP is inside that vendor's published ranges; a spoofed UA from any other IP is
// treated as an ordinary visitor. ANS was evaluated and rejected — verification
// is IP-range based only. Illustrative lanes shown in the report. ----
export const identityLanes = [
  {
    id: 'verified',
    label: 'Published range',
    agent: 'GPTBot',
    ua: 'GPTBot/1.2',
    method: 'IP ∈ OpenAI range',
    status: 'verified',
    detail: 'Source IP falls inside OpenAI’s published crawler ranges. Served the exposure artifact.',
  },
  {
    id: 'spoofed',
    label: 'Spoofed UA',
    agent: 'GPTBot (impostor)',
    ua: 'GPTBot/1.2',
    method: 'IP ∉ any range',
    status: 'failed',
    detail: 'Identical User-Agent, but the source IP is outside every vendor range. Treated as an ordinary visitor — gets the plain site, never the artifact.',
  },
  {
    id: 'passthrough',
    label: 'No bot claim',
    agent: 'a person / unknown UA',
    ua: '(no AI-bot token)',
    method: 'no claim',
    status: 'passthrough',
    detail: 'No AI-bot token in the User-Agent. Passes straight through to the origin, untouched.',
  },
]

// ---- exposure -> generated config preview (ties the iris to real output).
// robots.txt is real (fetched per-mode from the engine via fetchRobots); llms.txt
// and JSON-LD are templated previews — the engine generates those from a business
// profile, which a URL scan doesn't have. ----
export function generateConfig(mode) {
  const robotsByMode = {
    cloak: `User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /`,
    mirror: `User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /`,
    amplify: `User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /`,
  }
  const llmsByMode = {
    cloak: '# llms.txt\n# Exposure: Cloak — retrieval disabled.',
    mirror: '# llms.txt\n# Exposure: Mirror\n> Faithful reflection of the human page.\n\n## Pages\n- /: Overview',
    amplify: '# llms.txt\n# Exposure: Amplify\n> Structured, quotable, citation-ready.\n\n## Company\n- Name, services, hours, area\n\n## Pages\n- /: Overview (markdown mirror)\n- /pricing: Plans',
  }
  const schemaByMode = {
    cloak: '— none served —',
    mirror: '{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "…"\n}',
    amplify: '{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "…",\n  "telephone": "…",\n  "areaServed": "…",\n  "openingHours": "…"\n}',
  }
  return { robots: robotsByMode[mode], llms: llmsByMode[mode], schema: schemaByMode[mode] }
}
