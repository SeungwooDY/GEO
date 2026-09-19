import { describe, expect, it } from 'vitest';
import { extractVisibleText } from '../crawlers/htmlText.js';
import { MOCK_PROFILE } from '../mock-site/profile.js';
import { REAL_BUSINESS_HTML } from '../mock-site/server.js';
import { MemoryApprovedStore } from '../store/approvedStore.js';
import type { Judge } from '../validation/judge.js';
import { publishAmplify } from './amplify.js';

const judge: Judge = { id: 'fake', judge: async () => ({ verdict: 'supported', unsupportedClaims: [], omittedClaims: [] }) };
const key = { tenant: 'riverside', path: '/', mode: 'amplify' as const };

// What a person sees once the mock site's JavaScript has run.
const HUMAN_TEXT = extractVisibleText(`<body>${REAL_BUSINESS_HTML}</body>`);

describe('publishAmplify against the human-visible page', () => {
  it('publishes when every fact in the artifact is on the human page', async () => {
    const store = new MemoryApprovedStore();
    const result = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge, humanPageText: HUMAN_TEXT });
    expect(result.status).toBe('pass');
    expect(await store.get(key)).toBeDefined();
  });

  it('rejects facts that are in the profile but that people cannot read on the page', async () => {
    const store = new MemoryApprovedStore();
    const thinPage = 'Riverside Plumbing Co. Hours: Mon-Sat 7am-7pm. Call (951) 555-0142.';
    const result = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge, humanPageText: thinPage });

    expect(result.status).toBe('reject');
    expect(result.layer2).toBeNull(); // rejected before spending an LLM call
    const reasons = result.reasons.join('\n');
    expect(reasons).toContain('street "123 main st"');
    expect(reasons).toContain('rating "4.8"');
    expect(reasons).toContain('stat "120reviews"');
    expect(await store.get(key)).toBeUndefined();
  });

  it('does not count the site’s own URL as a hidden fact', async () => {
    const store = new MemoryApprovedStore();
    const result = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge, humanPageText: HUMAN_TEXT });
    expect(result.reasons.join()).not.toContain('url');
  });

  it('still catches a fact added by the profile after the page was written', async () => {
    const store = new MemoryApprovedStore();
    const profile = { ...MOCK_PROFILE, phone: '(951) 555-9999' };
    const result = await publishAmplify({ tenant: 'riverside', path: '/', profile, store, judge, humanPageText: HUMAN_TEXT });
    expect(result.status).toBe('reject');
    expect(result.reasons.join()).toContain('9515559999');
  });

  it('skips the page check when no page text is supplied (profile-only gate)', async () => {
    const store = new MemoryApprovedStore();
    const result = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge });
    expect(result.status).toBe('pass');
  });
});
