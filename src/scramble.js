// Random-order scramble. Each character resolves at its own random time
// (not left-to-right), swapping glyphs in place until it locks to the
// target and brightens from dim -> full via the .sc-on class.
//
// Characters are grouped into .sc-word spans (white-space:nowrap) so a word
// never breaks across lines; wrapping only happens at spaces. Each glyph
// sits in a fixed-width slot measured from its final character, so swapping
// scramble glyphs never shifts the line (no shudder).

// A broad enough set to feel alive, while per-slot fitting below prevents a
// wider replacement glyph from bleeding into the next character in a
// proportional font.
const GLYPHS = 'abcdeghiklnopqrstuvxyzAEGHIKLNOPQRSTUVXYZ0123456789'

export function scramble(el, text, { duration = 2.0, glyphs = GLYPHS } = {}) {
  if (!el) return () => {}

  // Respect reduced-motion: no glyph churn, just show the text.
  const reduce = typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    el.style.visibility = 'visible'
    el.textContent = text
    return () => {}
  }

  const chars = Array.from(text)
  let raf = 0
  let cancelled = false

  el.style.visibility = 'hidden'
  el.textContent = ''

  // Build spans aligned 1:1 with chars. Non-space chars go inside a
  // per-word wrapper; spaces are top-level (breakable) separators.
  const spans = []
  let word = null
  chars.forEach((ch) => {
    if (ch === ' ') {
      const sp = document.createElement('span')
      sp.className = 'sc-ch sc-sp'
      el.appendChild(sp)
      spans.push(sp)
      word = null
    } else {
      if (!word) {
        word = document.createElement('span')
        word.className = 'sc-word'
        el.appendChild(word)
      }
      const s = document.createElement('span')
      s.className = 'sc-ch'
      word.appendChild(s)
      spans.push(s)
    }
  })

  const begin = () => {
    if (cancelled) return
    // Measure each final glyph, then only use replacement glyphs that fit its
    // slot. Alliance No2 is proportional, so even a curated global alphabet
    // cannot guarantee that (for example) a random glyph fits an "i" slot.
    // This keeps the sentence stable without clipping or overlapping letters.
    spans.forEach((s, i) => { s.textContent = chars[i] === ' ' ? ' ' : chars[i] })
    const fittingGlyphs = spans.map((s, i) => {
      const finalWidth = s.getBoundingClientRect().width
      if (chars[i] === ' ') return []

      const fits = glyphs.split('').filter((glyph) => {
        s.textContent = glyph
        return s.getBoundingClientRect().width <= finalWidth + 0.5
      })
      s.textContent = chars[i]
      s.style.width = `${finalWidth}px`
      return fits.length ? fits : [chars[i]]
    })
    // Seed non-space slots with scramble glyphs so final text never flashes.
    spans.forEach((s, i) => {
      if (chars[i] !== ' ') {
        const choices = fittingGlyphs[i]
        s.textContent = choices[(Math.random() * choices.length) | 0]
      }
    })
    el.style.visibility = 'visible'

    // Random resolve order (in place).
    const thresholds = chars.map((ch) => (ch === ' ' ? 0 : Math.random()))
    const start = performance.now()
    const swapInterval = 90 // ms between glyph changes (slower cycling)
    let lastSwap = 0

    const tick = (now) => {
      const p = Math.min(1, (now - start) / (duration * 1000))
      const doSwap = now - lastSwap >= swapInterval
      if (doSwap) lastSwap = now
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        if (ch === ' ') continue
        if (p >= thresholds[i]) {
          if (!spans[i].classList.contains('sc-in')) {
            spans[i].textContent = ch
            spans[i].classList.add('sc-in')   // one-shot flicker as it locks
          }
        } else if (doSwap) {
          const choices = fittingGlyphs[i]
          spans[i].textContent = choices[(Math.random() * choices.length) | 0]
        }
      }
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        for (let i = 0; i < chars.length; i++) {
          if (chars[i] === ' ') continue
          spans[i].textContent = chars[i]
          spans[i].classList.add('sc-in')
        }
      }
    }
    raf = requestAnimationFrame(tick)
  }

  if (document.fonts && document.fonts.status !== 'loaded') {
    document.fonts.ready.then(begin)
  } else {
    begin()
  }

  return () => { cancelled = true; cancelAnimationFrame(raf) }
}
