import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkInfo, Rendering } from './types.js';

interface Signature {
  framework: string;
  rendering: Rendering;
  /** Any dependency name that identifies the framework. */
  deps?: string[];
  /** Any file/directory whose presence identifies the framework. */
  files?: string[];
}

// Order matters: meta-frameworks (which imply SSR/SSG) must match before their underlying tools —
// a Next.js app also has react and often vite-adjacent tooling in its lockfile.
const SIGNATURES: Signature[] = [
  { framework: 'next', rendering: 'ssg', deps: ['next'] },
  { framework: 'remix', rendering: 'ssr', deps: ['@remix-run/react', '@remix-run/node'] },
  { framework: 'nuxt', rendering: 'ssg', deps: ['nuxt'] },
  { framework: 'sveltekit', rendering: 'ssg', deps: ['@sveltejs/kit'] },
  { framework: 'astro', rendering: 'ssg', deps: ['astro'] },
  { framework: 'gatsby', rendering: 'ssg', deps: ['gatsby'] },
  { framework: 'docusaurus', rendering: 'ssg', deps: ['@docusaurus/core'] },
  { framework: 'eleventy', rendering: 'ssg', deps: ['@11ty/eleventy'] },
  { framework: 'create-react-app', rendering: 'spa', deps: ['react-scripts'] },
  // Bare bundler + UI library with no meta-framework above: client-rendered SPA.
  { framework: 'vite-spa', rendering: 'spa', deps: ['vite'] },
  { framework: 'jekyll', rendering: 'static', files: ['_config.yml'] },
  { framework: 'hugo', rendering: 'static', files: ['hugo.toml', 'hugo.yaml', 'config.toml'] },
];

function readPackageJson(repoPath: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

export function detectFramework(repoPath: string): FrameworkInfo {
  const deps = readPackageJson(repoPath);
  const evidence: string[] = [];

  for (const sig of SIGNATURES) {
    const depHit = sig.deps?.find((d) => d in deps);
    const fileHit = sig.files?.find((f) => existsSync(join(repoPath, f)));
    if (!depHit && !fileHit) continue;

    if (depHit) evidence.push(`"${depHit}" in package.json`);
    if (fileHit) evidence.push(`${fileHit} present`);

    let rendering = sig.rendering;
    // Next.js: output mode and router shape refine the default guess.
    if (sig.framework === 'next') {
      if (existsSync(join(repoPath, 'app')) || existsSync(join(repoPath, 'src/app'))) evidence.push('app router');
      else if (existsSync(join(repoPath, 'pages')) || existsSync(join(repoPath, 'src/pages'))) evidence.push('pages router');
    }
    return { framework: sig.framework, rendering, evidence };
  }

  // No package.json signature: a repo whose root (or public/) holds .html is a plain static site.
  for (const dir of ['', 'public', 'docs', 'site']) {
    if (existsSync(join(repoPath, dir, 'index.html'))) {
      evidence.push(join(dir, 'index.html') + ' present, no framework dependency');
      return { framework: 'static-html', rendering: 'static', evidence };
    }
  }

  return { framework: 'unknown', rendering: 'unknown', evidence: ['no framework signature matched'] };
}
