// A camera-iris aperture. `openness` (0..1) opens/closes the blades.
// The hole is a real transparent mask, so the page behind shows through.
// Depth comes from material, not extra shapes: a lit blade gradient, a
// recessed inner shadow at the aperture edge, and a metallic rim.
const BLADES = 8
const R = 96          // outer radius
const HEX_R = 66      // base radius of the opening polygon

function polygon(radius, sides, rot = 0) {
  const pts = []
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    pts.push(`${(Math.cos(a) * radius).toFixed(2)},${(Math.sin(a) * radius).toFixed(2)}`)
  }
  return pts.join(' ')
}

export default function Aperture({ openness = 0.5 }) {
  // hole scale: closed -> tiny, open -> beyond the ring
  const scale = 0.12 + openness * 1.35
  const rot = (1 - openness) * 42 // blades rotate as they close

  // Shared transform for anything that tracks the hole edge.
  const holeTransform = {
    transformBox: 'view-box', transformOrigin: '0px 0px',
    transform: `rotate(${rot}deg) scale(${scale})`,
    transition: 'transform 0.9s cubic-bezier(0.22, 1, 0.36, 1)',
  }

  return (
    <svg className="iris" viewBox="-100 -100 200 200" role="img" aria-label="aperture">
      <defs>
        <mask id="irisMask">
          <circle r={R} fill="#fff" />
          <polygon points={polygon(HEX_R, BLADES)} fill="#000" style={holeTransform} />
        </mask>

        {/* light catching the top-left edge of the blade plates */}
        <linearGradient id="bladeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 68%, var(--fg) 32%)" />
          <stop offset="52%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 76%, var(--bg) 34%)" />
        </linearGradient>

        {/* metallic rim: bright top-left -> dark bottom-right */}
        <linearGradient id="rimGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--fg) 60%, transparent)" />
          <stop offset="45%" stopColor="var(--line)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--bg) 55%, transparent)" />
        </linearGradient>

        <filter id="edgeBlur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* blade disc with transparent hole */}
      <circle r={R} fill="url(#bladeGrad)" mask="url(#irisMask)" />

      {/* blade seams */}
      <g
        className="seams"
        style={{
          transformBox: 'view-box', transformOrigin: '0px 0px',
          transform: `rotate(${rot}deg)`,
          transition: 'transform 0.9s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {Array.from({ length: BLADES }).map((_, i) => {
          const a = (i / BLADES) * Math.PI * 2
          const x = Math.cos(a) * R, y = Math.sin(a) * R
          const ix = Math.cos(a) * (HEX_R * scale), iy = Math.sin(a) * (HEX_R * scale)
          return <line key={i} x1={ix} y1={iy} x2={x} y2={y} stroke="var(--bg)" strokeWidth="1" opacity="0.4" />
        })}
      </g>

      {/* recessed inner shadow where the blades meet the opening */}
      <polygon
        points={polygon(HEX_R, BLADES)}
        fill="none"
        stroke="color-mix(in srgb, var(--bg) 88%, transparent)"
        strokeWidth="7"
        filter="url(#edgeBlur)"
        style={{ ...holeTransform, opacity: 0.75 }}
        mask="url(#irisMask)"
      />
      {/* crisp inner edge highlight on the opening */}
      <polygon
        points={polygon(HEX_R, BLADES)}
        fill="none"
        stroke="color-mix(in srgb, var(--fg) 22%, transparent)"
        strokeWidth="0.75"
        style={holeTransform}
      />

      {/* rim: metallic ring + inner shade line */}
      <circle r={R} fill="none" stroke="url(#rimGrad)" strokeWidth="2.5" />
      <circle r={R - 1.5} fill="none" stroke="color-mix(in srgb, var(--bg) 55%, transparent)" strokeWidth="1" opacity="0.55" />
    </svg>
  )
}
