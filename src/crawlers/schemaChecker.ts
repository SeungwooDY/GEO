import * as cheerio from 'cheerio';
import { BROWSER_USER_AGENT } from './botUserAgents.js';
import type { SchemaReport } from './types.js';

function collectTypes(json: unknown, types: Set<string>): void {
  if (Array.isArray(json)) {
    for (const entry of json) collectTypes(entry, types);
    return;
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (typeof obj['@type'] === 'string') types.add(obj['@type']);
    else if (Array.isArray(obj['@type'])) obj['@type'].forEach((t) => typeof t === 'string' && types.add(t));
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], types);
  }
}

export async function checkSchema(url: string): Promise<SchemaReport> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const blocks = $('script[type="application/ld+json"]');
  const types = new Set<string>();

  blocks.each((_, el) => {
    const raw = $(el).contents().text();
    try {
      collectTypes(JSON.parse(raw), types);
    } catch {
      // malformed JSON-LD block; ignore for presence purposes
    }
  });

  return {
    fetchUsable: res.status === 200 && html.trim().length > 0,
    statusCode: res.status,
    found: blocks.length > 0,
    types: [...types],
    blockCount: blocks.length,
  };
}
