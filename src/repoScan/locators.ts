import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { EditTargets, FileTarget, FrameworkInfo } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', 'coverage', '.cache', 'vendor']);
const MAX_FILES = 400;
const MAX_DEPTH = 6;

/** Bounded repo walk: skips build output and dependency dirs, caps count and depth so a monorepo can't hang the scan. */
export function walkFiles(repoPath: string, extensions: string[]): string[] {
  const found: string[] = [];
  const exts = new Set(extensions);

  const visit = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(full, depth + 1);
      else if (exts.has(entry.slice(entry.lastIndexOf('.')))) found.push(relative(repoPath, full));
    }
  };

  visit(repoPath, 0);
  return found;
}

function firstExisting(repoPath: string, candidates: string[]): string | null {
  return candidates.find((c) => existsSync(join(repoPath, c))) ?? null;
}

/** Directory whose contents are served verbatim at the site root, per framework convention. */
export function staticDirFor(repoPath: string, fw: FrameworkInfo): string {
  const conventions: Record<string, string[]> = {
    next: ['public'],
    'create-react-app': ['public'],
    'vite-spa': ['public'],
    remix: ['public'],
    astro: ['public'],
    sveltekit: ['static'],
    nuxt: ['public', 'static'],
    gatsby: ['static'],
    jekyll: [''],
    hugo: ['static'],
    'static-html': ['public', ''],
  };
  const dirs = conventions[fw.framework];
  if (dirs) {
    // Known framework: prefer an existing conventional dir, else recommend the convention itself —
    // the writer mkdirs it, and "create public/robots.txt" beats dropping files at the app root.
    return dirs.find((d) => d === '' || existsSync(join(repoPath, d))) ?? dirs[0] ?? '';
  }
  for (const dir of ['public', 'static']) {
    if (existsSync(join(repoPath, dir))) return dir;
  }
  return '';
}

const ROBOTS_LITERALS = ['robots.txt', 'public/robots.txt', 'static/robots.txt', 'src/public/robots.txt'];
// Frameworks that generate robots.txt from code; presence means "exists but not a literal file".
const ROBOTS_GENERATED = ['app/robots.ts', 'app/robots.js', 'src/app/robots.ts', 'src/app/robots.js'];

export function locateRobots(repoPath: string, staticDir: string): FileTarget {
  const literal = firstExisting(repoPath, ROBOTS_LITERALS);
  if (literal) return { path: literal, exists: true, generated: false };
  const generated = firstExisting(repoPath, ROBOTS_GENERATED);
  if (generated) return { path: generated, exists: true, generated: true };
  return { path: join(staticDir, 'robots.txt'), exists: false, generated: false };
}

export function locateLlmsTxt(repoPath: string, staticDir: string): FileTarget {
  const literal = firstExisting(repoPath, ['llms.txt', 'public/llms.txt', 'static/llms.txt']);
  if (literal) return { path: literal, exists: true, generated: false };
  return { path: join(staticDir, 'llms.txt'), exists: false, generated: false };
}

export function locateSitemap(repoPath: string, staticDir: string): FileTarget {
  const literal = firstExisting(repoPath, ['sitemap.xml', 'public/sitemap.xml', 'static/sitemap.xml']);
  if (literal) return { path: literal, exists: true, generated: false };
  const generated = firstExisting(repoPath, ['app/sitemap.ts', 'app/sitemap.js', 'src/app/sitemap.ts', 'next-sitemap.config.js']);
  if (generated) return { path: generated, exists: true, generated: true };
  return { path: join(staticDir, 'sitemap.xml'), exists: false, generated: false };
}

// Where the page <head> is authored, in rough order of framework specificity. JSON-LD lands here.
const HEAD_TEMPLATES = [
  'app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx',
  'pages/_document.tsx', 'pages/_document.jsx', 'src/pages/_document.tsx',
  'src/routes/+layout.svelte', 'app/root.tsx',
  'src/layouts/Layout.astro', 'src/layouts/BaseLayout.astro',
  'index.html', 'public/index.html',
];

export function locateHeadTemplate(repoPath: string): string | null {
  return firstExisting(repoPath, HEAD_TEMPLATES);
}

export function buildEditTargets(repoPath: string, fw: FrameworkInfo): EditTargets {
  const staticDir = staticDirFor(repoPath, fw);
  return {
    robots: locateRobots(repoPath, staticDir),
    llmsTxt: locateLlmsTxt(repoPath, staticDir),
    sitemap: locateSitemap(repoPath, staticDir),
    headTemplate: locateHeadTemplate(repoPath),
    staticDir,
  };
}
