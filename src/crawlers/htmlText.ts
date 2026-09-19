import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

/** Extracts human-visible text from HTML, stripping script/style/noscript so JS payloads don't count as "content". */
export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
