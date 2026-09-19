import { describe, expect, it } from 'vitest';
import { evaluateRobotsTxt } from '../crawlers/robotsParser.js';
import { AI_BOTS } from '../crawlers/botUserAgents.js';
import { analyzeSchema } from '../crawlers/schemaChecker.js';
import { MOCK_PROFILE } from '../mock-site/profile.js';
import { parseBusinessProfile } from './businessProfile.js';
import { generateAiBotRobots, generateLlmsTxt } from './configGenerator.js';
import { formatDays, formatTime } from './hours.js';
import { generateMarkdown } from './markdownGenerator.js';
import { generateSchema, renderJsonLdScript } from './schemaGenerator.js';

describe('hours formatting', () => {
  it('formats times in 12-hour style', () => {
    expect(formatTime('07:00')).toBe('7am');
    expect(formatTime('19:30')).toBe('7:30pm');
    expect(formatTime('00:00')).toBe('12am');
    expect(formatTime('12:00')).toBe('12pm');
  });

  it('collapses consecutive days into a range and keeps gaps separate', () => {
    expect(formatDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])).toBe('Monday-Saturday');
    expect(formatDays(['Monday', 'Wednesday'])).toBe('Monday, Wednesday');
    expect(formatDays(['Saturday', 'Monday', 'Tuesday', 'Wednesday'])).toBe('Monday-Wednesday, Saturday');
  });
});

describe('parseBusinessProfile', () => {
  it('accepts a valid profile', () => {
    expect(parseBusinessProfile(JSON.parse(JSON.stringify(MOCK_PROFILE)))).toEqual(MOCK_PROFILE);
  });

  it('names the offending field on bad input', () => {
    expect(() => parseBusinessProfile({ ...MOCK_PROFILE, phone: '' })).toThrow('profile.phone');
    expect(() => parseBusinessProfile({ ...MOCK_PROFILE, hours: [{ days: ['Funday'], opens: '07:00', closes: '19:00' }] })).toThrow(
      'unknown day',
    );
    expect(() => parseBusinessProfile({ ...MOCK_PROFILE, hours: [{ days: ['Monday'], opens: '7am', closes: '19:00' }] })).toThrow(
      'HH:MM',
    );
    expect(() => parseBusinessProfile({ ...MOCK_PROFILE, reviews: { ratingValue: 9, reviewCount: 1 } })).toThrow('ratingValue');
  });
});

describe('generateMarkdown', () => {
  const md = generateMarkdown(MOCK_PROFILE);

  it('states the profile facts', () => {
    expect(md).toContain('# Riverside Plumbing Co.');
    expect(md).toContain('Phone: (951) 555-0142');
    expect(md).toContain('123 Main St, Riverside, CA 92501');
    expect(md).toContain('Monday-Saturday: 7am-7pm');
    expect(md).toContain('- Water heater installation');
    expect(md).toContain('Rated 4.8 out of 5 from 120 reviews.');
  });

  it('omits sections the profile has no data for', () => {
    const md2 = generateMarkdown({ ...MOCK_PROFILE, reviews: undefined, hours: [], services: [] });
    expect(md2).not.toContain('## Reviews');
    expect(md2).not.toContain('## Hours');
    expect(md2).not.toContain('## Services');
  });
});

describe('generateSchema', () => {
  it('produces JSON-LD the Phase 1 schema checker reads as complete-ish LocalBusiness data', () => {
    const html = `<html><body>${MOCK_PROFILE.phone}${renderJsonLdScript(generateSchema(MOCK_PROFILE))}</body></html>`;
    const report = analyzeSchema(html, 200);
    expect(report.types).toContain('LocalBusiness');
    expect(report.fieldCompleteness.present).toEqual(expect.arrayContaining(['name', 'address', 'telephone', 'hours', 'url']));
    expect(report.telephoneInVisibleText).toBe(true);
  });

  it('does not invent fields the profile lacks', () => {
    const schema = generateSchema({ ...MOCK_PROFILE, reviews: undefined, url: undefined });
    expect(schema).not.toHaveProperty('aggregateRating');
    expect(schema).not.toHaveProperty('url');
  });

  it('escapes "<" so profile text cannot close the script tag', () => {
    const script = renderJsonLdScript(generateSchema({ ...MOCK_PROFILE, name: 'A</script><b>' }));
    expect(script.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('generateAiBotRobots', () => {
  it('cloak disallows every AI bot, including token-only ones', () => {
    const results = evaluateRobotsTxt(generateAiBotRobots('cloak'), '/');
    expect(results).toHaveLength(AI_BOTS.length);
    expect(results.every((r) => !r.allowedTargetPath && r.hasExplicitEntry)).toBe(true);
    expect(results.map((r) => r.bot)).toContain('Google-Extended');
  });

  it.each(['amplify', 'mirror'] as const)('%s allows every AI bot', (mode) => {
    const results = evaluateRobotsTxt(generateAiBotRobots(mode), '/');
    expect(results.every((r) => r.allowedTargetPath && r.hasExplicitEntry)).toBe(true);
  });
});

describe('generateLlmsTxt', () => {
  it('uses only profile facts', () => {
    const txt = generateLlmsTxt(MOCK_PROFILE);
    expect(txt).toContain('# Riverside Plumbing Co.');
    expect(txt).toContain('(951) 555-0142');
    expect(txt).toContain('- Drain cleaning');
    expect(txt).toContain('[Website](http://127.0.0.1:4173/)');
  });
});
