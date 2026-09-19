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
 *   POST /api/scan     { url }        -> DiagnosticReport
 *   GET  /api/robots?mode=amplify     -> text/plain robots.txt section (real, mode-only)
 *
 * URL-only by design. There is no GitHub path here — the engine has none.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { checkRobots } from '../src/crawlers/robotsParser.js';
import { checkUaDiff } from '../src/crawlers/uaDiffChecker.js';
import { checkRenderingGap } from '../src/crawlers/renderingGapScorer.js';
import { checkSchema } from '../src/crawlers/schemaChecker.js';
import { checkContentSignals } from '../src/crawlers/contentSignals.js';
import { checkPerBotSignals } from '../src/crawlers/perBotSignals.js';
import { generateAiBotRobots } from '../src/generators/configGenerator.js';
import { DELIVERY_MODES, type DeliveryMode } from '../src/mode.js';
import type { CheckOutcome, DiagnosticReport } from '../src/crawlers/types.js';

// Hosts like Render inject PORT and require binding 0.0.0.0. Locally this still defaults to
// 127.0.0.1:8787, which is where the Vite dev proxy expects the bridge.
const PORT = Number(process.env.PORT ?? process.env.APERTURE_BRIDGE_PORT ?? 8787);
const HOST = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

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
    try {
      const report = await runDiagnostics(target);
      sendJson(res, 200, report);
    } catch (err) {
      // runDiagnostics itself only throws on a malformed URL (already guarded); anything here is unexpected.
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Aperture bridge listening on http://${HOST}:${PORT}  (POST /api/scan, GET /api/robots?mode=)`);
});
