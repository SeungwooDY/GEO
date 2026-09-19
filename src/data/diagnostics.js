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
  robots: (mode) => `/api/robots?mode=${encodeURIComponent(mode)}`,
}

// ---- real scan: POST the url to the bridge, get back a DiagnosticReport ----
export async function scanReport(url) {
  const res = await fetch(API.scan, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    let msg = `scan failed (${res.status})`
    try { const e = await res.json(); if (e?.error) msg = e.error } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json() // DiagnosticReport
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

// ---- GEO score over what a URL alone can prove: crawler access (robots),
// extractability (rendering gap) and structured data. Freshness is intentionally
// absent — no crawl logs from a one-shot scan. Each factor is skipped when its
// check errored or returned an unusable (bot-challenged) baseline, and the score
// renormalizes over the factors that remain. Returns 0-100 + a breakdown. ----
export function computeGeoScore(report = sampleReport()) {
  const factors = []

  // crawler access: share of AI bots allowed to the target path
  if (report.robots?.ok) {
    const bots = report.robots.data.perBot
    const allowed = bots.filter((b) => b.allowedTargetPath).length
    factors.push({ key: 'access', label: 'Crawler access', weight: 45,
      pct: bots.length ? allowed / bots.length : 0, note: `${allowed}/${bots.length} AI bots allowed` })
  }

  // extractability: rendering gap (lower gap = better). Only when the raw fetch was usable.
  if (report.renderingGap?.ok && report.renderingGap.data.rawFetchUsable) {
    const gap = report.renderingGap.data.gapPercent
    factors.push({ key: 'extract', label: 'Extractability', weight: 30, pct: Math.max(0, 1 - gap / 100),
      note: `${gap}% JS-only` })
  }

  // structured data: schema present. Only when the fetch was usable (else absence is unproven).
  if (report.schema?.ok && report.schema.data.fetchUsable) {
    const has = report.schema.data.found
    const pctField = has && report.schema.data.fieldCompleteness ? report.schema.data.fieldCompleteness.percent / 100 : has ? 1 : 0
    factors.push({ key: 'schema', label: 'Structured data', weight: 25, pct: pctField,
      note: has ? `JSON-LD present${report.schema.data.fieldCompleteness ? ` · ${report.schema.data.fieldCompleteness.percent}% fields` : ''}` : 'no schema.org' })
  }

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1
  const score = Math.round(factors.reduce((s, f) => s + f.weight * f.pct, 0) / totalWeight * 100)
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F'
  return { score, grade, factors }
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
