import { describe, expect, it } from 'vitest'
import { buildChecks, gradeTone, weightShare } from './checks.js'
import { sampleReport } from '../data/diagnostics.js'

describe('weightShare', () => {
  it('splits the chosen mode into shares that sum to 100 across the six cards', () => {
    for (const mode of ['amplify', 'mirror', 'cloak']) {
      const sum = ['access', 'cloaking', 'extraction', 'structured', 'content', 'perbot'].reduce((s, id) => s + weightShare(mode, id), 0)
      expect(sum).toBe(100)
    }
  })
  it('reflects the mode: structured data matters in Amplify, not in Mirror', () => {
    expect(weightShare('amplify', 'structured')).toBe(25)
    expect(weightShare('mirror', 'structured')).toBe(0)
  })
})

describe('buildChecks', () => {
  const report = sampleReport('https://example.com')
  it('returns the six cards with a headline and status each', () => {
    const cards = buildChecks(report, 'mirror')
    expect(cards.map((c) => c.id)).toEqual(['access', 'cloaking', 'extraction', 'structured', 'content', 'perbot'])
    for (const c of cards) {
      expect(['ok', 'warn', 'bad', 'na']).toContain(c.status)
      expect(c.headline.length).toBeGreaterThan(0)
    }
  })
  it('degrades a failed check to na instead of throwing', () => {
    const broken = { ...report, robots: { ok: false, error: 'timed out' }, schema: undefined }
    const cards = buildChecks(broken, 'amplify')
    expect(cards[0]).toMatchObject({ id: 'access', status: 'na', headline: 'Check failed' })
    expect(cards[3].status).toBe('na')
  })
  it('in Cloak, being blocked counts as good', () => {
    const allBlocked = { ...report, robots: { ok: true, data: { robotsTxtFound: true, targetPath: '/', perBot: [{ bot: 'GPTBot', allowedTargetPath: false, matchedRule: 'Disallow: /', hasExplicitEntry: true }] } } }
    expect(buildChecks(allBlocked, 'cloak')[0].status).toBe('ok')
    expect(buildChecks(allBlocked, 'amplify')[0].status).toBe('bad')
  })
})

describe('gradeTone', () => {
  it('maps grades to tones', () => {
    expect(['A', 'B', 'C', 'D', 'F', '—'].map(gradeTone)).toEqual(['ok', 'ok', 'warn', 'bad', 'bad', 'na'])
  })
})

describe('friendlyError', () => {
  it('never shows a filesystem path or a Playwright stack to people', async () => {
    const { friendlyError } = await import('./checks.js')
    const raw = "browserType.launch: Executable doesn't exist at /opt/render/.cache/ms-playwright/chromium_headless_shell-1243/chrome"
    const out = friendlyError(raw)
    expect(out).not.toMatch(/\/opt\/|ms-playwright|Executable/)
    expect(friendlyError('cloaking timed out after 15s (likely edge protection)')).toMatch(/too long/)
    expect(friendlyError('read failed at /Users/me/a/b/c/file.js line 3')).not.toContain('/Users/')
  })
  it('pluralizes word counts', () => {
    const one = { ...sampleReport('https://x.com'), content: { ok: true, data: { ...sampleReport('https://x.com').content.data, fetchUsable: true, wordCount: 1 } } }
    expect(buildChecks(one, 'amplify').find((c) => c.id === 'content').headline).toBe('1 word')
  })
})
