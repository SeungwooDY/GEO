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

export type CheckOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SchemaReport {
  /** False when the fetch was challenged (non-200 or empty), so "no schema" can't be trusted. */
  fetchUsable: boolean;
  statusCode: number;
  found: boolean;
  types: string[];
  blockCount: number;
}

export interface DiagnosticReport {
  url: string;
  robots: CheckOutcome<RobotsReport>;
  uaDiff: CheckOutcome<UaDiffReport>;
  renderingGap: CheckOutcome<RenderingGapReport>;
  schema: CheckOutcome<SchemaReport>;
}
