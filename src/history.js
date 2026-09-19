// Per-user library of analyzed sites (client-side for now).
const KEY = 'aperture_history'

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Every entry has its own id: a timestamp isn't unique (two saves can land in the same millisecond), so it can't
// identify a row for React keys or deletion. Entries saved before ids existed get a stable one on read.
export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]').map((e, i) => (e.id ? e : { ...e, id: `legacy-${e.ts}-${i}` }))
  } catch { return [] }
}

// Saves the score from the REAL scan (the report computes it once results arrive). An indeterminate
// scan (firewalled) is kept in the library but carries no score, so it can't drag the averages.
export function recordScan(value, mode, result) {
  if (!value || !result) return
  const entry = {
    id: newId(), value, mode, ts: Date.now(),
    score: result.indeterminate ? null : result.score,
    grade: result.indeterminate ? '—' : result.grade,
  }
  const list = [entry, ...getHistory().filter((e) => e.value !== value)].slice(0, 24)
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

/** Removes one saved site by its id and returns the remaining list. */
export function removeScan(id) {
  const list = getHistory().filter((e) => e.id !== id)
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
  return list
}

export function summarize(list = getHistory()) {
  const scored = list.filter((e) => typeof e.score === 'number')
  const count = list.length
  const avg = scored.length ? Math.round(scored.reduce((s, e) => s + e.score, 0) / scored.length) : 0
  const modes = list.reduce((m, e) => { m[e.mode] = (m[e.mode] || 0) + 1; return m }, {})
  const topMode = Object.entries(modes).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  const best = scored.length ? Math.max(...scored.map((e) => e.score)) : 0
  return { count, avg, topMode, best }
}
