import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ORDER, MODES } from './modes'
import { GitHubIcon, LinkIcon, ArrowIcon } from './icons'
import Aperture from './Aperture'
import Report from './Report'
import Mission from './Mission'
import About from './About'
import { scramble } from './scramble'
import { generateConfig } from './data/diagnostics'
import { recordScan } from './history'
import clipEvidence from './assets/video/evidence-room.mp4'
import clipGeometry from './assets/video/hero-geometry.mp4'

const REDUCE = typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

function isAuthed() {
  try { return !!localStorage.getItem('aperture_user') } catch { return false }
}

const CFG_TABS = [
  { key: 'robots', label: 'robots.txt' },
  { key: 'llms', label: 'llms.txt' },
  { key: 'schema', label: 'schema' },
]

// Accept only a real GitHub repo URL (owner/repo) or a valid site URL.
function isValidTarget(source, raw) {
  const v = raw.trim()
  if (!v) return false
  if (source === 'github') {
    return /^(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i.test(v)
  }
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
  } catch { return false }
}

export default function Landing() {
  const [stage, setStage] = useState('enter')   // enter -> aperture -> analysis
  const [mode, setMode] = useState('mirror')
  const [source, setSource] = useState('github')
  const [value, setValue] = useState('')
  const [cfgTab, setCfgTab] = useState('robots')
  const [atBottom, setAtBottom] = useState(false)
  const [clipIdx, setClipIdx] = useState(0)   // 0 = evidence, 1 = geometry (14s loop)

  const enterRef = useRef(null)
  const promptRef = useRef(null)
  const inputRef = useRef(null)
  const apRef = useRef(null)
  const lineRef = useRef(null)
  const vA = useRef(null)
  const vB = useRef(null)

  // enter = light lavender lab; aperture = exposure theme; report = dark console
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-mode',
      stage === 'enter' ? 'site' : (stage === 'aperture' ? mode : 'cloak'),
    )
  }, [stage, mode])

  // Resume a pending analyze after the user signs in.
  useEffect(() => {
    let pending = null
    try { pending = localStorage.getItem('aperture_pending') } catch { /* ignore */ }
    if (pending && isAuthed()) {
      try { localStorage.removeItem('aperture_pending') } catch { /* ignore */ }
      setValue(pending)
      setStage('aperture')
    }
  }, [])

  // ENTER: flicker the description in (per character)
  useLayoutEffect(() => {
    if (stage !== 'enter' || !promptRef.current) return
    const cancel = scramble(promptRef.current, 'Point your site to Aperture.', { duration: 1.4 })
    return () => cancel()
  }, [stage])

  // body scroll: the enter page scrolls; aperture/report are single-screen
  useEffect(() => {
    document.body.classList.toggle('no-scroll', stage !== 'enter')
  }, [stage])

  // hero background: play evidence clip, then geometry clip, then loop (~14s)
  useEffect(() => {
    if (stage !== 'enter') return
    const cur = clipIdx === 0 ? vA.current : vB.current
    const other = clipIdx === 0 ? vB.current : vA.current
    if (other) other.pause()
    if (cur) { cur.currentTime = 0; cur.play().catch(() => {}) }
  }, [clipIdx, stage])

  // fade the floating arrow out near the bottom of the scroll page
  useEffect(() => {
    if (stage !== 'enter') return
    const onScroll = () => setAtBottom(window.innerHeight + window.scrollY >= document.body.scrollHeight - 90)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [stage])

  // APERTURE reveal
  useLayoutEffect(() => {
    if (stage !== 'aperture' || !apRef.current) return
    if (REDUCE) { gsap.set(apRef.current.children, { opacity: 1, y: 0 }); return }
    gsap.fromTo(apRef.current.children, { opacity: 0, y: 26 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.06 })
  }, [stage])

  // description scramble on mode change (random order)
  useEffect(() => {
    if (stage !== 'aperture' || !lineRef.current) return
    const cancel = scramble(lineRef.current, MODES[mode].line, { duration: 0.9 })
    return () => cancel()
  }, [mode, stage])

  const m = MODES[mode]
  const cfg = generateConfig(mode)
  const valid = isValidTarget(source, value)

  const scrollNext = () => {
    const headerHeight = document.querySelector('.site-header')?.offsetHeight ?? 0
    const sections = [...document.querySelectorAll('.home-scroll > section')]
    const next = sections.find((section) => section.getBoundingClientRect().top > headerHeight + 1)
    if (!next) return

    window.scrollTo({
      top: window.scrollY + next.getBoundingClientRect().top - headerHeight,
      behavior: REDUCE ? 'auto' : 'smooth',
    })
  }

  // Hitting enter requires a signed-in user; otherwise send to login and resume.
  const startAnalyze = (e) => {
    e.preventDefault()
    if (!valid) return
    if (isAuthed()) {
      setStage('aperture')
    } else {
      try { localStorage.setItem('aperture_pending', value.trim()) } catch { /* ignore */ }
      window.location.hash = '/login'
    }
  }

  // The report is a full-screen horizontal deck — render it outside the
  // centered stage wrapper so its pinned scroll has the whole viewport.
  if (stage === 'analysis') {
    return <Report url={value} mode={mode} onBack={() => setStage('aperture')} />
  }

  // ENTER — scrollable page: hero card -> Mission -> About, with a floating arrow
  if (stage === 'enter') {
    return (
      <div className="home-scroll" ref={enterRef}>
        <section className="home-hero" id="sec-hero">
          <div className="home-card">
            <video ref={vA} className={`home-video ${clipIdx === 0 ? '' : 'is-hidden'}`} autoPlay muted playsInline preload="auto" aria-hidden="true" onEnded={() => { if (clipIdx === 0) setClipIdx(1) }}>
              <source src={clipEvidence} type="video/mp4" />
            </video>
            <video ref={vB} className={`home-video ${clipIdx === 1 ? '' : 'is-hidden'}`} autoPlay muted playsInline preload="auto" aria-hidden="true" onEnded={() => { if (clipIdx === 1) setClipIdx(0) }}>
              <source src={clipGeometry} type="video/mp4" />
            </video>
            <div className="home-video-scrim" aria-hidden="true" />
            <div className="home-center">
              <p className="home-desc" ref={promptRef}>Point your site to Aperture.</p>
              <form className="input-row home-input" ref={inputRef} onSubmit={startAnalyze}>
                <div className="src-toggle">
                  <button type="button" className={source === 'github' ? 'active' : ''} onClick={() => setSource('github')} aria-label="GitHub repository"><GitHubIcon /></button>
                  <button type="button" className={source === 'url' ? 'active' : ''} onClick={() => setSource('url')} aria-label="Website URL"><LinkIcon /></button>
                </div>
                <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
                  placeholder={source === 'github' ? 'github.com/user/repo' : 'https://your-site.com'} />
                <button className={`go ${valid ? 'lit' : ''}`} type="submit" aria-label="Analyze" disabled={!valid}><ArrowIcon /></button>
              </form>
              {value.trim() && !valid && (
                <p className="input-err mono">{source === 'github' ? 'Enter a GitHub repo URL — github.com/owner/repo' : 'Enter a valid site URL — https://example.com'}</p>
              )}
            </div>
          </div>
        </section>

        <section className="home-sec" id="sec-mission"><Mission /></section>
        <section className="home-sec" id="sec-about"><About /></section>

        <button className={`scroll-arrow ${atBottom ? 'gone' : ''}`} onClick={scrollNext} aria-label="Scroll down">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <main className="stage-wrap">
      {/* ---------- APERTURE ---------- */}
      {stage === 'aperture' && (
        <div className="aperture-stage" ref={apRef}>
          <div className="ap-visual"><Aperture openness={m.openness} /></div>

          <div className="ap-side">
            <p className="ap-eyebrow mono">Set your exposure</p>
            <div className="ap-toggle">
              {ORDER.map((k) => (
                <button key={k} className={`ap-opt ${mode === k ? 'active' : ''}`} onClick={() => setMode(k)}>
                  <span className="ap-dot" />
                  <span className="ap-name">{MODES[k].label}</span>
                  <span className="ap-tag mono">{MODES[k].tag}</span>
                </button>
              ))}
            </div>
            <p className="ap-line" ref={lineRef}>{m.line}</p>

            {/* generated-config preview — ties the exposure to real output */}
            <div className="cfg">
              <div className="cfg-tabs">
                {CFG_TABS.map((t) => (
                  <button key={t.key} className={`cfg-tab ${cfgTab === t.key ? 'active' : ''}`} onClick={() => setCfgTab(t.key)}>{t.label}</button>
                ))}
              </div>
              <pre className="cfg-body">{cfg[cfgTab]}</pre>
            </div>

            <button className="ap-submit" onClick={() => { recordScan(value, mode); setStage('analysis') }}>
              Analyze site <ArrowIcon />
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
