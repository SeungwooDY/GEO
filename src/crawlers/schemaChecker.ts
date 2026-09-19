import * as cheerio from 'cheerio';
import { BROWSER_USER_AGENT } from './botUserAgents.js';
import { extractVisibleText } from './htmlText.js';
import type { SchemaReport } from './types.js';

// Fields that matter for local-business citation; "hours" is satisfied by either hours property.
const LOCAL_FIELDS: Record<string, string[]> = {
  name: ['name'],
  address: ['address'],
  telephone: ['telephone'],
  hours: ['openingHours', 'openingHoursSpecification'],
  geo: ['geo'],
  sameAs: ['sameAs'],
  url: ['url'],
  image: ['image'],
  priceRange: ['priceRange'],
};

function walk(json: unknown, types: Set<string>, keys: Set<string>, phones: string[]): void {
  if (Array.isArray(json)) {
    for (const entry of json) walk(entry, types, keys, phones);
    return;
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (typeof obj['@type'] === 'string') types.add(obj['@type']);
    else if (Array.isArray(obj['@type'])) obj['@type'].forEach((t) => typeof t === 'string' && types.add(t));
    for (const [key, value] of Object.entries(obj)) {
      keys.add(key);
      if (key === 'telephone' && typeof value === 'string') phones.push(value);
    }
    if (Array.isArray(obj['@graph'])) walk(obj['@graph'], types, keys, phones);
  }
}

const digitsOnly = (s: string) => s.replace(/\D/g, '');

export async function checkSchema(url: string, userAgent = BROWSER_USER_AGENT): Promise<SchemaReport> {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  return analyzeSchema(await res.text(), res.status);
}

export function analyzeSchema(html: string, statusCode: number): SchemaReport {
  const $ = cheerio.load(html);

  const blocks = $('script[type="application/ld+json"]');
  const types = new Set<string>();
  const keys = new Set<string>();
  const phones: string[] = [];

  blocks.each((_, el) => {
    const raw = $(el).contents().text();
    try {
      walk(JSON.parse(raw), types, keys, phones);
    } catch {
      // malformed JSON-LD block; ignore for presence purposes
    }
  });

  const present = Object.keys(LOCAL_FIELDS).filter((field) => LOCAL_FIELDS[field].some((k) => keys.has(k)));
  const missing = Object.keys(LOCAL_FIELDS).filter((field) => !present.includes(field));

  const telephone = phones[0] ?? null;
  const telDigits = telephone ? digitsOnly(telephone) : '';
  const visibleDigits = digitsOnly(extractVisibleText(html));

  return {
    fetchUsable: statusCode === 200 && html.trim().length > 0,
    statusCode,
    found: blocks.length > 0,
    types: [...types],
    blockCount: blocks.length,
    fieldCompleteness: {
      present,
      missing,
      percent: Math.round((present.length / Object.keys(LOCAL_FIELDS).length) * 100),
    },
    telephone,
    // Compare on the last 10 digits so "+1-951-555-0142" matches "(951) 555-0142".
    telephoneInVisibleText: telDigits ? visibleDigits.includes(telDigits.slice(-10)) : null,
  };
}
