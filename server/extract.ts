/**
 * Page extraction for the Suggested Files feature. Reads facts a site already publishes
 * (JSON-LD, tel: links, title/meta) so the business form can be pre-filled. It never invents
 * a value: a field with no evidence stays empty and is reported as missing.
 *
 * `parsePage` is pure (HTML in, facts out) so it can be tested without a network.
 */
import * as cheerio from 'cheerio';
import { BROWSER_USER_AGENT } from '../src/crawlers/botUserAgents.js';
import { extractVisibleText } from '../src/crawlers/htmlText.js';
import { renderPage } from '../src/crawlers/renderPage.js';
import { DAYS, type BusinessProfile, type Day, type HoursEntry } from '../src/generators/businessProfile.js';

export type FileState = { state: 'found'; text: string } | { state: 'absent' } | { state: 'unreadable'; reason: string };

export interface PageFacts {
  profile: Partial<BusinessProfile>;
  /** field -> where it was found ("JSON-LD", "tel: link", "page title") */
  evidence: Record<string, string>;
  links: string[];
}

export interface PageExtract extends PageFacts {
  source: 'raw' | 'rendered' | 'unreadable';
  robots: FileState;
  sitemap: FileState;
  llms: FileState;
}

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mp3|woff2?|ttf|otf|txt)$/i;
const MAX_LINKS = 50;

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Flattens JSON-LD (single objects, arrays, and @graph) into a list of nodes. */
function jsonLdNodes($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      for (const item of asArray<Record<string, unknown>>(parsed)) {
        if (item && typeof item === 'object') {
          nodes.push(item);
          for (const g of asArray<Record<string, unknown>>(item['@graph'] as Record<string, unknown>[])) if (g && typeof g === 'object') nodes.push(g);
        }
      }
    } catch {
      /* malformed JSON-LD block: ignore, it is evidence of nothing */
    }
  });
  return nodes;
}

const BUSINESS_TYPE = /(LocalBusiness|Organization|Store|Restaurant|Dentist|Physician|Plumber|Electrician|Attorney|Service|Contractor|Salon|Clinic|Hotel|Shop|Firm|Company)/i;

function pickBusinessNode(nodes: Record<string, unknown>[]): Record<string, unknown> | null {
  const typed = nodes.filter((n) => asArray(n['@type'] as string | string[]).some((t) => BUSINESS_TYPE.test(String(t))));
  const rich = typed.find((n) => n.address || n.telephone);
  return rich ?? typed[0] ?? null;
}

function dayName(raw: string): Day | null {
  const tail = raw.split('/').pop() ?? raw; // "https://schema.org/Monday" -> "Monday"
  const match = DAYS.find((d) => d.toLowerCase() === tail.trim().toLowerCase());
  return match ?? null;
}

function hhmm(raw: unknown): string | null {
  const m = String(raw ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return h > 23 ? null : `${String(h).padStart(2, '0')}:${m[2]}`;
}

function parseHours(node: Record<string, unknown>): HoursEntry[] {
  const out: HoursEntry[] = [];
  for (const spec of asArray<Record<string, unknown>>(node.openingHoursSpecification as Record<string, unknown>[])) {
    const days = asArray<string>(spec?.dayOfWeek as string[]).map(dayName).filter((d): d is Day => d !== null);
    const opens = hhmm(spec?.opens);
    const closes = hhmm(spec?.closes);
    if (days.length && opens && closes) out.push({ days, opens, closes });
  }
  return out;
}

function nameOf(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') return str((v as Record<string, unknown>).name);
  return '';
}

/** Pulls every fact the page itself states. Missing facts are simply absent from `profile`. */
export function parsePage(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const profile: Partial<BusinessProfile> = {};
  const evidence: Record<string, string> = {};
  const origin = new URL(pageUrl).origin;

  const node = pickBusinessNode(jsonLdNodes($));
  if (node) {
    const name = str(node.name);
    if (name) { profile.name = name; evidence.name = 'JSON-LD'; }
    const phone = str(node.telephone);
    if (phone) { profile.phone = phone; evidence.phone = 'JSON-LD'; }

    const addr = node.address as Record<string, unknown> | string | undefined;
    if (addr && typeof addr === 'object') {
      const address = {
        street: str(addr.streetAddress), city: str(addr.addressLocality),
        region: str(addr.addressRegion), postalCode: str(addr.postalCode),
      };
      if (Object.values(address).some(Boolean)) {
        profile.address = address;
        evidence.address = 'JSON-LD';
      }
    }

    const services = asArray<Record<string, unknown>>(node.makesOffer as Record<string, unknown>[])
      .map((o) => nameOf((o as Record<string, unknown>)?.itemOffered)).filter(Boolean);
    if (services.length) { profile.services = services; evidence.services = 'JSON-LD'; }

    const areas = asArray<unknown>(node.areaServed as unknown[]).map(nameOf).filter(Boolean);
    if (areas.length) { profile.areaServed = areas; evidence.areaServed = 'JSON-LD'; }

    const hours = parseHours(node);
    if (hours.length) { profile.hours = hours; evidence.hours = 'JSON-LD'; }

    const rating = node.aggregateRating as Record<string, unknown> | undefined;
    const rv = Number(rating?.ratingValue);
    const rc = Number(rating?.reviewCount ?? rating?.ratingCount);
    if (rating && rv >= 0 && rv <= 5 && Number.isInteger(rc) && rc >= 0) {
      profile.reviews = { ratingValue: rv, reviewCount: rc };
      evidence.reviews = 'JSON-LD';
    }
  }

  if (!profile.phone) {
    const tel = $('a[href^="tel:"]').first().attr('href');
    const digits = tel?.replace(/^tel:/i, '').trim();
    if (digits) { profile.phone = decodeURIComponent(digits); evidence.phone = 'tel: link'; }
  }
  if (!profile.name) {
    const site = $('meta[property="og:site_name"]').attr('content')?.trim();
    const title = $('title').first().text().split(/[|\-–—·]/)[0]?.trim();
    if (site) { profile.name = site; evidence.name = 'og:site_name'; }
    else if (title) { profile.name = title; evidence.name = 'page title'; }
  }

  // same-origin internal links, home first, tracking noise removed
  const seen = new Set<string>([`${origin}/`]);
  const links: string[] = [`${origin}/`];
  $('a[href]').each((_, el) => {
    if (links.length >= MAX_LINKS) return;
    try {
      const u = new URL($(el).attr('href') ?? '', pageUrl);
      if (u.origin !== origin || SKIP_EXT.test(u.pathname)) return;
      u.hash = ''; u.search = '';
      const href = u.toString();
      if (!seen.has(href)) { seen.add(href); links.push(href); }
    } catch { /* unparseable href */ }
  });

  profile.url = `${origin}/`;
  return { profile, evidence, links };
}

// ---------- network ----------

async function get(url: string, ms = 15000): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_USER_AGENT, accept: '*/*' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

const UNREADABLE = new Set([401, 403, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/** Fetches a site-root file. "absent" only when the site answered and it isn't there; a firewall or network error is "unreadable". */
export async function fetchSiteFile(origin: string, path: string, looksValid: (t: string) => boolean): Promise<FileState> {
  const res = await get(`${origin}${path}`, 8000);
  if (!res) return { state: 'unreadable', reason: 'request failed' };
  if (UNREADABLE.has(res.status)) return { state: 'unreadable', reason: `HTTP ${res.status}` };
  if (res.status >= 200 && res.status < 300 && looksValid(res.text)) return { state: 'found', text: res.text };
  return { state: 'absent' };
}

export const looksLikeRobots = (t: string) => /(user-agent|disallow|allow|sitemap)\s*:/i.test(t);
export const looksLikeSitemap = (t: string) => /<(urlset|sitemapindex)[\s>]/i.test(t);
// llms.txt is freeform text; the check that matters is rejecting an SPA's index.html served as a
// 200 fallback for every unknown path — which would otherwise read as "found".
export const looksLikeLlms = (t: string) => t.trim().length > 0 && !/<(!doctype|html|head|script)[\s>]/i.test(t);

/** Reads the page (raw first, headless render if it's a JS shell), then the site's existing robots.txt, sitemap.xml and llms.txt. */
export async function fetchExtract(url: string): Promise<PageExtract> {
  const origin = new URL(url).origin;
  const [raw, robots, sitemap, llms] = await Promise.all([
    get(url),
    fetchSiteFile(origin, '/robots.txt', looksLikeRobots),
    fetchSiteFile(origin, '/sitemap.xml', looksLikeSitemap),
    fetchSiteFile(origin, '/llms.txt', looksLikeLlms),
  ]);

  let html = raw && raw.status < 400 ? raw.text : '';
  let source: PageExtract['source'] = html ? 'raw' : 'unreadable';

  const thin = html ? extractVisibleText(html).length < 400 && !/application\/ld\+json/i.test(html) : true;
  if (thin) {
    try {
      const rendered = await Promise.race([
        renderPage(url),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('render timeout')), 30000)),
      ]);
      if (extractVisibleText(rendered).length > extractVisibleText(html).length) { html = rendered; source = 'rendered'; }
    } catch { /* no Chromium, or blocked: keep whatever the raw fetch gave us */ }
  }

  const facts = html ? parsePage(html, url) : { profile: { url: `${origin}/` } as Partial<BusinessProfile>, evidence: {}, links: [`${origin}/`] };
  return { ...facts, source, robots, sitemap, llms };
}
