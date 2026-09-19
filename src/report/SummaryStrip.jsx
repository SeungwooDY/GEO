import { MODES } from '../modes'
import { gradeTone } from './checks'

// The first thing on the page, always visible above the tabs: score, letter grade, and the
// exposure mode they were measured against. Everything else is one click deeper.
export default function SummaryStrip({ url, mode, result, projected, scanning, offline, offlineReason }) {
  const m = MODES[mode] ?? MODES.mirror

  if (scanning || !result) {
    return (
      <header className="rs rs-loading">
        <div className="rs-spin" aria-hidden="true" />
        <div>
          <div className="rs-loading-title">Scanning {url.replace(/^https?:\/\//, '')}</div>
          <div className="rs-loading-sub">robots · cloaking · rendering · schema · content · per-bot</div>
        </div>
        <div className="rs-mode">
          <span className={`rs-chip rs-chip-${mode}`}><i />{m.label}</span>
        </div>
      </header>
    )
  }

  const { score, grade, indeterminate, coverage, aim, title, reason, protection } = result
  return (
    <header className="rs">
      <div className="rs-block">
        <div className="rs-label">{title}</div>
        {indeterminate
          ? <div className="rs-indet">Can’t<br />conclude</div>
          : <div className="rs-score" aria-label={`Score ${score} out of 100`}>{score}</div>}
      </div>

      <div className="rs-block">
        <div className="rs-label">Grade</div>
        <div className={`rs-grade tone-${gradeTone(grade)}`} aria-label={`Grade ${grade}`}>{grade}</div>
      </div>

      <div className="rs-mode">
        <div className="rs-label">Exposure</div>
        <span className={`rs-chip rs-chip-${mode}`}><i />{m.label}<em>{m.tag}</em></span>
        <p className="rs-aim">{indeterminate ? reason : aim}</p>
        {projected && (
          <p className="rs-proj" aria-live="polite" data-testid="projected">
            <span>With these files</span>
            <b>{projected.score}</b>
            <em className={`tone-${gradeTone(projected.grade)}`}>{projected.grade}</em>
            <span className={projected.delta > 0 ? 'rs-up' : ''}>{projected.delta > 0 ? `+${projected.delta}` : projected.delta === 0 ? 'no change yet' : projected.delta}</span>
          </p>
        )}
        <p className="rs-line">
          {url.replace(/^https?:\/\//, '')} · {Math.round(coverage * 100)}% of signals measured
          {protection?.challenged && <span className="rs-flag"> · edge protection (HTTP {protection.codes.join('/')})</span>}
          {offline && <span className="rs-flag" title={offlineReason}> · offline sample, server unreachable</span>}
        </p>
      </div>
    </header>
  )
}
