/**
 * Aperture bridge — the thin HTTP seam between the React front end (browser) and the
 * URL diagnostics engine (Node + fetch + Playwright, which the browser can't run).
 *
 * It does NOT alter the engine: it composes the engine's exported check functions the
 * exact same way `src/runDiagnostics.ts` does (that file's function isn't exported and it
 * runs `main()` on import, so we re-orchestrate rather than import it) and returns the
 * engine's `DiagnosticReport` verbatim, plus the engine's per-mode robots.txt.
 *
 * Endpoints:
 *   POST /api/scan      { url }        -> DiagnosticReport
 *   POST /api/files     { url, mode, profile? } -> suggested files (robots merge, sitemap, JSON-LD, llms.txt, markdown)
 *   POST /api/repo-scan { url }        -> RepoScanReport (GitHub repo pattern scan: checks + edit targets)
 *   GET  /api/robots?mode=amplify     -> text/plain robots.txt section (real, mode-only)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { checkRobots } from '../src/crawlers/robotsParser.js';
import { checkUaDiff } from '../src/crawlers/uaDiffChecker.js';
import { checkRenderingGap } from '../src/crawlers/renderingGapScorer.js';
import { checkSchema } from '../src/crawlers/schemaChecker.js';
import { checkContentSignals } from '../src/crawlers/contentSignals.js';
import { checkPerBotSignals } from '../src/crawlers/perBotSignals.js';
import { generateAiBotRobots } from '../src/generators/configGenerator.js';
import { DELIVERY_MODES, type DeliveryMode } from '../src/mode.js';
import type { CheckOutcome, DiagnosticReport } from '../src/crawlers/types.js';
import { checkPublicHost } from './guard.js';
import { fetchExtract, type PageExtract } from './extract.js';
import { buildFiles, sanitizeProfileInput } from './files.js';
import { resolveRepo, scanRepo } from '../src/repoScan/scan.js';
import { loadHarnessConfig } from '../src/harness/config.js';
import { createGithubApp, prepareRepoDelivery } from '../src/harness/github.js';
import { deliverChange } from '../src/harness/deliver.js';
import { branchNameFor } from '../src/harness/git.js';
import { applyRepoFix, describeFix, type RepoFixSummary } from '../src/harness/repoFix.js';

// Render (and most hosts) inject PORT and require binding 0.0.0.0. Falls back to
// 8787 locally, where `npm run dev` (Vite) proxies /api here.
const PORT = Number(process.env.PORT ?? process.env.APERTURE_BRIDGE_PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

// The built front end. In production this same service serves the SPA and /api
// from one origin, so the app's relative /api calls just work (no CORS, no second host).
const DIST = join(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** Serve a built asset, falling back to index.html for client-side routes (SPA). */
async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.[/\\])+/, '');
  const candidate = join(DIST, rel || 'index.html');
  const filePath = candidate.startsWith(DIST) ? candidate : join(DIST, 'index.html');
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const index = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(index);
    } catch {
      sendJson(res, 404, { error: 'not found (build the front end with `npm run build`)' });
    }
  }
}

/** Same failure isolation as runDiagnostics: one check failing becomes `{ ok:false }`, never a dead scan. */
async function settle<T>(work: Promise<T>): Promise<CheckOutcome<T>> {
  try {
    return { ok: true, data: await work };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) };
  }
}

// A firewall that hangs (rather than returning 403) would otherwise freeze the whole
// scan. Race each check against a deadline so a hung check becomes an inconclusive
// signal — which the scorer treats as "couldn't measure", not a finding. The engine
// fetch keeps running in the background but no longer blocks the response.
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<CheckOutcome<T>> {
  const deadline = new Promise<CheckOutcome<T>>((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: `${label} timed out after ${ms / 1000}s (likely edge protection)` }), ms);
    t.unref?.();
  });
  return Promise.race([settle(work), deadline]);
}

async function runDiagnostics(url: string): Promise<DiagnosticReport> {
  const FETCH_MS = 15000;
  const RENDER_MS = 30000; // headless render legitimately takes longer than a plain fetch
  const [robots, uaDiff, renderingGap, schema, content, perBotSignals] = await Promise.all([
    withTimeout(checkRobots(url, new URL(url).pathname), FETCH_MS, 'robots'),
    withTimeout(checkUaDiff(url), FETCH_MS, 'cloaking'),
    withTimeout(checkRenderingGap(url), RENDER_MS, 'rendering'), // Chromium-less machines get { ok:false } here; the rest of the scan still returns.
    withTimeout(checkSchema(url), FETCH_MS, 'schema'),
    withTimeout(checkContentSignals(url), FETCH_MS, 'content'),
    withTimeout(checkPerBotSignals(url), RENDER_MS, 'per-bot'),
  ]);
  return { url, robots, uaDiff, renderingGap, schema, content, perBotSignals };
}

/** Accept only a well-formed http(s) URL; reject anything else (no file:, no SSRF-y schemes). */
function normalizeTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.includes('://') ? raw.trim() : `https://${raw.trim()}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) reject(new Error('body too large')); // this endpoint only ever receives a URL
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Editing the business form regenerates files without re-reading the site: cache the page read briefly.
const EXTRACT_TTL_MS = 5 * 60 * 1000;
const extractCache = new Map<string, { at: number; value: Promise<PageExtract> }>();
function cachedExtract(url: string): Promise<PageExtract> {
  const hit = extractCache.get(url);
  if (hit && Date.now() - hit.at < EXTRACT_TTL_MS) return hit.value;
  if (extractCache.size >= 50) extractCache.delete(extractCache.keys().next().value as string);
  const value = fetchExtract(url)
    .then((page) => {
      // A read that failed (site down, firewall, timeout) must not stick for 5 minutes.
      if (page.source === 'unreadable') extractCache.delete(url);
      return page;
    })
    .catch((err) => { extractCache.delete(url); throw err; });
  extractCache.set(url, { at: Date.now(), value });
  return value;
}

const server = createServer(async (req, res) => {
  cors(res);
  const { method } = req;
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/api/robots') {
    const mode = url.searchParams.get('mode') as DeliveryMode | null;
    if (!mode || !DELIVERY_MODES.includes(mode)) {
      sendJson(res, 400, { error: `mode must be one of ${DELIVERY_MODES.join(', ')}` });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(generateAiBotRobots(mode));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/scan') {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBody(req)) || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const target = normalizeTarget((parsed as { url?: unknown }).url);
    if (!target) {
      sendJson(res, 400, { error: 'a valid http(s) url is required' });
      return;
    }
    const blocked = await checkPublicHost(target);
    if (blocked) {
      sendJson(res, 400, { error: blocked });
      return;
    }
    try {
      const report = await runDiagnostics(target);
      sendJson(res, 200, report);
    } catch (err) {
      // runDiagnostics itself only throws on a malformed URL (already guarded); anything here is unexpected.
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/files') {
    let parsed: { url?: unknown; mode?: unknown; profile?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const target = normalizeTarget(parsed.url);
    if (!target) {
      sendJson(res, 400, { error: 'a valid http(s) url is required' });
      return;
    }
    if (!DELIVERY_MODES.includes(parsed.mode as DeliveryMode)) {
      sendJson(res, 400, { error: `mode must be one of ${DELIVERY_MODES.join(', ')}` });
      return;
    }
    const blocked = await checkPublicHost(target);
    if (blocked) {
      sendJson(res, 400, { error: blocked });
      return;
    }
    try {
      const page = await cachedExtract(target);
      // The user's edits win over what we read off the page; anything they leave out falls back to it.
      const effective = { ...page.profile, ...sanitizeProfileInput(parsed.profile) };
      const built = buildFiles({
        url: target, mode: parsed.mode as DeliveryMode, profile: effective,
        robots: page.robots, sitemap: page.sitemap, llms: page.llms, links: page.links, hasJsonLd: page.evidence.name === 'JSON-LD',
      });
      sendJson(res, 200, { files: built.files, missing: built.missing, prefill: page.profile, evidence: page.evidence, source: page.source });
    } catch (err) {
      console.error('[api/files]', err); // details stay in the server log, never in the response
      sendJson(res, 500, { error: 'Could not build files for this site. Please try again.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/repo-scan') {
    let parsed: { url?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    // Network callers may only name public GitHub repos — never local paths (resolveRepo would
    // happily scan any directory on this machine, which is fine for the CLI, not for HTTP).
    const raw = typeof parsed.url === 'string' ? parsed.url.trim() : '';
    if (!/^https:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(raw)) {
      sendJson(res, 400, { error: 'a public GitHub repository URL is required (https://github.com/owner/repo)' });
      return;
    }
    try {
      const { path, cleanup } = resolveRepo(raw.replace(/\/$/, ''));
      try {
        sendJson(res, 200, scanRepo(path, raw));
      } finally {
        cleanup();
      }
    } catch (err) {
      console.error('[api/repo-scan]', err); // clone/scan details stay in the server log
      sendJson(res, 500, { error: 'Could not clone or scan that repository. Is it public?' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/repo-pr') {
    let parsed: { url?: unknown; mode?: unknown; profile?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const raw = typeof parsed.url === 'string' ? parsed.url.trim().replace(/\/$/, '') : '';
    const m = raw.match(/^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!m) {
      sendJson(res, 400, { error: 'a public GitHub repository URL is required (https://github.com/owner/repo)' });
      return;
    }
    if (!DELIVERY_MODES.includes(parsed.mode as DeliveryMode)) {
      sendJson(res, 400, { error: `mode must be one of ${DELIVERY_MODES.join(', ')}` });
      return;
    }
    const [, owner, name] = m;
    const mode = parsed.mode as DeliveryMode;

    // The App credentials are optional for the rest of the bridge; this endpoint needs them.
    let app;
    try {
      app = createGithubApp(loadHarnessConfig());
    } catch {
      sendJson(res, 503, { error: 'The GitHub App is not configured on this server.' });
      return;
    }

    // The PR goes into the SUBMITTED repo. The App must be installed there — that installation is the
    // repo owner's consent, so "not installed" is a first-class response with the install link, not a failure.
    let delivery;
    try {
      delivery = await prepareRepoDelivery(app, owner, name);
    } catch {
      const { data: self } = await app.octokit.request('GET /app').catch(() => ({ data: null as { slug?: string } | null }));
      sendJson(res, 409, {
        error: 'app-not-installed',
        message: `The Aperture App isn't installed on ${owner}/${name} yet. Install it (choosing that repository), then try again.`,
        installUrl: self?.slug ? `https://github.com/apps/${self.slug}/installations/new` : null,
      });
      return;
    }

    try {
      let summary: RepoFixSummary | null = null;
      const result = await deliverChange({
        remoteUrl: delivery.remoteUrl,
        auth: delivery.auth,
        baseBranch: delivery.baseBranch,
        branch: branchNameFor(['config', mode]),
        apply: async (dir) => { summary = await applyRepoFix(dir, mode, parsed.profile); },
        commitMessage: `Aperture: AI crawler config (${mode})`,
        get pr() { return describeFix(summary as unknown as RepoFixSummary, mode); },
        client: delivery.client,
        author: delivery.author,
      });
      const s = summary as unknown as RepoFixSummary | null;
      sendJson(res, 200, {
        status: result.status,
        pr: 'pr' in result ? result.pr : null,
        written: s?.written ?? [],
        skipped: s?.skipped ?? [],
      });
    } catch (err) {
      console.error('[api/repo-pr]', err); // clone/push details stay in the server log
      sendJson(res, 500, { error: 'Could not open the pull request. Check the server log.' });
    }
    return;
  }

  // Anything that isn't an API call is a request for the front end.
  if (method === 'GET' && !url.pathname.startsWith('/api/')) {
    await serveStatic(res, url.pathname);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Aperture bridge listening on http://${HOST}:${PORT}  (SPA + POST /api/scan, POST /api/files, GET /api/robots?mode=)`);
});
