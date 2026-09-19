// Aperture centerpiece: a connected-node network arranged in concentric
// rings (iris-like) as thin line-art. Calm, slow rotation; a few solid nodes.
// Clean, not edgy — matches the light/lavender bar.

const RINGS = [
  { n: 1, r: 0 },
  { n: 6, r: 66 },
  { n: 12, r: 130 },
]

function build() {
  const nodes = []
  RINGS.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 - Math.PI / 2 + (ri === 2 ? Math.PI / 12 : 0)
      nodes.push({ x: Math.cos(a) * ring.r, y: Math.sin(a) * ring.r, ring: ri, i, big: ri === 1 && i % 3 === 0 })
    }
  })
  const ring1 = nodes.filter((n) => n.ring === 1)
  const ring2 = nodes.filter((n) => n.ring === 2)
  const center = nodes[0]
  const edges = []
  ring1.forEach((n, i) => {
    edges.push([center, n])                                   // spokes
    edges.push([n, ring1[(i + 1) % ring1.length]])            // inner hexagon
    edges.push([n, ring2[(i * 2) % ring2.length]])            // radial to outer
    edges.push([n, ring2[(i * 2 + 1) % ring2.length]])
  })
  ring2.forEach((n, i) => edges.push([n, ring2[(i + 1) % ring2.length]])) // outer ring
  // a few long chords for the "network" feel
  edges.push([ring2[0], ring2[5]], [ring2[3], ring2[9]], [ring2[7], ring2[11]])
  return { nodes, edges }
}

const { nodes, edges } = build()

export default function NetGraph() {
  return (
    <svg className="netgraph" viewBox="-165 -165 330 330" role="img" aria-label="aperture network">
      <g className="net-rot">
        {edges.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="currentColor" strokeWidth="0.9" opacity="0.26" />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.ring === 0 ? 5 : n.big ? 4.5 : 2.6}
            fill="currentColor" opacity={n.big || n.ring === 0 ? 0.9 : 0.5}
            className="net-node" style={{ animationDelay: `${(i % 6) * 0.4}s` }} />
        ))}
      </g>
    </svg>
  )
}
