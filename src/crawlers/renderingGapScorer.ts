import { extractVisibleText } from './htmlText.js';
import { BROWSER_USER_AGENT } from './botUserAgents.js';
import { renderPage } from './renderPage.js';
import type { RenderingGapReport } from './types.js';

const JS_DEPENDENT_THRESHOLD_PERCENT = 15;

export async function checkRenderingGap(url: string): Promise<RenderingGapReport> {
  const rawRes = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
  const rawHtml = await rawRes.text();
  const rawText = extractVisibleText(rawHtml);

  const renderedText = extractVisibleText(await renderPage(url));

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
