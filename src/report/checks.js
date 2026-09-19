// Condenses a DiagnosticReport into six check cards: a status, ONE headline number, a short sub-line,
// and how much the check counts toward the chosen exposure mode's score. The granular tables live in
// each card's drawer (InsightsView); nothing is dropped, it's just one click deeper.
//
// The card shape ({ id, label, status, headline, sub, share }) is deliberately source-agnostic so a
// future GitHub-repo report can feed the same <CheckCard> without touching the UI.
import { MODE_SCORING, firewallBots } from '../data/diagnostics'

// Which score signals (data/diagnostics.js geoSignals) belong to which card.
const SIGNALS = {
  access: ['access'],
  cloaking: ['served', 'uaMatch'],
  extraction: ['extractable'],
  structured: ['structured'],
  content: ['substance'],
  perbot: ['parity'],
}

/** Percent of the chosen mode's total weight that these signals carry (0 = not scored in this mode). */
export function weightShare(mode, id) {
  const weights = (MODE_SCORING[mode] ?? MODE_SCORING.mirror).weights
  const total = Object.values(weights).reduce((s, x) => s + x.w, 0)
  const mine = (SIGNALS[id] ?? []).reduce((s, k) => s + (weights[k]?.w ?? 0), 0)
  return total ? Math.round((mine / total) * 100) : 0
}

/**
 * Engine errors are raw (Playwright prints absolute filesystem paths). Show people a sentence, never a stack fragment or an
 * internal path; the check simply couldn't run.
 */
export function friendlyError(err) {
  const e = String(err ?? '')
  if (/Executable doesn't exist|browserType\.launch|chromium/i.test(e)) return 'Headless browser unavailable on this server.'
  if (/timed out|timeout/i.test(e)) return 'Took too long to answer (often a firewall stalling bots).'
  const clean = e.replace(/(?:\/[\w.@-]+){3,}/g, '…').replace(/\s+/g, ' ').trim()
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean || 'This check couldn’t run.'
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const na = (id, label, headline, sub) => ({ id, label, status: 'na', headline, sub })

export function buildChecks(report, mode) {
  const fw = firewallBots(report)
  const cards = []

  // 1. crawler access (robots.txt)
  const r = report.robots
  if (!r?.ok) cards.push(na('access', 'Crawler access', 'Check failed', friendlyError(r?.error)))
  else {
    const bots = r.data.perBot
    const allowed = bots.filter((b) => b.allowedTargetPath).length
    const wanted = mode === 'cloak' ? bots.length - allowed : allowed // in Cloak, being blocked is the goal
    cards.push({
      id: 'access', label: 'Crawler access', headline: `${allowed} of ${bots.length} bots allowed`,
      sub: r.data.robotsTxtFound ? 'robots.txt found' : 'No robots.txt (everything is allowed by default)',
      status: wanted === bots.length ? 'ok' : wanted === 0 ? 'bad' : 'warn',
    })
  }

  // 2. cloaking (UA-diff)
  const u = report.uaDiff
  if (!u?.ok) cards.push(na('cloaking', 'Cloaking', 'Check failed', friendlyError(u?.error)))
  else if (!u.data.baselineUsable) cards.push(na('cloaking', 'Cloaking', 'Inconclusive', 'The site blocked our baseline visit, so bots can’t be compared.'))
  else {
    const bots = u.data.perBot
    const challenged = bots.filter((b) => fw.has(b.bot)).length
    const rest = bots.filter((b) => !fw.has(b.bot))
    const blocked = rest.filter((b) => b.blocked).length
    const mismatch = rest.filter((b) => !b.blocked && b.substanceMismatch).length
    const same = rest.length - blocked - mismatch
    const parts = [mismatch && `${mismatch} mismatch`, blocked && `${blocked} blocked`, challenged && `${challenged} challenged by firewall`].filter(Boolean)
    cards.push({
      id: 'cloaking', label: 'Cloaking', headline: `${same} of ${bots.length} bots see the same page`,
      sub: parts.join(' · ') || 'No differences between bots and people',
      status: mismatch > 0 ? 'bad' : mode === 'cloak' && blocked === rest.length ? 'ok' : blocked || challenged ? 'warn' : 'ok',
    })
  }

  // 3. extraction (rendering gap)
  const g = report.renderingGap
  if (!g?.ok) cards.push(na('extraction', 'Extraction', 'Check failed', friendlyError(g?.error)))
  else if (!g.data.rawFetchUsable) cards.push(na('extraction', 'Extraction', 'Inconclusive', `Raw fetch returned HTTP ${g.data.rawStatusCode} with no usable text.`))
  else {
    const d = g.data
    cards.push({
      id: 'extraction', label: 'Extraction', headline: `${d.gapPercent}% JS-only`,
      sub: `${d.rawTextLength.toLocaleString()} of ${d.renderedTextLength.toLocaleString()} characters are visible without JavaScript`,
      status: d.jsDependent ? 'bad' : d.gapPercent > 25 ? 'warn' : 'ok',
    })
  }

  // 4. structured data (JSON-LD)
  const s = report.schema
  if (!s?.ok) cards.push(na('structured', 'Structured data', 'Check failed', friendlyError(s?.error)))
  else if (!s.data.fetchUsable) cards.push(na('structured', 'Structured data', 'Inconclusive', `Fetch returned HTTP ${s.data.statusCode} with no usable HTML.`))
  else if (!s.data.found) cards.push({ id: 'structured', label: 'Structured data', headline: 'None found', sub: 'No schema.org markup for AI to quote', status: 'bad' })
  else {
    const pct = s.data.fieldCompleteness?.percent
    cards.push({
      id: 'structured', label: 'Structured data', headline: s.data.types.join(', ') || `${s.data.blockCount} JSON-LD block(s)`,
      sub: pct != null ? `${pct}% of local-business fields present` : `${s.data.blockCount} block(s)`,
      status: pct == null || pct >= 70 ? 'ok' : 'warn',
    })
  }

  // 5. content (raw HTML signals)
  const c = report.content
  if (!c?.ok) cards.push(na('content', 'Content', 'Check failed', friendlyError(c?.error)))
  else if (!c.data.fetchUsable) cards.push(na('content', 'Content', 'Inconclusive', `Fetch returned HTTP ${c.data.statusCode} with no usable text.`))
  else {
    const d = c.data
    cards.push({
      id: 'content', label: 'Content', headline: plural(d.wordCount, 'word'),
      sub: `${d.h1Count}·${d.h2Count}·${d.h3Count} headings · ${d.questionHeadings} question headings`,
      status: d.wordCount >= 800 ? 'ok' : d.wordCount >= 300 ? 'warn' : 'bad',
    })
  }

  // 6. per-bot parity
  const p = report.perBotSignals
  if (!p?.ok) cards.push(na('perbot', 'Per-bot parity', 'Check failed', friendlyError(p?.error)))
  else if (!p.data.baselineUsable) cards.push(na('perbot', 'Per-bot parity', 'Inconclusive', 'The baseline visit was blocked, so bots can’t be compared.'))
  else {
    const comp = p.data.perBot.filter((b) => !b.error && b.fetchUsable && !fw.has(b.bot))
    if (comp.length === 0) cards.push(na('perbot', 'Per-bot parity', 'Inconclusive', 'No bot fetch got through to compare.'))
    else {
      const same = comp.filter((b) => b.differences.length === 0).length
      cards.push({
        id: 'perbot', label: 'Per-bot parity', headline: `${same} of ${comp.length} bots match`,
        sub: same === comp.length ? 'Every bot sees the same schema and content' : `${comp.length - same} bot(s) see something different`,
        status: same === comp.length ? 'ok' : 'warn',
      })
    }
  }

  return cards.map((card) => ({ ...card, share: weightShare(mode, card.id) }))
}

/** Grade -> tone, for the big letter. */
export function gradeTone(grade) {
  return grade === 'A' || grade === 'B' ? 'ok' : grade === 'C' ? 'warn' : grade === '—' ? 'na' : 'bad'
}
