import { useState } from 'react'
import { firewallBots, identityLanes } from '../data/diagnostics'
import CheckCard from './CheckCard'
import { buildChecks, friendlyError } from './checks'

const Note = ({ tone, label, children }) => (
  <p className="dnote"><span className={`stat ${tone}`}>{label}</span> {children}</p>
)

// Granular detail per check: the same tables the old slide deck had, now one click inside each card.
function Detail({ id, report, mode }) {
  const fw = firewallBots(report)

  if (id === 'access') {
    const r = report.robots
    if (!r.ok) return <Note tone="bad" label="Check failed">{friendlyError(r.error)}</Note>
    return (
      <table className="dtable">
        <thead><tr><th>Bot</th><th>Access</th><th>Matched rule</th></tr></thead>
        <tbody>
          {r.data.perBot.map((b) => (
            <tr key={b.bot}>
              <td>{b.bot}</td>
              <td><span className={`stat ${b.allowedTargetPath ? 'ok' : 'bad'}`}>{b.allowedTargetPath ? 'Allowed' : 'Blocked'}</span></td>
              <td>{b.matchedRule ?? '(default allow)'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (id === 'cloaking') {
    const u = report.uaDiff
    if (!u.ok) return <Note tone="bad" label="Check failed">{friendlyError(u.error)}</Note>
    if (!u.data.baselineUsable) return <Note tone="warn" label="Inconclusive">the browser baseline was challenged or empty (likely bot protection), so bot comparisons aren’t meaningful.</Note>
    return (<>
      <table className="dtable">
        <thead><tr><th>Bot</th><th>Vendor</th><th>Verdict</th></tr></thead>
        <tbody>
          {u.data.perBot.map((b) => {
            // A firewall challenge isn't an AI-access verdict: show Challenged, not a false Blocked/Mismatch.
            const challenged = fw.has(b.bot)
            const tone = challenged ? 'warn' : b.blocked ? 'bad' : b.substanceMismatch ? 'warn' : 'ok'
            const label = challenged ? 'Challenged' : b.blocked ? 'Blocked' : b.substanceMismatch ? 'Mismatch' : 'Match'
            return (
              <tr key={b.bot}>
                <td>{b.bot}</td><td>{b.vendor}</td>
                <td><span className={`stat ${tone}`} title={challenged ? `HTTP ${b.statusCode}: edge protection, not an AI policy` : undefined}>{label}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="dnote">Baseline visit: HTTP {u.data.baseline.statusCode}, {u.data.baseline.contentLength.toLocaleString()} bytes.</p>
    </>)
  }

  if (id === 'extraction') {
    const g = report.renderingGap
    if (!g.ok) return <Note tone="bad" label="Check failed">{friendlyError(g.error)}</Note>
    const d = g.data
    if (!d.rawFetchUsable) return <Note tone="warn" label="Inconclusive">raw fetch returned HTTP {d.rawStatusCode} with no usable text; the headless render read {d.renderedTextLength.toLocaleString()} characters.</Note>
    const max = Math.max(d.rawTextLength, d.renderedTextLength, 1)
    return (<>
      {[['Without JavaScript', d.rawTextLength], ['With JavaScript', d.renderedTextLength]].map(([label, n]) => (
        <div className="ins-row ins-row-tight" key={label}>
          <span>{label}</span>
          <span className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
          <span className="note">{n.toLocaleString()} chars</span>
        </div>
      ))}
      <p className="dnote">{d.jsDependent ? 'Most crawlers don’t run JavaScript, so they see a near-empty page.' : 'The content is present without JavaScript.'}</p>
    </>)
  }

  if (id === 'structured') {
    const s = report.schema
    if (!s.ok) return <Note tone="bad" label="Check failed">{friendlyError(s.error)}</Note>
    if (!s.data.fetchUsable) return <Note tone="warn" label="Inconclusive">fetch returned HTTP {s.data.statusCode}, so the absence of schema can’t be confirmed.</Note>
    if (!s.data.found) return <Note tone="bad" label="None found">No schema.org markup, so there are no structured facts for AI to extract. The Suggestions tab can generate it.</Note>
    const fc = s.data.fieldCompleteness
    return (<>
      <p className="dnote"><span className="stat ok">{s.data.blockCount} JSON-LD block(s)</span> {s.data.types.join(', ') || 'untyped'}</p>
      {fc && (
        <table className="dtable">
          <tbody>
            <tr><td>Present</td><td>{fc.present.join(', ') || '—'}</td></tr>
            <tr><td>Missing</td><td>{fc.missing.join(', ') || '—'}</td></tr>
          </tbody>
        </table>
      )}
      {s.data.telephone && <p className="dnote">Phone {s.data.telephone}: {s.data.telephoneInVisibleText ? 'matches the page' : 'NOT found in the visible page text'}.</p>}
    </>)
  }

  if (id === 'content') {
    const c = report.content
    if (!c.ok) return <Note tone="bad" label="Check failed">{friendlyError(c.error)}</Note>
    const d = c.data
    if (!d.fetchUsable) return <Note tone="warn" label="Inconclusive">fetch returned HTTP {d.statusCode} with no usable text.</Note>
    const tiles = [
      [d.wordCount.toLocaleString(), 'words'], [d.textToHtmlRatio, 'text / html'], [`${d.h1Count}·${d.h2Count}·${d.h3Count}`, 'h1 · h2 · h3'],
      [d.questionHeadings, 'question headings'], [d.statCount, 'stats / figures'], [d.quoteCount, 'quotes'],
      [d.outboundLinkHosts, 'outbound hosts'], [`${d.responseTimeMs} ms`, 'response'],
    ]
    return (<>
      <div className="sig-grid">
        {tiles.map(([v, l]) => <div className="sig" key={l}><b>{v}</b><span>{l}</span></div>)}
      </div>
      <p className="dnote">What a crawler that doesn’t run JavaScript reads. Last-modified: {d.lastModifiedHeader ?? 'not sent'} · {d.htmlBytes.toLocaleString()} bytes.</p>
    </>)
  }

  if (id === 'perbot') {
    const p = report.perBotSignals
    if (!p.ok) return <Note tone="bad" label="Check failed">{friendlyError(p.error)}</Note>
    if (!p.data.baselineUsable) return <Note tone="warn" label="Inconclusive">the baseline visit was challenged or empty, so per-bot comparisons aren’t meaningful.</Note>
    return (
      <table className="dtable">
        <thead><tr><th>Bot</th><th>Verdict</th><th>Words</th><th>Schema</th><th>Differences from the browser view</th></tr></thead>
        <tbody>
          {p.data.perBot.map((b) => {
            const v = b.error ? ['bad', 'Error'] : !b.fetchUsable ? ['warn', 'Blocked'] : b.differences.length === 0 ? ['ok', 'Same'] : ['warn', 'Differs']
            return (
              <tr key={b.bot}>
                <td>{b.bot}</td>
                <td><span className={`stat ${v[0]}`}>{v[1]}</span></td>
                <td>{b.fetchUsable ? b.wordCount.toLocaleString() : '—'}</td>
                <td>{b.fetchUsable ? `${b.schemaCompletenessPercent}%` : '—'}</td>
                <td>{b.error ? b.error : b.differences.length ? b.differences.join('; ') : b.fetchUsable ? '—' : `HTTP ${b.statusCode}`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }
  return null
}

export default function InsightsView({ report, mode, result }) {
  const cards = buildChecks(report, mode)
  const [open, setOpen] = useState(() => new Set())
  const allOpen = open.size === cards.length
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="ins">
      <section aria-labelledby="ins-break">
        <div className="ins-h" id="ins-break">
          <span>How the score is made</span>
          <span>{result.factors.some((f) => f.dir < 0) ? 'Lower exposure scores higher in Cloak' : 'Signals that couldn’t be measured are left out, not penalized'}</span>
        </div>
        {result.factors.length === 0 && <p className="dnote">No page-level signals could be measured.</p>}
        {result.factors.map((f) => (
          <div className="ins-row" key={f.key}>
            <span>{f.label}{f.dir < 0 ? ' ↓' : ''}</span>
            <span className="bar"><i style={{ width: `${Math.round(f.pct * 100)}%` }} /></span>
            <span className="note">{f.note}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="ins-checks">
        <div className="ins-h" id="ins-checks">
          <span>The six checks</span>
          <button className="ins-toggle" onClick={() => setOpen(allOpen ? new Set() : new Set(cards.map((c) => c.id)))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <div className="cc-grid">
          {cards.map((c) => (
            <CheckCard key={c.id} {...c} open={open.has(c.id)} onToggle={() => toggle(c.id)}>
              <Detail id={c.id} report={report} mode={mode} />
            </CheckCard>
          ))}
        </div>
      </section>

      <details className="ins-verify">
        <summary>How Aperture decides which crawlers get served</summary>
        <div className="ins-lanes">
          {identityLanes.map((l) => (
            <div className={`lane ${l.status}`} key={l.id}>
              <div className="lane-label">{l.label}</div>
              <div className="lane-agent">{l.agent}</div>
              <div className="lane-detail">{l.detail}</div>
            </div>
          ))}
        </div>
        <p className="dnote">Illustrative: this describes the proxy’s behavior, not something measured on your site. Verification is by published IP range; the User-Agent alone proves nothing.</p>
      </details>
    </div>
  )
}
