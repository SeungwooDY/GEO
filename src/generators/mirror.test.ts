import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_USER_AGENT, AI_BOTS } from '../crawlers/botUserAgents.js';
import { extractVisibleText } from '../crawlers/htmlText.js';
import { startMockSite } from '../mock-site/server.js';
import { MemoryApprovedStore } from '../store/approvedStore.js';
import { startProxy } from '../proxy/node.js';
import { createBotVerifier } from '../verification/botIdentity.js';
import { parseCidr } from '../verification/ipRanges.js';
import { publishMirror } from './mirror.js';

const key = { tenant: 'riverside', path: '/', mode: 'mirror' as const };
const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

const rendersInOrder = (...pages: string[]) => {
  let i = 0;
  return async () => pages[Math.min(i++, pages.length - 1)];
};

describe('publishMirror (fake renderer)', () => {
  const stable = page('<h1>Riverside Plumbing</h1><p>Mon-Sat 7am-7pm. Call (951) 555-0142.</p>');

  it('stores the snapshot when two renders agree', async () => {
    const store = new MemoryApprovedStore();
    const result = await publishMirror({ tenant: 'riverside', path: '/', url: 'http://x.test/', store, render: rendersInOrder(stable, stable), now: () => new Date(0) });
    expect(result.status).toBe('pass');
    expect(await store.get(key)).toEqual({ contentType: 'text/html; charset=utf-8', body: stable, approvedAt: '1970-01-01T00:00:00.000Z' });
  });

  it('rejects a capture whose facts differ from a second render of the live page', async () => {
    const store = new MemoryApprovedStore();
    const changed = page('<h1>Riverside Plumbing</h1><p>Mon-Sat 7am-9pm. Call (951) 555-0999.</p>');
    const result = await publishMirror({ tenant: 'riverside', path: '/', url: 'http://x.test/', store, render: rendersInOrder(stable, changed) });
    expect(result.status).toBe('reject');
    expect(await store.get(key)).toBeUndefined();
  });

  it('rejects a blank snapshot instead of trivially passing it', async () => {
    const store = new MemoryApprovedStore();
    const blank = page('<script>document.title="x"</script>');
    const result = await publishMirror({ tenant: 'riverside', path: '/', url: 'http://x.test/', store, render: rendersInOrder(blank, blank) });
    expect(result.status).toBe('reject');
    expect(result.reasons[0]).toContain('no visible text');
    expect(await store.get(key)).toBeUndefined();
  });

  it('a failed render leaves any earlier snapshot in place', async () => {
    const store = new MemoryApprovedStore();
    await publishMirror({ tenant: 'riverside', path: '/', url: 'http://x.test/', store, render: rendersInOrder(stable, stable) });
    const before = await store.get(key);
    await expect(
      publishMirror({ tenant: 'riverside', path: '/', url: 'http://x.test/', store, render: async () => { throw new Error('browser crashed'); } }),
    ).rejects.toThrow('browser crashed');
    expect(await store.get(key)).toEqual(before);
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

// Needs a real browser; skipped where Chromium isn't installed (`npx playwright install chromium`).
describe.runIf(existsSync(chromium.executablePath()))('publishMirror + proxy (real Chromium)', () => {
  let origin: Awaited<ReturnType<typeof startMockSite>>;
  let proxy: Awaited<ReturnType<typeof startProxy>>;
  const store = new MemoryApprovedStore();

  beforeAll(async () => {
    origin = await startMockSite(await freePort());
    proxy = await startProxy(0, {
      tenants: { byHost: () => ({ id: 'riverside', hosts: ['127.0.0.1'], origin: origin.url, mode: 'mirror' }) },
      store,
      verifyBot: createBotVerifier({ getRanges: async () => [parseCidr('127.0.0.1/32')!] }), // test-only: local client stands in for a vendor IP
    });
  }, 30000);

  afterAll(async () => {
    await proxy.close();
    await origin.close();
  });

  it('snapshots the JavaScript-built page so a bot that cannot run JS still sees the real content', async () => {
    const result = await publishMirror({ tenant: 'riverside', path: '/', url: origin.url, store });
    expect(result.status).toBe('pass');

    const raw = await (await fetch(proxy.url, { headers: { 'user-agent': BROWSER_USER_AGENT } })).text();
    expect(extractVisibleText(raw)).toBe('Loading...'); // what a non-JS reader gets from the origin

    const bot = await fetch(proxy.url, { headers: { 'user-agent': AI_BOTS.find((b) => b.token === 'GPTBot')!.userAgent } });
    expect(bot.headers.get('x-geo-served')).toBe('mirror');
    const botText = extractVisibleText(await bot.text());
    expect(botText).toContain('Riverside Plumbing Co.');
    expect(botText).toContain('(951) 555-0142');
    expect(botText).not.toContain('Loading...');
  }, 60000);
});
