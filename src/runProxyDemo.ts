import { AI_BOTS, BROWSER_USER_AGENT } from './crawlers/botUserAgents.js';
import { extractVisibleText } from './crawlers/htmlText.js';
import { renderPage } from './crawlers/renderPage.js';
import { publishAmplify } from './generators/amplify.js';
import { publishMirror } from './generators/mirror.js';
import { MOCK_PROFILE } from './mock-site/profile.js';
import { startMockSite } from './mock-site/server.js';
import type { DeliveryMode } from './mode.js';
import { MemoryCrawlLog } from './proxy/crawlLog.js';
import { startProxy } from './proxy/node.js';
import { MemoryApprovedStore } from './store/approvedStore.js';
import { cachedJudge, createAnthropicJudge, MemoryJudgeCache, type Judge } from './validation/judge.js';
import { createBotVerifier } from './verification/botIdentity.js';
import { parseCidr } from './verification/ipRanges.js';

/**
 * Side-by-side demo of the Phase 2 proxy against the deliberately flawed mock site: for each delivery mode,
 * what a person, a verified AI bot and a spoofed AI bot each receive.
 *
 * Verification lanes:
 *  - "verified": the local client stands in for OpenAI's crawler, so the demo adds 127.0.0.1 to the ranges (simulated).
 *  - "spoofed":  the same GPTBot UA checked against OpenAI's REAL published ranges, fetched live. 127.0.0.1 isn't in them.
 */

const GPTBOT = AI_BOTS.find((b) => b.token === 'GPTBot')!;
const ORIGIN_PORT = 4173;

const summarize = (text: string) => {
  const t = extractVisibleText(text.includes('<') ? text : `<body>${text}</body>`);
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
};

async function main() {
  const origin = await startMockSite(ORIGIN_PORT);
  const store = new MemoryApprovedStore();
  const log = new MemoryCrawlLog();
  let mode: DeliveryMode = 'amplify';

  try {
    console.log(`\nGEO Phase 2 proxy demo (origin: ${origin.url})\n${'='.repeat(60)}`);

    // Publish: everything the proxy will ever serve to a bot has been through the gate first.
    const humanText = extractVisibleText(await renderPage(origin.url));
    const useJudge = Boolean(process.env.ANTHROPIC_API_KEY);
    const judge: Judge | undefined = useJudge ? cachedJudge(createAnthropicJudge(), new MemoryJudgeCache()) : undefined;

    const amplify = await publishAmplify({ tenant: 'riverside', path: '/', profile: MOCK_PROFILE, store, judge, humanPageText: humanText, requireJudge: useJudge });
    console.log(`\n[publish amplify] gate=${amplify.status.toUpperCase()}  layer 1 (facts + human page): ${amplify.layer1.ok ? 'ok' : 'FAILED'}  layer 2 (LLM judge): ${useJudge ? amplify.layer2?.verdict ?? 'n/a' : 'SKIPPED (set ANTHROPIC_API_KEY)'}`);
    for (const reason of amplify.reasons) console.log(`  - ${reason}`);

    const mirror = await publishMirror({ tenant: 'riverside', path: '/', url: origin.url, store });
    console.log(`[publish mirror]  gate=${mirror.status.toUpperCase()}  (snapshot of the rendered page, checked against a second render)`);

    const tenants = { byHost: () => ({ id: 'riverside', hosts: ['127.0.0.1'], origin: origin.url, mode }) };
    const simulatedVerified = createBotVerifier({
      getRanges: async () => [parseCidr('127.0.0.1/32')!],
    });
    const realVerifier = createBotVerifier();

    const asVerifiedBot = await startProxy(0, { tenants, store, log, verifyBot: simulatedVerified });
    const asSpoofedBot = await startProxy(0, { tenants, store, log, verifyBot: realVerifier });

    const lanes: Array<{ label: string; url: string; ua: string }> = [
      { label: 'Person (browser UA)        ', url: asVerifiedBot.url, ua: BROWSER_USER_AGENT },
      { label: 'GPTBot, verified IP (sim.) ', url: asVerifiedBot.url, ua: GPTBOT.userAgent },
      { label: 'GPTBot UA, real ranges     ', url: asSpoofedBot.url, ua: GPTBOT.userAgent },
    ];

    for (const m of ['amplify', 'mirror', 'cloak'] as const) {
      mode = m;
      console.log(`\n--- mode: ${m.toUpperCase()} ${'-'.repeat(48 - m.length)}`);
      for (const lane of lanes) {
        const res = await fetch(lane.url, { headers: { 'user-agent': lane.ua } });
        const served = res.headers.get('x-geo-served');
        const from = served ? `[served: ${served}]` : m === 'cloak' && res.status === 403 ? '[blocked]     ' : '[origin]      ';
        console.log(`  ${lane.label} ${String(res.status).padEnd(4)} ${from} ${summarize(await res.text())}`);
      }
    }

    const last = log.entries.filter((e) => e.bot).slice(-1)[0];
    console.log(`\nCrawl log: ${log.entries.length} requests recorded; last bot entry: ${JSON.stringify({ action: last?.action, verified: last?.verified, reason: last?.verifyReason })}`);
    console.log('Notes:');
    console.log('  - "Person" shows the origin\'s raw HTML ("Loading..."); a real browser runs the page\'s JavaScript and sees the full business page.');
    console.log('  - The "real ranges" lane fetches OpenAI\'s published IP list live; if offline it reports ranges-unavailable and fails closed.\n');

    await asVerifiedBot.close();
    await asSpoofedBot.close();
  } finally {
    await origin.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
