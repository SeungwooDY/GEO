import { chromium } from 'playwright';
import { extractVisibleText } from './htmlText.js';
import { BROWSER_USER_AGENT } from './botUserAgents.js';
import type { RenderingGapReport } from './types.js';

const JS_DEPENDENT_THRESHOLD_PERCENT = 15;

export async function checkRenderingGap(url: string): Promise<RenderingGapReport> {
  const rawRes = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
  const rawHtml = await rawRes.text();
  const rawText = extractVisibleText(rawHtml);

  const browser = await chromium.launch();
  let renderedText: string;
  try {
    const page = await browser.newPage({ userAgent: BROWSER_USER_AGENT });
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    // Big sites (ads/analytics) never reach network idle; give JS a bounded window to render, then move on.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const renderedHtml = await page.content();
    renderedText = extractVisibleText(renderedHtml);
  } finally {
    await browser.close();
  }

  const rawTextLength = rawText.length;
  const renderedTextLength = renderedText.length;
  const rawFetchUsable = rawRes.status === 200 && rawTextLength > 0;
  const gapPercent =
    renderedTextLength === 0 ? 0 : Math.max(0, ((renderedTextLength - rawTextLength) / renderedTextLength) * 100);

  return {
    rawStatusCode: rawRes.status,
    rawFetchUsable,
    rawTextLength,
    renderedTextLength,
    gapPercent: Math.round(gapPercent * 10) / 10,
    jsDependent: rawFetchUsable && gapPercent >= JS_DEPENDENT_THRESHOLD_PERCENT,
  };
}
