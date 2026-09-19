import { useEffect, useState } from 'react'
import Landing from './Landing'
import About from './About'
import Mission from './Mission'
import Auth from './Auth'
import Profile from './Profile'

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace('#', '') || '/')
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace('#', '') || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export default function App() {
  const route = useHashRoute()
  const [replay, setReplay] = useState(0)
  const [authed, setAuthed] = useState(() => {
    try { return !!localStorage.getItem('aperture_user') } catch { return false }
  })

  const page = route.startsWith('/about') ? 'about'
    : route.startsWith('/mission') ? 'mission'
    : route.startsWith('/login') ? 'login'
    : route.startsWith('/profile') ? 'profile' : 'home'

  useEffect(() => {
    if (page !== 'home') {
      document.body.classList.remove('no-scroll')
      document.documentElement.setAttribute('data-mode', 'site')
    }
  }, [page])

  const goHome = (e) => {
    e.preventDefault()
    if (page !== 'home') window.location.hash = '/'
    setReplay((r) => r + 1)
  }

  const goSection = (id) => (e) => {
    e.preventDefault()
    const scroll = () => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth' })
    if (page !== 'home') { window.location.hash = '/'; setTimeout(scroll, 160) } else scroll()
  }

  const signOut = (e) => {
    e.preventDefault()
    try { localStorage.removeItem('aperture_user') } catch { /* ignore */ }
    setAuthed(false)
  }

  return (
    <>
      <header className="site-header">
        <div className="sh-left">
          <a className="sh-logo" href="#/" onClick={goHome}>Aperture</a>
          <nav className="sh-nav">
            <a href="#/" onClick={goSection('mission')}>Mission</a>
            <a href="#/" onClick={goSection('about')}>About</a>
          </nav>
        </div>
        <div className="sh-right">
          {authed
            ? <><a className={`sh-link ${page === 'profile' ? 'active' : ''}`} href="#/profile">Profile</a><a className="sh-cta" href="#/" onClick={signOut}>Sign out</a></>
            : <a className="sh-cta" href="#/login">Sign in</a>}
        </div>
      </header>

      <main className="site-main">
        {page === 'home' && <Landing key={replay} />}
        {page === 'about' && <About />}
        {page === 'mission' && <Mission />}
        {page === 'login' && <Auth onAuth={() => setAuthed(true)} />}
        {page === 'profile' && (authed ? <Profile /> : <Auth onAuth={() => setAuthed(true)} />)}
      </main>
    </>
  )
}
