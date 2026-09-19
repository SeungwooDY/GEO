import { useRef } from 'react'
import { ORDER, MODES } from './modes'

// A tactile 3-position toggle. The lever throws + tilts between stops,
// an indicator LED lights per mode, and a soft click plays on change.
export default function LightSwitch({ mode, setMode }) {
  const audioRef = useRef(null)

  function click() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!audioRef.current) audioRef.current = new AC()
      const ctx = audioRef.current
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(1400, t)
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.03)
      gain.gain.setValueAtTime(0.05, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t); osc.stop(t + 0.07)
    } catch { /* no audio, no problem */ }
  }

  function pick(k) {
    if (k === mode) return
    click()
    setMode(k)
  }

  return (
    <div className="ls">
      <div className="ls-plate">
        <div className="ls-track">
          <div className={`ls-lever ${mode}`}>
            <div className="ls-led" />
          </div>
          {ORDER.map((k) => (
            <button
              key={k}
              className={`ls-detent d-${k} ${mode === k ? 'active' : ''}`}
              onClick={() => pick(k)}
              aria-pressed={mode === k}
            >
              <span className="mono">{MODES[k].label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
