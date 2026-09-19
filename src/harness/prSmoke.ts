import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadHarnessConfig } from './config.js';
import { deliverChange } from './deliver.js';
import { branchNameFor } from './git.js';
import { createGithubApp, prepareRepoDelivery } from './github.js';

/**
 * `npm run harness:pr-smoke -- owner/repo [--dry-run]`: clones the repo, adds one placeholder file on a `geo/` branch
 * and opens a PR as the App. Safe to re-run: it reuses the branch and PR. `--dry-run` stops before pushing.
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [owner, name, ...rest] = (args.find((a) => !a.startsWith('--')) ?? '').split('/');
if (!owner || !name || rest.length > 0) {
  console.error('usage: npm run harness:pr-smoke -- <owner>/<repo> [--dry-run]');
  process.exit(2);
}

let config;
try {
  config = loadHarnessConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  const app = createGithubApp(config);
  const target = await prepareRepoDelivery(app, owner, name);
  console.log(`Target ${target.fullName}, base branch ${target.baseBranch}${dryRun ? ' (dry run)' : ''}`);

  const result = await deliverChange({
    remoteUrl: target.remoteUrl,
    auth: target.auth,
    baseBranch: target.baseBranch,
    branch: branchNameFor(['harness', 'smoke']),
    author: target.author,
    client: target.client,
    dryRun,
    commitMessage: 'Add GEO harness smoke-test file',
    pr: {
      title: 'GEO harness smoke test',
      body: [
        'This PR was opened by the GEO GitHub App to test the harness plumbing (branch, commit, push, PR).',
        '',
        'It adds one placeholder file and changes nothing else. It is safe to close and delete the branch.',
      ].join('\n'),
    },
    apply: async (dir) => {
      await mkdir(join(dir, '.geo'), { recursive: true });
      await writeFile(join(dir, '.geo', 'smoke-test.md'), '# GEO harness smoke test\n\nPlaceholder file. Safe to delete.\n');
    },
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
