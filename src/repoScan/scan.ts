import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_BOTS } from '../crawlers/botUserAgents.js';
import { evaluateRobotsTxt } from '../crawlers/robotsParser.js';
import { analyzeSchema } from '../crawlers/schemaChecker.js';
import { extractVisibleText } from '../crawlers/htmlText.js';
import { detectFramework } from './frameworkDetect.js';
import { buildEditTargets, walkFiles } from './locators.js';
import type { RepoCheck, RepoScanReport } from './types.js';

const GITHUB_URL = /^https:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/;

/** Shallow-clones a GitHub URL to a temp dir, or passes a local path through. */
export function resolveRepo(input: string): { path: string; cleanup: () => void } {
  if (GITHUB_URL.test(input)) {
    const dir = mkdtempSync(join(tmpdir(), 'repo-scan-'));
    execFileSync('git', ['clone', '--depth', '1', '--quiet', input, dir], { stdio: 'pipe', timeout: 120_000 });
    return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  if (!existsSync(input)) throw new Error(`Not a GitHub URL and not a local path: ${input}`);
  return { path: input, cleanup: () => {} };
}

const read = (repoPath: string, rel: string): string => readFileSync(join(repoPath, rel), 'utf8');

const na = (id: RepoCheck['id'], label: string, sub: string): RepoCheck => ({
  id, label, status: 'na', provenance: 'not-derivable', headline: 'Not derivable from source', sub, evidence: {},
});

const RENDER_SCORE: Record<string, number> = { ssg: 3, ssr: 3, spa: 2, static: 1, unknown: 0 };

/**
 * Monorepos keep the deployable site in a workspace (apps/web, packages/site…), so a root-level scan
 * finds nothing and edits would land where no deploy serves them. When the root has no framework,
 * look one level into workspace/common directories and pick the most site-shaped package.
 */
export function findAppRoot(repoPath: string): string {
  if (detectFramework(repoPath).framework !== 'unknown') return '';

  const parents = new Set(['apps', 'packages', 'sites', 'web', 'frontend', 'site']);
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    const globs: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
    for (const g of globs) {
      const parent = g.replace(/\/?\*+.*$/, '');
      if (parent && !parent.includes('*')) parents.add(parent);
    }
  } catch {
    /* no root package.json — still try the common directories */
  }

  let best: { dir: string; score: number } | null = null;
  for (const parent of parents) {
    const parentAbs = join(repoPath, parent);
    if (!existsSync(parentAbs)) continue;
    // `web`/`frontend` may themselves be the app; directories like `apps` hold apps one level down.
    const candidates = statSync(parentAbs).isDirectory()
      ? [parent, ...readdirSync(parentAbs).map((d) => join(parent, d))]
      : [];
    for (const dir of candidates) {
      const abs = join(repoPath, dir);
      try {
        if (!statSync(abs).isDirectory() || !existsSync(join(abs, 'package.json'))) continue;
      } catch {
        continue;
      }
      const score = RENDER_SCORE[detectFramework(abs).rendering];
      if (score > 0 && (!best || score > best.score)) best = { dir, score };
    }
  }
  return best?.dir ?? '';
}

export function scanRepo(repoPath: string, source: string): RepoScanReport {
  const appRoot = findAppRoot(repoPath);
  const base = appRoot ? join(repoPath, appRoot) : repoPath;
  /** Repo-relative form of a base-relative path — what every report field carries. */
  const rel = (p: string): string => (appRoot ? join(appRoot, p) : p);

  const framework = detectFramework(base);
  const rawTargets = buildEditTargets(base, framework);
  const editTargets = {
    robots: { ...rawTargets.robots, path: rel(rawTargets.robots.path) },
    llmsTxt: { ...rawTargets.llmsTxt, path: rel(rawTargets.llmsTxt.path) },
    sitemap: { ...rawTargets.sitemap, path: rel(rawTargets.sitemap.path) },
    headTemplate: rawTargets.headTemplate ? rel(rawTargets.headTemplate) : null,
    staticDir: rel(rawTargets.staticDir),
  };
  const checks: RepoCheck[] = [];
  // Everything below reads from `base` with base-relative paths; report fields use rel(...).
  repoPath = base;

  // 1. Crawler access — the repo's actual robots.txt, parsed with the same RFC 9309 evaluator as the live check.
  if (rawTargets.robots.exists && !rawTargets.robots.generated) {
    const perBot = evaluateRobotsTxt(read(repoPath, rawTargets.robots.path), '/');
    const allowed = perBot.filter((b) => b.allowedTargetPath).length;
    checks.push({
      id: 'access', label: 'Crawler access', provenance: 'measured',
      status: allowed === perBot.length ? 'ok' : allowed === 0 ? 'bad' : 'warn',
      headline: `${allowed} of ${perBot.length} bots allowed`,
      sub: `${editTargets.robots.path} in repo`,
      evidence: { path: editTargets.robots.path, perBot },
    });
  } else if (rawTargets.robots.exists && rawTargets.robots.generated) {
    checks.push({
      id: 'access', label: 'Crawler access', provenance: 'inferred', status: 'warn',
      headline: 'robots.txt is generated by code',
      sub: `${editTargets.robots.path} builds it at runtime — rules not statically readable`,
      evidence: { path: editTargets.robots.path },
    });
  } else {
    checks.push({
      id: 'access', label: 'Crawler access', provenance: 'measured', status: 'ok',
      headline: `${AI_BOTS.length} of ${AI_BOTS.length} bots allowed`,
      sub: 'No robots.txt in repo (everything is allowed by default)',
      evidence: { path: null },
    });
  }

  // 2. Cloaking — runtime serving behavior; a codebase cannot show what different UAs receive.
  checks.push(na('cloaking', 'Cloaking', 'What each UA is served is decided at runtime; scan the live URL for this.'));

  // 3. Extraction — inferred from the rendering model instead of measured with a headless browser.
  const renderVerdict: Record<string, { status: RepoCheck['status']; headline: string; sub: string }> = {
    spa: { status: 'bad', headline: 'Client-rendered SPA', sub: 'Content is built by JavaScript in the browser; non-rendering AI crawlers see an empty shell.' },
    ssg: { status: 'ok', headline: 'Pre-rendered at build time', sub: 'Full HTML is served; crawlers see the content without running JS.' },
    ssr: { status: 'ok', headline: 'Server-rendered', sub: 'Full HTML is served per request; crawlers see the content without running JS.' },
    static: { status: 'ok', headline: 'Static HTML', sub: 'Plain HTML files; nothing depends on JS.' },
    unknown: { status: 'na', headline: 'Rendering model unknown', sub: 'No framework signature matched; scan the live URL to measure.' },
  };
  const rv = renderVerdict[framework.rendering];
  checks.push({
    id: 'extraction', label: 'Extraction', provenance: framework.rendering === 'unknown' ? 'not-derivable' : 'inferred',
    status: rv.status, headline: rv.headline, sub: rv.sub,
    evidence: { framework: framework.framework, rendering: framework.rendering, frameworkEvidence: framework.evidence },
  });

  // 4. Structured data — parse literal HTML with the live check's own analyzer; grep templates for the rest.
  const htmlFiles = walkFiles(repoPath, ['.html']);
  let best: ReturnType<typeof analyzeSchema> | null = null;
  let bestFile: string | null = null;
  for (const file of htmlFiles.slice(0, 50)) {
    try {
      const result = analyzeSchema(read(repoPath, file), 200);
      if (result.found && (best === null || result.fieldCompleteness.percent > best.fieldCompleteness.percent)) {
        best = result;
        bestFile = file;
      }
    } catch {
      /* unparseable file proves nothing */
    }
  }
  const templates = walkFiles(repoPath, ['.tsx', '.jsx', '.astro', '.vue', '.svelte', '.php', '.ejs', '.liquid'])
    .filter((f) => {
      try {
        return read(repoPath, f).includes('application/ld+json');
      } catch {
        return false;
      }
    });

  if (best && bestFile) {
    checks.push({
      id: 'structured', label: 'Structured data', provenance: 'measured',
      status: best.fieldCompleteness.percent >= 70 ? 'ok' : 'warn',
      headline: best.types.join(', ') || `${best.blockCount} JSON-LD block(s)`,
      sub: `${best.fieldCompleteness.percent}% of local-business fields present (${rel(bestFile)})`,
      evidence: { file: rel(bestFile), types: best.types, fieldCompleteness: best.fieldCompleteness },
    });
  } else if (templates.length > 0) {
    checks.push({
      id: 'structured', label: 'Structured data', provenance: 'inferred', status: 'warn',
      headline: 'JSON-LD authored in templates',
      sub: `Found in ${templates.length} template file(s); rendered values not statically readable.`,
      evidence: { templates: templates.slice(0, 10).map(rel) },
    });
  } else {
    checks.push({
      id: 'structured', label: 'Structured data', provenance: 'measured', status: 'bad',
      headline: 'None found',
      sub: 'No JSON-LD in any HTML file or template.',
      evidence: { htmlFilesScanned: htmlFiles.length, templatesScanned: templates.length },
    });
  }

  // 5. Content — only meaningful when the content actually lives in the repo (markdown or static HTML).
  const contentFiles = [...walkFiles(repoPath, ['.md', '.mdx']), ...htmlFiles].slice(0, 100);
  if (contentFiles.length > 0) {
    let words = 0;
    for (const file of contentFiles) {
      try {
        const text = file.endsWith('.html') ? extractVisibleText(read(repoPath, file)) : read(repoPath, file);
        words += text.split(/\s+/).filter(Boolean).length;
      } catch {
        /* skip unreadable file */
      }
    }
    checks.push({
      id: 'content', label: 'Content', provenance: 'inferred',
      status: words >= 800 ? 'ok' : words >= 300 ? 'warn' : 'bad',
      headline: `${words.toLocaleString()} words in repo content`,
      sub: `${contentFiles.length} markdown/HTML file(s); CMS- or API-sourced content is not visible here.`,
      evidence: { files: contentFiles.length, words },
    });
  } else {
    checks.push(na('content', 'Content', 'No markdown or HTML content in the repo — content likely comes from a CMS or API.'));
  }

  // 6. Per-bot parity — runtime behavior, same as cloaking.
  checks.push(na('perbot', 'Per-bot parity', 'What each bot receives is decided at runtime; scan the live URL for this.'));

  return { schemaVersion: 1, source, appRoot, framework, checks, editTargets };
}
