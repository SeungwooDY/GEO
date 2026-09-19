import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_BOTS, BROWSER_USER_AGENT } from '../crawlers/botUserAgents.js';
import { extractVisibleText } from '../crawlers/htmlText.js';
import { publishAmplify } from '../generators/amplify.js';
import { MOCK_PROFILE } from '../mock-site/profile.js';
import { REAL_BUSINESS_HTML, startMockSite } from '../mock-site/server.js';
import type { DeliveryMode } from '../mode.js';
import { MemoryApprovedStore } from '../store/approvedStore.js';
import { checkFacts } from '../validation/facts.js';
import type { Judge } from '../validation/judge.js';
import { createBotVerifier } from '../verification/botIdentity.js';
import { parseCidr } from '../verification/ipRanges.js';
import { MemoryCrawlLog } from './crawlLog.js';
import { startProxy } from './node.js';
import { createTenantDirectory, type Tenant } from './tenants.js';

const judge: Judge = { id: 'fake', judge: async () => ({ verdict: 'supported', unsupportedClaims: [], omittedClaims: [] }) };
const botUa = (token: string) => AI_BOTS.find((b) => b.token === token)!.userAgent;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

const get = (url: string, ua: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { 'user-agent': ua } });

let origin: Awaited<ReturnType<typeof startMockSite>>;
let proxy: Awaited<ReturnType<typeof startProxy>>;
let mode: DeliveryMode = 'amplify';
const store = new MemoryApprovedStore();
const log = new MemoryCrawlLog();

// The local client connects from 127.0.0.1, standing in for a vendor's crawler IP. Test-only: production code has no override.
const trustingLocalhost = createBotVerifier({ getRanges: async () => [parseCidr('127.0.0.1/32')!] });
const trustingNobody = createBotVerifier({ getRanges: async () => [parseCidr('203.0.113.0/24')!] });
let verifyBot = trustingLocalhost;

beforeAll(async () => {
  origin = await startMockSite(await freePort());
  const tenant = (): Tenant => ({ id: 'riverside', hosts: ['127.0.0.1'], origin: origin.url, mode });
  proxy = await startProxy(0, {
    tenants: { byHost: () => tenant() },
    store,
    verifyBot: (ua, ip) => verifyBot(ua, ip),
    log,
  });

  const humanText = extractVisibleText(`<body>${REAL_BUSINESS_HTML}</body>`);
  const gate = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge, humanPageText: humanText });
  expect(gate.status).toBe('pass');
});

afterAll(async () => {
  await proxy.close();
  await origin.close();
});

describe('proxy in front of the mock site (real HTTP)', () => {
  it('amplify: a verified bot gets the generated page; people get the origin page untouched', async () => {
    mode = 'amplify';
    verifyBot = trustingLocalhost;

    const bot = await get(proxy.url, botUa('GPTBot'));
    expect(bot.status).toBe(200);
    expect(bot.headers.get('content-type')).toContain('text/markdown');
    expect(bot.headers.get('x-geo-served')).toBe('amplify');
    const botText = await bot.text();
    expect(botText).toContain('# Riverside Plumbing Co.');
    expect(botText).toContain('(951) 555-0142');

    const person = await get(proxy.url, BROWSER_USER_AGENT);
    const personHtml = await person.text();
    expect(person.headers.get('content-type')).toContain('text/html');
    expect(personHtml).toContain('Loading...'); // the origin's own JS-built page, unchanged
    expect(personHtml).toContain('Riverside Plumbing Co.');
  });

  it('cloaking policy end to end: the bot version asserts no fact a person cannot read on the page', async () => {
    mode = 'amplify';
    verifyBot = trustingLocalhost;
    const botText = await (await get(proxy.url, botUa('ClaudeBot'))).text();
    const humanText = extractVisibleText(`<body>${REAL_BUSINESS_HTML}</body>`);

    const result = checkFacts(botText, humanText);
    const ownUrl = MOCK_PROFILE.url!.replace(/\/+$/, '').toLowerCase();
    expect(result.added.filter((f) => !(f.kind === 'url' && f.value === ownUrl))).toEqual([]);
  });

  it('spoofing: the same bot UA from an IP outside the vendor ranges gets the ordinary site', async () => {
    mode = 'amplify';
    verifyBot = trustingNobody;
    const res = await get(proxy.url, botUa('GPTBot'));
    expect(res.headers.get('x-geo-served')).toBeNull();
    // The mock site's own (buggy) behavior for bot UAs, proving this is the origin talking, not us.
    expect(await res.text()).toContain('Welcome to our site.');
  });

  it('cloak: bots get a 403 even from a genuine vendor IP; people are unaffected', async () => {
    mode = 'cloak';
    verifyBot = trustingLocalhost;

    for (const bot of AI_BOTS.filter((b) => !b.tokenOnly)) {
      expect((await get(proxy.url, bot.userAgent)).status, bot.token).toBe(403);
    }
    const person = await get(proxy.url, BROWSER_USER_AGENT);
    expect(person.status).toBe(200);
    expect(await person.text()).toContain('Loading...');
  });

  it('serves the origin’s other paths and status codes as-is', async () => {
    mode = 'amplify';
    const missing = await get(new URL('/no-such-page', proxy.url).toString(), BROWSER_USER_AGENT);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('Not found');

    const robots = await get(new URL('/robots.txt', proxy.url).toString(), BROWSER_USER_AGENT);
    expect(await robots.text()).toContain('User-agent: ClaudeBot');
  });

  it('records what happened for the log-based diagnostics', () => {
    const botEntries = log.entries.filter((e) => e.bot !== null);
    expect(botEntries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['served-amplify', 'passthrough-unverified-bot', 'blocked']),
    );
    expect(log.entries.some((e) => e.bot === null && e.action === 'passthrough')).toBe(true);
    expect(botEntries.every((e) => e.tenant === 'riverside')).toBe(true);
  });

  it('returns 502 when the origin goes away, and serves verified bots their artifact regardless', async () => {
    mode = 'amplify';
    verifyBot = trustingLocalhost;
    const dead = await startMockSite(await freePort());
    const deadUrl = dead.url;
    await dead.close();

    const local = await startProxy(0, {
      tenants: { byHost: () => ({ id: 'riverside', hosts: ['127.0.0.1'], origin: deadUrl, mode: 'amplify' }) },
      store,
      verifyBot: (ua, ip) => verifyBot(ua, ip),
    });
    try {
      expect((await get(local.url, BROWSER_USER_AGENT)).status).toBe(502);
      expect((await get(local.url, botUa('GPTBot'))).status).toBe(200);
    } finally {
      await local.close();
    }
  });
});
