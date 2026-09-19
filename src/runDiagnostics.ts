import { startMockSite } from './mock-site/server.js';
import { checkRobots } from './crawlers/robotsParser.js';
import { checkUaDiff } from './crawlers/uaDiffChecker.js';
import { checkRenderingGap } from './crawlers/renderingGapScorer.js';
import { checkSchema } from './crawlers/schemaChecker.js';
import type { CheckOutcome, DiagnosticReport } from './crawlers/types.js';

async function settle<T>(work: Promise<T>): Promise<CheckOutcome<T>> {
  try {
    return { ok: true, data: await work };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) };
  }
}

async function runDiagnostics(url: string): Promise<DiagnosticReport> {
  const [robots, uaDiff, renderingGap, schema] = await Promise.all([
    settle(checkRobots(url, new URL(url).pathname)),
    settle(checkUaDiff(url)),
    settle(checkRenderingGap(url)),
    settle(checkSchema(url)),
  ]);

  return { url, robots, uaDiff, renderingGap, schema };
}

function printReport(report: DiagnosticReport): void {
  console.log(`\nGEO Phase 1 diagnostics for ${report.url}\n${'='.repeat(60)}`);

  if (!report.robots.ok) {
    console.log(`\n[robots.txt] ERROR: ${report.robots.error}`);
  } else {
    const robots = report.robots.data;
    console.log(`\n[robots.txt] found=${robots.robotsTxtFound} target=${robots.targetPath}`);
    for (const r of robots.perBot) {
      const flag = r.allowedTargetPath ? 'OK      ' : 'BLOCKED ';
      console.log(
        `  ${flag} ${r.bot.padEnd(16)} explicit-entry=${r.hasExplicitEntry ? 'yes' : 'no '} rule=${r.matchedRule ?? '(default allow)'}`,
      );
    }
  }

  if (!report.uaDiff.ok) {
    console.log(`\n[UA-diff / cloaking] ERROR: ${report.uaDiff.error}`);
  } else {
    const ua = report.uaDiff.data;
    console.log(`\n[UA-diff / cloaking] baseline: status=${ua.baseline.statusCode} bytes=${ua.baseline.contentLength}`);
    if (!ua.baselineUsable) {
      console.log(
        '  INCONCLUSIVE: the browser-UA baseline was itself challenged/empty (likely bot protection), so bot comparisons are not meaningful.',
      );
    } else {
      for (const b of ua.perBot) {
        const flag = b.blocked ? 'BLOCKED ' : b.substanceMismatch ? 'MISMATCH' : 'OK      ';
        console.log(
          `  ${flag} ${b.bot.padEnd(16)} status=${b.statusCode ?? 'ERR'} bytes=${b.contentLength}${b.error ? ` error=${b.error}` : ''}`,
        );
      }
    }
  }

  if (!report.renderingGap.ok) {
    console.log(`\n[Rendering gap] ERROR: ${report.renderingGap.error}`);
  } else {
    const rg = report.renderingGap.data;
    if (!rg.rawFetchUsable) {
      console.log(
        `\n[Rendering gap] INCONCLUSIVE: raw fetch returned status=${rg.rawStatusCode} with ${rg.rawTextLength} chars of text (likely bot protection); headless browser rendered ${rg.renderedTextLength} chars.`,
      );
    } else {
      console.log(
        `\n[Rendering gap] raw=${rg.rawTextLength} chars, rendered=${rg.renderedTextLength} chars, gap=${rg.gapPercent}% js-dependent=${rg.jsDependent}`,
      );
    }
  }

  if (!report.schema.ok) {
    console.log(`\n[Schema] ERROR: ${report.schema.error}`);
  } else {
    const sc = report.schema.data;
    if (!sc.fetchUsable) {
      console.log(
        `\n[Schema] INCONCLUSIVE: fetch returned status=${sc.statusCode} with no usable HTML (likely bot protection), so absence of schema can't be confirmed.`,
      );
    } else {
      console.log(`\n[Schema] found=${sc.found} blocks=${sc.blockCount} types=${sc.types.join(', ') || '(none)'}`);
    }
  }
  console.log();
}

async function main() {
  const targetUrl = process.argv[2];

  if (targetUrl) {
    new URL(targetUrl); // fail fast on a malformed URL
    printReport(await runDiagnostics(targetUrl));
    return;
  }

  const site = await startMockSite(4173);
  try {
    printReport(await runDiagnostics(site.url));
  } finally {
    await site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
