import { AI_BOTS, BROWSER_USER_AGENT, fetchableBots } from './botUserAgents.js';
import { extractVisibleText, hashText } from './htmlText.js';
import { detectWafChallenge } from './wafDetection.js';
import type { UaDiffReport, UaDiffResult } from './types.js';

async function fetchAs(url: string, userAgent: string) {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  const body = await res.text();
  return { statusCode: res.status, headers: res.headers, body };
}

export async function checkUaDiff(url: string): Promise<UaDiffReport> {
  const baselineRaw = await fetchAs(url, BROWSER_USER_AGENT);
  const baselineText = extractVisibleText(baselineRaw.body);
  const baseline = {
    statusCode: baselineRaw.statusCode,
    contentLength: baselineRaw.body.length,
    textHash: hashText(baselineText),
  };
  const baselineUsable = baselineRaw.statusCode === 200 && baselineText.length > 0;

  const perBot: UaDiffResult[] = await Promise.all(
    fetchableBots(AI_BOTS).map(async (bot): Promise<UaDiffResult> => {
      try {
        const { statusCode, headers, body } = await fetchAs(url, bot.userAgent);
        const text = extractVisibleText(body);
        const textHash = hashText(text);
        // A WAF challenge means our (unverified-by-definition) probe was intercepted before
        // reaching the origin — it is neither a block nor cloaking evidence.
        const waf = detectWafChallenge(statusCode, headers, body);
        const blocked =
          !waf.challenged &&
          (statusCode === 403 || statusCode === 404 || statusCode === 429 || body.length === 0);

        return {
          bot: bot.token,
          vendor: bot.vendor,
          statusCode,
          contentLength: body.length,
          textHash,
          // Flag as cloaking risk only when both sides actually returned content but it differs in substance.
          substanceMismatch: !waf.challenged && !blocked && baselineUsable && textHash !== baseline.textHash,
          blocked,
          challenged: waf.challenged,
          challengedBy: waf.vendor,
          error: null,
        };
      } catch (err) {
        return {
          bot: bot.token,
          vendor: bot.vendor,
          statusCode: null,
          contentLength: 0,
          textHash: null,
          substanceMismatch: false,
          blocked: true,
          challenged: false,
          challengedBy: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { baseline, baselineUsable, perBot };
}
