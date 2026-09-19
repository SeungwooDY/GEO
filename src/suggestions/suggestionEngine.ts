import type {
  ContentSignalsReport,
  DiagnosticReport,
  PerBotSignalsReport,
  RenderingGapReport,
  RobotsReport,
  SchemaReport,
  UaDiffReport,
} from '../crawlers/types.js';

export type Severity = 'high' | 'medium' | 'low' | 'info';

/** Change-spec task types the harness knows how to execute; null = report-only finding. */
export type TaskType =
  | 'robots-rules'
  | 'add-jsonld'
  | 'complete-jsonld'
  | 'align-nap'
  | 'prerender'
  | 'align-bot-content'
  | 'check-waf-settings'
  | 'enrich-content'
  | null;

export interface Suggestion {
  /** Stable rule id, e.g. "robots.blocked". One suggestion per rule; bots are aggregated in evidence. */
  id: string;
  checkId: keyof Omit<DiagnosticReport, 'url'>;
  severity: Severity;
  /** One-line finding for the report. */
  finding: string;
  /** What to do about it. */
  action: string;
  /** Supporting data straight from the diagnostic — drives change-spec payloads and UI detail views. */
  evidence: Record<string, unknown>;
  task: TaskType;
  /** The metric to re-measure after the fix — the before/after story. */
  measurable: string;
}

export interface CheckSummary {
  checkId: keyof Omit<DiagnosticReport, 'url'>;
  status: 'pass' | 'fail' | 'warn' | 'inconclusive' | 'error';
}

export interface SuggestionsResult {
  suggestions: Suggestion[];
  /** Per-check pass/fail rollup — the "7/10 tests passed" headline. */
  checks: CheckSummary[];
}

const statusRank: Record<CheckSummary['status'], number> = {
  pass: 0,
  warn: 1,
  inconclusive: 2,
  error: 3,
  fail: 4,
};

function worst(a: CheckSummary['status'], b: CheckSummary['status']): CheckSummary['status'] {
  return statusRank[b] > statusRank[a] ? b : a;
}

function robotsRules(robots: RobotsReport, out: Suggestion[]): CheckSummary['status'] {
  const blocked = robots.perBot.filter((r) => !r.allowedTargetPath);
  if (blocked.length === 0) return 'pass';

  // Wildcard blocks are likely accidental; explicit per-bot entries are a deliberate policy choice.
  const accidental = blocked.filter((r) => !r.hasExplicitEntry);
  const deliberate = blocked.filter((r) => r.hasExplicitEntry);

  if (accidental.length > 0) {
    out.push({
      id: 'robots.blocked.wildcard',
      checkId: 'robots',
      severity: 'high',
      finding: `robots.txt blocks ${accidental.map((r) => r.bot).join(', ')} via a wildcard rule — likely unintentional.`,
      action: 'Add explicit Allow entries for AI crawlers to robots.txt.',
      evidence: { bots: accidental.map((r) => ({ bot: r.bot, matchedRule: r.matchedRule })) },
      task: 'robots-rules',
      measurable: 'per-bot robots verdict',
    });
  }
  if (deliberate.length > 0) {
    out.push({
      id: 'robots.blocked.explicit',
      checkId: 'robots',
      severity: 'high',
      finding: `robots.txt explicitly blocks ${deliberate.map((r) => r.bot).join(', ')}.`,
      action:
        'This looks deliberate. If AI visibility is wanted, remove the Disallow entries; these bots cannot cite what they cannot crawl.',
      evidence: { bots: deliberate.map((r) => ({ bot: r.bot, matchedRule: r.matchedRule })) },
      task: 'robots-rules',
      measurable: 'per-bot robots verdict',
    });
  }
  return 'fail';
}

function uaDiffRules(ua: UaDiffReport, robotsBlockedBots: Set<string>, out: Suggestion[]): CheckSummary['status'] {
  if (!ua.baselineUsable) return 'inconclusive';
  let status: CheckSummary['status'] = 'pass';

  const challenged = ua.perBot.filter((b) => b.challenged);
  if (challenged.length > 0) {
    status = worst(status, 'inconclusive');
    out.push({
      id: 'uaDiff.wafChallenged',
      checkId: 'uaDiff',
      severity: 'medium',
      finding: `A WAF (${challenged[0].challengedBy ?? 'unknown vendor'}) challenges unverified bot traffic — real-crawler access can't be measured from outside.`,
      action:
        'Check the WAF\'s AI-crawler settings (e.g. Cloudflare AI Crawl Control): AI bots may be blocked by default without the site owner ever choosing that.',
      evidence: { bots: challenged.map((b) => ({ bot: b.bot, statusCode: b.statusCode, vendor: b.challengedBy })) },
      task: 'check-waf-settings',
      measurable: 'per-bot fetch status',
    });
  }

  const blocked = ua.perBot.filter((b) => b.blocked && !b.challenged);
  if (blocked.length > 0) {
    status = worst(status, 'fail');
    out.push({
      id: 'uaDiff.originBlocked',
      checkId: 'uaDiff',
      severity: 'high',
      finding: `The site itself refuses requests from ${blocked.map((b) => b.bot).join(', ')} (UA-based filtering).`,
      action: 'Remove server/App-level UA filtering for AI crawlers, or serve them the bot-optimized version instead of an error.',
      evidence: { bots: blocked.map((b) => ({ bot: b.bot, statusCode: b.statusCode, error: b.error })) },
      task: null,
      measurable: 'per-bot fetch status',
    });
  }

  // Cascade: a bot the site blocks outright (or robots disallows) shouldn't also generate cloaking noise.
  const mismatched = ua.perBot.filter(
    (b) => b.substanceMismatch && !b.blocked && !b.challenged && !robotsBlockedBots.has(b.bot),
  );
  if (mismatched.length > 0) {
    status = worst(status, 'warn');
    out.push({
      id: 'uaDiff.contentDiffers',
      checkId: 'uaDiff',
      severity: 'medium',
      finding: `Bots receive different page text than browsers (${mismatched.map((b) => b.bot).join(', ')}).`,
      action:
        'Verify substance parity: serving bots a cleaner *format* is fine (and good GEO), but facts, claims, and offerings must match the human-visible page.',
      evidence: {
        baselineBytes: ua.baseline.contentLength,
        bots: mismatched.map((b) => ({ bot: b.bot, bytes: b.contentLength })),
        caveat: 'Exact text-hash comparison — may be a benign format difference, not cloaking.',
      },
      task: 'align-bot-content',
      measurable: 'per-bot text hash vs. baseline',
    });
  }

  return status;
}

function renderingGapRules(rg: RenderingGapReport, out: Suggestion[]): CheckSummary['status'] {
  if (!rg.rawFetchUsable) return 'inconclusive';
  if (!rg.jsDependent) return 'pass';
  out.push({
    id: 'renderingGap.jsDependent',
    checkId: 'renderingGap',
    severity: 'high',
    finding: `${rg.gapPercent}% of the page's text only exists after JavaScript runs — invisible to AI crawlers that don't render JS.`,
    action: 'Serve prerendered/SSR HTML, or route bot traffic to a static rendition of the page.',
    evidence: { gapPercent: rg.gapPercent, rawChars: rg.rawTextLength, renderedChars: rg.renderedTextLength },
    task: 'prerender',
    measurable: 'gapPercent',
  });
  return 'fail';
}

function schemaRules(sc: SchemaReport, out: Suggestion[]): CheckSummary['status'] {
  if (!sc.fetchUsable) return 'inconclusive';

  if (!sc.found) {
    out.push({
      id: 'schema.missing',
      checkId: 'schema',
      severity: 'high',
      finding: 'No JSON-LD structured data on the page.',
      action: 'Add a LocalBusiness JSON-LD block with name, address, phone, hours, and services.',
      evidence: {},
      task: 'add-jsonld',
      measurable: 'schema found + field completeness %',
    });
    return 'fail';
  }

  let status: CheckSummary['status'] = 'pass';

  if (sc.fieldCompleteness.missing.length > 0) {
    status = worst(status, 'warn');
    out.push({
      id: 'schema.incomplete',
      checkId: 'schema',
      severity: 'medium',
      finding: `Structured data is ${sc.fieldCompleteness.percent}% complete for local-business citation (missing: ${sc.fieldCompleteness.missing.join(', ')}).`,
      action: 'Add the missing fields to the existing JSON-LD block.',
      evidence: { missing: sc.fieldCompleteness.missing, present: sc.fieldCompleteness.present, types: sc.types },
      task: 'complete-jsonld',
      measurable: 'field completeness %',
    });
  }

  if (sc.telephoneInVisibleText === false) {
    status = worst(status, 'warn');
    out.push({
      id: 'schema.napMismatch',
      checkId: 'schema',
      severity: 'low',
      finding: `The schema phone number (${sc.telephone}) doesn't appear in the page's visible text.`,
      action: 'Show the same phone number on the page as in the structured data — consistency is a trust signal for extraction.',
      evidence: { schemaTelephone: sc.telephone },
      task: 'align-nap',
      measurable: 'telephoneInVisibleText',
    });
  }

  return status;
}

function contentRules(c: ContentSignalsReport, out: Suggestion[]): CheckSummary['status'] {
  if (!c.fetchUsable) return 'inconclusive';
  let status: CheckSummary['status'] = 'pass';

  // Heuristic thresholds — deliberately soft (low/info) until weights are fit against citation data.
  if (c.wordCount < 150) {
    status = worst(status, 'warn');
    out.push({
      id: 'content.thin',
      checkId: 'content',
      severity: 'low',
      finding: `Only ${c.wordCount} words of crawler-visible text.`,
      action: 'Add substantive, extraction-friendly copy: what the business does, where, for whom, at what price range.',
      evidence: { wordCount: c.wordCount, textToHtmlRatio: c.textToHtmlRatio },
      task: 'enrich-content',
      measurable: 'wordCount',
    });
  }

  if (c.h1Count === 0) {
    status = worst(status, 'warn');
    out.push({
      id: 'content.noH1',
      checkId: 'content',
      severity: 'low',
      finding: 'Page has no H1 heading.',
      action: 'Add a descriptive H1 (business name + what/where) — headings anchor extraction.',
      evidence: { h1: c.h1Count, h2: c.h2Count, h3: c.h3Count },
      task: 'enrich-content',
      measurable: 'h1Count',
    });
  }

  if (c.statCount === 0 && c.quoteCount === 0 && c.outboundLinkHosts === 0) {
    out.push({
      id: 'content.noCitableSignals',
      checkId: 'content',
      severity: 'info',
      finding: 'No statistics, quotes, or cited sources in the visible text.',
      action:
        'Consider adding concrete, citable specifics (years in business, number of customers, review quotes) — GEO literature associates these with higher citation rates. Heuristic signal; not yet validated against our own citation data.',
      evidence: { statCount: c.statCount, quoteCount: c.quoteCount, outboundLinkHosts: c.outboundLinkHosts },
      task: 'enrich-content',
      measurable: 'statCount / quoteCount / outboundLinkHosts',
    });
  }

  return status;
}

function perBotSignalRules(
  pb: PerBotSignalsReport,
  alreadyFlagged: Set<string>,
  out: Suggestion[],
): CheckSummary['status'] {
  if (!pb.baselineUsable) return 'inconclusive';

  // Cascade: skip bots that are unusable (blocked/challenged — reported by uaDiff) and bots whose
  // content difference uaDiff already flagged, so one root cause doesn't surface as three findings.
  const differing = pb.perBot.filter((b) => b.fetchUsable && !b.error && b.differences.length > 0 && !alreadyFlagged.has(b.bot));
  if (differing.length === 0) return 'pass';

  out.push({
    id: 'perBotSignals.viewDiffers',
    checkId: 'perBotSignals',
    severity: 'medium',
    finding: `Some bots see structurally different pages than browsers: ${differing.map((b) => b.bot).join(', ')}.`,
    action: 'Review the per-bot differences below and confirm bot-served pages carry the same schema and content substance.',
    evidence: {
      bots: differing.map((b) => ({
        bot: b.bot,
        differences: b.differences,
        schemaCompletenessPercent: b.schemaCompletenessPercent,
        wordCount: b.wordCount,
      })),
    },
    task: 'align-bot-content',
    measurable: 'per-bot differences count',
  });
  return 'warn';
}

export function buildSuggestions(report: DiagnosticReport): SuggestionsResult {
  const suggestions: Suggestion[] = [];
  const checks: CheckSummary[] = [];

  const robotsBlockedBots = new Set<string>(
    report.robots.ok ? report.robots.data.perBot.filter((r) => !r.allowedTargetPath).map((r) => r.bot) : [],
  );

  checks.push({
    checkId: 'robots',
    status: report.robots.ok ? robotsRules(report.robots.data, suggestions) : 'error',
  });

  checks.push({
    checkId: 'uaDiff',
    status: report.uaDiff.ok ? uaDiffRules(report.uaDiff.data, robotsBlockedBots, suggestions) : 'error',
  });

  // Bots whose content difference is already reported by uaDiff (any state other than a clean OK).
  const flaggedByUaDiff = new Set<string>(
    report.uaDiff.ok
      ? report.uaDiff.data.perBot
          .filter((b) => b.substanceMismatch || b.blocked || b.challenged)
          .map((b) => b.bot)
      : [],
  );

  checks.push({
    checkId: 'renderingGap',
    status: report.renderingGap.ok ? renderingGapRules(report.renderingGap.data, suggestions) : 'error',
  });

  checks.push({
    checkId: 'schema',
    status: report.schema.ok ? schemaRules(report.schema.data, suggestions) : 'error',
  });

  checks.push({
    checkId: 'content',
    status: report.content.ok ? contentRules(report.content.data, suggestions) : 'error',
  });

  checks.push({
    checkId: 'perBotSignals',
    status: report.perBotSignals.ok
      ? perBotSignalRules(report.perBotSignals.data, flaggedByUaDiff, suggestions)
      : 'error',
  });

  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  suggestions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { suggestions, checks };
}
