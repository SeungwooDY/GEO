import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Branches the App may create and push. Everything else, including the default branch, is refused. */
export const BRANCH_PREFIX = 'geo/';

const SAFE_BRANCH = /^geo\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * The hard guard behind "PR only, never the default branch". Runs before any network call, and again inside
 * `push`. GitHub branch protection is the second line of defense, not the first.
 */
export function assertSafeBranch(branch: string, protectedBranches: readonly string[]): void {
  if (!SAFE_BRANCH.test(branch) || branch.includes('..') || branch.endsWith('.lock') || branch.endsWith('.')) {
    throw new Error(`refusing branch "${branch}": must look like ${BRANCH_PREFIX}<name> with only letters, digits, ".", "_" and "-"`);
  }
  if (protectedBranches.some((p) => p === branch)) {
    throw new Error(`refusing to touch protected branch "${branch}"`);
  }
}

const MAX_SLUG = 60;

/**
 * A stable branch name for a change: the same parts always give the same branch, which is what lets a re-run find
 * its existing branch and PR. Long names are truncated with a hash so distinct inputs stay distinct.
 */
export function branchNameFor(parts: readonly string[]): string {
  const joined = parts.join('-');
  const slug = joined
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\.lock$/, '-lock')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (slug === '') throw new Error('cannot derive a branch name from empty parts');
  if (slug.length <= MAX_SLUG) return `${BRANCH_PREFIX}${slug}`;
  const hash = createHash('sha1').update(joined).digest('hex').slice(0, 8);
  return `${BRANCH_PREFIX}${slug.slice(0, MAX_SLUG - 9).replace(/[^a-z0-9]+$/, '')}-${hash}`;
}

export interface GitAuth {
  /** A short-lived installation token. Never logged, never written to disk. */
  token: string;
}

export interface GitOptions {
  cwd?: string;
  auth?: GitAuth;
}

const redact = (text: string, auth?: GitAuth) => {
  if (!auth) return text;
  const basic = Buffer.from(`x-access-token:${auth.token}`).toString('base64');
  return text.split(auth.token).join('***').split(basic).join('***');
};

/**
 * Runs git without a shell. Credentials travel in GIT_CONFIG_* environment variables, so they don't appear in
 * the argument list or in `.git/config`. `GIT_TERMINAL_PROMPT=0` makes a bad credential fail instead of hang.
 */
export async function git(args: string[], { cwd, auth }: GitOptions = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (auth) {
    const basic = Buffer.from(`x-access-token:${auth.token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraheader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git ${args[0]} failed: ${redact((e.stderr || e.message || String(err)).trim(), auth)}`);
  }
}

export async function cloneBase(remoteUrl: string, baseBranch: string, dir: string, auth?: GitAuth): Promise<void> {
  // autocrlf off so we commit exactly the bytes that were written, on any OS. Set at clone time so the checkout obeys it too.
  await git(['clone', '--config', 'core.autocrlf=false', '--depth', '1', '--single-branch', '--branch', baseBranch, remoteUrl, dir], { auth });
}

/** Checks out `branch`, continuing from the remote copy when it already exists so a re-run adds to it instead of forking it. */
export async function checkoutWorkBranch(dir: string, branch: string, auth?: GitAuth): Promise<{ existed: boolean }> {
  const remote = await git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { cwd: dir, auth });
  if (remote.trim() === '') {
    await git(['checkout', '-b', branch], { cwd: dir });
    return { existed: false };
  }
  await git(['fetch', '--depth', '1', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: dir, auth });
  await git(['checkout', '-B', branch, `origin/${branch}`], { cwd: dir });
  return { existed: true };
}

/**
 * Stages everything and reports whether anything real is staged. Asking for the staged diff (not `status`) means
 * a file that merely looks modified, but has identical content, doesn't count as a change.
 */
export async function hasChanges(dir: string): Promise<boolean> {
  await git(['add', '--all'], { cwd: dir });
  return (await git(['diff', '--cached', '--name-only'], { cwd: dir })).trim() !== '';
}

export interface CommitIdentity {
  name: string;
  email: string;
}

export async function commitAll(dir: string, message: string, author: CommitIdentity): Promise<string> {
  await git(['add', '--all'], { cwd: dir });
  await git(['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '--no-gpg-sign', '-m', message], { cwd: dir });
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).trim();
}

/** The staged change against HEAD, for dry runs. Call after `hasChanges`, which stages. */
export async function diffAgainstHead(dir: string): Promise<string> {
  return git(['diff', '--cached', '--stat', '--patch'], { cwd: dir });
}

/** Pushes HEAD to `branch`. Never forces, and re-checks the branch guard so no caller can skip it. */
export async function pushBranch(dir: string, branch: string, protectedBranches: readonly string[], auth?: GitAuth): Promise<void> {
  assertSafeBranch(branch, protectedBranches);
  await git(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: dir, auth });
}
