import * as cheerio from 'cheerio';
import { BROWSER_USER_AGENT } from './botUserAgents.js';
import { extractVisibleText } from './htmlText.js';
import type { ContentSignalsReport } from './types.js';

// Heuristic: percentages, currency amounts, and counts with a unit ("25 years", "1,200 reviews").
const STAT_PATTERN = /\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:%|percent\b|years?\b|reviews?\b|customers?\b|clients?\b|projects?\b|jobs?\b)/gi;

/** Measures what a non-JS crawler can read: everything is computed from the raw HTML, not the rendered page. */
export async function checkContentSignals(url: string, userAgent = BROWSER_USER_AGENT): Promise<ContentSignalsReport> {
  const started = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  const html = await res.text();
  return analyzeContent(url, html, res.status, res.headers.get('last-modified'), Date.now() - started);
}

export function analyzeContent(
  url: string,
  html: string,
  statusCode: number,
  lastModifiedHeader: string | null,
  responseTimeMs: number,
): ContentSignalsReport {
  const $ = cheerio.load(html);
  const text = extractVisibleText(html);
  const wordCount = text ? text.split(/\s+/).length : 0;

  const pageHost = new URL(url).hostname;
  const outboundHosts = new Set<string>();
  $('a[href]').each((_, el) => {
    try {
      const host = new URL($(el).attr('href') ?? '', url).hostname;
      if (host && host !== pageHost) outboundHosts.add(host);
    } catch {
      // unparseable href; ignore
    }
  });

  const questionHeadings = $('h2, h3, h4')
    .toArray()
    .filter((el) => $(el).text().trim().endsWith('?')).length;

  return {
    fetchUsable: statusCode === 200 && wordCount > 0,
    statusCode,
    responseTimeMs,
    htmlBytes: Buffer.byteLength(html),
    wordCount,
    textToHtmlRatio: html.length === 0 ? 0 : Math.round((text.length / html.length) * 1000) / 1000,
    h1Count: $('h1').length,
    h2Count: $('h2').length,
    h3Count: $('h3').length,
    statCount: (text.match(STAT_PATTERN) ?? []).length,
    quoteCount: $('blockquote, q').length,
    outboundLinkHosts: outboundHosts.size,
    questionHeadings,
    lastModifiedHeader,
  };
}
