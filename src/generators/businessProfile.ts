export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Day = (typeof DAYS)[number];

export interface HoursEntry {
  days: Day[];
  /** 24h "HH:MM" */
  opens: string;
  /** 24h "HH:MM" */
  closes: string;
}

/**
 * The structured facts a business tells us about itself. This is the single source of truth for the
 * generators, and the source the validation gate checks generated content against: every claim in
 * generated output must trace back to a field here.
 */
export interface BusinessProfile {
  name: string;
  phone: string;
  address: { street: string; city: string; region: string; postalCode: string };
  areaServed: string[];
  services: string[];
  hours: HoursEntry[];
  /** Canonical site URL. */
  url?: string;
  reviews?: { ratingValue: number; reviewCount: number };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`profile.${field} must be a non-empty string`);
  return value.trim();
}

function requireStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`profile.${field} must be an array of strings`);
  return value.map((v, i) => requireString(v, `${field}[${i}]`));
}

/** Validates untrusted JSON (e.g. a tenant's profile file) into a BusinessProfile; throws with the offending field on failure. */
export function parseBusinessProfile(input: unknown): BusinessProfile {
  if (!input || typeof input !== 'object') throw new Error('profile must be an object');
  const raw = input as Record<string, unknown>;

  const rawAddress = raw.address as Record<string, unknown> | undefined;
  if (!rawAddress || typeof rawAddress !== 'object') throw new Error('profile.address must be an object');

  const hours: HoursEntry[] = (Array.isArray(raw.hours) ? raw.hours : []).map((entry, i) => {
    const e = entry as Record<string, unknown>;
    const days = requireStringList(e?.days, `hours[${i}].days`);
    for (const d of days) {
      if (!(DAYS as readonly string[]).includes(d)) throw new Error(`profile.hours[${i}].days has unknown day "${d}"`);
    }
    const opens = requireString(e.opens, `hours[${i}].opens`);
    const closes = requireString(e.closes, `hours[${i}].closes`);
    if (!TIME_PATTERN.test(opens) || !TIME_PATTERN.test(closes)) {
      throw new Error(`profile.hours[${i}] times must be 24h "HH:MM"`);
    }
    return { days: days as Day[], opens, closes };
  });

  let reviews: BusinessProfile['reviews'];
  if (raw.reviews !== undefined) {
    const r = raw.reviews as Record<string, unknown>;
    if (typeof r?.ratingValue !== 'number' || r.ratingValue < 0 || r.ratingValue > 5) {
      throw new Error('profile.reviews.ratingValue must be a number from 0 to 5');
    }
    if (typeof r.reviewCount !== 'number' || !Number.isInteger(r.reviewCount) || r.reviewCount < 0) {
      throw new Error('profile.reviews.reviewCount must be a non-negative integer');
    }
    reviews = { ratingValue: r.ratingValue, reviewCount: r.reviewCount };
  }

  return {
    name: requireString(raw.name, 'name'),
    phone: requireString(raw.phone, 'phone'),
    address: {
      street: requireString(rawAddress.street, 'address.street'),
      city: requireString(rawAddress.city, 'address.city'),
      region: requireString(rawAddress.region, 'address.region'),
      postalCode: requireString(rawAddress.postalCode, 'address.postalCode'),
    },
    areaServed: requireStringList(raw.areaServed ?? [], 'areaServed'),
    services: requireStringList(raw.services ?? [], 'services'),
    hours,
    url: raw.url === undefined ? undefined : requireString(raw.url, 'url'),
    reviews,
  };
}
