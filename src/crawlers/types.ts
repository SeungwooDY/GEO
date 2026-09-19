export interface RobotsRuleResult {
  bot: string;
  allowedTargetPath: boolean;
  matchedRule: string | null;
  hasExplicitEntry: boolean;
}

export interface RobotsReport {
  robotsTxtFound: boolean;
  targetPath: string;
  perBot: RobotsRuleResult[];
}

export interface UaDiffResult {
  bot: string;
  vendor: string;
  statusCode: number | null;
  contentLength: number;
  textHash: string | null;
  substanceMismatch: boolean;
  blocked: boolean;
  error: string | null;
}

export interface UaDiffReport {
  baseline: { statusCode: number | null; contentLength: number; textHash: string | null };
  /** False when the browser-UA baseline itself was challenged (non-200 or empty), making the comparison meaningless. */
  baselineUsable: boolean;
  perBot: UaDiffResult[];
}

export interface RenderingGapReport {
  rawStatusCode: number;
  /** False when the raw fetch was challenged (non-200 or empty), so the gap can't be trusted. */
  rawFetchUsable: boolean;
  rawTextLength: number;
  renderedTextLength: number;
  gapPercent: number;
  jsDependent: boolean;
}

export interface PerBotSignalResult {
  bot: string;
  statusCode: number | null;
  fetchUsable: boolean;
  schemaTypes: string[];
  schemaCompletenessPercent: number;
  wordCount: number;
  /** Human-readable differences from the browser-UA view; empty when identical (or not comparable). */
  differences: string[];
  error: string | null;
}

export interface PerBotSignalsReport {
  baselineUsable: boolean;
  perBot: PerBotSignalResult[];
}

export type CheckOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SchemaReport {
  /** False when the fetch was challenged (non-200 or empty), so "no schema" can't be trusted. */
  fetchUsable: boolean;
  statusCode: number;
  found: boolean;
  types: string[];
  blockCount: number;
  /** Which local-business fields appear anywhere in the JSON-LD; percent = present / total tracked. */
  fieldCompleteness: { present: string[]; missing: string[]; percent: number };
  /** Phone number from schema, and whether its digits appear in the page's visible text (NAP agreement). */
  telephone: string | null;
  telephoneInVisibleText: boolean | null;
}

export interface ContentSignalsReport {
  fetchUsable: boolean;
  statusCode: number;
  responseTimeMs: number;
  htmlBytes: number;
  wordCount: number;
  textToHtmlRatio: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  /** Heuristic count of percentages, dollar amounts and unit-bearing numbers in visible text. */
  statCount: number;
  quoteCount: number;
  /** Distinct external hostnames linked from the page (proxy for cited sources). */
  outboundLinkHosts: number;
  questionHeadings: number;
  lastModifiedHeader: string | null;
}

export interface DiagnosticReport {
  url: string;
  robots: CheckOutcome<RobotsReport>;
  uaDiff: CheckOutcome<UaDiffReport>;
  renderingGap: CheckOutcome<RenderingGapReport>;
  schema: CheckOutcome<SchemaReport>;
  content: CheckOutcome<ContentSignalsReport>;
  perBotSignals: CheckOutcome<PerBotSignalsReport>;
}
