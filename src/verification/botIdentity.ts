import { AI_BOTS, fetchableBots, type BotDefinition } from '../crawlers/botUserAgents.js';
import { ipInCidr, parseIp, parsePrefixFile, type Cidr } from './ipRanges.js';

/**
 * Bot-identity verification: a UA string is only a claim, so a request counts as a real AI bot only if its
 * source IP falls inside the ranges that bot's vendor publishes. Shared by the proxy and (later) the diagnostics.
 */

export type VerificationReason =
  | 'verified'
  | 'no-bot-claimed'
  | 'invalid-ip'
  | 'no-published-ranges'
  | 'ranges-unavailable'
  | 'ip-not-in-ranges';

export interface BotVerification {
  /** Token of the bot the UA claims to be, or null when it claims none. */
  claimedBot: string | null;
  vendor: string | null;
  /** True only when the claim is confirmed by IP range. Anything else must be treated as an ordinary visitor. */
  verified: boolean;
  reason: VerificationReason;
}

export type BotVerifier = (userAgent: string, ip: string) => Promise<BotVerification>;

/** Which bot a UA claims to be, judged by robots.txt token. Token-only bots (Google-Extended) never send requests, so never match. */
export function detectClaimedBot(userAgent: string, bots: BotDefinition[] = AI_BOTS): BotDefinition | null {
  const ua = userAgent.toLowerCase();
  return fetchableBots(bots).find((bot) => ua.includes(bot.token.toLowerCase())) ?? null;
}

export interface RangeProviderOptions {
  fetchFn?: typeof fetch;
  /** How long fetched ranges are trusted before a refresh is attempted. Default 1 hour. */
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/** Fetches and caches vendor range files. If a refresh fails, stale ranges are kept rather than dropped. */
export function createRangeProvider({ fetchFn = fetch, ttlMs = 60 * 60 * 1000, timeoutMs = 5000, now = Date.now }: RangeProviderOptions = {}) {
  const cache = new Map<string, { cidrs: Cidr[]; fetchedAt: number }>();

  return async function getRanges(url: string): Promise<Cidr[] | null> {
    const cached = cache.get(url);
    if (cached && now() - cached.fetchedAt < ttlMs) return cached.cidrs;

    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cidrs = parsePrefixFile(await res.json());
      if (cidrs.length === 0) throw new Error('no usable prefixes in range file');
      cache.set(url, { cidrs, fetchedAt: now() });
      return cidrs;
    } catch {
      return cached?.cidrs ?? null;
    }
  };
}

export interface BotVerifierOptions extends RangeProviderOptions {
  bots?: BotDefinition[];
  getRanges?: (url: string) => Promise<Cidr[] | null>;
}

export function createBotVerifier(options: BotVerifierOptions = {}): BotVerifier {
  const bots = options.bots ?? AI_BOTS;
  const getRanges = options.getRanges ?? createRangeProvider(options);

  return async (userAgent, ip) => {
    const bot = detectClaimedBot(userAgent, bots);
    if (!bot) return { claimedBot: null, vendor: null, verified: false, reason: 'no-bot-claimed' };

    const result = (verified: boolean, reason: VerificationReason): BotVerification => ({
      claimedBot: bot.token,
      vendor: bot.vendor,
      verified,
      reason,
    });

    const parsed = parseIp(ip);
    if (!parsed) return result(false, 'invalid-ip');
    if (!bot.ipRangeUrls?.length) return result(false, 'no-published-ranges');

    const lists = await Promise.all(bot.ipRangeUrls.map(getRanges));
    if (lists.some((cidrs) => cidrs?.some((c) => ipInCidr(parsed, c)))) return result(true, 'verified');
    return result(false, lists.some((l) => l === null) ? 'ranges-unavailable' : 'ip-not-in-ranges');
  };
}
