import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateAiBotRobots, generateLlmsTxt } from '../generators/configGenerator.js';
import { generateSchema, renderJsonLdScript } from '../generators/schemaGenerator.js';
import { missingFields, sanitizeProfileInput, toProfile, stripAiGroups } from '../../server/files.js';
import { scanRepo } from '../repoScan/scan.js';
import type { RepoScanReport } from '../repoScan/types.js';
import type { DeliveryMode } from '../mode.js';

/**
 * The deterministic `apply` for deliverChange: writes the same config files the URL report's
 * "Suggested Files" tab shows, at the paths the repo scan located. No agent, no LLM — the honesty
 * rules carry over: only files that need no business facts are written (robots.txt today); anything
 * fact-dependent is skipped and listed in the PR body instead of being fabricated.
 */
export interface RepoFixSummary {
  scan: RepoScanReport;
  written: { path: string; what: string }[];
  skipped: { what: string; reason: string }[];
}

export async function applyRepoFix(dir: string, mode: DeliveryMode, profileInput?: unknown): Promise<RepoFixSummary> {
  const scan = scanRepo(dir, dir);
  const written: RepoFixSummary['written'] = [];
  const skipped: RepoFixSummary['skipped'] = [];

  // robots.txt — the one artifact every mode needs and the only one that needs no business facts.
  const robots = scan.editTargets.robots;
  if (robots.generated) {
    skipped.push({
      what: 'robots.txt',
      reason: `${robots.path} generates robots.txt in code; editing generator source is agent-tier work, not a config commit.`,
    });
  } else {
    const section = `# Aperture: AI crawler policy (${mode})\n${generateAiBotRobots(mode).trimEnd()}\n`;
    const content = robots.exists
      ? `${stripAiGroups(readFileSync(join(dir, robots.path), 'utf8')).trimEnd()}\n\n${section}`.replace(/^\n+/, '')
      : section;
    const abs = join(dir, robots.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written.push({ path: robots.path, what: robots.exists ? 'robots.txt (merged — non-AI rules kept)' : 'robots.txt (new)' });
  }

  // Fact-dependent files (llms.txt, JSON-LD) need a validated business profile. Without one,
  // skipping honestly beats fabricating names or addresses.
  const sanitized = sanitizeProfileInput(profileInput);
  const profile = toProfile(sanitized);

  if (mode === 'cloak') {
    skipped.push({ what: 'llms.txt / JSON-LD', reason: 'cloak mode hides content from AI engines; fact files would work against it.' });
  } else if (!profile) {
    const missing = missingFields(sanitized);
    skipped.push({
      what: 'llms.txt / JSON-LD',
      reason: `needs validated business facts — ${missing.length ? `missing: ${missing.join(', ')}` : 'no profile supplied'}. Fill in the details form to include them.`,
    });
  } else {
    // llms.txt — plain generated file at the located static path.
    const llms = scan.editTargets.llmsTxt;
    const llmsAbs = join(dir, llms.path);
    mkdirSync(dirname(llmsAbs), { recursive: true });
    writeFileSync(llmsAbs, generateLlmsTxt(profile));
    written.push({ path: llms.path, what: llms.exists ? 'llms.txt (regenerated from the supplied facts)' : 'llms.txt (new)' });

    // JSON-LD — three tiers by what the head template is:
    //   literal .html  -> deterministic string insertion (below)
    //   framework file -> gated Claude edit (insertion-only or it's discarded) when a key is configured
    //   nothing found  -> skip
    const head = scan.editTargets.headTemplate;
    if (!head || !existsSync(join(dir, head))) {
      skipped.push({ what: 'JSON-LD', reason: 'no head template found to insert into.' });
    } else if (!head.endsWith('.html')) {
      if (!process.env.ANTHROPIC_API_KEY) {
        skipped.push({ what: 'JSON-LD', reason: `head is authored in ${head} — the agent edit needs ANTHROPIC_API_KEY.` });
      } else {
        const source = readFileSync(join(dir, head), 'utf8');
        if (source.includes('application/ld+json')) {
          skipped.push({ what: 'JSON-LD', reason: `${head} already carries JSON-LD — not overwriting hand-authored markup.` });
        } else {
          const { insertJsonLdWithAgent } = await import('./agentEdit.js');
          const jsonLd = JSON.stringify(generateSchema(profile), null, 2);
          const result = await insertJsonLdWithAgent(head, source, jsonLd);
          if (result.ok && result.content) {
            writeFileSync(join(dir, head), result.content);
            written.push({ path: head, what: 'JSON-LD LocalBusiness block inserted (guarded Claude edit: insertion-only, exact payload)' });
          } else {
            skipped.push({ what: 'JSON-LD', reason: `agent edit of ${head} rejected — ${result.reason}.` });
          }
        }
      }
    } else {
      const html = readFileSync(join(dir, head), 'utf8');
      if (html.includes('application/ld+json')) {
        skipped.push({ what: 'JSON-LD', reason: `${head} already carries JSON-LD — not overwriting hand-authored markup.` });
      } else if (!/<\/head>/i.test(html)) {
        skipped.push({ what: 'JSON-LD', reason: `${head} has no </head> to insert before.` });
      } else {
        const script = `  ${renderJsonLdScript(generateSchema(profile))}\n`;
        writeFileSync(join(dir, head), html.replace(/<\/head>/i, `${script}</head>`));
        written.push({ path: head, what: 'JSON-LD LocalBusiness block inserted into <head>' });
      }
    }
  }

  return { scan, written, skipped };
}

export function describeFix(summary: RepoFixSummary, mode: DeliveryMode): { title: string; body: string } {
  const lines = [
    `GEO config for exposure mode **${mode}**, generated by Aperture from a scan of this repository.`,
    '',
    '### Changes',
    ...summary.written.map((w) => `- \`${w.path}\` — ${w.what}`),
    '',
    '### Skipped (not fabricated)',
    ...summary.skipped.map((s) => `- ${s.what}: ${s.reason}`),
    '',
    `### Repo scan (${summary.scan.framework.framework}, ${summary.scan.framework.rendering})`,
    ...summary.scan.checks.map((c) => `- ${c.status.toUpperCase().padEnd(4)} ${c.label}: ${c.headline} _[${c.provenance}]_`),
  ];
  return { title: `Aperture: AI crawler config (${mode})`, body: lines.join('\n') };
}
