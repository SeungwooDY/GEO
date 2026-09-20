/**
 * Repo-scan: the second evidence collector. Where the URL diagnostics observe the *deployed* site
 * over HTTP, this reads a checked-out codebase for the same class of findings. Pattern evidence is
 * weaker than probe evidence, so every check carries a provenance:
 *  - 'measured'      — read directly from a real artifact in the repo (an actual robots.txt file)
 *  - 'inferred'      — deduced from patterns (a Vite SPA implies JS-only content)
 *  - 'not-derivable' — runtime serving behavior (cloaking, WAF) that source code cannot show
 */
export type Provenance = 'measured' | 'inferred' | 'not-derivable';

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'na';

/** Same card ids and status vocabulary as src/report/checks.js, so the UI can render either source. */
export interface RepoCheck {
  id: 'access' | 'cloaking' | 'extraction' | 'structured' | 'content' | 'perbot';
  label: string;
  status: CheckStatus;
  provenance: Provenance;
  headline: string;
  sub: string;
  evidence: Record<string, unknown>;
}

export type Rendering = 'ssr' | 'ssg' | 'spa' | 'static' | 'unknown';

export interface FrameworkInfo {
  framework: string;
  rendering: Rendering;
  /** What led to the conclusion, e.g. "next in dependencies", "app/ directory present". */
  evidence: string[];
}

/** Where a located artifact lives, or where a generated one should go. */
export interface FileTarget {
  /** Repo-relative path. */
  path: string;
  exists: boolean;
  /** True when the artifact is produced by code (e.g. app/robots.ts) rather than a literal file. */
  generated: boolean;
}

/**
 * The placement map for the PR agent: which repo paths correspond to the URL-world artifacts the
 * generators produce. This is what makes repo findings *actionable* — detection and edit-target
 * discovery are the same pass.
 */
export interface EditTargets {
  robots: FileTarget;
  llmsTxt: FileTarget;
  sitemap: FileTarget;
  /** The file that renders the page <head>, for JSON-LD placement. Null when none was found. */
  headTemplate: string | null;
  /** Directory served verbatim at the site root (public/, static/, or the repo root). */
  staticDir: string;
}

export interface RepoScanReport {
  schemaVersion: 1;
  /** What was scanned: a GitHub URL or a local path. */
  source: string;
  /**
   * Repo-relative directory of the deployable web app ('' when it's the repo root). Monorepos keep
   * the site in a workspace (apps/web, packages/site…); every path in this report is prefixed with
   * it so edits land where the deploy actually serves from.
   */
  appRoot: string;
  framework: FrameworkInfo;
  checks: RepoCheck[];
  editTargets: EditTargets;
}
