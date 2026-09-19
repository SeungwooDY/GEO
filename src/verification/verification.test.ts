import { describe, expect, it, vi } from 'vitest';
import { AI_BOTS } from '../crawlers/botUserAgents.js';
import { createBotVerifier, createRangeProvider, detectClaimedBot } from './botIdentity.js';
import { ipInCidr, parseCidr, parseIp, parsePrefixFile } from './ipRanges.js';

const inCidr = (ip: string, cidr: string) => ipInCidr(parseIp(ip)!, parseCidr(cidr)!);

describe('parseIp', () => {
  it('parses IPv4 and IPv6 forms', () => {
    expect(parseIp('132.196.86.5')).toEqual({ version: 4, value: 0x84c45605n });
    expect(parseIp('2001:4860:4801:10::1')?.version).toBe(6);
    expect(parseIp('::1')).toEqual({ version: 6, value: 1n });
    expect(parseIp('fe80::1%eth0')?.version).toBe(6);
  });

  it('treats IPv4-mapped IPv6 (what Node reports on dual-stack sockets) as IPv4', () => {
    expect(parseIp('::ffff:132.196.86.5')).toEqual(parseIp('132.196.86.5'));
    expect(parseIp('::ffff:84c4:5605')).toEqual(parseIp('132.196.86.5'));
  });

  it.each(['', 'nope', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.999', '1::2::3', '12345::1', ':::', '1:2:3:4:5:6:7:8:9'])(
    'rejects %j',
    (bad) => expect(parseIp(bad)).toBeNull(),
  );
});

describe('ipInCidr', () => {
  it('matches IPv4 ranges at the boundaries', () => {
    expect(inCidr('132.196.86.0', '132.196.86.0/24')).toBe(true);
    expect(inCidr('132.196.86.255', '132.196.86.0/24')).toBe(true);
    expect(inCidr('132.196.87.0', '132.196.86.0/24')).toBe(false);
    expect(inCidr('216.73.219.255', '216.73.216.0/22')).toBe(true);
    expect(inCidr('216.73.220.0', '216.73.216.0/22')).toBe(false);
  });

  it('handles /32, /0 and a bare address', () => {
    expect(inCidr('3.224.62.45', '3.224.62.45/32')).toBe(true);
    expect(inCidr('3.224.62.46', '3.224.62.45/32')).toBe(false);
    expect(inCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
    expect(inCidr('3.224.62.45', '3.224.62.45')).toBe(true);
  });

  it('matches IPv6 and never matches across versions', () => {
    expect(inCidr('2001:4860:4801:10::abcd', '2001:4860:4801:10::/64')).toBe(true);
    expect(inCidr('2001:4860:4801:11::1', '2001:4860:4801:10::/64')).toBe(false);
    expect(inCidr('1.2.3.4', '2001:4860:4801:10::/64')).toBe(false);
    expect(inCidr('2001:4860:4801:10::1', '0.0.0.0/0')).toBe(false);
  });

  it('rejects malformed CIDRs', () => {
    for (const bad of ['1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/x', '1.2.3.4/8/8', 'foo/8']) expect(parseCidr(bad)).toBeNull();
  });
});

describe('parsePrefixFile', () => {
  it('reads both prefix kinds and skips junk entries', () => {
    const cidrs = parsePrefixFile({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }, { ipv6Prefix: '2001:db8::/32' }, { ipv4Prefix: 'bad' }, {}, null, 7] });
    expect(cidrs).toHaveLength(2);
  });

  it('returns nothing for the wrong shape', () => {
    expect(parsePrefixFile(null)).toEqual([]);
    expect(parsePrefixFile({ prefixes: 'x' })).toEqual([]);
  });
});

describe('detectClaimedBot', () => {
  it('finds a bot by token, case-insensitively', () => {
    expect(detectClaimedBot(AI_BOTS.find((b) => b.token === 'GPTBot')!.userAgent)?.token).toBe('GPTBot');
    expect(detectClaimedBot('something perplexitybot/1.0')?.token).toBe('PerplexityBot');
  });

  it('keeps look-alike tokens distinct', () => {
    expect(detectClaimedBot('Mozilla/5.0 (compatible; Claude-SearchBot/1.0)')?.token).toBe('Claude-SearchBot');
    expect(detectClaimedBot('Mozilla/5.0 (compatible; ClaudeBot/1.0)')?.token).toBe('ClaudeBot');
    expect(detectClaimedBot('Mozilla/5.0 (compatible; OAI-SearchBot/1.4)')?.token).toBe('OAI-SearchBot');
  });

  it('does not treat ordinary browsers or token-only bots as claims', () => {
    expect(detectClaimedBot('Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36')).toBeNull();
    expect(detectClaimedBot('Mozilla/5.0 (compatible; Google-Extended)')).toBeNull();
    expect(detectClaimedBot('')).toBeNull();
  });

  it('every fetchable bot has a documented range source (otherwise it could never be verified)', () => {
    for (const bot of AI_BOTS.filter((b) => !b.tokenOnly)) expect(bot.ipRangeUrls?.length, bot.token).toBeGreaterThan(0);
  });
});

// Fixture ranges lifted from the real vendor files.
const FILES: Record<string, object> = {
  'https://openai.com/gptbot.json': { prefixes: [{ ipv4Prefix: '132.196.86.0/24' }] },
  'https://openai.com/searchbot.json': { prefixes: [{ ipv4Prefix: '13.66.216.176/28' }] },
  'https://claude.com/crawling/bots.json': { prefixes: [{ ipv4Prefix: '216.73.216.0/22' }, { ipv4Prefix: '34.162.230.222/32' }] },
  'https://www.perplexity.com/perplexitybot.json': { prefixes: [{ ipv4Prefix: '3.224.62.45/32' }] },
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(files: Record<string, object> = FILES) {
  return vi.fn(async (url: string | URL | Request) => {
    const body = files[String(url)];
    return body ? jsonResponse(body) : new Response('missing', { status: 404 });
  });
}

const uaFor = (token: string) => AI_BOTS.find((b) => b.token === token)!.userAgent;

describe('createBotVerifier', () => {
  it('verifies a claimed bot whose IP is in its vendor ranges', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    expect(await verify(uaFor('GPTBot'), '132.196.86.9')).toMatchObject({ claimedBot: 'GPTBot', vendor: 'OpenAI', verified: true, reason: 'verified' });
    expect((await verify(uaFor('PerplexityBot'), '3.224.62.45')).verified).toBe(true);
  });

  it('rejects a spoofed UA coming from an IP outside the ranges', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    expect(await verify(uaFor('GPTBot'), '203.0.113.7')).toMatchObject({ claimedBot: 'GPTBot', verified: false, reason: 'ip-not-in-ranges' });
  });

  it("rejects one vendor's real IP claiming to be another vendor's bot", async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    expect((await verify(uaFor('ClaudeBot'), '132.196.86.9')).verified).toBe(false);
    expect((await verify(uaFor('GPTBot'), '216.73.216.10')).verified).toBe(false);
  });

  it('verifies all Anthropic bots against the shared list', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    for (const token of ['ClaudeBot', 'Claude-User', 'Claude-SearchBot']) {
      expect((await verify(uaFor(token), '216.73.217.1')).verified, token).toBe(true);
    }
  });

  it('accepts the IPv4-mapped form Node reports for IPv4 clients', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    expect((await verify(uaFor('GPTBot'), '::ffff:132.196.86.9')).verified).toBe(true);
  });

  it('reports no claim for ordinary browsers and never fetches ranges for them', async () => {
    const fetchFn = fakeFetch();
    const verify = createBotVerifier({ fetchFn: fetchFn as never });
    expect(await verify('Mozilla/5.0 Chrome/128', '132.196.86.9')).toMatchObject({ claimedBot: null, verified: false, reason: 'no-bot-claimed' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an unparseable IP', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never });
    expect((await verify(uaFor('GPTBot'), 'not-an-ip')).reason).toBe('invalid-ip');
  });

  it('fails closed when ranges cannot be fetched', async () => {
    const down = vi.fn(async () => new Response('nope', { status: 503 }));
    const verify = createBotVerifier({ fetchFn: down as never });
    expect(await verify(uaFor('GPTBot'), '132.196.86.9')).toMatchObject({ verified: false, reason: 'ranges-unavailable' });
  });

  it('fails closed on a range file that parses to nothing', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch({ 'https://openai.com/gptbot.json': { prefixes: [] } }) as never });
    expect((await verify(uaFor('GPTBot'), '132.196.86.9')).reason).toBe('ranges-unavailable');
  });

  it('cannot verify a bot with no published ranges', async () => {
    const verify = createBotVerifier({ fetchFn: fakeFetch() as never, bots: [{ token: 'MysteryBot', userAgent: 'MysteryBot/1', vendor: 'X' }] });
    expect((await verify('MysteryBot/1', '132.196.86.9')).reason).toBe('no-published-ranges');
  });
});

describe('createRangeProvider caching', () => {
  const URL_ = 'https://openai.com/gptbot.json';

  it('fetches once within the TTL and refreshes after it', async () => {
    let clock = 0;
    const fetchFn = fakeFetch();
    const get = createRangeProvider({ fetchFn: fetchFn as never, ttlMs: 1000, now: () => clock });
    await get(URL_);
    clock = 999;
    await get(URL_);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock = 1000;
    await get(URL_);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps serving stale ranges when a refresh fails, and recovers later', async () => {
    let clock = 0;
    let healthy = true;
    const fetchFn = vi.fn(async () => (healthy ? jsonResponse(FILES[URL_]) : new Response('x', { status: 500 })));
    const get = createRangeProvider({ fetchFn: fetchFn as never, ttlMs: 1000, now: () => clock });

    expect(await get(URL_)).toHaveLength(1);
    healthy = false;
    clock = 5000;
    expect(await get(URL_)).toHaveLength(1); // stale, not dropped
    healthy = true;
    clock = 6000;
    expect(await get(URL_)).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns null when nothing was ever fetched successfully', async () => {
    const get = createRangeProvider({ fetchFn: vi.fn(async () => { throw new Error('offline'); }) as never });
    expect(await get(URL_)).toBeNull();
  });
});

// Hits the real vendor endpoints; opt in with GEO_LIVE_TESTS=1.
describe.runIf(process.env.GEO_LIVE_TESTS)('live vendor range files', () => {
  it.each(AI_BOTS.filter((b) => !b.tokenOnly).flatMap((b) => (b.ipRangeUrls ?? []).map((url) => [b.token, url] as const)))(
    '%s range file is reachable and parses',
    async (_token, url) => {
      const cidrs = await createRangeProvider()(url);
      expect(cidrs?.length).toBeGreaterThan(0);
    },
  );
});
