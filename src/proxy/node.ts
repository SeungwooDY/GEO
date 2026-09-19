import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleRequest, type ProxyDeps } from './handler.js';

/**
 * Thin node:http wrapper around the portable handler, for local development and tests. Deployment targets
 * such as a Cloudflare Worker call handleRequest directly with their own Request and client IP.
 *
 * The client IP is the socket peer. Behind another proxy or load balancer that would be the balancer's
 * address, so verification would fail closed (bots just get the plain site); never read it from a client header.
 */
export function startProxy(port: number, deps: ProxyDeps, hostname = '127.0.0.1') {
  const server = createServer(async (nodeReq, nodeRes) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(nodeReq.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
        else if (value !== undefined) headers.set(name, value);
      }

      const method = nodeReq.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(nodeReq) as unknown as BodyInit;
        init.duplex = 'half';
      }

      const req = new Request(`http://${nodeReq.headers.host ?? 'localhost'}${nodeReq.url ?? '/'}`, init);
      const res = await handleRequest(req, { ip: nodeReq.socket.remoteAddress ?? '' }, deps);

      const out: Record<string, string | string[]> = {};
      res.headers.forEach((value, name) => {
        if (name !== 'set-cookie') out[name] = value;
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) out['set-cookie'] = cookies;

      nodeRes.writeHead(res.status, out);
      if (!res.body) return void nodeRes.end();
      Readable.fromWeb(res.body as never).pipe(nodeRes);
    } catch {
      if (!nodeRes.headersSent) nodeRes.writeHead(502, { 'content-type': 'text/plain' });
      nodeRes.end('Bad gateway\n');
    }
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(port, hostname, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://${hostname}:${actualPort}/`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
