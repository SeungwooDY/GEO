import { describe, expect, it } from 'vitest';
import { generateMarkdown } from '../generators/markdownGenerator.js';
import { generateSchema, renderJsonLdScript } from '../generators/schemaGenerator.js';
import { MOCK_PROFILE } from '../mock-site/profile.js';
import { checkFacts, extractFacts } from './facts.js';

const values = (text: string, kind: Parameters<ReturnType<typeof extractFacts>['get']>[0]) => [...(extractFacts(text).get(kind) ?? [])];

describe('extractFacts', () => {
  it('normalizes phone variants to the same value', () => {
    const variants = ['(951) 555-0142', '+1-951-555-0142', '951.555.0142', '951 555 0142'];
    for (const v of variants) expect(values(`Call ${v} today`, 'phone')).toEqual(['9515550142']);
  });

  it('reads 12h and 24h times as the same fact', () => {
    expect(values('Open 7am-7pm', 'time').sort()).toEqual(['07:00', '19:00']);
    expect(values('"opens": "07:00", "closes": "19:00"', 'time').sort()).toEqual(['07:00', '19:00']);
    expect(values('Closes at 7:30pm', 'time')).toEqual(['19:30']);
  });

  it('expands day ranges, including full and abbreviated names', () => {
    expect(values('Mon-Sat', 'day').sort()).toEqual(values('Monday-Saturday', 'day').sort());
    expect(values('Monday-Saturday', 'day')).toHaveLength(6);
    expect(values('Monday-Saturday', 'day')).not.toContain('Sunday');
    expect(values('Fri-Mon', 'day').sort()).toEqual(['Friday', 'Monday', 'Saturday', 'Sunday']);
  });

  it('extracts prices, stats and ratings', () => {
    expect(values('Drain cleaning from $89. 25 years in business, 1,200 reviews.', 'stat').sort()).toEqual([
      '$89',
      '1200reviews',
      '25years',
    ]);
    expect(values('Rated 4.8 out of 5', 'rating')).toEqual(['4.8']);
  });

  it('normalizes street suffixes and finds zip codes', () => {
    expect(values('123 Main Street', 'street')).toEqual(values('123 Main St.', 'street'));
    expect(values('Riverside, CA 92501', 'zip')).toEqual(['92501']);
  });

  it('detects risky claim phrases', () => {
    expect(values('Available 24/7. Licensed & insured. Free estimates!', 'claim').sort()).toEqual([
      '24/7',
      'free-estimates',
      'insured',
      'licensed',
    ]);
  });
});

describe('checkFacts', () => {
  const markdown = generateMarkdown(MOCK_PROFILE);
  const withSchema = `${markdown}\n${renderJsonLdScript(generateSchema(MOCK_PROFILE))}`;

  it('passes generated markdown against its profile with nothing added or omitted', () => {
    const result = checkFacts(markdown, MOCK_PROFILE);
    expect(result.added).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes markdown plus JSON-LD against its profile', () => {
    expect(checkFacts(withSchema, MOCK_PROFILE).added).toEqual([]);
  });

  it('flags a changed phone number', () => {
    const result = checkFacts(markdown.replace('555-0142', '555-9999'), MOCK_PROFILE);
    expect(result.ok).toBe(false);
    expect(result.added).toContainEqual({ kind: 'phone', value: '9515559999' });
    expect(result.omitted).toContainEqual({ kind: 'phone', value: '9515550142' });
  });

  it('flags an added price', () => {
    const result = checkFacts(`${markdown}\nDrain cleaning from $49.`, MOCK_PROFILE);
    expect(result.ok).toBe(false);
    expect(result.added).toContainEqual({ kind: 'stat', value: '$49' });
  });

  it('flags added availability claims like 24/7 and licensed', () => {
    const result = checkFacts(`${markdown}\nOpen 24/7. Licensed and insured.`, MOCK_PROFILE);
    expect(result.added.map((f) => f.value).sort()).toEqual(['24/7', 'insured', 'licensed']);
  });

  it('flags an extra open day', () => {
    const result = checkFacts(markdown.replace('Monday-Saturday', 'Monday-Sunday'), MOCK_PROFILE);
    expect(result.added).toContainEqual({ kind: 'day', value: 'Sunday' });
  });

  it('flags an altered rating or review count', () => {
    const result = checkFacts(markdown.replace('4.8', '5').replace('120', '500'), MOCK_PROFILE);
    expect(result.added).toContainEqual({ kind: 'rating', value: '5' });
    expect(result.added).toContainEqual({ kind: 'stat', value: '500reviews' });
  });

  it('treats omissions as warnings, not failures', () => {
    const result = checkFacts('# Riverside Plumbing Co.\nCall (951) 555-0142.', MOCK_PROFILE);
    expect(result.ok).toBe(true);
    expect(result.omitted.length).toBeGreaterThan(0);
  });

  it('compares two texts, e.g. a bot snapshot against the human page', () => {
    const human = 'Riverside Plumbing. Hours: Mon-Sat 7am-7pm. Call (951) 555-0142.';
    expect(checkFacts('Open Monday-Saturday, 7am to 7pm. Phone: 951-555-0142', human).added).toEqual([]);
    expect(checkFacts('Open Monday-Saturday, 7am to 9pm.', human).added).toContainEqual({ kind: 'time', value: '21:00' });
  });

  it('lets profile claims in free-text fields count as sourced', () => {
    const profile = { ...MOCK_PROFILE, services: ['Licensed drain cleaning'] };
    expect(checkFacts('We offer licensed drain cleaning.', profile).added).toEqual([]);
  });
});
