import { describe, expect, it } from 'vitest'
import { jsonLdFields, projectReport, projectScore } from './projection.js'
import { computeGeoScore, sampleReport } from '../data/diagnostics.js'

const LD = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>\n`
const FULL = { '@type': 'LocalBusiness', name: 'A', telephone: '1', address: {}, url: 'https://a.com' }
const file = (id, over = {}) => ({ id, status: 'ready', content: '', ...over })

describe('jsonLdFields', () => {
  it('counts the engine-tracked fields the block really has, with the engine rounding', () => {
    expect(jsonLdFields(LD(FULL))).toMatchObject({ percent: 44, present: ['name', 'address', 'telephone', 'url'] })
    expect(jsonLdFields(LD({ ...FULL, openingHoursSpecification: [] })).percent).toBe(56)
  })
  it('returns null for an unreadable block', () => {
    expect(jsonLdFields('<script>{nope</script>')).toBeNull()
  })
})

describe('projectScore', () => {
  const report = sampleReport('https://x.com')
  const noSchema = { ...report, schema: { ok: true, data: { fetchUsable: true, statusCode: 200, found: false, types: [], blockCount: 0 } } }

  it('rises when a JSON-LD block would fill in missing structured data (Amplify)', () => {
    const measured = computeGeoScore(noSchema, 'amplify')
    const p = projectScore(noSchema, [file('jsonld', { content: LD(FULL) })], 'amplify', measured)
    expect(p.delta).toBeGreaterThan(0)
    expect(p.score).toBe(measured.score + p.delta)
  })

  it('a locked (needs-facts) JSON-LD file projects nothing: filling the details is what moves the score', () => {
    const measured = computeGeoScore(noSchema, 'amplify')
    const locked = projectScore(noSchema, [file('jsonld', { status: 'needs-facts', content: '' })], 'amplify', measured)
    const unlocked = projectScore(noSchema, [file('jsonld', { content: LD(FULL) })], 'amplify', measured)
    expect(locked.delta).toBe(0)
    expect(unlocked.delta).toBeGreaterThan(locked.delta)
  })

  it('more complete details project a higher score', () => {
    const measured = computeGeoScore(noSchema, 'amplify')
    const a = projectScore(noSchema, [file('jsonld', { content: LD(FULL) })], 'amplify', measured)
    const b = projectScore(noSchema, [file('jsonld', { content: LD({ ...FULL, openingHoursSpecification: [{}], geo: {}, sameAs: [] }) })], 'amplify', measured)
    expect(b.score).toBeGreaterThan(a.score)
  })

  it('never projects a worse result than the site already has', () => {
    const rich = { ...report, schema: { ok: true, data: { fetchUsable: true, statusCode: 200, found: true, types: ['LocalBusiness'], blockCount: 1, fieldCompleteness: { present: [], missing: [], percent: 89 } } } }
    const measured = computeGeoScore(rich, 'amplify')
    expect(projectScore(rich, [file('jsonld', { content: LD(FULL) })], 'amplify', measured).delta).toBe(0)
  })

  it('robots: allowing every bot lifts access in Amplify; blocking every bot lifts it in Cloak', () => {
    const blocked = { ...report, robots: { ok: true, data: { robotsTxtFound: true, targetPath: '/', perBot: [{ bot: 'GPTBot', allowedTargetPath: false, matchedRule: 'Disallow: /', hasExplicitEntry: true }, { bot: 'ClaudeBot', allowedTargetPath: false, matchedRule: 'Disallow: /', hasExplicitEntry: true }] } } }
    expect(projectScore(blocked, [file('robots')], 'amplify', computeGeoScore(blocked, 'amplify')).delta).toBeGreaterThan(0)
    const open = { ...blocked, robots: { ok: true, data: { ...blocked.robots.data, perBot: blocked.robots.data.perBot.map((b) => ({ ...b, allowedTargetPath: true })) } } }
    expect(projectScore(open, [file('robots')], 'cloak', computeGeoScore(open, 'cloak')).delta).toBeGreaterThan(0)
  })

  it('does not project robots when the original was unreadable (warning present)', () => {
    const blocked = { ...report, robots: { ok: true, data: { robotsTxtFound: true, targetPath: '/', perBot: [{ bot: 'GPTBot', allowedTargetPath: false, matchedRule: 'Disallow: /', hasExplicitEntry: true }] } } }
    const p = projectScore(blocked, [file('robots', { warning: "couldn't read" })], 'amplify', computeGeoScore(blocked, 'amplify'))
    expect(p.delta).toBe(0)
  })

  it('returns null when the measured score is indeterminate, and never mutates the input report', () => {
    expect(projectScore(report, [file('robots')], 'mirror', { indeterminate: true })).toBeNull()
    const before = JSON.stringify(noSchema)
    projectReport(noSchema, [file('jsonld', { content: LD(FULL) })], 'amplify')
    expect(JSON.stringify(noSchema)).toBe(before)
  })
})
