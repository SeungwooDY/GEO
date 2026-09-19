import { useEffect, useRef, useState } from 'react'
import { sampleReport, computeGeoScore, freshness, ansLanes, metrics } from './data/diagnostics'

function Panel({ idx, title, wide, children }) {
  return (
    <section className="hpanel">
      <div className={`hpanel-inner${wide ? ' wide' : ''}`}>
        <div className="hp-idx">{idx} / 06</div>
        <div className="hp-title">{title}</div>
        {children}
      </div>
    </section>
  )
}

const PANELS = 6

export default function Report({ url, mode, onBack }) {
  const scrollerRef = useRef(null)
  const [progress, setProgress] = useState(0)

  const report = sampleReport(url || 'github.com/user/repo')
  const { score, grade, factors } = computeGeoScore(report, freshness)
  const robots = report.robots.data
  const ua = report.uaDiff.data
  const rg = report.renderingGap.data
  const sc = report.schema.data
  const rgMax = Math.max(rg.renderedTextLength, rg.rawTextLength, 1)
  const cov = metrics.pathCoverage
  const covPct = Math.round((cov.crawled / cov.sitemapTotal) * 100)

  // native horizontal scroll-snap; translate vertical wheel to horizontal
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth
      setProgress(max > 0 ? el.scrollLeft / max : 0)
    }
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('wheel', onWheel) }
  }, [])

  const current = Math.min(PANELS, Math.round(progress * (PANELS - 1)) + 1)

  return (
    <>
      <section className="hreport" ref={scrollerRef}>

          {/* 01 SCORE */}
          <Panel idx="01" title="GEO Score">
            <div className="score-row">
              <div>
                <div className="score-big">{score}</div>
                <div className="score-meta">GRADE <b>{grade}</b> · EXPOSURE <b>{mode?.toUpperCase() || '—'}</b></div>
                <div className="score-meta" style={{ marginTop: 4 }}>{report.url}</div>
              </div>
              <div className="factors">
                {factors.map((f) => (
                  <div className="factor" key={f.key}>
                    <span>{f.label}</span>
                    <span className="bar"><i style={{ width: `${Math.round(f.pct * 100)}%` }} /></span>
                    <span className="note">{f.note}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="scroll-hint"><i />scroll to explore</div>
          </Panel>

          {/* 02 CRAWLER ACCESS */}
          <Panel idx="02" title="Crawler Access · robots.txt">
            <table className="dtable">
              <thead><tr><th>Bot</th><th>Target path</th><th>Matched rule</th></tr></thead>
              <tbody>
                {robots.perBot.map((b) => (
                  <tr key={b.bot}>
                    <td>{b.bot}</td>
                    <td><span className={`stat ${b.allowedTargetPath ? 'ok' : 'bad'}`}>{b.allowedTargetPath ? 'Allowed' : 'Blocked'}</span></td>
                    <td>{b.matchedRule ?? '(default allow)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dnote">robots.txt found · target {robots.targetPath}</p>
          </Panel>

          {/* 03 CLOAKING */}
          <Panel idx="03" title="Cloaking · UA-diff">
            <table className="dtable">
              <thead><tr><th>Bot</th><th>Vendor</th><th>Verdict</th></tr></thead>
              <tbody>
                {ua.perBot.map((b) => {
                  const cls = b.blocked ? 'bad' : b.substanceMismatch ? 'warn' : 'ok'
                  const label = b.blocked ? 'Blocked' : b.substanceMismatch ? 'Mismatch' : 'Match'
                  return (
                    <tr key={b.bot}>
                      <td>{b.bot}</td><td>{b.vendor}</td>
                      <td><span className={`stat ${cls}`}>{label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="dnote">baseline {ua.baseline.statusCode} · {ua.baseline.contentLength.toLocaleString()} bytes · comparison {ua.baselineUsable ? 'valid' : 'inconclusive'}</p>
          </Panel>

          {/* 04 EXTRACTION */}
          <Panel idx="04" title="Extraction · rendering + schema">
            <div className="factor" style={{ gridTemplateColumns: '150px 1fr 120px' }}>
              <span>Raw HTTP</span>
              <span className="bar"><i style={{ width: `${(rg.rawTextLength / rgMax) * 100}%` }} /></span>
              <span className="note">{rg.rawTextLength.toLocaleString()} chars</span>
            </div>
            <div className="factor" style={{ gridTemplateColumns: '150px 1fr 120px', marginTop: 12 }}>
              <span>Headless render</span>
              <span className="bar"><i style={{ width: '100%' }} /></span>
              <span className="note">{rg.renderedTextLength.toLocaleString()} chars</span>
            </div>
            <p className="dnote"><span className={`stat ${rg.jsDependent ? 'bad' : 'ok'}`}>{rg.gapPercent}% JS-only</span> — crawlers see a near-empty page.</p>
            <p className="dnote" style={{ marginTop: 20 }}>
              <span className={`stat ${sc.found ? 'ok' : 'bad'}`}>{sc.found ? `${sc.blockCount} JSON-LD block(s)` : 'No schema.org markup'}</span>
              {sc.found ? ` · ${sc.types.join(', ')}` : ' — no structured facts to extract.'}
            </p>
          </Panel>

          {/* 05 ANS IDENTITY */}
          <Panel idx="05" title="Agent Identity · ANS Verification" wide>
            <div className="ans-grid">
              {ansLanes.map((l) => (
                <div className={`lane bracket ${l.status}`} key={l.id}>
                  <div className="lane-label">{l.label}</div>
                  <div className="lane-agent">{l.agent}</div>
                  <div className="lane-kv">UA <b>{l.ua}</b></div>
                  <div className="lane-kv">METHOD <b>{l.method}</b></div>
                  <div className="lane-status"><i className={l.status === 'verified' ? '' : 'blink'} />{l.status}</div>
                  <div className="lane-detail">{l.detail}</div>
                </div>
              ))}
            </div>
            <p className="dnote">Same User-Agent, opposite verdicts — identity is proven by signature, not the header.</p>
          </Panel>

          {/* 06 OBSERVABILITY */}
          <Panel idx="06" title="Observability · Crawl Traffic" wide>
            <div className="metrics-grid">
              <div>
                <div className="lane-label" style={{ marginBottom: 10 }}>Hits / bot · 12-day trend</div>
                {metrics.perBot.map((b) => {
                  const max = Math.max(...b.perDay, 1)
                  return (
                    <div className="bot-row" key={b.bot}>
                      <span>{b.bot}<br /><span style={{ color: 'var(--muted)' }}>{b.total.toLocaleString()} total</span></span>
                      <span className="spark">{b.perDay.map((v, i) => <i key={i} style={{ height: `${(v / max) * 100}%` }} />)}</span>
                      <span className="last">{b.lastHitHrs == null ? 'never' : `${b.lastHitHrs}h ago`}</span>
                    </div>
                  )
                })}
              </div>
              <div>
                <div className="lane-label" style={{ marginBottom: 10 }}>Path coverage</div>
                <div className="cov-meta"><b style={{ fontFamily: 'var(--mono)' }}>{cov.crawled}</b> <span>/ {cov.sitemapTotal} crawled ({covPct}%)</span></div>
                <div className="cov-bar"><i style={{ width: `${covPct}%` }} /></div>
                <div className="lane-label" style={{ marginTop: 8 }}>Orphaned · never crawled</div>
                {cov.orphaned.slice(0, 3).map((p) => <div className="orphan" key={p}>{p}</div>)}
              </div>
            </div>
          </Panel>

      </section>

      {/* fixed console chrome */}
      <div className="hbar">
        <span className="hprogress" style={{ width: `${progress * 100}%` }} />
        <span className="hbar-l">APERTURE <b>// diagnostic report</b> · {report.url}</span>
        <span className="hbar-r">
          <span className="hcount">{String(current).padStart(2, '0')} / 0{PANELS}</span>
          <button className="hback" onClick={onBack}>◄ Exposure</button>
        </span>
      </div>
    </>
  )
}
