// Per-user library of analyzed sites (client-side for now).
import { sampleReport, computeGeoScore, freshness } from './data/diagnostics'

const KEY = 'aperture_history'

export function getHistory() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function recordScan(value, mode) {
  if (!value) return
  const { score, grade } = computeGeoScore(sampleReport(value), freshness)
  let list = getHistory().filter((e) => e.value !== value)
  list.unshift({ value, mode, score, grade, ts: Date.now() })
  list = list.slice(0, 24)
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

export function summarize(list = getHistory()) {
  const count = list.length
  const avg = count ? Math.round(list.reduce((s, e) => s + e.score, 0) / count) : 0
  const modes = list.reduce((m, e) => { m[e.mode] = (m[e.mode] || 0) + 1; return m }, {})
  const topMode = Object.entries(modes).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  const best = count ? Math.max(...list.map((e) => e.score)) : 0
  return { count, avg, topMode, best }
}
