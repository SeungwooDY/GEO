import { beforeEach, describe, expect, it } from 'vitest'

// history.js talks to localStorage; give the node test environment a tiny in-memory one.
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const { getHistory, recordScan, removeScan, summarize } = await import('./history.js')

const scored = { score: 62, grade: 'C', indeterminate: false }
beforeEach(() => store.clear())

describe('library', () => {
  it('saves the real score, newest first, one entry per site', () => {
    recordScan('a.com', 'mirror', scored)
    recordScan('b.com', 'amplify', { ...scored, score: 80, grade: 'A' })
    recordScan('a.com', 'cloak', { ...scored, score: 40, grade: 'D' }) // rescan replaces, moves to top
    const h = getHistory()
    expect(h.map((e) => e.value)).toEqual(['a.com', 'b.com'])
    expect(h[0]).toMatchObject({ mode: 'cloak', score: 40 })
  })

  it('keeps an indeterminate scan but with no score, so averages ignore it', () => {
    recordScan('a.com', 'mirror', scored)
    recordScan('fw.com', 'mirror', { indeterminate: true, score: 0, grade: 'F' })
    expect(getHistory()[0]).toMatchObject({ score: null, grade: '—' })
    expect(summarize()).toMatchObject({ count: 2, avg: 62, best: 62 })
  })

  it('deletes one site by timestamp and leaves the rest', () => {
    recordScan('a.com', 'mirror', scored)
    recordScan('b.com', 'mirror', scored) // may share a millisecond with a.com: ids must still differ
    const a = getHistory().find((e) => e.value === 'a.com')
    const remaining = removeScan(a.id)
    expect(remaining.map((e) => e.value)).toEqual(['b.com'])
    expect(getHistory()).toHaveLength(1)
  })

  it('gives entries saved before ids existed a stable id so they can still be deleted', () => {
    store.set('aperture_history', JSON.stringify([{ value: 'old.com', mode: 'mirror', score: 50, grade: 'C', ts: 123 }]))
    const [e] = getHistory()
    expect(e.id).toBe(getHistory()[0].id)
    expect(removeScan(e.id)).toEqual([])
  })

  it('deleting the last site leaves a clean empty summary', () => {
    recordScan('a.com', 'mirror', scored)
    removeScan(getHistory()[0].id)
    expect(summarize()).toEqual({ count: 0, avg: 0, topMode: '—', best: 0 })
  })
})
