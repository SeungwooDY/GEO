import { createServer } from 'node:http';
import { AI_BOTS } from '../crawlers/botUserAgents.js';

/**
 * A deliberately flawed mock local-business site, used only to exercise the
 * Phase 1 diagnostics against known, reproducible problems instead of an
 * unpredictable live URL:
 *  - robots.txt fully blocks ClaudeBot
 *  - "/" serves thinner, different-substance content to AI bot UAs (cloaking risk)
 *  - the real business content is injected client-side, invisible to a raw HTTP fetch
 *  - JSON-LD LocalBusiness schema is present (this part is done right)
 */

const ROBOTS_TXT = `User-agent: ClaudeBot
Disallow: /

User-agent: GPTBot
Allow: /

User-agent: *
Disallow: /admin
`;

const REAL_BUSINESS_HTML = `
  <h1>Riverside Plumbing Co.</h1>
  <p>Family-owned plumbing serving Riverside, CA since 1998. Emergency repairs, water heater
  installation, and drain cleaning. Licensed &amp; insured, CA lic #123456.</p>
  <p>Hours: Mon-Sat 7am-7pm. Call (951) 555-0142 for same-day service.</p>
`;

function isAiBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return AI_BOTS.some((bot) => ua.includes(bot.token.toLowerCase()));
}

function renderHomePage(userAgent: string): string {
  const schema = `
    <script type="application/ld+json">
    ${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Riverside Plumbing Co.',
      telephone: '+1-951-555-0142',
      areaServed: 'Riverside, CA',
    })}
    </script>`;

  if (isAiBot(userAgent)) {
    // Cloaking bug: bots get a thin stub instead of the real page content.
    return `<!doctype html><html><head><title>Riverside Plumbing</title>${schema}</head>
      <body><p>Welcome to our site.</p></body></html>`;
  }

  // Browsers get a placeholder that client-side JS fills in after load —
  // a raw (non-JS) fetch will only ever see "Loading...".
  return `<!doctype html><html><head><title>Riverside Plumbing</title>${schema}</head>
    <body>
      <div id="content">Loading...</div>
      <script>
        document.getElementById('content').innerHTML = ${JSON.stringify(REAL_BUSINESS_HTML)};
      </script>
    </body></html>`;
}

export function startMockSite(port: number) {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    const userAgent = req.headers['user-agent'] ?? '';

    if (url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ROBOTS_TXT);
      return;
    }

    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(renderHomePage(userAgent));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
