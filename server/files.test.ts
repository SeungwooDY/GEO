import { describe, expect, it } from 'vitest';
import { buildFiles, buildSitemap, mergeRobots, missingFields, sanitizeProfileInput, stripAiGroups } from './files.js';
import { AI_BOTS } from '../src/crawlers/botUserAgents.js';

const FULL = {
  name: 'Riverside Plumbing Co.', phone: '(951) 555-0142',
  address: { street: '123 Main St', city: 'Riverside', region: 'CA', postalCode: '92501' },
  services: ['Drain cleaning'], areaServed: ['Riverside'], hours: [],
};
const base = { url: 'https://example.com/', robots: { state: 'absent' } as const, sitemap: { state: 'absent' } as const, links: ['https://example.com/', 'https://example.com/about'] };
const byId = (files: { id: string }[], id: string) => files.find((f) => f.id === id) as ReturnType<typeof buildFiles>['files'][number];

describe('robots.txt merge', () => {
  const existing = ['# my rules', 'User-agent: *', 'Disallow: /admin/', '', '# no gpt', 'User-agent: GPTBot', 'Disallow: /', '', 'User-agent: Googlebot', 'Allow: /', '', 'Sitemap: https://example.com/sm.xml', ''].join('\n');

  it('drops AI-only groups (and their comment) but keeps everything else', () => {
    const out = stripAiGroups(existing);
    expect(out).toContain('Disallow: /admin/');
    expect(out).toContain('User-agent: Googlebot');
    expect(out).toContain('Sitemap: https://example.com/sm.xml');
    expect(out).not.toMatch(/GPTBot/);
    expect(out).not.toContain('# no gpt');
  });

  it('keeps a group that mixes an AI bot with a non-AI bot', () => {
    const mixed = 'User-agent: GPTBot\nUser-agent: Googlebot\nDisallow: /x/\n';
    expect(stripAiGroups(mixed)).toContain('Googlebot');
  });

  it('cloak disallows every AI bot; amplify allows every AI bot', () => {
    const cloak = mergeRobots(existing, 'cloak', null);
    const amplify = mergeRobots(existing, 'amplify', null);
    for (const b of AI_BOTS) {
      expect(cloak).toContain(`User-agent: ${b.token}\nDisallow: /`);
      expect(amplify).toContain(`User-agent: ${b.token}\nAllow: /`);
    }
    expect(cloak).toContain('Disallow: /admin/'); // the site's own rule survives
  });

  it('creates a minimal file when none exists, and adds Sitemap only when absent', () => {
    const out = mergeRobots(null, 'mirror', 'https://example.com/sitemap.xml');
    expect(out).toMatch(/^User-agent: \*\nAllow: \//);
    expect(out).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(mergeRobots(existing, 'mirror', 'https://example.com/sitemap.xml')).not.toContain('example.com/sitemap.xml');
  });

  it('is idempotent: merging its own output changes nothing', () => {
    const once = mergeRobots(existing, 'amplify', null);
    expect(mergeRobots(once, 'amplify', null)).toBe(once);
  });
});

describe('sitemap', () => {
  it('lists found urls, escapes them, invents no lastmod', () => {
    const xml = buildSitemap(['https://example.com/', 'https://example.com/a&b', 'https://example.com/']);
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml).toContain('a&amp;b');
    expect(xml).not.toContain('lastmod');
  });
});

describe('buildFiles by mode', () => {
  it('cloak: only robots.txt is ready', () => {
    const { files } = buildFiles({ ...base, mode: 'cloak', profile: FULL });
    expect(files.filter((f) => f.status === 'ready').map((f) => f.id)).toEqual(['robots']);
  });

  it('mirror: robots + sitemap + json-ld, not llms/markdown', () => {
    const { files } = buildFiles({ ...base, mode: 'mirror', profile: FULL });
    expect(files.filter((f) => f.status === 'ready').map((f) => f.id)).toEqual(['robots', 'sitemap', 'jsonld']);
  });

  it('amplify: everything is ready with a full profile', () => {
    const { files, profile } = buildFiles({ ...base, mode: 'amplify', profile: FULL });
    expect(profile?.name).toBe('Riverside Plumbing Co.');
    expect(files.every((f) => f.status === 'ready')).toBe(true);
    expect(byId(files, 'jsonld').content).toContain('application/ld+json');
    expect(byId(files, 'llms').content).toContain('# Riverside Plumbing Co.');
  });

  it('withholds fact-based files and names what is missing', () => {
    const { files, missing } = buildFiles({ ...base, mode: 'amplify', profile: { name: 'Acme' } });
    expect(missing).toEqual(['phone', 'address.street', 'address.city', 'address.region', 'address.postalCode']);
    for (const id of ['jsonld', 'llms', 'markdown']) {
      expect(byId(files, id).status).toBe('needs-facts');
      expect(byId(files, id).content).toBe('');
      expect(byId(files, id).missing).toContain('phone');
    }
    expect(byId(files, 'robots').status).toBe('ready'); // robots never needs facts
  });

  it('never presents a replacement when robots.txt was unreadable', () => {
    const { files } = buildFiles({ ...base, mode: 'amplify', profile: FULL, robots: { state: 'unreadable', reason: 'HTTP 403' } });
    const robots = byId(files, 'robots');
    expect(robots.warning).toMatch(/couldn't read/);
    expect(robots.content).not.toContain('User-agent: *');
    expect(robots.existing).toBeNull();
  });

  it('leaves an existing sitemap alone', () => {
    const { files } = buildFiles({ ...base, mode: 'mirror', profile: FULL, sitemap: { state: 'found', text: '<urlset></urlset>' } });
    expect(byId(files, 'sitemap').status).toBe('skipped');
    expect(byId(files, 'sitemap').existing).toBe('<urlset></urlset>');
  });

  it('skips the sitemap when robots.txt already declares one elsewhere, and does not re-declare it', () => {
    const robots = { state: 'found', text: 'Sitemap: https://example.com/sitemap/main.xml\nUser-agent: *\nAllow: /\n' } as const;
    const { files } = buildFiles({ ...base, mode: 'mirror', profile: FULL, robots });
    expect(byId(files, 'sitemap').status).toBe('skipped');
    expect(byId(files, 'sitemap').why).toContain('sitemap/main.xml');
    expect(byId(files, 'robots').content.match(/^Sitemap:/gim)).toHaveLength(1);
  });

  it('a profile with a bad phone-less address is still reported missing, not thrown', () => {
    expect(missingFields({ name: 'x', phone: ' ', address: { street: 'a', city: 'b', region: 'c', postalCode: 'd' } })).toEqual(['phone']);
  });
});

describe('sanitizeProfileInput (the request body is untrusted)', () => {
  it('keeps well-typed form fields, trimmed', () => {
    expect(sanitizeProfileInput({ name: '  Acme ', phone: '1', address: { street: 'a', city: 'b', region: 'c', postalCode: 'd' }, services: [' x ', ''], areaServed: ['y'] }))
      .toEqual({ name: 'Acme', phone: '1', address: { street: 'a', city: 'b', region: 'c', postalCode: 'd' }, services: ['x'], areaServed: ['y'] });
  });

  it('drops wrong types instead of throwing, so the page value can win', () => {
    expect(sanitizeProfileInput({ name: 123, phone: [], address: 'x', services: 'str', areaServed: { a: 1 } })).toEqual({});
    for (const junk of [null, undefined, 5, 'str', [], true]) expect(sanitizeProfileInput(junk)).toEqual({});
  });

  it('ignores fields the form never sends (hours, reviews, url, __proto__) so they cannot be injected', () => {
    const out = sanitizeProfileInput(JSON.parse('{"name":"A","hours":[{"days":["Monday"]}],"reviews":{"ratingValue":5,"reviewCount":9999},"url":"https://evil.example","__proto__":{"polluted":true}}'));
    expect(out).toEqual({ name: 'A' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('caps text length and list size', () => {
    const out = sanitizeProfileInput({ name: 'x'.repeat(5000), services: Array.from({ length: 500 }, (_, i) => `s${i}`) });
    expect(out.name).toHaveLength(300);
    expect(out.services).toHaveLength(50);
  });

  it('an empty string is kept: the user clearing a field must override the page value', () => {
    expect(sanitizeProfileInput({ phone: '' })).toEqual({ phone: '' });
  });
});
