// The "aperture" logo wordmark: brand font (Inter) with the leading "a"
// rendered as the camera-iris itself (icon-integrated wordmark). Each unit —
// the iris and every letter — flickers in individually, Palantir-style.

const LETTERS = ['p', 'e', 'r', 't', 'u', 'r', 'e']

function octagon(r) {
  const pts = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 8
    pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`)
  }
  return pts.join(' ')
}

function IrisMark() {
  return (
    <svg className="wm-iris" viewBox="-50 -50 100 100" aria-hidden="true">
      <polygon points={octagon(46)} fill="currentColor" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 8
        return <line key={i} x1={Math.cos(a) * 16} y1={Math.sin(a) * 16}
          x2={Math.cos(a) * 46} y2={Math.sin(a) * 46} stroke="var(--bg)" strokeWidth="5" />
      })}
      <polygon points={octagon(16)} fill="var(--bg)" />
    </svg>
  )
}

export default function Wordmark({ className = '' }) {
  return (
    <span className={`wm ${className}`} aria-label="aperture">
      <span className="wm-ch wm-lead" style={{ animationDelay: '0ms' }} aria-hidden="true"><IrisMark /></span>
      {LETTERS.map((c, i) => (
        <span key={i} className="wm-ch" style={{ animationDelay: `${(i + 1) * 75}ms` }} aria-hidden="true">{c}</span>
      ))}
    </span>
  )
}
