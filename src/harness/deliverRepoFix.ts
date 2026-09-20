/**
 * One-shot: scan a GitHub repo, write the deterministic GEO config files, and open a PR as the App.
 *
 *   npx tsx --env-file=.env src/harness/deliverRepoFix.ts https://github.com/owner/repo            # dry run: prints the diff
 *   npx tsx --env-file=.env src/harness/deliverRepoFix.ts https://github.com/owner/repo --pr       # real branch + PR
 *   npx tsx --env-file=.env src/harness/deliverRepoFix.ts <url> --mode cloak --pr
 *
 * Dry run needs no credentials at all (public repo, anonymous clone, nothing pushed).
 * --pr needs the GitHub App env (GITHUB_APP_ID, key, webhook secret) AND the App installed on the repo.
 */
import { loadHarnessConfig } from './config.js';
import { createGithubApp, prepareRepoDelivery } from './github.js';
import { deliverChange } from './deliver.js';
import { branchNameFor, git } from './git.js';
import { applyRepoFix, describeFix, type RepoFixSummary } from './repoFix.js';
import { DELIVERY_MODES, type DeliveryMode } from '../mode.js';

function parseArgs(argv: string[]): { repoUrl: string; owner: string; name: string; mode: DeliveryMode; pr: boolean } {
  const pr = argv.includes('--pr');
  const modeIdx = argv.indexOf('--mode');
  const mode = (modeIdx >= 0 ? argv[modeIdx + 1] : 'mirror') as DeliveryMode;
  if (!DELIVERY_MODES.includes(mode)) throw new Error(`--mode must be one of ${DELIVERY_MODES.join(', ')}`);
  const repoUrl = argv.find((a) => /^https:\/\/(www\.)?github\.com\//.test(a));
  if (!repoUrl) throw new Error('usage: deliverRepoFix.ts https://github.com/owner/repo [--mode mirror|amplify|cloak] [--pr]');
  const m = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`could not parse owner/repo from ${repoUrl}`);
  return { repoUrl: `https://github.com/${m[1]}/${m[2]}.git`, owner: m[1], name: m[2], mode, pr };
}

/** The repo's default branch, read anonymously (dry run has no API client to ask). */
async function detectDefaultBranch(remoteUrl: string): Promise<string> {
  const out = await git(['ls-remote', '--symref', remoteUrl, 'HEAD']);
  return out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? 'main';
}

async function main() {
  const { repoUrl, owner, name, mode, pr } = parseArgs(process.argv.slice(2));
  const branch = branchNameFor(['config', mode]);
  let summary: RepoFixSummary | null = null;

  const apply = async (dir: string) => {
    summary = await applyRepoFix(dir, mode);
  };
  // Title/body are computed after apply() has run; deliverChange only reads them at PR time, which is later.
  const prText = () => describeFix(summary as unknown as RepoFixSummary, mode);

  if (!pr) {
    const baseBranch = await detectDefaultBranch(repoUrl);
    const result = await deliverChange({
      remoteUrl: repoUrl, baseBranch, branch, apply, dryRun: true,
      commitMessage: '', author: { name: 'dry-run', email: 'dry-run@invalid' },
      pr: { title: '', body: '' },
      client: { findOpen: async () => undefined, create: async () => { throw new Error('dry run never opens a PR'); } },
    });
    if (result.status !== 'dry-run') throw new Error(`expected dry-run result, got ${result.status}`);
    const s = summary as unknown as RepoFixSummary;
    console.log(`\nDry run for ${owner}/${name} (mode: ${mode}, branch would be ${branch})\n${'='.repeat(60)}`);
    console.log(result.diff || '(no changes — the repo already matches the generated config)');
    console.log(`\nWould write: ${s.written.map((w) => w.path).join(', ') || '(nothing)'}`);
    for (const skip of s.skipped) console.log(`Skipped: ${skip.what} — ${skip.reason}`);
    console.log('\nRe-run with --pr to open the pull request as the App.');
    return;
  }

  const config = loadHarnessConfig();
  const app = createGithubApp(config);
  const delivery = await prepareRepoDelivery(app, owner, name);
  const result = await deliverChange({
    remoteUrl: delivery.remoteUrl, auth: delivery.auth, baseBranch: delivery.baseBranch, branch, apply,
    commitMessage: `Aperture: AI crawler config (${mode})`, author: delivery.author,
    get pr() { return prText(); },
    client: delivery.client,
  });

  switch (result.status) {
    case 'opened': console.log(`PR opened: ${result.pr.url}`); break;
    case 'updated': console.log(`Existing PR updated with a new commit: ${result.pr.url}`); break;
    case 'unchanged': console.log(`No new changes; PR already open: ${result.pr.url}`); break;
    case 'no-changes': console.log('Repo already matches the generated config — nothing to commit.'); break;
    default: console.log(result);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
