import { describe, expect, it, vi } from 'vitest';
import { AI_BOTS } from '../crawlers/botUserAgents.js';
import { MemoryApprovedStore } from '../store/approvedStore.js';
import type { BotVerification, BotVerifier } from '../verification/botIdentity.js';
import { MemoryCrawlLog } from './crawlLog.js';
import { handleRequest, type ProxyDeps } from './handler.js';
import { createTenantDirectory, parseTenants, type Tenant } from './tenants.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36';
const botUa = (token: string) => AI_BOTS.find((b) => b.token === token)!.userAgent;

const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
  id: 'riverside',
  hosts: ['shop.test'],
  origin: 'http://origin.test/',
  mode: 'amplify',
  ...overrides,
});

const verifiedFor = (bot: string): BotVerification => ({ claimedBot: bot, vendor: 'V', verified: true, reason: 'verified' });
const unverifiedFor = (bot: string): BotVerification => ({ claimedBot: bot, vendor: 'V', verified: false, reason: 'ip-not-in-ranges' });

/** A verifier that trusts a fixed set of IPs, mirroring how real range checks behave. */
const verifierTrusting = (trustedIp: string): BotVerifier =>
  vi.fn(async (ua: string, ip: string) => {
    const bot = AI_BOTS.find((b) => !b.tokenOnly && ua.toLowerCase().includes(b.token.toLowerCase()));
    if (!bot) return { claimedBot: null, vendor: null, verified: false, reason: 'no-bot-claimed' as const };
    return ip === trustedIp ? verifiedFor(bot.token) : unverifiedFor(bot.token);
  });

const originResponding = (body = 'origin page', init: ResponseInit = {}) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, { status: 200, ...init }));

async function setup(opts: { tenant?: Partial<Tenant>; verifyBot?: BotVerifier; fetchOrigin?: ReturnType<typeof originResponding>; withArtifact?: boolean } = {}) {
  const t = tenant(opts.tenant);
  const store = new MemoryApprovedStore();
  if (opts.withArtifact !== false) {
    for (const mode of ['amplify', 'mirror'] as const) {
      await store.put({ tenant: t.id, path: '/', mode }, { contentType: 'text/markdown', body: `${mode} artifact`, approvedAt: 'now' });
    }
  }
  const log = new MemoryCrawlLog();
  const fetchOrigin = opts.fetchOrigin ?? originResponding();
  const verifyBot = opts.verifyBot ?? verifierTrusting('198.51.100.1');
  const deps: ProxyDeps = { tenants: createTenantDirectory([t]), store, verifyBot, log, fetchOrigin: fetchOrigin as never, now: () => new Date(0) };
  const send = (path: string, ua: string, ip = '203.0.113.9', init: RequestInit = {}) =>
    handleRequest(new Request(`http://shop.test${path}`, { ...init, headers: { 'user-agent': ua, ...(init.headers as object) } }), { ip }, deps);
  return { send, store, log, fetchOrigin, verifyBot, deps };
}

describe('handleRequest: routing', () => {
  it('rejects hosts that are not a tenant', async () => {
    const { deps } = await setup();
    const res = await handleRequest(new Request('http://other.test/', { headers: { 'user-agent': BROWSER_UA } }), { ip: '1.1.1.1' }, deps);
    expect(res.status).toBe(421);
  });

  it('matches hosts regardless of port and case', async () => {
    const { deps } = await setup();
    const res = await handleRequest(new Request('http://SHOP.test:8080/', { headers: { 'user-agent': BROWSER_UA } }), { ip: '1.1.1.1' }, deps);
    expect(await res.text()).toBe('origin page');
  });

  it('passes ordinary visitors straight to the origin without any bot verification', async () => {
    const { send, verifyBot, fetchOrigin, log } = await setup();
    const res = await send('/menu?x=1', BROWSER_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('origin page');
    expect(verifyBot).not.toHaveBeenCalled();
    expect(String(fetchOrigin.mock.calls[0][0])).toBe('http://origin.test/menu?x=1');
    expect(log.entries[0]).toMatchObject({ action: 'passthrough', bot: null, verified: null, path: '/menu', status: 200 });
  });

  it('forwards visitor headers and appends the client IP, ignoring nothing the client sent', async () => {
    const { send, fetchOrigin } = await setup();
    await send('/', BROWSER_UA, '203.0.113.9', { headers: { cookie: 'a=1', 'x-forwarded-for': '9.9.9.9' } });
    const headers = new Headers(fetchOrigin.mock.calls[0][1]?.headers);
    expect(headers.get('cookie')).toBe('a=1');
    expect(headers.get('x-forwarded-for')).toBe('9.9.9.9, 203.0.113.9');
    expect(headers.get('x-forwarded-host')).toBe('shop.test');
    expect(fetchOrigin.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it("returns the origin's status and headers, dropping stale encoding/length headers", async () => {
    const fetchOrigin = originResponding('moved', { status: 301, headers: { location: '/new', 'content-encoding': 'gzip', 'content-length': '999' } });
    const { send } = await setup({ fetchOrigin });
    const res = await send('/old', BROWSER_UA);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/new');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('forwards non-GET request bodies', async () => {
    const { send, fetchOrigin } = await setup();
    await send('/contact', BROWSER_UA, '203.0.113.9', { method: 'POST', body: 'name=x' });
    const init = fetchOrigin.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.body).not.toBeNull();
  });
});

describe('handleRequest: amplify and mirror', () => {
  it.each(['amplify', 'mirror'] as const)('%s: serves the approved artifact to a verified bot without touching the origin', async (mode) => {
    const { send, fetchOrigin, log } = await setup({ tenant: { mode } });
    const res = await send('/', botUa('GPTBot'), '198.51.100.1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`${mode} artifact`);
    expect(res.headers.get('content-type')).toBe('text/markdown');
    expect(res.headers.get('vary')).toBe('User-Agent');
    expect(res.headers.get('x-geo-served')).toBe(mode);
    expect(fetchOrigin).not.toHaveBeenCalled();
    expect(log.entries[0]).toMatchObject({ action: `served-${mode}`, bot: 'GPTBot', verified: true, verifyReason: 'verified' });
  });

  it('treats a bot UA from an unverified IP as an ordinary visitor (spoof protection)', async () => {
    const { send, log } = await setup();
    const res = await send('/', botUa('GPTBot'), '203.0.113.9');
    expect(await res.text()).toBe('origin page');
    expect(log.entries[0]).toMatchObject({ action: 'passthrough-unverified-bot', bot: 'GPTBot', verified: false, verifyReason: 'ip-not-in-ranges' });
  });

  it('serves the same UA differently depending only on where it comes from', async () => {
    const { send } = await setup();
    expect(await (await send('/', botUa('ClaudeBot'), '198.51.100.1')).text()).toBe('amplify artifact');
    expect(await (await send('/', botUa('ClaudeBot'), '203.0.113.9')).text()).toBe('origin page');
  });

  it('falls through to the origin when there is no approved artifact', async () => {
    const { send, log } = await setup({ withArtifact: false });
    expect(await (await send('/', botUa('GPTBot'), '198.51.100.1')).text()).toBe('origin page');
    expect(log.entries[0].action).toBe('passthrough-no-artifact');
  });

  it('only serves artifacts for the tenant’s configured paths', async () => {
    const { send, log } = await setup();
    expect(await (await send('/pricing', botUa('GPTBot'), '198.51.100.1')).text()).toBe('origin page');
    expect(log.entries[0].action).toBe('passthrough-no-artifact');
  });

  it('treats a trailing slash on the path as the same page', async () => {
    const { send, store } = await setup({ tenant: { paths: ['/about'] } });
    await store.put({ tenant: 'riverside', path: '/about', mode: 'amplify' }, { contentType: 'text/markdown', body: 'about artifact', approvedAt: 'now' });
    expect(await (await send('/about/', botUa('GPTBot'), '198.51.100.1')).text()).toBe('about artifact');
    expect(await (await send('/about', botUa('GPTBot'), '198.51.100.1')).text()).toBe('about artifact');
  });

  it('answers HEAD without a body and leaves other methods to the origin', async () => {
    const { send, fetchOrigin } = await setup();
    const head = await send('/', botUa('GPTBot'), '198.51.100.1', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(fetchOrigin).not.toHaveBeenCalled();

    await send('/', botUa('GPTBot'), '198.51.100.1', { method: 'POST', body: 'x' });
    expect(fetchOrigin).toHaveBeenCalledTimes(1);
  });
});

describe('handleRequest: cloak', () => {
  it('blocks any request claiming to be an AI bot, without verification or contacting the origin', async () => {
    const { send, verifyBot, fetchOrigin, log } = await setup({ tenant: { mode: 'cloak' } });
    for (const bot of AI_BOTS.filter((b) => !b.tokenOnly)) {
      const res = await send('/', bot.userAgent, '203.0.113.9');
      expect(res.status, bot.token).toBe(403);
    }
    expect(verifyBot).not.toHaveBeenCalled();
    expect(fetchOrigin).not.toHaveBeenCalled();
    expect(log.entries.every((e) => e.action === 'blocked' && e.verified === null)).toBe(true);
  });

  it('blocks a bot even from a genuine vendor IP, on any method and path', async () => {
    const { send } = await setup({ tenant: { mode: 'cloak' } });
    expect((await send('/anything', botUa('GPTBot'), '198.51.100.1')).status).toBe(403);
    expect((await send('/', botUa('GPTBot'), '198.51.100.1', { method: 'POST', body: 'x' })).status).toBe(403);
  });

  it('is honest about it: a plain 403 that varies by UA, never a fake page', async () => {
    const { send } = await setup({ tenant: { mode: 'cloak' } });
    const res = await send('/', botUa('PerplexityBot'));
    expect(res.headers.get('vary')).toBe('User-Agent');
    expect(await res.text()).toContain('not permitted');
  });

  it('leaves ordinary visitors untouched', async () => {
    const { send } = await setup({ tenant: { mode: 'cloak' } });
    const res = await send('/', BROWSER_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('origin page');
  });
});

describe('handleRequest: failing open', () => {
  it('falls back to the origin when the verifier throws', async () => {
    const verifyBot: BotVerifier = vi.fn(async () => { throw new Error('verifier exploded'); });
    const { send, log } = await setup({ verifyBot });
    const res = await send('/', botUa('GPTBot'), '198.51.100.1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('origin page');
    expect(log.entries[0]).toMatchObject({ action: 'passthrough-fallback', bot: 'GPTBot' });
  });

  it('falls back to the origin when the store throws', async () => {
    const { send, store, log } = await setup();
    store.get = async () => { throw new Error('disk on fire'); };
    expect(await (await send('/', botUa('GPTBot'), '198.51.100.1')).text()).toBe('origin page');
    expect(log.entries[0].action).toBe('passthrough-fallback');
  });

  it('a throwing log never takes the request down', async () => {
    const { send, deps } = await setup();
    deps.log = { record() { throw new Error('log full'); } };
    expect((await send('/', BROWSER_UA)).status).toBe(200);
  });

  it('returns a plain 502 when the origin is down, without retrying it', async () => {
    const fetchOrigin = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { send, log } = await setup({ fetchOrigin: fetchOrigin as never });
    const res = await send('/', BROWSER_UA);
    expect(res.status).toBe(502);
    expect(fetchOrigin).toHaveBeenCalledTimes(1);
    expect(log.entries[0]).toMatchObject({ action: 'error', status: 502 });
  });

  it('still serves verified bots their artifact when the origin is down', async () => {
    const fetchOrigin = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { send } = await setup({ fetchOrigin: fetchOrigin as never });
    expect(await (await send('/', botUa('GPTBot'), '198.51.100.1')).text()).toBe('amplify artifact');
  });
});

describe('parseTenants', () => {
  const valid = { id: 't', hosts: ['a.test'], origin: 'http://o.test', mode: 'mirror' };

  it('accepts a valid tenant', () => {
    expect(parseTenants([valid])).toEqual([{ ...valid, paths: undefined }]);
  });

  it.each([
    [{ ...valid, id: '' }, 'id'],
    [{ ...valid, hosts: [] }, 'hosts'],
    [{ ...valid, origin: 'not a url' }, 'origin'],
    [{ ...valid, mode: 'stealth' }, 'mode'],
    [{ ...valid, paths: ['about'] }, 'paths'],
  ])('rejects a bad tenant (%#)', (bad, field) => {
    expect(() => parseTenants([bad])).toThrow(field);
  });
});
