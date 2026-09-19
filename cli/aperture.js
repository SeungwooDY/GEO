#!/usr/bin/env node
// Aperture CLI — Phase-1 GEO diagnostics for a single URL.
// Dependency-free (Node 18+ native fetch). Produces the same DiagnosticReport
// shape the web console consumes and scores with the shared formula.
//
//   aperture <url> [--mode cloak|mirror|amplify] [--json] [--no-color]
//
import { computeGeoScore } from '../src/data/diagnostics.js'

// ---------- tiny ANSI (no deps) ----------
const noColor = process.argv.includes('--no-color') || !process.stdout.isTTY
const c = (code) => (s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`)
const dim = c('2'), bold = c('1'), green = c('32'), red = c('31'), yellow = c('33'), cyan = c('36')

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const BOT_UAS = {
  GPTBot: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ClaudeBot: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
}
const VENDOR = { GPTBot: 'OpenAI', ClaudeBot: 'Anthropic', PerplexityBot: 'Perplexity' }
const ROBOTS_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchUA(url, ua) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow' })
    const text = await res.text()
    return { statusCode: res.status, text, length: text.length, error: null }
  } catch (err) {
    return { statusCode: null, text: '', length: 0, error: err.message?.split('\n')[0] || String(err) }
  }
}

// ---------- robots.txt ----------
function parseRobots(txt) {
  const groups = {}
  let current = []
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [k, ...rest] = line.split(':')
    const key = k.trim().toLowerCase()
    const val = rest.join(':').trim()
    if (key === 'user-agent') {
      const ua = val.toLowerCase()
      if (!groups[ua]) groups[ua] = []
      current = groups[ua]
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.push({ type: key, path: val })
    }
  }
  return groups
}

function robotsAllows(groups, botLower, targetPath) {
  const rules = groups[botLower] || groups['*'] || []
  let best = null
  for (const r of rules) {
    if (r.path === '' && r.type === 'disallow') continue // "Disallow:" = allow all
    if (targetPath.startsWith(r.path)) {
      if (!best || r.path.length > best.path.length) best = r
    }
  }
  return {
    allowed: best ? best.type === 'allow' : true,
    matchedRule: best ? `${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.path || '/'}` : null,
    hasExplicitEntry: !!groups[botLower],
  }
}

async function checkRobots(base, targetPath) {
  const res = await fetchUA(new URL('/robots.txt', base).href, BROWSER_UA)
  const found = res.statusCode === 200 && /user-agent/i.test(res.text)
  const groups = found ? parseRobots(res.text) : {}
  return {
    ok: true,
    data: {
      robotsTxtFound: found,
      targetPath,
      perBot: ROBOTS_BOTS.map((bot) => {
        const r = robotsAllows(groups, bot.toLowerCase(), targetPath)
        return { bot, allowedTargetPath: found ? r.allowed : true, matchedRule: r.matchedRule, hasExplicitEntry: r.hasExplicitEntry }
      }),
    },
  }
}

// ---------- UA-diff / cloaking ----------
async function checkUaDiff(url) {
  const base = await fetchUA(url, BROWSER_UA)
  const baseText = stripTags(base.text)
  const baselineUsable = base.statusCode === 200 && baseText.length > 0
  const perBot = []
  for (const [bot, ua] of Object.entries(BOT_UAS)) {
    const r = await fetchUA(url, ua)
    const botText = stripTags(r.text)
    const blocked = r.statusCode == null || r.statusCode >= 400 || botText.length === 0
    const ratio = baseText.length ? botText.length / baseText.length : 1
    perBot.push({
      bot, vendor: VENDOR[bot], statusCode: r.statusCode, contentLength: r.length, textHash: null,
      substanceMismatch: baselineUsable && !blocked && (ratio < 0.7 || ratio > 1.4),
      blocked, error: r.error,
    })
  }
  return { ok: true, data: { baseline: { statusCode: base.statusCode, contentLength: base.length, textHash: null }, baselineUsable, perBot } }
}

// ---------- schema / JSON-LD ----------
async function checkSchema(url) {
  const res = await fetchUA(url, BROWSER_UA)
  const usable = res.statusCode === 200 && res.length > 0
  const blocks = [...res.text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
  const types = new Set()
  for (const b of blocks) {
    try {
      const json = JSON.parse(b[1].trim())
      const nodes = json['@graph'] || (Array.isArray(json) ? json : [json])
      for (const n of nodes) if (n && n['@type']) [].concat(n['@type']).forEach((t) => types.add(t))
    } catch { /* ignore malformed block */ }
  }
  return { ok: true, data: { fetchUsable: usable, statusCode: res.statusCode ?? 0, found: blocks.length > 0, types: [...types], blockCount: blocks.length } }
}

// ---------- rendering gap (heuristic — full check needs headless engine) ----------
async function checkRenderingGap(url) {
  const res = await fetchUA(url, BROWSER_UA)
  const usable = res.statusCode === 200 && res.length > 0
  const rawText = stripTags(res.text)
  const scriptCount = (res.text.match(/<script/gi) || []).length
  const shell = /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(res.text)
  const jsDependent = usable && (shell || (rawText.length < 800 && scriptCount > 3))
  const gapPercent = !usable ? 0 : jsDependent ? (shell ? 90 : 70) : Math.min(30, Math.round((scriptCount / 40) * 30))
  return { ok: true, data: { rawStatusCode: res.statusCode ?? 0, rawFetchUsable: usable, rawTextLength: rawText.length, renderedTextLength: null, gapPercent, jsDependent, heuristic: true } }
}

async function runDiagnostics(url) {
  const targetPath = new URL(url).pathname || '/'
  const [robots, uaDiff, schema, renderingGap] = await Promise.all([
    checkRobots(url, targetPath), checkUaDiff(url), checkSchema(url), checkRenderingGap(url),
  ])
  return { url, robots, uaDiff, renderingGap, schema }
}

// ---------- rendering ----------
function bar(pct, width = 24) {
  const n = Math.round((pct / 100) * width)
  return '█'.repeat(n) + dim('░'.repeat(width - n))
}
function statLabel(kind, text) {
  return kind === 'ok' ? green('■ ' + text) : kind === 'bad' ? red('■ ' + text) : yellow('■ ' + text)
}
function h(title) { console.log('\n' + bold(cyan(title)) + '\n' + dim('─'.repeat(60))) }

function printReport(report, mode) {
  const { score, grade, factors } = computeGeoScore(report, null) // no crawl logs in CLI -> skip freshness
  console.log('\n' + bold('APERTURE') + dim(' // diagnostic report  ') + report.url)
  if (mode) console.log(dim('exposure target: ') + mode.toUpperCase())

  h('GEO SCORE')
  console.log('  ' + bold(String(score).padStart(2)) + dim('/100') + '   grade ' + bold(grade))
  for (const f of factors) {
    console.log('  ' + f.label.padEnd(16) + ' ' + bar(f.pct * 100) + '  ' + dim(f.note))
  }
  console.log('  ' + dim('freshness        (n/a — needs crawl logs / middleware)'))

  h('CRAWLER ACCESS · robots.txt')
  for (const b of report.robots.data.perBot) {
    const s = b.allowedTargetPath ? statLabel('ok', 'allowed') : statLabel('bad', 'blocked')
    console.log('  ' + b.bot.padEnd(16) + s.padEnd(noColor ? 10 : 24) + '  ' + dim(b.matchedRule ?? '(default allow)'))
  }
  console.log('  ' + dim(`robots.txt ${report.robots.data.robotsTxtFound ? 'found' : 'MISSING'} · target ${report.robots.data.targetPath}`))

  h('CLOAKING · UA-diff')
  const ua = report.uaDiff.data
  if (!ua.baselineUsable) console.log('  ' + yellow('inconclusive — baseline (browser UA) was challenged/empty'))
  for (const b of ua.perBot) {
    const s = b.blocked ? statLabel('bad', 'blocked') : b.substanceMismatch ? statLabel('warn', 'mismatch') : statLabel('ok', 'match')
    console.log('  ' + b.bot.padEnd(16) + s.padEnd(noColor ? 10 : 24) + '  ' + dim(`status ${b.statusCode ?? 'ERR'} · ${b.contentLength.toLocaleString()} bytes`))
  }

  h('RENDERING GAP · heuristic')
  const rg = report.renderingGap.data
  console.log('  raw text: ' + bold(rg.rawTextLength.toLocaleString()) + dim(' chars'))
  console.log('  ' + (rg.jsDependent ? statLabel('bad', `~${rg.gapPercent}% JS-dependent`) : statLabel('ok', 'server-rendered')))
  console.log('  ' + dim('exact gap needs the headless engine (crawlers branch)'))

  h('STRUCTURED DATA · JSON-LD')
  const sc = report.schema.data
  console.log('  ' + (sc.found ? statLabel('ok', `${sc.blockCount} block(s): ${sc.types.join(', ') || 'untyped'}`) : statLabel('bad', 'no schema.org markup')))
  console.log()
}

// ---------- entry ----------
function usage() {
  console.log(`aperture — Phase-1 GEO diagnostics

usage:
  aperture <url> [options]

options:
  --mode <cloak|mirror|amplify>   exposure target to label the report
  --json                          print the raw DiagnosticReport + score as JSON
  --no-color                      disable ANSI color
  -h, --help                      show this help

examples:
  aperture https://example.com
  aperture https://example.com --mode amplify
  aperture https://example.com --json > report.json`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help') || args.length === 0) { usage(); return }
  const url = args.find((a) => !a.startsWith('-'))
  const mode = args[args.indexOf('--mode') + 1]
  if (!url) { console.error(red('error: no URL provided')); usage(); process.exitCode = 1; return }

  let target
  try { target = new URL(url.includes('://') ? url : `https://${url}`).href } catch { console.error(red(`error: invalid URL "${url}"`)); process.exitCode = 1; return }

  const report = await runDiagnostics(target)
  if (args.includes('--json')) {
    console.log(JSON.stringify({ report, score: computeGeoScore(report, null) }, null, 2))
  } else {
    printReport(report, args.includes('--mode') ? mode : null)
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
