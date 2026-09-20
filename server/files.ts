/**
 * Builds the "suggested files" for a scanned URL, entirely from the engine's own generators
 * plus two small, dependency-free additions the engine lacks (robots merge, sitemap).
 *
 * Honesty rules, inherited from the engine and PLAN.md:
 *  - A file that needs business facts (llms.txt, JSON-LD, markdown) is only generated when the
 *    profile validates. Otherwise it is returned as `needs-facts` listing exactly what is missing.
 *  - Nothing is fabricated: no lastmod dates, no guessed contact addresses, no placeholder files.
 *  - If we could not READ the site's current robots.txt (firewall, timeout), we never present a
 *    "replacement"; we hand back only the AI-bot section to merge by hand.
 */
import { AI_BOTS } from '../src/crawlers/botUserAgents.js';
import { generateAiBotRobots, generateLlmsTxt } from '../src/generators/configGenerator.js';
import { generateSchema, renderJsonLdScript } from '../src/generators/schemaGenerator.js';
import { generateMarkdown } from '../src/generators/markdownGenerator.js';
import { parseBusinessProfile, type BusinessProfile } from '../src/generators/businessProfile.js';
import type { DeliveryMode } from '../src/mode.js';
import type { FileState } from './extract.js';

export type FileStatus = 'ready' | 'needs-facts' | 'skipped';
export type FileKind = 'text' | 'xml' | 'html' | 'markdown';

export interface SuggestedFile {
  id: string;
  name: string;
  kind: FileKind;
  status: FileStatus;
  /** One sentence: what this file does for this exposure mode. */
  why: string;
  /** Where it goes on the site. */
  howTo: string;
  content: string;
  /** The site's current version, when we could read one (drives the diff). */
  existing: string | null;
  /** Profile fields still needed (status === 'needs-facts'). */
  missing: string[];
  warning?: string;
}

const AI_TOKENS = new Set(AI_BOTS.map((b) => b.token.toLowerCase()));

// ---------- robots.txt ----------

interface Block { lines: string[]; uas: string[]; hasRules: boolean }

/** Removes robots.txt groups that address only AI bots, leaving every other rule (and comments) intact. */
export function stripAiGroups(text: string): string {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [{ lines: [], uas: [], hasRules: false }];

  for (const line of raw) {
    const t = line.trim();
    const cur = blocks[blocks.length - 1];
    if (/^user-agent\s*:/i.test(t)) {
      const token = t.replace(/^user-agent\s*:/i, '').trim().toLowerCase();
      if (cur.hasRules) {
        // a comment sitting right above the new group belongs to it, not to the group before
        const carried: string[] = [];
        while (cur.lines.length && cur.lines[cur.lines.length - 1].trim().startsWith('#')) carried.unshift(cur.lines.pop() as string);
        blocks.push({ lines: [...carried, line], uas: [token], hasRules: false });
      } else {
        cur.uas.push(token);
        cur.lines.push(line);
      }
    } else if (/^(allow|disallow|crawl-delay|noindex)\s*:/i.test(t)) {
      cur.hasRules = true;
      cur.lines.push(line);
    } else if (/^sitemap\s*:/i.test(t)) {
      blocks.push({ lines: [line], uas: [], hasRules: false }); // global: never belongs to a group
      blocks.push({ lines: [], uas: [], hasRules: false });
    } else {
      cur.lines.push(line); // blank line / comment: stays with whatever we're inside
    }
  }

  return blocks
    .filter((b) => !(b.uas.length > 0 && b.uas.every((u) => AI_TOKENS.has(u))))
    .flatMap((b) => b.lines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function mergeRobots(existing: string | null, mode: DeliveryMode, sitemapUrl: string | null): string {
  const ai = `# Aperture: AI crawler policy (${mode})\n${generateAiBotRobots(mode).trimEnd()}`;
  let base = existing ? stripAiGroups(existing) : '';
  if (!base) base = 'User-agent: *\nAllow: /';
  const hasSitemap = /^\s*sitemap\s*:/im.test(base);
  let out = `${base}\n\n${ai}\n`;
  if (sitemapUrl && !hasSitemap) out += `\nSitemap: ${sitemapUrl}\n`;
  return out;
}

// ---------- sitemap.xml ----------

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** URLs we actually found on the page. No <lastmod>: we can't know when pages changed, and a made-up date is worse than none. */
export function buildSitemap(links: string[]): string {
  const urls = [...new Set(links)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

// ---------- business profile ----------

export function missingFields(p: Partial<BusinessProfile>): string[] {
  const m: string[] = [];
  if (!p.name?.trim()) m.push('name');
  if (!p.phone?.trim()) m.push('phone');
  for (const k of ['street', 'city', 'region', 'postalCode'] as const) if (!p.address?.[k]?.trim()) m.push(`address.${k}`);
  return m;
}

const clean = (l: unknown): string[] => (Array.isArray(l) ? l.map((s) => String(s).trim()).filter(Boolean) : []);

const MAX_TEXT = 300;
const MAX_ITEMS = 50;
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : undefined);
const textList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map(text).filter((s): s is string => !!s).slice(0, MAX_ITEMS) : undefined;

/**
 * The request body is untrusted. Keep only the fields the form can send, only when they have the right type, and
 * cap their size; everything else is dropped (and hours/reviews only ever come from what the page itself publishes).
 * Anything left out falls back to the page's own values, so a malformed field can't crash the build or inject data.
 */
export function sanitizeProfileInput(raw: unknown): Partial<BusinessProfile> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<BusinessProfile> = {};
  const name = text(r.name);
  const phone = text(r.phone);
  if (name !== undefined) out.name = name;
  if (phone !== undefined) out.phone = phone;
  if (r.address && typeof r.address === 'object' && !Array.isArray(r.address)) {
    const a = r.address as Record<string, unknown>;
    out.address = { street: text(a.street) ?? '', city: text(a.city) ?? '', region: text(a.region) ?? '', postalCode: text(a.postalCode) ?? '' };
  }
  const services = textList(r.services);
  const areaServed = textList(r.areaServed);
  if (services) out.services = services;
  if (areaServed) out.areaServed = areaServed;
  return out;
}

/** A validated profile, or null when required facts are missing (never throws). */
export function toProfile(p: Partial<BusinessProfile>): BusinessProfile | null {
  if (missingFields(p).length) return null;
  try {
    return parseBusinessProfile({ ...p, services: clean(p.services), areaServed: clean(p.areaServed), hours: p.hours ?? [] });
  } catch {
    return null;
  }
}

// ---------- assembly ----------

export interface BuildInput {
  url: string;
  mode: DeliveryMode;
  profile: Partial<BusinessProfile>;
  robots: FileState;
  sitemap: FileState;
  /** The site's current /llms.txt, when readable — lets the report acknowledge it instead of claiming it's missing. */
  llms?: FileState;
  links: string[];
  /** Whether the page already carries JSON-LD (so we can say we're replacing it). */
  hasJsonLd?: boolean;
}

/** The first Sitemap: URL the site's own robots.txt declares, if any. */
function declaredSitemap(robots: FileState): string | null {
  if (robots.state !== 'found') return null;
  return robots.text.match(/^\s*sitemap\s*:\s*(\S+)/im)?.[1] ?? null;
}

const skipped = (id: string, name: string, kind: FileKind, why: string, howTo: string, existing: string | null = null): SuggestedFile =>
  ({ id, name, kind, status: 'skipped', why, howTo, content: '', existing, missing: [] });

export function buildFiles(input: BuildInput): { files: SuggestedFile[]; profile: BusinessProfile | null; missing: string[] } {
  const { mode, robots, sitemap, links } = input;
  const origin = new URL(input.url).origin;
  const profile = toProfile({ ...input.profile, url: input.profile.url ?? `${origin}/` });
  const missing = missingFields(input.profile);
  const files: SuggestedFile[] = [];
  const wantsSitemap = mode !== 'cloak';

  // 1. robots.txt: the one file every mode needs, and the only one that works without business facts
  const robotsWhy = mode === 'cloak'
    ? 'Tells every AI crawler to stay out. Your other rules are kept.'
    : 'Explicitly allows every AI crawler, so nothing blocks them by accident. Your other rules are kept.';
  if (robots.state === 'unreadable') {
    files.push({
      id: 'robots', name: 'robots.txt', kind: 'text', status: 'ready', why: robotsWhy,
      howTo: 'Add this section to your existing robots.txt.',
      content: `# Aperture: AI crawler policy (${mode})\n${generateAiBotRobots(mode).trimEnd()}\n`,
      existing: null, missing: [],
      warning: `We couldn't read your current robots.txt (${robots.reason}, likely edge protection). Merge this section into it by hand instead of replacing the file.`,
    });
  } else {
    files.push({
      id: 'robots', name: 'robots.txt', kind: 'text', status: 'ready', why: robotsWhy,
      howTo: 'Upload to your site root so it is served at /robots.txt.',
      content: mergeRobots(robots.state === 'found' ? robots.text : null, mode, wantsSitemap && sitemap.state !== 'found' && !declaredSitemap(robots) ? `${origin}/sitemap.xml` : null),
      existing: robots.state === 'found' ? robots.text : null, missing: [],
    });
  }

  // 2. sitemap.xml
  if (!wantsSitemap) {
    files.push(skipped('sitemap', 'sitemap.xml', 'xml', 'Not part of Cloak: there is nothing to advertise to AI.', 'Upload to /sitemap.xml.'));
  } else if (sitemap.state === 'found') {
    files.push(skipped('sitemap', 'sitemap.xml', 'xml', 'Your site already publishes a sitemap, so we left it alone.', 'Upload to /sitemap.xml.', sitemap.text));
  } else if (declaredSitemap(robots)) {
    // no file at /sitemap.xml, but robots.txt already points crawlers at one elsewhere
    files.push(skipped('sitemap', 'sitemap.xml', 'xml', `Your robots.txt already points to a sitemap (${declaredSitemap(robots)}), so we left it alone.`, 'Upload to /sitemap.xml.'));
  } else {
    files.push({
      id: 'sitemap', name: 'sitemap.xml', kind: 'xml', status: 'ready',
      why: `Lists ${new Set(links).size} page${new Set(links).size === 1 ? '' : 's'} we found linked from your home page, so crawlers can discover them.`,
      howTo: 'Upload to your site root so it is served at /sitemap.xml.',
      content: buildSitemap(links), existing: null, missing: [],
      warning: sitemap.state === 'unreadable' ? `We couldn't check for an existing sitemap (${sitemap.reason}). Skip this if you already have one.` : undefined,
    });
  }

  // 3-5. files that state business facts: only with a valid profile
  const factFile = (
    id: string, name: string, kind: FileKind, why: string, howTo: string, build: (p: BusinessProfile) => string, onlyIn: DeliveryMode[], note?: string, existing: string | null = null,
  ): SuggestedFile => {
    if (!onlyIn.includes(mode)) {
      return skipped(id, name, kind, mode === 'cloak' ? 'Not part of Cloak: nothing is served to AI.' : 'Amplify only: Mirror shows AI exactly what a person sees.', howTo, existing);
    }
    if (!profile) return { id, name, kind, status: 'needs-facts', why, howTo, content: '', existing, missing };
    return { id, name, kind, status: 'ready', why, howTo, content: build(profile), existing, missing: [], warning: note };
  };

  files.push(factFile(
    'jsonld', 'structured-data.html', 'html',
    'Machine-readable business facts (name, address, phone, hours) that answer engines can quote with confidence.',
    'Paste inside the <head> of your home page.',
    (p) => renderJsonLdScript(generateSchema(p)) + '\n',
    ['mirror', 'amplify'],
    input.hasJsonLd ? 'Your page already has JSON-LD. Replace it with this block rather than adding a second one.' : undefined,
  ));
  const existingLlms = input.llms?.state === 'found' ? input.llms.text : null;
  files.push(factFile(
    'llms', 'llms.txt', 'text',
    existingLlms
      ? 'Your site already serves /llms.txt — good. This version is rebuilt from the details above.'
      : 'A short plain-text summary for AI readers. Free to add, though no major crawler is known to honor it yet.',
    'Upload to your site root so it is served at /llms.txt.',
    generateLlmsTxt, ['amplify'],
    undefined,
    existingLlms,
  ));
  files.push(factFile(
    'markdown', 'business.md', 'markdown',
    'A clean markdown page of your business facts, easy for AI to parse and cite. Built only from the details above.',
    'Upload to /business.md and update it whenever your details change.',
    generateMarkdown, ['amplify'],
  ));

  return { files, profile, missing };
}
