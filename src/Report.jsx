import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scanReport, sampleReport, computeGeoScore, fetchFiles } from './data/diagnostics'
import { recordScan } from './history'
import SummaryStrip from './report/SummaryStrip'
import SuggestionsView from './report/SuggestionsView'
import InsightsView from './report/InsightsView'
import { projectScore } from './report/projection'

// The report: one summary strip (score, grade, exposure mode) that never scrolls away, then two tabs.
//   Suggestions  the files to add to the site (first, because it's the action)
//   Insights     why: the score breakdown and six checks, each expandable to full detail
//
// `source` is 'url' today. A GitHub-repo report can reuse SummaryStrip / InsightsView / CheckCard by feeding
// them its own checks; Suggested Files is URL-only (the engine has no repo path), so that tab is hidden for it.
export default function Report({ url, mode, source = 'url', onBack }) {
  const isUrl = source === 'url'
  const [tab, setTab] = useState(isUrl ? 'suggestions' : 'insights')

  // ---- the diagnostic scan (slow: up to ~30s) ----
  const [scan, setScan] = useState({ status: 'loading', report: null, error: '' })
  useEffect(() => {
    let live = true
    setScan({ status: 'loading', report: null, error: '' })
    scanReport(url)
      .then((report) => { if (live) setScan({ status: 'ready', report, error: '' }) })
      .catch((e) => {
        if (!live) return
        // Server unreachable: fall back to the offline sample so the page still renders (clearly marked).
        setScan({ status: 'offline', report: sampleReport(url || 'https://your-site.com'), error: e instanceof Error ? e.message : String(e) })
      })
    return () => { live = false }
  }, [url])

  // ---- suggested files (starts in parallel with the scan so the first tab is ready sooner) ----
  const [files, setFiles] = useState({ status: 'loading', data: null, error: '' })
  const loadFiles = useCallback((profile) => {
    if (!isUrl) return undefined
    let live = true
    setFiles((s) => ({ ...s, status: 'loading', error: '' }))
    fetchFiles(url, mode, profile)
      .then((data) => { if (live) setFiles({ status: 'ready', data, error: '' }) })
      .catch((e) => { if (live) setFiles((s) => ({ ...s, status: s.data ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e) })) })
    return () => { live = false }
  }, [url, mode, isUrl])
  useEffect(() => loadFiles(), [loadFiles])

  const result = useMemo(() => (scan.report ? computeGeoScore(scan.report, mode) : null), [scan.report, mode])
  // Re-scored copy of the report with the ready files applied: moves as the user fills in their details.
  const projected = useMemo(
    () => (isUrl ? projectScore(scan.report, files.data?.files, mode, result) : null),
    [isUrl, scan.report, files.data, mode, result],
  )

  // Save the REAL score to the user's library once (never the offline sample).
  const saved = useRef(false)
  useEffect(() => {
    if (scan.status === 'ready' && result && !saved.current) { saved.current = true; recordScan(url, mode, result) }
  }, [scan.status, result, url, mode])

  const readyCount = files.data?.files.filter((f) => f.status === 'ready').length

  return (
    <div className="rp">
      <SummaryStrip
        url={url} mode={mode} result={result} projected={projected} scanning={scan.status === 'loading'}
        offline={scan.status === 'offline'} offlineReason={scan.error}
      />

      <div className="rt" role="tablist" aria-label="Report sections">
        {isUrl && (
          <button role="tab" id="tab-suggestions" aria-selected={tab === 'suggestions'} className="rt-tab" onClick={() => setTab('suggestions')}>
            Suggestions {readyCount != null && <span className="rt-count">{readyCount}</span>}
          </button>
        )}
        <button role="tab" id="tab-insights" aria-selected={tab === 'insights'} className="rt-tab" onClick={() => setTab('insights')}>Insights</button>
        <button className="rt-back" onClick={onBack}>◄ Change exposure</button>
      </div>

      {tab === 'suggestions' && isUrl && (
        <div role="tabpanel" aria-labelledby="tab-suggestions">
          <SuggestionsView state={files} mode={mode} url={url} onApply={loadFiles} onRetry={() => loadFiles()} />
        </div>
      )}

      {tab === 'insights' && (
        <div role="tabpanel" aria-labelledby="tab-insights">
          {scan.report && result
            ? <InsightsView report={scan.report} mode={mode} result={result} />
            : <div className="sg-status" role="status"><div className="rs-spin" aria-hidden="true" /><div className="rs-loading-title">Still scanning…</div></div>}
        </div>
      )}
    </div>
  )
}
