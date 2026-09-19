import { useEffect, useRef, useState } from 'react'
import { scanReport, sampleReport, computeGeoScore, identityLanes } from './data/diagnostics'

const PANELS = 7

function Panel({ idx, title, wide, children }) {
  return (
    <section className="hpanel">
      <div className={`hpanel-inner${wide ? ' wide' : ''}`}>
        <div className="hp-idx">{idx} / {String(PANELS).padStart(2, '0')}</div>
        <div className="hp-title">{title}</div>
        {children}
      </div>
    </section>
  )
}

// A check that errored, or came back on a bot-challenged baseline, can't be shown as a finding.
function Inconclusive({ children }) {
  return <p className="dnote"><span className="stat warn">Inconclusive</span> {children}</p>
}
function Failed({ error }) {
  return <p className="dnote"><span className="stat bad">Check failed</span> {error}</p>
}

export default function Report({ url, mode, onBack }) {
  const scrollerRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | offline
  const [errMsg, setErrMsg] = useState('')

  // Run the real scan through the bridge. If the bridge is unreachable, fall back
  // to the offline sample so the deck still renders (clearly marked).
  useEffect(() => {
    let live = true
    setStatus('loading')
    scanReport(url)
      .then((r) => { if (live) { setReport(r); setStatus('ready') } })
      .catch((e) => {
        if (!live) return
        setErrMsg(e instanceof Error ? e.message : String(e))
        setReport(sampleReport(url || 'https://your-site.com'))
        setStatus('offline')
      })
    return () => { live = false }
  }, [url])

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
  }, [report])

  if (status === 'loading' || !report) {
    return (
      <>
        <section className="hreport hreport-status">
          <div className="scan-status">
            <div className="scan-spinner" aria-hidden="true" />
            <div className="scan-title mono">Scanning {url}</div>
            <div className="scan-sub">robots · cloaking · rendering · schema · content · per-bot</div>
          </div>
        </section>
        <div className="hbar">
          <span className="hbar-l">APERTURE <b>// diagnostic report</b> · {url}</span>
          <span className="hbar-r"><button className="hback" onClick={onBack}>◄ Exposure</button></span>
        </div>
      </>
    )
  }

  const { score, grade, factors, title, aim } = computeGeoScore(report, mode)
  const robots = report.robots
  const ua = report.uaDiff
  const rg = report.renderingGap
  const sc = report.schema
  const content = report.content
  const pbs = report.perBotSignals
  const rgd = rg?.ok ? rg.data : null
  const rgMax = rgd ? Math.max(rgd.renderedTextLength, rgd.rawTextLength, 1) : 1
  const cd = content?.ok ? content.data : null

  return (
    <>
      <section className="hreport" ref={scrollerRef}>

        {/* 01 SCORE */}
        <Panel idx="01" title={title}>
          <div className="score-row">
            <div>
              <div className="score-big">{score}</div>
              <div className="score-meta">GRADE <b>{grade}</b> · EXPOSURE <b>{mode?.toUpperCase() || '—'}</b></div>
              <div className="score-meta" style={{ marginTop: 4 }}>{report.url}</div>
            </div>
            <div className="factors">
              {factors.map((f) => (
                <div className="factor" key={f.key}>
                  <span>{f.label}{f.dir < 0 ? ' ↓' : ''}</span>
                  <span className="bar"><i style={{ width: `${Math.round(f.pct * 100)}%` }} /></span>
                  <span className="note">{f.note}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="dnote" style={{ marginTop: 16 }}>{aim}</p>
          <p className="dnote">Deterministic, from the crawler tests below. Signals that came back inconclusive are dropped, not penalized. {factors.some((f) => f.dir < 0) ? '↓ = lower exposure scores higher in this mode.' : ''}</p>
          <div className="scroll-hint"><i />scroll to explore</div>
        </Panel>

        {/* 02 CRAWLER ACCESS */}
        <Panel idx="02" title="Crawler Access · robots.txt">
          {!robots.ok ? <Failed error={robots.error} /> : (<>
            <table className="dtable">
              <thead><tr><th>Bot</th><th>Target path</th><th>Matched rule</th></tr></thead>
              <tbody>
                {robots.data.perBot.map((b) => (
                  <tr key={b.bot}>
                    <td>{b.bot}</td>
                    <td><span className={`stat ${b.allowedTargetPath ? 'ok' : 'bad'}`}>{b.allowedTargetPath ? 'Allowed' : 'Blocked'}</span></td>
                    <td>{b.matchedRule ?? '(default allow)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dnote">robots.txt {robots.data.robotsTxtFound ? 'found' : 'not found'} · target {robots.data.targetPath}</p>
          </>)}
        </Panel>

        {/* 03 CLOAKING */}
        <Panel idx="03" title="Cloaking · UA-diff">
          {!ua.ok ? <Failed error={ua.error} />
            : !ua.data.baselineUsable ? <Inconclusive>the browser-UA baseline was itself challenged/empty (likely bot protection), so bot comparisons aren’t meaningful.</Inconclusive>
            : (<>
              <table className="dtable">
                <thead><tr><th>Bot</th><th>Vendor</th><th>Verdict</th></tr></thead>
                <tbody>
                  {ua.data.perBot.map((b) => {
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
              <p className="dnote">baseline {ua.data.baseline.statusCode} · {ua.data.baseline.contentLength.toLocaleString()} bytes</p>
            </>)}
        </Panel>

        {/* 04 EXTRACTION */}
        <Panel idx="04" title="Extraction · rendering + schema">
          {!rg.ok ? <Failed error={rg.error} />
            : !rgd.rawFetchUsable ? <Inconclusive>raw fetch returned status {rgd.rawStatusCode} with no usable text (likely bot protection); headless render read {rgd.renderedTextLength.toLocaleString()} chars.</Inconclusive>
            : (<>
              <div className="factor" style={{ gridTemplateColumns: '150px 1fr 120px' }}>
                <span>Raw HTTP</span>
                <span className="bar"><i style={{ width: `${(rgd.rawTextLength / rgMax) * 100}%` }} /></span>
                <span className="note">{rgd.rawTextLength.toLocaleString()} chars</span>
              </div>
              <div className="factor" style={{ gridTemplateColumns: '150px 1fr 120px', marginTop: 12 }}>
                <span>Headless render</span>
                <span className="bar"><i style={{ width: `${(rgd.renderedTextLength / rgMax) * 100}%` }} /></span>
                <span className="note">{rgd.renderedTextLength.toLocaleString()} chars</span>
              </div>
              <p className="dnote"><span className={`stat ${rgd.jsDependent ? 'bad' : 'ok'}`}>{rgd.gapPercent}% JS-only</span>{rgd.jsDependent ? ' — non-JS crawlers see a near-empty page.' : ' — content is present without JS.'}</p>
            </>)}

          {/* schema sub-section */}
          {!sc.ok ? <Failed error={sc.error} />
            : !sc.data.fetchUsable ? <div style={{ marginTop: 20 }}><Inconclusive>fetch returned status {sc.data.statusCode} with no usable HTML, so absence of schema can’t be confirmed.</Inconclusive></div>
            : (
              <p className="dnote" style={{ marginTop: 20 }}>
                <span className={`stat ${sc.data.found ? 'ok' : 'bad'}`}>{sc.data.found ? `${sc.data.blockCount} JSON-LD block(s)` : 'No schema.org markup'}</span>
                {sc.data.found
                  ? <> · {sc.data.types.join(', ') || '—'}{sc.data.fieldCompleteness ? ` · local fields ${sc.data.fieldCompleteness.percent}%` : ''}{sc.data.telephone ? ` · tel ${sc.data.telephoneInVisibleText ? 'matches page' : 'NOT on page'}` : ''}</>
                  : ' — no structured facts to extract.'}
              </p>
            )}
        </Panel>

        {/* 05 CONTENT SIGNALS */}
        <Panel idx="05" title="Content Signals · raw HTML">
          {!content.ok ? <Failed error={content.error} />
            : !cd.fetchUsable ? <Inconclusive>fetch returned status {cd.statusCode} with no usable text.</Inconclusive>
            : (<>
              <div className="sig-grid">
                <div className="sig"><b>{cd.wordCount.toLocaleString()}</b><span>words</span></div>
                <div className="sig"><b>{cd.textToHtmlRatio}</b><span>text / html</span></div>
                <div className="sig"><b>{cd.h1Count}·{cd.h2Count}·{cd.h3Count}</b><span>h1·h2·h3</span></div>
                <div className="sig"><b>{cd.questionHeadings}</b><span>question headings</span></div>
                <div className="sig"><b>{cd.statCount}</b><span>stats / figures</span></div>
                <div className="sig"><b>{cd.quoteCount}</b><span>quotes</span></div>
                <div className="sig"><b>{cd.outboundLinkHosts}</b><span>outbound hosts</span></div>
                <div className="sig"><b>{cd.responseTimeMs}<small>ms</small></b><span>ttfb + body</span></div>
              </div>
              <p className="dnote">What a non-JS crawler reads. last-modified: {cd.lastModifiedHeader ?? '(none)'} · {cd.htmlBytes.toLocaleString()} bytes</p>
            </>)}
        </Panel>

        {/* 06 PER-BOT DIFFERENCES */}
        <Panel idx="06" title="Per-bot · schema / content diff" wide>
          {!pbs.ok ? <Failed error={pbs.error} />
            : !pbs.data.baselineUsable ? <Inconclusive>the browser-UA baseline was challenged/empty, so per-bot comparisons aren’t meaningful.</Inconclusive>
            : (<>
              <table className="dtable">
                <thead><tr><th>Bot</th><th>Verdict</th><th>Words</th><th>Schema</th><th>Differences vs. browser view</th></tr></thead>
                <tbody>
                  {pbs.data.perBot.map((b) => {
                    const verdict = b.error ? ['bad', 'Error'] : !b.fetchUsable ? ['warn', 'Blocked'] : b.differences.length === 0 ? ['ok', 'Same'] : ['warn', 'Differs']
                    return (
                      <tr key={b.bot}>
                        <td>{b.bot}</td>
                        <td><span className={`stat ${verdict[0]}`}>{verdict[1]}</span></td>
                        <td>{b.fetchUsable ? b.wordCount.toLocaleString() : '—'}</td>
                        <td>{b.fetchUsable ? `${b.schemaCompletenessPercent}%` : '—'}</td>
                        <td>{b.error ? b.error : b.differences.length ? b.differences.join('; ') : b.fetchUsable ? '—' : `status ${b.statusCode}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="dnote">Each AI-bot UA fetched separately and compared to the browser view — a proxy for what that crawler actually sees.</p>
            </>)}
        </Panel>

        {/* 07 AGENT IDENTITY · IP-RANGE */}
        <Panel idx="07" title="Agent Identity · IP-range verification" wide>
          <div className="ans-grid">
            {identityLanes.map((l) => (
              <div className={`lane bracket ${l.status}`} key={l.id}>
                <div className="lane-label">{l.label}</div>
                <div className="lane-agent">{l.agent}</div>
                <div className="lane-kv">UA <b>{l.ua}</b></div>
                <div className="lane-kv">CHECK <b>{l.method}</b></div>
                <div className="lane-status"><i className={l.status === 'verified' ? '' : 'blink'} />{l.status}</div>
                <div className="lane-detail">{l.detail}</div>
              </div>
            ))}
          </div>
          <p className="dnote">Aperture’s proxy serves the exposure artifact only to bots whose source IP is inside the vendor’s published ranges — the User-Agent alone proves nothing. ANS was evaluated and rejected; verification is IP-range based.</p>
        </Panel>

      </section>

      {/* fixed console chrome */}
      <div className="hbar">
        <span className="hprogress" style={{ width: `${progress * 100}%` }} />
        <span className="hbar-l">
          APERTURE <b>// diagnostic report</b> · {report.url}
          {status === 'offline' && <span className="hbar-offline" title={errMsg}> · offline sample (bridge unreachable)</span>}
        </span>
        <span className="hbar-r">
          <span className="hcount">{String(Math.min(PANELS, Math.round(progress * (PANELS - 1)) + 1)).padStart(2, '0')} / {String(PANELS).padStart(2, '0')}</span>
          <button className="hback" onClick={onBack}>◄ Exposure</button>
        </span>
      </div>
    </>
  )
}
