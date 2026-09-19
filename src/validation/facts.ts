import { STAT_PATTERN } from '../crawlers/contentSignals.js';
import { DAYS, type BusinessProfile } from '../generators/businessProfile.js';

/**
 * Validation layer 1: deterministic fact extraction and comparison. Pulls the hard, checkable facts out of
 * text (phones, prices, hours, addresses, URLs, risky claim phrases) so generated content can be compared
 * against its source. Anything *added* (in the output, not in the source) is a cloaking-policy violation.
 */

export type FactKind = 'phone' | 'email' | 'url' | 'stat' | 'rating' | 'time' | 'day' | 'street' | 'zip' | 'claim';

export interface Fact {
  kind: FactKind;
  value: string;
}

export type Facts = Map<FactKind, Set<string>>;

export interface FactCheckResult {
  /** True when nothing was added; omissions alone never fail the check. */
  ok: boolean;
  /** In the generated content but not the source: fails the check. */
  added: Fact[];
  /** In the source but not the generated content: reported as warnings. */
  omitted: Fact[];
}

const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// The JSON-LD "@context" namespace is boilerplate, not a claim about the business.
const SCHEMA_ORG_NAMESPACE = /^https?:\/\/(?:www\.)?schema\.org(?:\/|$)/;
const EMAIL =/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_PATTERN = /https?:\/\/[^\s)>\]"'<]+/g;
const RATING = /(\d(?:\.\d+)?)\s?(?:\/|out of)\s?5\b|(\d(?:\.\d+)?)[- ]stars?\b|ratingValue"?\s*:\s*"?(\d(?:\.\d+)?)/gi;
const REVIEW_COUNT_JSON = /reviewCount"?\s*:\s*"?(\d+)/g;
const TIME_12H = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi;
const TIME_24H = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const DAY_NAME = '(Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
const DAY_SINGLE = new RegExp(`\\b${DAY_NAME}\\b`, 'g');
const DAY_RANGE = new RegExp(`\\b${DAY_NAME}\\s*(?:-|–|—|to|through|thru)\\s*${DAY_NAME}\\b`, 'g');
const STREET =
  /\b\d{1,6}\s+(?:[A-Z][\w.]*\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)\b/g;
const ZIP = /\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b|postalCode"?\s*:\s*"?(\d{5})/g;

// Claims a customer would care about being wrong. The LLM judge covers fuzzier ones ("best in town").
const CLAIMS: Array<[string, RegExp]> = [
  ['24/7', /24\s?\/\s?7|24[- ]hours?\b|around the clock/i],
  ['licensed', /\blicensed\b/i],
  ['insured', /\binsured\b/i],
  ['bonded', /\bbonded\b/i],
  ['free-estimates', /\bfree (?:estimates?|quotes?|consultations?)\b/i],
  ['guarantee', /\bguarantee[ds]?\b/i],
  ['warranty', /\bwarrant(?:y|ies)\b/i],
  ['same-day', /\bsame[- ]day\b/i],
];

const STREET_ABBREVIATIONS: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', place: 'pl', highway: 'hwy',
};

function add(facts: Facts, kind: FactKind, value: string): void {
  if (!facts.has(kind)) facts.set(kind, new Set());
  facts.get(kind)!.add(value);
}

function emptyFacts(): Facts {
  return new Map();
}

const dayIndex = (token: string): number => DAYS.findIndex((d) => d.startsWith(token.slice(0, 3)));

function normalizeTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function extractFacts(text: string): Facts {
  const facts = emptyFacts();

  for (const m of text.matchAll(PHONE)) add(facts, 'phone', m[0].replace(/\D/g, '').slice(-10));
  for (const m of text.matchAll(EMAIL)) add(facts, 'email', m[0].toLowerCase());
  for (const m of text.matchAll(URL_PATTERN)) {
    const url = m[0].replace(/[.,;:]+$/, '').replace(/\/+$/, '').toLowerCase();
    if (!SCHEMA_ORG_NAMESPACE.test(url)) add(facts, 'url', url);
  }

  // STAT_PATTERN's number part swallows a sentence-ending "." ("$49." in "from $49."), so trim it off.
  for (const s of text.match(STAT_PATTERN) ?? []) add(facts, 'stat', s.toLowerCase().replace(/[\s,]/g, '').replace(/\.+$/, ''));
  for (const m of text.matchAll(REVIEW_COUNT_JSON)) add(facts, 'stat', `${m[1]}reviews`);
  for (const m of text.matchAll(RATING)) add(facts, 'rating', String(Number(m[1] ?? m[2] ?? m[3])));

  for (const m of text.matchAll(TIME_12H)) {
    const hour24 = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    add(facts, 'time', normalizeTime(hour24, Number(m[2] ?? 0)));
  }
  for (const m of text.matchAll(TIME_24H)) add(facts, 'time', normalizeTime(Number(m[1]), Number(m[2])));

  for (const m of text.matchAll(DAY_RANGE)) {
    const from = dayIndex(m[1]);
    const to = dayIndex(m[2]);
    for (let i = from; ; i = (i + 1) % 7) {
      add(facts, 'day', DAYS[i]);
      if (i === to) break;
    }
  }
  for (const m of text.matchAll(DAY_SINGLE)) add(facts, 'day', DAYS[dayIndex(m[1])]);

  for (const m of text.matchAll(STREET)) {
    const words = m[0].toLowerCase().replace(/[.,]/g, '').split(/\s+/).map((w) => STREET_ABBREVIATIONS[w] ?? w);
    add(facts, 'street', words.join(' '));
  }
  for (const m of text.matchAll(ZIP)) add(facts, 'zip', m[1] ?? m[2]);

  for (const [name, pattern] of CLAIMS) if (pattern.test(text)) add(facts, 'claim', name);

  return facts;
}

/** Facts a profile asserts, built directly from its fields (not via the generators, so the check isn't circular). */
export function factsFromProfile(profile: BusinessProfile): Facts {
  // Free-text fields can carry claims/stats too (e.g. a service called "Free estimates, licensed & insured").
  const freeText = [profile.name, ...profile.services, ...profile.areaServed].join('\n');
  const facts = extractFacts(freeText);

  add(facts, 'phone', profile.phone.replace(/\D/g, '').slice(-10));
  add(facts, 'zip', profile.address.postalCode.slice(0, 5));
  for (const street of extractFacts(profile.address.street).get('street') ?? []) add(facts, 'street', street);
  if (profile.url) add(facts, 'url', profile.url.replace(/\/+$/, '').toLowerCase());

  for (const entry of profile.hours) {
    for (const d of entry.days) add(facts, 'day', d);
    for (const t of [entry.opens, entry.closes]) add(facts, 'time', t);
  }
  if (profile.reviews) {
    add(facts, 'rating', String(profile.reviews.ratingValue));
    add(facts, 'stat', `${profile.reviews.reviewCount}reviews`);
  }
  return facts;
}

function toFacts(input: string | Facts | BusinessProfile): Facts {
  if (typeof input === 'string') return extractFacts(input);
  if (input instanceof Map) return input;
  return factsFromProfile(input);
}

function difference(a: Facts, b: Facts): Fact[] {
  const out: Fact[] = [];
  for (const [kind, values] of a) {
    for (const value of values) if (!b.get(kind)?.has(value)) out.push({ kind, value });
  }
  return out;
}

/**
 * Compares generated content against its source. `source` may be text (e.g. the human-visible page),
 * pre-extracted facts, or a BusinessProfile.
 */
export function checkFacts(generated: string | Facts, source: string | Facts | BusinessProfile): FactCheckResult {
  const gen = toFacts(generated);
  const src = toFacts(source);
  const added = difference(gen, src);
  return { ok: added.length === 0, added, omitted: difference(src, gen) };
}
