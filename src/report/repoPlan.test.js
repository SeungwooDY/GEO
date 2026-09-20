import { describe, expect, it } from 'vitest'
import { buildPrPlan, missingProfileFields, profileComplete } from './repoPlan.js'

const FULL = { name: 'A', phone: '1', address: { street: 's', city: 'c', region: 'r', postalCode: 'p' } }
const report = (over = {}) => ({
  checks: [{ id: 'access', status: 'ok' }, { id: 'structured', status: 'bad' }, { id: 'extraction', status: 'ok' }],
  editTargets: { robots: { path: 'public/robots.txt', exists: false, generated: false }, headTemplate: 'public/index.html' },
  ...over,
})
const byId = (rows, id) => rows.find((r) => r.id === id)

describe('profileComplete', () => {
  it('needs every required fact, not just any submitted form', () => {
    expect(profileComplete(FULL)).toBe(true)
    expect(profileComplete({})).toBe(false)
    expect(profileComplete(null)).toBe(false)
    expect(profileComplete({ ...FULL, phone: '  ' })).toBe(false)
    expect(profileComplete({ ...FULL, address: { ...FULL.address, city: '' } })).toBe(false)
  })
  it('an empty form submission is NOT complete (the UI must not flip to "included")', () => {
    expect(profileComplete({ name: '', phone: '', address: { street: '', city: '', region: '', postalCode: '' }, services: [], areaServed: [] })).toBe(false)
  })
  it('lists what is still missing', () => {
    expect(missingProfileFields({ name: 'A', address: { street: 's' } })).toEqual(['phone', 'address.city', 'address.region', 'address.postalCode'])
    expect(missingProfileFields(FULL)).toEqual([])
  })
})

describe('buildPrPlan', () => {
  it('Amplify without details: robots included, llms + JSON-LD locked', () => {
    const rows = buildPrPlan(report(), 'amplify', null)
    expect(byId(rows, 'robots').state).toBe('included')
    expect(byId(rows, 'llms').state).toBe('locked')
    expect(byId(rows, 'jsonld').state).toBe('locked')
  })

  it('unlocks llms + JSON-LD once the profile is complete, and only then', () => {
    expect(byId(buildPrPlan(report(), 'amplify', FULL), 'llms').state).toBe('included')
    expect(byId(buildPrPlan(report(), 'amplify', FULL), 'jsonld').state).toBe('included')
    expect(byId(buildPrPlan(report(), 'amplify', { ...FULL, name: '' }), 'llms').state).toBe('locked')
  })

  it('Cloak includes only robots.txt and says why the fact files are out', () => {
    const rows = buildPrPlan(report(), 'cloak', FULL)
    expect(byId(rows, 'robots').state).toBe('included')
    expect(byId(rows, 'llms').state).toBe('excluded')
    expect(byId(rows, 'jsonld').state).toBe('excluded')
    expect(byId(rows, 'llms').impact).toMatch(/hides your content/)
  })

  it('a code-generated robots.txt is excluded (the server will not edit generator source)', () => {
    const r = report({ editTargets: { robots: { path: 'app/robots.ts', generated: true }, headTemplate: 'public/index.html' } })
    const row = byId(buildPrPlan(r, 'mirror', null), 'robots')
    expect(row.state).toBe('excluded')
    expect(row.impact).toContain('app/robots.ts')
  })

  it('no head template means JSON-LD is excluded, not "locked behind your details"', () => {
    const r = report({ editTargets: { robots: { path: 'public/robots.txt', generated: false }, headTemplate: null } })
    const row = byId(buildPrPlan(r, 'amplify', FULL), 'jsonld')
    expect(row.state).toBe('excluded')
    expect(row.impact).toMatch(/head template/)
  })

  it('a framework layout (not .html) names the guarded edit; a literal .html does not', () => {
    const fw = report({ editTargets: { robots: { path: 'public/robots.txt', generated: false }, headTemplate: 'app/layout.tsx' } })
    expect(byId(buildPrPlan(fw, 'amplify', FULL), 'jsonld').impact).toMatch(/guarded Claude edit of app\/layout\.tsx/)
    expect(byId(buildPrPlan(report(), 'amplify', FULL), 'jsonld').impact).not.toMatch(/Claude/)
  })

  it('states honestly whether robots.txt moves a score', () => {
    expect(byId(buildPrPlan(report(), 'mirror', null), 'robots').impact).toMatch(/No score change/)
    const failing = report({ checks: [{ id: 'access', status: 'bad' }] })
    expect(byId(buildPrPlan(failing, 'mirror', null), 'robots').impact).toMatch(/Fixes the failing crawler-access/)
  })

  it('a failing extraction check is listed as out of scope (needs a build change)', () => {
    const r = report({ checks: [{ id: 'access', status: 'ok' }, { id: 'extraction', status: 'bad' }] })
    const row = byId(buildPrPlan(r, 'amplify', FULL), 'prerender')
    expect(row.state).toBe('excluded')
    expect(byId(buildPrPlan(report(), 'amplify', FULL), 'prerender')).toBeUndefined()
  })
})
