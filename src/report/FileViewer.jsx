import { useMemo, useState } from 'react'
import { diffLines, diffStats } from '../lib/lineDiff'
import { copyText, downloadFile } from '../lib/download'

const FIELD_NAMES = {
  name: 'business name', phone: 'phone', 'address.street': 'street address', 'address.city': 'city',
  'address.region': 'state / region', 'address.postalCode': 'postal code',
}

export default function FileViewer({ file, modeLabel, onFixFacts }) {
  const [view, setView] = useState('preview')
  const [copied, setCopied] = useState(false)
  const canDiff = file.status === 'ready' && file.existing != null
  const active = canDiff ? view : 'preview'

  const diff = useMemo(() => (canDiff ? diffLines(file.existing, file.content) : []), [canDiff, file.existing, file.content])
  const stats = useMemo(() => diffStats(diff), [diff])

  const copy = async () => {
    if (await copyText(file.content)) { setCopied(true); setTimeout(() => setCopied(false), 1600) }
  }

  return (
    <article className="fv">
      <div className="fv-head">
        <div>
          <h3 className="fv-title">{file.name}</h3>
          <p className="fv-why">{file.why}</p>
          <p className="fv-how"><b>Where it goes:</b> {file.howTo}</p>
        </div>
        {file.status === 'ready' && (
          <div className="fv-actions">
            <button className="sg-btn sg-btn-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button className="sg-btn" onClick={() => downloadFile(file)}>Download</button>
          </div>
        )}
      </div>

      {file.warning && <p className="fv-warn">{file.warning}</p>}

      {file.status === 'needs-facts' && (
        <div className="fv-locked">
          <p className="fv-locked-title">Needs a few details from you</p>
          <p>We only write what your business has actually told us, so this file waits on:</p>
          <ul>{file.missing.map((m) => <li key={m}>{FIELD_NAMES[m] ?? m}</li>)}</ul>
          <button className="sg-btn" onClick={onFixFacts}>Add details</button>
        </div>
      )}

      {file.status === 'skipped' && (
        <div className="fv-locked">
          <p className="fv-locked-title">Not included with {modeLabel}</p>
          <p>{file.why}</p>
          {file.existing && <><p className="fv-cur">Your current file</p><pre className="fv-pre">{file.existing}</pre></>}
        </div>
      )}

      {file.status === 'ready' && (<>
        {canDiff && (
          <div className="fv-tabs" role="tablist">
            <button role="tab" aria-selected={active === 'preview'} onClick={() => setView('preview')}>Preview</button>
            <button role="tab" aria-selected={active === 'diff'} onClick={() => setView('diff')}>
              Changes <span className="fv-stat"><b className="add">+{stats.add}</b> <b className="del">−{stats.del}</b></span>
            </button>
          </div>
        )}
        {active === 'preview'
          ? <pre className="fv-pre" tabIndex={0}>{file.content}</pre>
          : (
            <pre className="fv-pre fv-diff" tabIndex={0}>
              {diff.map((l, i) => (
                <span className={`dl dl-${l.type}`} key={i}>
                  <i aria-hidden="true">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</i>{l.text || ' '}{'\n'}
                </span>
              ))}
            </pre>
          )}
        {!canDiff && <p className="fv-foot">{file.existing == null ? 'This site has no current version of this file, so everything here is new.' : ''}</p>}
      </>)}
    </article>
  )
}
