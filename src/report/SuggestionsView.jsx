import { useEffect, useMemo, useRef, useState } from 'react'
import { MODES } from '../modes'
import { downloadZip } from '../lib/download'
import BusinessForm from './BusinessForm'
import FileViewer from './FileViewer'

const FACT_FILES = ['jsonld', 'llms', 'markdown']
const STATE_LABEL = { ready: 'Ready', 'needs-facts': 'Needs details', skipped: 'Not in this mode' }

// The files to add to the site, generated from what the scan read. Shown BEFORE the insights: it's the action
// the user actually takes; the insights explain why.
export default function SuggestionsView({ state, mode, url, onApply, onRetry }) {
  const modeLabel = (MODES[mode] ?? MODES.mirror).label
  const [selectedId, setSelectedId] = useState('robots')
  const [deselected, setDeselected] = useState(() => new Set())
  const [zipping, setZipping] = useState(false)
  const formRef = useRef(null)

  const data = state.data
  const files = data?.files ?? []
  // keep the selection valid when the file list changes (mode switch, regenerate)
  useEffect(() => {
    if (files.length && !files.some((f) => f.id === selectedId)) setSelectedId(files[0].id)
  }, [files, selectedId])

  const ready = useMemo(() => files.filter((f) => f.status === 'ready'), [files])
  const chosen = ready.filter((f) => !deselected.has(f.id))
  const selected = files.find((f) => f.id === selectedId) ?? files[0]

  if (state.status === 'loading' && !data) {
    return (
      <div className="sg-status" role="status">
        <div className="rs-spin" aria-hidden="true" />
        <div>
          <div className="rs-loading-title">Reading your site and building files…</div>
          <div className="rs-loading-sub">existing robots.txt · sitemap · business details</div>
        </div>
      </div>
    )
  }

  if (state.status === 'error' && !data) {
    return (
      <div className="sg-status sg-error" role="alert">
        <div>
          <div className="rs-loading-title">We couldn’t build files for this site</div>
          <div className="rs-loading-sub">{state.error}</div>
        </div>
        <button className="sg-btn" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  const showForm = files.some((f) => FACT_FILES.includes(f.id) && f.status !== 'skipped')
  const needsFacts = files.some((f) => f.status === 'needs-facts')
  const busy = state.status === 'loading'

  const toggle = (id) => setDeselected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const fixFacts = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const zip = async () => { setZipping(true); try { await downloadZip(chosen, url) } finally { setZipping(false) } }

  return (
    <div className="sg">
      <div className="sg-top">
        <div>
          <h2 className="sg-lead">{ready.length} file{ready.length === 1 ? '' : 's'} ready to add to your site</h2>
          <p className="sg-lead-sub">Built for <b>{modeLabel}</b> exposure from what we read on {url.replace(/^https?:\/\//, '')}. Preview each file, then upload it to your site.</p>
        </div>
        <button className="sg-btn sg-btn-lg" disabled={chosen.length === 0 || zipping} onClick={zip}>
          {zipping ? 'Zipping…' : `Download ${chosen.length} file${chosen.length === 1 ? '' : 's'} (ZIP)`}
        </button>
      </div>

      {data.source === 'unreadable' && (
        <p className="sg-banner">We couldn’t read your page (likely edge protection), so your business details couldn’t be pre-filled. robots.txt doesn’t need them and is still ready.</p>
      )}

      {showForm && (
        <div ref={formRef}>
          <BusinessForm key={mode} prefill={data.prefill} evidence={data.evidence} missing={data.missing} busy={busy} defaultOpen={needsFacts} onApply={onApply} />
        </div>
      )}

      <div className="sg-cols">
        <nav className="fl" aria-label="Suggested files">
          {files.map((f) => (
            <div className={`fl-item fl-${f.status}${f.id === selected?.id ? ' active' : ''}`} key={f.id}>
              <input
                type="checkbox" className="fl-check" aria-label={`Include ${f.name} in the ZIP`}
                checked={f.status === 'ready' && !deselected.has(f.id)} disabled={f.status !== 'ready'} onChange={() => toggle(f.id)}
              />
              <button className="fl-btn" onClick={() => setSelectedId(f.id)} aria-current={f.id === selected?.id}>
                <span className="fl-name">{f.name}</span>
                <span className="fl-state"><i aria-hidden="true" />{f.id === 'sitemap' && f.status === 'skipped' && f.existing ? 'You have one' : STATE_LABEL[f.status]}</span>
              </button>
            </div>
          ))}
        </nav>
        {selected && <FileViewer key={selected.id + selected.content.length} file={selected} modeLabel={modeLabel} onFixFacts={fixFacts} />}
      </div>
    </div>
  )
}
