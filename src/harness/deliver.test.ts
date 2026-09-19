import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverChange, type PullRequestClient, type PullRequestInfo } from './deliver.js';
import { assertSafeBranch, branchNameFor, cloneBase, git, pushBranch } from './git.js';

const author = { name: 'geo-app[bot]', email: '123+geo-app[bot]@users.noreply.github.com' };
const BRANCH = 'geo/schema-missing';

class FakeClient implements PullRequestClient {
  created: Array<{ branch: string; base: string; title: string; body: string }> = [];
  failNextCreate = false;
  async findOpen(branch: string): Promise<PullRequestInfo | undefined> {
    const i = this.created.findIndex((c) => c.branch === branch);
    return i >= 0 ? { number: i + 1, url: `https://example.test/pr/${i + 1}` } : undefined;
  }
  async create(input: { branch: string; base: string; title: string; body: string }) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('GitHub is down');
    }
    this.created.push(input);
    return { number: this.created.length, url: `https://example.test/pr/${this.created.length}` };
  }
}

describe('delivering a change as a PR', { timeout: 60_000 }, () => {
  let root: string;
  let bare: string;
  let tmpRoot: string;
  let remoteUrl: string;
  let client: FakeClient;

  const origin = (...args: string[]) => git(['--git-dir', bare, ...args]).then((s) => s.trim());
  const writeFileApply = (content: string, path = '.geo/a.md') => async (dir: string) => {
    await mkdir(join(dir, '.geo'), { recursive: true });
    await writeFile(join(dir, path), content);
  };
  const deliver = (over: Partial<Parameters<typeof deliverChange>[0]> = {}) =>
    deliverChange({
      remoteUrl,
      baseBranch: 'main',
      branch: BRANCH,
      apply: writeFileApply('v1\n'),
      commitMessage: 'Add schema',
      author,
      pr: { title: 'Add schema', body: 'body' },
      client,
      tmpRoot,
      ...over,
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'geo-deliver-test-'));
    bare = join(root, 'origin.git');
    tmpRoot = join(root, 'tmp');
    await mkdir(tmpRoot);
    remoteUrl = pathToFileURL(bare).href;
    client = new FakeClient();

    await git(['init', '--bare', '-b', 'main', bare]);
    const seed = join(root, 'seed');
    await git(['init', '-b', 'main', seed]);
    await writeFile(join(seed, 'README.md'), '# site\n');
    await git(['add', '.'], { cwd: seed });
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed'], { cwd: seed });
    await git(['push', pathToFileURL(bare).href, 'main'], { cwd: seed });
  });

  afterEach(async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  it('pushes a geo/ branch and opens a PR, leaving main and the temp dir untouched', async () => {
    const mainBefore = await origin('rev-parse', 'main');

    const result = await deliver();

    expect(result).toMatchObject({ status: 'opened', pr: { number: 1 } });
    expect(await origin('show', `${BRANCH}:.geo/a.md`)).toBe('v1');
    expect(await origin('log', '-1', '--format=%an <%ae>', BRANCH)).toBe(`${author.name} <${author.email}>`);
    expect(await origin('rev-parse', 'main')).toBe(mainBefore);
    expect(client.created).toEqual([{ branch: BRANCH, base: 'main', title: 'Add schema', body: 'body' }]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('is idempotent: identical content adds no commit and no second PR', async () => {
    await deliver();
    const tip = await origin('rev-parse', BRANCH);

    const again = await deliver();

    expect(again).toMatchObject({ status: 'unchanged', pr: { number: 1 } });
    expect(await origin('rev-parse', BRANCH)).toBe(tip);
    expect(client.created).toHaveLength(1);
  });

  it('adds a commit to the same branch and PR when the content changes', async () => {
    await deliver();

    const again = await deliver({ apply: writeFileApply('v2\n'), commitMessage: 'Update schema' });

    expect(again).toMatchObject({ status: 'updated', pr: { number: 1 } });
    expect(await origin('rev-list', '--count', BRANCH)).toBe('3'); // seed + two commits
    expect(await origin('show', `${BRANCH}:.geo/a.md`)).toBe('v2');
    expect(client.created).toHaveLength(1);
  });

  it('does nothing when the change produces no diff and there is no branch yet', async () => {
    const result = await deliver({ apply: async () => {} });

    expect(result).toEqual({ status: 'no-changes' });
    expect(await origin('branch', '--list', BRANCH)).toBe('');
    expect(client.created).toEqual([]);
  });

  it('dry run shows the diff but pushes nothing and opens no PR', async () => {
    const result = await deliver({ dryRun: true });

    expect(result.status).toBe('dry-run');
    if (result.status === 'dry-run') {
      expect(result.diff).toContain('.geo/a.md');
      expect(result.diff).toContain('+v1');
    }
    expect(await origin('branch', '--list', BRANCH)).toBe('');
    expect(client.created).toEqual([]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('recovers when the push worked but opening the PR failed', async () => {
    client.failNextCreate = true;
    await expect(deliver()).rejects.toThrow('GitHub is down');
    expect(await origin('show', `${BRANCH}:.geo/a.md`)).toBe('v1'); // the branch made it

    const retry = await deliver();

    expect(retry).toMatchObject({ status: 'opened', commit: null, pr: { number: 1 } });
    expect(await origin('rev-list', '--count', BRANCH)).toBe('2'); // no duplicate commit
  });

  it('deletes the clone even when applying the change throws', async () => {
    await expect(
      deliver({
        apply: async () => {
          throw new Error('agent crashed');
        },
      }),
    ).rejects.toThrow('agent crashed');

    expect(await readdir(tmpRoot)).toEqual([]);
    expect(await origin('branch', '--list', BRANCH)).toBe('');
  });

  it('refuses the base branch and unsafe names before touching the network or running the change', async () => {
    const mainBefore = await origin('rev-parse', 'main');
    const apply = vi.fn(async () => {});
    const dead = 'file:///this/does/not/exist.git'; // if the guard didn't run first, this would fail differently

    for (const bad of ['main', 'feature/x', 'geo/', 'geo/../main', 'geo/x.lock', 'geo/x y', '--force', 'geo/x;rm']) {
      await expect(deliver({ branch: bad, apply, remoteUrl: dead })).rejects.toThrow(/refusing/);
    }
    await expect(deliver({ baseBranch: 'geo/base', branch: 'geo/base', apply, remoteUrl: dead })).rejects.toThrow(/protected/);

    expect(apply).not.toHaveBeenCalled();
    expect(await origin('rev-parse', 'main')).toBe(mainBefore);
    expect(client.created).toEqual([]);
  });
});

describe('git safety', { timeout: 30_000 }, () => {
  it('pushBranch refuses a protected or unsafe branch before running git', async () => {
    await expect(pushBranch('/nonexistent', 'main', ['main'])).rejects.toThrow(/refusing/);
    await expect(pushBranch('/nonexistent', 'geo/x', ['geo/x'])).rejects.toThrow(/protected/);
  });

  it('assertSafeBranch accepts ordinary geo/ names', () => {
    for (const ok of ['geo/schema-missing', 'geo/robots.blocked.wildcard', 'geo/a/b', 'geo/v1_2']) {
      expect(() => assertSafeBranch(ok, ['main'])).not.toThrow();
    }
  });

  it('never persists the token in .git/config, and redacts it from errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geo-auth-test-'));
    try {
      const bare = join(root, 'o.git');
      const seed = join(root, 's');
      await git(['init', '--bare', '-b', 'main', bare]);
      await git(['init', '-b', 'main', seed]);
      await writeFile(join(seed, 'f'), 'x');
      await git(['add', '.'], { cwd: seed });
      await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 's'], { cwd: seed });
      await git(['push', pathToFileURL(bare).href, 'main'], { cwd: seed });

      const token = 'ghs_SUPERSECRETTOKEN';
      const dir = join(root, 'clone');
      await cloneBase(pathToFileURL(bare).href, 'main', dir, { token });
      const config = await readFile(join(dir, '.git', 'config'), 'utf8');
      expect(config).not.toContain(token);
      expect(config).not.toContain('extraheader');

      const err = await cloneBase(pathToFileURL(join(root, 'missing.git')).href, 'main', join(root, 'c2'), { token }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(token);
      expect((err as Error).message).not.toContain(Buffer.from(`x-access-token:${token}`).toString('base64'));
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('branchNameFor', () => {
  it('is stable and readable', () => {
    expect(branchNameFor(['schema.missing', 'robots.blocked.wildcard'])).toBe('geo/schema.missing-robots.blocked.wildcard');
    expect(branchNameFor(['Harness', 'Smoke'])).toBe('geo/harness-smoke');
    expect(branchNameFor(['a'])).toBe(branchNameFor(['a']));
  });

  it('always produces a branch the guard accepts', () => {
    for (const parts of [['x.lock'], ['  weird / chars ?? '], ['a..b'], ['-lead'], ['trail.'], ['UPPER'], ['x'.repeat(200)]]) {
      expect(() => assertSafeBranch(branchNameFor(parts), ['main'])).not.toThrow();
    }
  });

  it('keeps long, different inputs distinct via a hash', () => {
    const a = branchNameFor(['x'.repeat(100), 'a']);
    const b = branchNameFor(['x'.repeat(100), 'b']);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual('geo/'.length + 60);
  });

  it('rejects input with nothing usable', () => {
    expect(() => branchNameFor([])).toThrow();
    expect(() => branchNameFor(['///'])).toThrow();
  });
});
