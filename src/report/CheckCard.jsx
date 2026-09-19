import { useId } from 'react'

// One check as a uniform row: status dot | label | headline + one-line detail | weight | expand.
// Every field sits in a fixed column and long text is clamped to one line, so all six rows are the same height
// and line up; the granular detail opens in a drawer beneath the row.
//
// Takes a normalized { label, status, headline, sub, share } so any source (URL scan today, a GitHub-repo
// report later) can render through the same row.
export default function CheckCard({ label, status, headline, sub, share, open, onToggle, children }) {
  const id = useId()
  return (
    <section className={`cc cc-${status}${open ? ' is-open' : ''}`}>
      <button className="cc-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="cc-dot" aria-hidden="true" />
        <span className="cc-label">{label}</span>
        <span className="cc-main">
          <span className="cc-headline" title={headline}>{headline}</span>
          <span className="cc-sub" title={sub}>{sub}</span>
        </span>
        <span className="cc-share">{share > 0 ? `${share}% of score` : 'not scored'}</span>
        <span className="cc-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="cc-body" id={id}>{children}</div>}
    </section>
  )
}
