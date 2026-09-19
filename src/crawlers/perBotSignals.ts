import { AI_BOTS, BROWSER_USER_AGENT, fetchableBots } from './botUserAgents.js';
import { analyzeContent } from './contentSignals.js';
import { analyzeSchema } from './schemaChecker.js';
import type { ContentSignalsReport, PerBotSignalResult, PerBotSignalsReport, SchemaReport } from './types.js';

// Word counts within this relative difference are treated as normal noise (rotating banners, timestamps).
const WORD_COUNT_TOLERANCE = 0.1;

interface Snapshot {
  statusCode: number;
  schema: SchemaReport;
  content: ContentSignalsReport;
}

async function snapshotAs(url: string, userAgent: string): Promise<Snapshot> {
  const started = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  const html = await res.text();
  return {
    statusCode: res.status,
    schema: analyzeSchema(html, res.status),
    content: analyzeContent(url, html, res.status, res.headers.get('last-modified'), Date.now() - started),
  };
}

function diff(baseline: Snapshot, bot: Snapshot): string[] {
  const out: string[] = [];

  const baseTypes = [...baseline.schema.types].sort().join(',');
  const botTypes = [...bot.schema.types].sort().join(',');
  if (baseTypes !== botTypes) out.push(`schema types: browser=[${baseTypes}] bot=[${botTypes}]`);

  if (baseline.schema.fieldCompleteness.percent !== bot.schema.fieldCompleteness.percent) {
    out.push(
      `schema completeness: browser=${baseline.schema.fieldCompleteness.percent}% bot=${bot.schema.fieldCompleteness.percent}%`,
    );
  }
  if (baseline.schema.telephone !== bot.schema.telephone) {
    out.push(`schema telephone: browser=${baseline.schema.telephone ?? '(none)'} bot=${bot.schema.telephone ?? '(none)'}`);
  }

  const bw = baseline.content.wordCount;
  const ow = bot.content.wordCount;
  if (Math.abs(bw - ow) > Math.max(bw, ow) * WORD_COUNT_TOLERANCE) out.push(`word count: browser=${bw} bot=${ow}`);

  if (baseline.content.h1Count !== bot.content.h1Count) {
    out.push(`h1 count: browser=${baseline.content.h1Count} bot=${bot.content.h1Count}`);
  }
  if (baseline.content.statCount !== bot.content.statCount) {
    out.push(`stat count: browser=${baseline.content.statCount} bot=${bot.content.statCount}`);
  }

  return out;
}

export async function checkPerBotSignals(url: string): Promise<PerBotSignalsReport> {
  const baseline = await snapshotAs(url, BROWSER_USER_AGENT);
  const baselineUsable = baseline.schema.fetchUsable && baseline.content.fetchUsable;

  const perBot = await Promise.all(
    fetchableBots(AI_BOTS).map(async (bot): Promise<PerBotSignalResult> => {
      try {
        const snap = await snapshotAs(url, bot.userAgent);
        const usable = snap.schema.fetchUsable && snap.content.fetchUsable;
        return {
          bot: bot.token,
          statusCode: snap.statusCode,
          fetchUsable: usable,
          schemaTypes: snap.schema.types,
          schemaCompletenessPercent: snap.schema.fieldCompleteness.percent,
          wordCount: snap.content.wordCount,
          differences: baselineUsable && usable ? diff(baseline, snap) : [],
          error: null,
        };
      } catch (err) {
        return {
          bot: bot.token,
          statusCode: null,
          fetchUsable: false,
          schemaTypes: [],
          schemaCompletenessPercent: 0,
          wordCount: 0,
          differences: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { baselineUsable, perBot };
}
