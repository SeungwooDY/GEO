// A small, obvious camera-aperture iris in thin line-art. Eight swept blades
// around a central opening + outer ring. Calm, slow rotation.
const BLADES = 8
const OUTER = 46
const OPEN = 17

function pt(r, a) { return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}` }

function irisPolygon(r) {
  const p = []
  for (let i = 0; i < BLADES; i++) p.push(pt(r, (i / BLADES) * Math.PI * 2 - Math.PI / 2))
  return p.join(' ')
}

export default function IrisHero() {
  const step = (Math.PI * 2) / BLADES
  return (
    <svg className="irishero" viewBox="-60 -60 120 120" role="img" aria-label="aperture">
      <g className="iris-rot">
        <circle r={OUTER + 4} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
        {/* swept blades: inner opening vertex -> outer, offset one step for the tilt */}
        {Array.from({ length: BLADES }).map((_, i) => {
          const a = i * step - Math.PI / 2
          const inner = pt(OPEN, a)
          const outer = pt(OUTER, a + step)
          return <line key={i} x1={inner.split(',')[0]} y1={inner.split(',')[1]}
            x2={outer.split(',')[0]} y2={outer.split(',')[1]} stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
        })}
        {/* central aperture opening */}
        <polygon points={irisPolygon(OPEN)} fill="none" stroke="currentColor" strokeWidth="1.4" />
      </g>
    </svg>
  )
}
