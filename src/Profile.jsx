import { getHistory, summarize } from './history'

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

export default function Profile() {
  const list = getHistory()
  const { count, avg, topMode, best } = summarize(list)
  const user = (() => { try { return localStorage.getItem('aperture_user') } catch { return null } })()

  return (
    <div className="profile">
      <p className="page-kicker mono">Profile</p>
      <h1 className="profile-h1">{user ? `${user}’s library` : 'Your library'}</h1>
      <p className="profile-lead">Every site you’ve pointed Aperture at, with its GEO score and exposure.</p>

      <div className="profile-summary">
        <div className="ps-stat"><span className="ps-num">{count}</span><span className="ps-lab mono">sites analyzed</span></div>
        <div className="ps-stat"><span className="ps-num">{avg}</span><span className="ps-lab mono">avg GEO score</span></div>
        <div className="ps-stat"><span className="ps-num">{best}</span><span className="ps-lab mono">best score</span></div>
        <div className="ps-stat"><span className="ps-num" style={{ textTransform: 'capitalize' }}>{topMode}</span><span className="ps-lab mono">most-used exposure</span></div>
      </div>
      {count > 0 && (
        <p className="profile-insight">
          {avg >= 65
            ? 'Your sites are, on average, well-exposed to AI answer engines — keep amplifying.'
            : avg >= 50
              ? 'Middling exposure overall. A few config fixes (schema, robots) would move most of these up a grade.'
              : 'Most of your sites are hard for AI to read. Start with structured data and crawler access.'}
        </p>
      )}

      <div className="profile-list">
        {list.length === 0 ? (
          <p className="profile-empty">No sites analyzed yet. Point Aperture at a site from the home page.</p>
        ) : list.map((e) => (
          <div className="lib-row" key={e.ts}>
            <span className="lib-site">{e.value}</span>
            <span className={`lib-grade g-${e.grade}`}>{e.grade}</span>
            <span className="lib-score mono">{e.score}</span>
            <span className="lib-mode mono">{e.mode}</span>
            <span className="lib-time mono">{timeAgo(e.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
