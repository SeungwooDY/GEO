import type { ApprovedStore } from '../store/approvedStore.js';
import { detectClaimedBot, type BotVerification, type BotVerifier } from '../verification/botIdentity.js';
import { nullCrawlLog, type CrawlAction, type CrawlLog } from './crawlLog.js';
import type { Tenant, TenantDirectory } from './tenants.js';

/**
 * The multi-tenant proxy's request handler, written against web-standard Request/Response so it can run under
 * the Node wrapper in node.ts today and a Cloudflare Worker later without changes.
 *
 * Per request, for a tenant's mode:
 *  - not claiming to be an AI bot -> straight through to the origin, untouched
 *  - claims to be an AI bot, mode cloak -> 403 (keyed on the claim; blocking a spoofer costs nothing)
 *  - claims to be an AI bot, mode amplify/mirror -> the saved approved artifact, but ONLY if the source IP is
 *    inside that bot's vendor-published ranges; otherwise it is treated as an ordinary visitor
 * Any fault in our own logic falls back to the origin (fail-open): the site stays up, bots just see the plain page.
 */

export interface ProxyDeps {
  tenants: TenantDirectory;
  store: ApprovedStore;
  verifyBot: BotVerifier;
  log?: CrawlLog;
  /** Defaults to global fetch; injectable for tests. */
  fetchOrigin?: typeof fetch;
  now?: () => Date;
}

export interface ClientInfo {
  /** The TCP peer address. Never taken from a client-supplied header like X-Forwarded-For, which anyone can forge. */
  ip: string;
}

/** The origin itself failed. Not retried: it would just fail again, and it isn't our logic that faulted. */
class OriginError extends Error {}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

interface Outcome {
  response: Response;
  action: CrawlAction;
  bot: string | null;
  verification: BotVerification | null;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

async function passthrough(req: Request, tenant: Tenant, client: ClientInfo, fetchOrigin: typeof fetch): Promise<Response> {
  const incoming = new URL(req.url);
  const target = new URL(incoming.pathname + incoming.search, tenant.origin);

  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name)) headers.set(name, value);
  });
  headers.set('x-forwarded-for', [req.headers.get('x-forwarded-for'), client.ip].filter(Boolean).join(', '));
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  let res: Response;
  try {
    res = await fetchOrigin(target, init);
  } catch (err) {
    throw new OriginError(err instanceof Error ? err.message : String(err));
  }

  // fetch already decoded the body, so the encoding/length headers no longer describe it.
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  out.delete('transfer-encoding');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

async function route(req: Request, tenant: Tenant, client: ClientInfo, deps: ProxyDeps, fetchOrigin: typeof fetch): Promise<Outcome> {
  const claimed = detectClaimedBot(req.headers.get('user-agent') ?? '');
  const pass = (action: CrawlAction, verification: BotVerification | null = null): Promise<Outcome> =>
    passthrough(req, tenant, client, fetchOrigin).then((response) => ({ response, action, bot: claimed?.token ?? null, verification }));

  if (!claimed) return pass('passthrough');

  if (tenant.mode === 'cloak') {
    const response = new Response('AI crawlers are not permitted on this site.\n', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', vary: 'User-Agent' },
    });
    return { response, action: 'blocked', bot: claimed.token, verification: null };
  }

  // Amplify/Mirror only alter plain page reads.
  if (req.method !== 'GET' && req.method !== 'HEAD') return pass('passthrough');

  const verification = await deps.verifyBot(req.headers.get('user-agent') ?? '', client.ip);
  if (!verification.verified) return pass('passthrough-unverified-bot', verification);

  const path = normalizePath(new URL(req.url).pathname);
  if (!(tenant.paths ?? ['/']).includes(path)) return pass('passthrough-no-artifact', verification);

  const artifact = await deps.store.get({ tenant: tenant.id, path, mode: tenant.mode });
  if (!artifact) return pass('passthrough-no-artifact', verification);

  const response = new Response(req.method === 'HEAD' ? null : artifact.body, {
    status: 200,
    headers: { 'content-type': artifact.contentType, vary: 'User-Agent', 'x-geo-served': tenant.mode },
  });
  return { response, action: tenant.mode === 'amplify' ? 'served-amplify' : 'served-mirror', bot: claimed.token, verification };
}

export async function handleRequest(req: Request, client: ClientInfo, deps: ProxyDeps): Promise<Response> {
  const url = new URL(req.url);
  const tenant = deps.tenants.byHost(url.host);
  if (!tenant) return new Response('Unknown host\n', { status: 421, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  const fetchOrigin = deps.fetchOrigin ?? fetch;
  const claimed = detectClaimedBot(req.headers.get('user-agent') ?? '');

  let outcome: Outcome;
  try {
    outcome = await route(req, tenant, client, deps, fetchOrigin);
  } catch (err) {
    if (err instanceof OriginError) {
      outcome = { response: new Response('Bad gateway\n', { status: 502 }), action: 'error', bot: claimed?.token ?? null, verification: null };
    } else {
      // Our own logic faulted (verifier, store, ...): fail open to the real site.
      try {
        const response = await passthrough(req, tenant, client, fetchOrigin);
        outcome = { response, action: 'passthrough-fallback', bot: claimed?.token ?? null, verification: null };
      } catch {
        outcome = { response: new Response('Bad gateway\n', { status: 502 }), action: 'error', bot: claimed?.token ?? null, verification: null };
      }
    }
  }

  try {
    (deps.log ?? nullCrawlLog).record({
      ts: (deps.now?.() ?? new Date()).toISOString(),
      tenant: tenant.id,
      mode: tenant.mode,
      path: normalizePath(url.pathname),
      method: req.method,
      bot: outcome.bot,
      verified: outcome.verification ? outcome.verification.verified : null,
      verifyReason: outcome.verification?.reason ?? null,
      action: outcome.action,
      status: outcome.response.status,
    });
  } catch {
    // the log must never take a request down
  }

  return outcome.response;
}
