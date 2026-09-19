// Front-end data layer. Shapes match the `crawlers` engine's DiagnosticReport
// (src/crawlers/types.ts) verbatim, so this is a drop-in for the real
// runDiagnostics(url) output / a thin API endpoint later. Freshness, metrics
// and ANS lanes are the Phase-2/observability + demo layers on top.

// ---- a realistic Phase-1 diagnostic report (JS-heavy marketing site) ----
export function sampleReport(url = 'github.com/vercel/next.js') {
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
      data: {
        rawStatusCode: 200,
        rawFetchUsable: true,
        rawTextLength: 1840,
        renderedTextLength: 9120,
        gapPercent: 80,
        jsDependent: true,
      },
    },
    schema: {
      ok: true,
      data: { fetchUsable: true, statusCode: 200, found: false, types: [], blockCount: 0 },
    },
  }
}

// ---- freshness (Phase-2 / log-dependent) ----
export const freshness = {
  perBot: [
    { bot: 'GPTBot', lastHitDays: 2 },
    { bot: 'ClaudeBot', lastHitDays: 6 },
    { bot: 'PerplexityBot', lastHitDays: null }, // never
    { bot: 'Google-Extended', lastHitDays: 11 },
  ],
  lagDays: 6, // freshest meaningful crawl age used in the score
}

// ---- GEO score: robots access + freshness (primary, per PLAN) with schema
// and rendering-gap as modifiers. Only measurable factors are included; the
// score renormalizes over them (so a CLI run with no crawl logs still scores
// fairly on what a URL alone can prove). Returns 0-100 + factor breakdown. ----
export function computeGeoScore(report = sampleReport(), fresh = freshness) {
  const factors = []

  // robots: share of AI bots allowed to the target path
  if (report.robots.ok) {
    const bots = report.robots.data.perBot
    const allowed = bots.filter((b) => b.allowedTargetPath).length
    factors.push({ key: 'access', label: 'Crawler access', weight: 35,
      pct: bots.length ? allowed / bots.length : 0, note: `${allowed}/${bots.length} AI bots allowed` })
  }

  // freshness: recency of the most recent crawl (30d window -> 0). Skipped
  // when unavailable (no crawl logs) — pass fresh = null.
  if (fresh) {
    const lag = fresh.lagDays ?? 30
    factors.push({ key: 'freshness', label: 'Freshness', weight: 30, pct: Math.max(0, 1 - lag / 30),
      note: fresh.lagDays == null ? 'never crawled' : `last crawl ${lag}d ago` })
  }

  // extractability: rendering gap (lower gap = better)
  if (report.renderingGap.ok) {
    const gap = report.renderingGap.data.gapPercent
    factors.push({ key: 'extract', label: 'Extractability', weight: 20, pct: Math.max(0, 1 - gap / 100),
      note: `${gap}% JS-only` })
  }

  // structure: schema present
  if (report.schema.ok) {
    const has = report.schema.data.found
    factors.push({ key: 'schema', label: 'Structured data', weight: 15, pct: has ? 1 : 0,
      note: has ? 'JSON-LD present' : 'no schema.org' })
  }

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1
  const score = Math.round(factors.reduce((s, f) => s + f.weight * f.pct, 0) / totalWeight * 100)
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F'
  return { score, grade, factors }
}

// ---- ANS verification lanes (the hackathon demo centerpiece) ----
export const ansLanes = [
  {
    id: 'registered',
    label: 'Registered agent',
    agent: 'aperture-scan',
    ua: 'aperture-scan/1.0 (+ans)',
    method: 'ANS signature',
    status: 'verified',
    detail: 'Cryptographic identity resolved in the ANS registry. Signature valid.',
  },
  {
    id: 'spoofed',
    label: 'Spoofed agent',
    agent: 'aperture-scan (impostor)',
    ua: 'aperture-scan/1.0 (+ans)',
    method: 'ANS signature',
    status: 'failed',
    detail: 'Identical User-Agent, but no valid ANS signature. Identity rejected.',
  },
  {
    id: 'fallback',
    label: 'Known crawler',
    agent: 'GPTBot',
    ua: 'GPTBot/1.2',
    method: 'IP-range fallback',
    status: 'verified',
    detail: 'Not in ANS, but source IP matches OpenAI’s published range.',
  },
]

// ---- observability metrics (per-bot hits + path coverage) ----
export const metrics = {
  perBot: [
    { bot: 'GPTBot', total: 1284, perDay: [4, 9, 6, 12, 8, 15, 22, 18, 27, 31, 24, 29], lastHitHrs: 5 },
    { bot: 'ClaudeBot', total: 642, perDay: [2, 3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12], lastHitHrs: 14 },
    { bot: 'PerplexityBot', total: 0, perDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], lastHitHrs: null },
  ],
  pathCoverage: {
    sitemapTotal: 128,
    crawled: 87,
    orphaned: ['/pricing/enterprise', '/docs/edge-runtime', '/blog/2024-geo', '/changelog'],
  },
}

// ---- exposure -> generated config preview (ties the iris to real output) ----
export function generateConfig(mode) {
  const robotsByMode = {
    cloak: `User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /`,
    mirror: `User-agent: *\nAllow: /\nSitemap: /sitemap.xml`,
    amplify: `User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n\n# AI answer engines\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /`,
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
