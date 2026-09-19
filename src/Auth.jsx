import { useState } from 'react'
import { ArrowIcon } from './icons'

// Client-side seed auth for now. Swap for a real backend later.
const SEED = { username: 'user', password: '123' }

export default function Auth({ onAuth }) {
  const [username, setUsername] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (username.trim().toLowerCase() === SEED.username && pw === SEED.password) {
      try { localStorage.setItem('aperture_user', username.trim()) } catch { /* ignore */ }
      onAuth && onAuth()
      window.location.hash = '/'
    } else {
      setErr('Those credentials don’t match. Use the seed login below.')
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <p className="page-kicker mono">Access</p>
        <h1 className="auth-title">Sign in to Aperture</h1>
        <p className="auth-sub">Control how AI answer engines read, retain, and cite your site.</p>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Username</span>
            <input type="text" value={username} autoComplete="username"
              onChange={(e) => { setUsername(e.target.value); setErr('') }} placeholder="user" />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input type="password" value={pw} autoComplete="current-password"
              onChange={(e) => { setPw(e.target.value); setErr('') }} placeholder="•••" />
          </label>
          {err && <p className="auth-err mono">{err}</p>}
          <button className="auth-go" type="submit">Sign in <ArrowIcon /></button>
        </form>

        <p className="auth-hint mono">Seed login · user · 123</p>
      </div>
    </div>
  )
}
