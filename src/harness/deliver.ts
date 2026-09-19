import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSafeBranch,
  checkoutWorkBranch,
  cloneBase,
  commitAll,
  diffAgainstHead,
  hasChanges,
  pushBranch,
  type CommitIdentity,
  type GitAuth,
} from './git.js';

export interface PullRequestInfo {
  number: number;
  url: string;
}

/** The only GitHub API surface delivery needs, so tests can stand in for GitHub. */
export interface PullRequestClient {
  findOpen(branch: string): Promise<PullRequestInfo | undefined>;
  create(input: { branch: string; base: string; title: string; body: string }): Promise<PullRequestInfo>;
}

export interface DeliverInput {
  remoteUrl: string;
  auth?: GitAuth;
  /** The branch the PR targets. It is never pushed to. */
  baseBranch: string;
  /** Deterministic per change (not per run) so a re-run finds the same branch and PR. Must start with `geo/`. */
  branch: string;
  /** Edits the working tree. Later this is the agent's session; for now it is a plain function. */
  apply: (dir: string) => Promise<void>;
  commitMessage: string;
  author: CommitIdentity;
  pr: { title: string; body: string };
  client: PullRequestClient;
  /** Clone, apply and diff, then stop: nothing is pushed and no PR is opened. */
  dryRun?: boolean;
  /** Where the throwaway clone lives. Defaults to the OS temp directory. */
  tmpRoot?: string;
}

export type DeliverResult =
  /** `commit` is null when the branch was already pushed and only the PR was missing. */
  | { status: 'opened'; pr: PullRequestInfo; commit: string | null }
  | { status: 'updated'; pr: PullRequestInfo; commit: string }
  | { status: 'unchanged'; pr: PullRequestInfo }
  | { status: 'no-changes' }
  | { status: 'dry-run'; diff: string };

/**
 * Applies a change on a `geo/...` branch and opens (or reuses) a PR for it. Idempotent: running the same change
 * twice never makes a second branch or PR, and identical content adds no commit. The clone is always deleted.
 */
export async function deliverChange(input: DeliverInput): Promise<DeliverResult> {
  const { baseBranch, branch, auth, client } = input;
  assertSafeBranch(branch, [baseBranch]); // before any network call or filesystem work

  const root = await mkdtemp(join(input.tmpRoot ?? tmpdir(), 'geo-run-'));
  const dir = join(root, 'repo');
  try {
    await cloneBase(input.remoteUrl, baseBranch, dir, auth);
    const { existed } = await checkoutWorkBranch(dir, branch, auth);

    await input.apply(dir);
    const changed = await hasChanges(dir);

    if (input.dryRun) return { status: 'dry-run', diff: changed ? await diffAgainstHead(dir) : '' };

    // A PR can only exist for a branch that is already on the remote.
    const existing = existed ? await client.findOpen(branch) : undefined;

    if (!changed) {
      if (existing) return { status: 'unchanged', pr: existing };
      // Nothing new to commit. If the branch is already up there, an earlier run probably pushed and then failed to open the PR.
      if (!existed) return { status: 'no-changes' };
      return { status: 'opened', pr: await client.create({ branch, base: baseBranch, ...input.pr }), commit: null };
    }

    const commit = await commitAll(dir, input.commitMessage, input.author);
    await pushBranch(dir, branch, [baseBranch], auth);

    if (existing) return { status: 'updated', pr: existing, commit };
    return { status: 'opened', pr: await client.create({ branch, base: baseBranch, ...input.pr }), commit };
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
