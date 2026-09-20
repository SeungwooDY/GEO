import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectFramework } from './frameworkDetect.js';
import { buildEditTargets } from './locators.js';
import { scanRepo } from './scan.js';

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-scan-fixture-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('detectFramework', () => {
  it('identifies a Vite SPA as client-rendered', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ dependencies: { react: '^18' }, devDependencies: { vite: '^5' } }),
      'index.html': '<html><body><div id="root"></div></body></html>',
    });
    const fw = detectFramework(dir);
    expect(fw.framework).toBe('vite-spa');
    expect(fw.rendering).toBe('spa');
  });

  it('identifies Next.js before its underlying tooling', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ dependencies: { next: '^14', react: '^18' }, devDependencies: { vite: '^5' } }),
      'app/layout.tsx': 'export default function Layout() {}',
    });
    expect(detectFramework(dir).framework).toBe('next');
  });

  it('identifies plain HTML with no package.json as static', () => {
    const dir = fixture({ 'index.html': '<html></html>' });
    const fw = detectFramework(dir);
    expect(fw.framework).toBe('static-html');
    expect(fw.rendering).toBe('static');
  });
});

describe('buildEditTargets', () => {
  it('finds an existing public/robots.txt and reports it as literal', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' } }),
      'public/robots.txt': 'User-agent: *\nAllow: /\n',
    });
    const targets = buildEditTargets(dir, detectFramework(dir));
    expect(targets.robots).toEqual({ path: 'public/robots.txt', exists: true, generated: false });
  });

  it('flags Next.js app/robots.ts as generated', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ dependencies: { next: '^14' } }),
      'app/robots.ts': 'export default function robots() { return {} }',
    });
    const targets = buildEditTargets(dir, detectFramework(dir));
    expect(targets.robots.generated).toBe(true);
  });

  it('recommends a location when robots.txt is missing', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' } }),
      'public/index.html': '<html></html>',
    });
    const targets = buildEditTargets(dir, detectFramework(dir));
    expect(targets.robots.exists).toBe(false);
    expect(targets.robots.path).toBe('public/robots.txt');
  });
});

describe('scanRepo', () => {
  it('parses a literal robots.txt with the shared evaluator and blocks show up', () => {
    const dir = fixture({
      'index.html': '<html><body>hello world</body></html>',
      'robots.txt': 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
    });
    const report = scanRepo(dir, dir);
    const access = report.checks.find((c) => c.id === 'access');
    expect(access?.status).toBe('warn');
    expect(access?.provenance).toBe('measured');
    const perBot = access?.evidence.perBot as Array<{ bot: string; allowedTargetPath: boolean }>;
    expect(perBot.find((b) => b.bot === 'GPTBot')?.allowedTargetPath).toBe(false);
  });

  it('marks runtime-only checks as not derivable', () => {
    const dir = fixture({ 'index.html': '<html></html>' });
    const report = scanRepo(dir, dir);
    expect(report.checks.find((c) => c.id === 'cloaking')?.status).toBe('na');
    expect(report.checks.find((c) => c.id === 'perbot')?.provenance).toBe('not-derivable');
  });

  it('finds JSON-LD in static HTML via the shared analyzer', () => {
    const dir = fixture({
      'index.html': `<html><head><script type="application/ld+json">{"@type":"LocalBusiness","name":"Mario's","telephone":"555-0142","address":"1 Main St"}</script></head><body>Mario's Pizza 555-0142</body></html>`,
    });
    const report = scanRepo(dir, dir);
    const structured = report.checks.find((c) => c.id === 'structured');
    expect(structured?.provenance).toBe('measured');
    expect(structured?.headline).toContain('LocalBusiness');
  });

  it('finds the app in a monorepo workspace and prefixes every path with it', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': JSON.stringify({ dependencies: { next: '^15' } }),
      'apps/web/app/layout.tsx': 'export default function RootLayout() {}',
      'packages/core/package.json': JSON.stringify({ name: 'core' }),
    });
    const report = scanRepo(dir, dir);
    expect(report.appRoot).toBe('apps/web');
    expect(report.framework.framework).toBe('next');
    expect(report.editTargets.robots.path).toBe('apps/web/public/robots.txt');
    expect(report.editTargets.headTemplate).toBe('apps/web/app/layout.tsx');
  });

  it('infers extraction risk for an SPA', () => {
    const dir = fixture({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' }, dependencies: { react: '^18' } }),
      'index.html': '<html><body><div id="root"></div></body></html>',
    });
    const report = scanRepo(dir, dir);
    const extraction = report.checks.find((c) => c.id === 'extraction');
    expect(extraction?.status).toBe('bad');
    expect(extraction?.provenance).toBe('inferred');
  });
});
