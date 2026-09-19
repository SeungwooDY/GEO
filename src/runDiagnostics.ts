import { startMockSite } from './mock-site/server.js';
import { checkRobots } from './crawlers/robotsParser.js';
import { checkUaDiff } from './crawlers/uaDiffChecker.js';
import { checkRenderingGap } from './crawlers/renderingGapScorer.js';
import { checkSchema } from './crawlers/schemaChecker.js';
import { checkContentSignals } from './crawlers/contentSignals.js';
import { checkPerBotSignals } from './crawlers/perBotSignals.js';
import type { CheckOutcome, DiagnosticReport } from './crawlers/types.js';

async function settle<T>(work: Promise<T>): Promise<CheckOutcome<T>> {
  try {
    return { ok: true, data: await work };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) };
  }
}

async function runDiagnostics(url: string): Promise<DiagnosticReport> {
  const [robots, uaDiff, renderingGap, schema, content, perBotSignals] = await Promise.all([
    settle(checkRobots(url, new URL(url).pathname)),
    settle(checkUaDiff(url)),
    settle(checkRenderingGap(url)),
    settle(checkSchema(url)),
    settle(checkContentSignals(url)),
    settle(checkPerBotSignals(url)),
  ]);

  return { url, robots, uaDiff, renderingGap, schema, content, perBotSignals };
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
        const flag = b.challenged ? 'INDETERM' : b.blocked ? 'BLOCKED ' : b.substanceMismatch ? 'MISMATCH' : 'OK      ';
        const note = b.challenged
          ? ` — ${b.challengedBy ?? 'WAF'} challenged our unverified probe; real-crawler access unknowable from outside`
          : '';
        console.log(
          `  ${flag} ${b.bot.padEnd(16)} status=${b.statusCode ?? 'ERR'} bytes=${b.contentLength}${b.error ? ` error=${b.error}` : ''}${note}`,
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
      if (sc.found) {
        console.log(
          `  local-field completeness: ${sc.fieldCompleteness.percent}% (missing: ${sc.fieldCompleteness.missing.join(', ') || 'none'})`,
        );
        console.log(
          `  telephone in schema: ${sc.telephone ?? '(none)'}; appears in visible page text: ${sc.telephoneInVisibleText ?? 'n/a'}`,
        );
      }
    }
  }

  if (!report.content.ok) {
    console.log(`\n[Content signals] ERROR: ${report.content.error}`);
  } else {
    const c = report.content.data;
    if (!c.fetchUsable) {
      console.log(`\n[Content signals] INCONCLUSIVE: fetch returned status=${c.statusCode} with no usable text.`);
    } else {
      console.log(`\n[Content signals] (raw HTML, i.e. what a non-JS crawler reads)`);
      console.log(`  words=${c.wordCount} text/html=${c.textToHtmlRatio} htmlBytes=${c.htmlBytes} ttfb+body=${c.responseTimeMs}ms`);
      console.log(`  headings: h1=${c.h1Count} h2=${c.h2Count} h3=${c.h3Count} question-headings=${c.questionHeadings}`);
      console.log(`  stats=${c.statCount} quotes=${c.quoteCount} outbound-hosts=${c.outboundLinkHosts} last-modified=${c.lastModifiedHeader ?? '(none)'}`);
    }
  }

  if (!report.perBotSignals.ok) {
    console.log(`\n[Per-bot schema/content] ERROR: ${report.perBotSignals.error}`);
  } else {
    const pb = report.perBotSignals.data;
    console.log(`\n[Per-bot schema/content] differences vs. browser view`);
    if (!pb.baselineUsable) {
      console.log('  INCONCLUSIVE: the browser-UA baseline was challenged/empty, so bot comparisons are not meaningful.');
    } else {
      for (const b of pb.perBot) {
        if (b.error) console.log(`  ERROR    ${b.bot.padEnd(16)} ${b.error}`);
        else if (!b.fetchUsable) console.log(`  BLOCKED  ${b.bot.padEnd(16)} status=${b.statusCode} (no usable page for this bot)`);
        else if (b.differences.length === 0) console.log(`  SAME     ${b.bot.padEnd(16)} words=${b.wordCount} schema=${b.schemaCompletenessPercent}%`);
        else {
          console.log(`  DIFFERS  ${b.bot}`);
          for (const d of b.differences) console.log(`             - ${d}`);
        }
      }
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
