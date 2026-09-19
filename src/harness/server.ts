import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { App } from '@octokit/app';
import type { Logger } from './installationEvents.js';

/** GitHub caps webhook payloads at 25 MB; installation events are tiny, so we accept far less. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

function reply(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/**
 * The webhook receiver. The signature is checked against the raw body before anything is parsed or handled;
 * an unsigned or mis-signed request never reaches a handler.
 */
export function createHarnessServer(app: App, log: Logger): Server {
  return createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0];

      if (req.method === 'GET' && path === '/healthz') return reply(res, 200, 'ok');
      if (path !== '/webhook') return reply(res, 404, 'not found');
      if (req.method !== 'POST') return reply(res, 405, 'method not allowed');

      const id = header(req, 'x-github-delivery');
      const name = header(req, 'x-github-event');
      const signature = header(req, 'x-hub-signature-256');
      if (!id || !name || !signature) return reply(res, 400, 'missing GitHub webhook headers');

      const payload = await readBody(req);

      let verified = false;
      try {
        verified = await app.webhooks.verify(payload, signature);
      } catch {
        verified = false; // a malformed signature header is just an invalid signature
      }
      if (!verified) {
        log.warn('rejected webhook with invalid signature', { delivery: id, event: name });
        return reply(res, 401, 'invalid signature');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return reply(res, 400, 'payload is not JSON');
      }

      // Events we have no handler for (ping, push, ...) are accepted and ignored.
      await app.webhooks.receive({ id, name, payload: parsed } as Parameters<App['webhooks']['receive']>[0]);
      log.info('webhook handled', { delivery: id, event: name });
      reply(res, 200, 'ok');
    } catch (err) {
      if (err instanceof BodyTooLarge) return reply(res, 413, 'payload too large');
      log.error('webhook handling failed', { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) reply(res, 500, 'internal error');
    }
  });
}
