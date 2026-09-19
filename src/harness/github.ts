import { App } from '@octokit/app';
import type { HarnessConfig } from './config.js';
import type { PullRequestClient } from './deliver.js';
import type { CommitIdentity, GitAuth } from './git.js';

export function createGithubApp(config: Pick<HarnessConfig, 'appId' | 'privateKey' | 'webhookSecret'>): App {
  return new App({ appId: config.appId, privateKey: config.privateKey, webhooks: { secret: config.webhookSecret } });
}

export interface RepoAccess {
  installationId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /** Permissions the installation holds, as GitHub reports them, e.g. { contents: "write" }. */
  permissions: Record<string, string>;
}

/**
 * Proves the whole auth chain against a real repo: App JWT -> installation for this repo -> short-lived
 * installation token -> a read through that token. Throws if the App isn't installed on the repo.
 */
export async function describeRepoAccess(app: App, owner: string, name: string): Promise<RepoAccess> {
  const { data: installation } = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo: name });
  const octokit = await app.getInstallationOctokit(installation.id);
  const { data: repo } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: name });

  return {
    installationId: installation.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    permissions: (installation.permissions ?? {}) as Record<string, string>,
  };
}

export interface RepoDelivery {
  fullName: string;
  remoteUrl: string;
  /** A short-lived installation token (about an hour). Fetch a new one per run; never store it. */
  auth: GitAuth;
  /** The repo's default branch: the PR target, and never pushed to. */
  baseBranch: string;
  /** Commits are authored as the App's bot user, so GitHub attributes them to the App. */
  author: CommitIdentity;
  client: PullRequestClient;
}

/** Everything `deliverChange` needs for one repo: a token, the base branch, the App's identity and a PR client. */
export async function prepareRepoDelivery(app: App, owner: string, name: string): Promise<RepoDelivery> {
  const { data: installation } = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo: name });
  const octokit = await app.getInstallationOctokit(installation.id);
  const { token } = (await octokit.auth({ type: 'installation' })) as { token: string };

  const { data: repo } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: name });
  const { data: self } = await app.octokit.request('GET /app');
  if (!self?.slug) throw new Error('could not read the App slug from GitHub');
  const botLogin = `${self.slug}[bot]`;
  const { data: bot } = await octokit.request('GET /users/{username}', { username: botLogin });

  const repoOwner = repo.owner.login;
  const client: PullRequestClient = {
    async findOpen(branch) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner: repoOwner,
        repo: repo.name,
        head: `${repoOwner}:${branch}`,
        state: 'open',
      });
      return data[0] ? { number: data[0].number, url: data[0].html_url } : undefined;
    },
    async create({ branch, base, title, body }) {
      const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner: repoOwner,
        repo: repo.name,
        head: branch,
        base,
        title,
        body,
      });
      return { number: data.number, url: data.html_url };
    },
  };

  return {
    fullName: repo.full_name,
    remoteUrl: `https://github.com/${repo.full_name}.git`,
    auth: { token },
    baseBranch: repo.default_branch,
    author: { name: botLogin, email: `${bot.id}+${botLogin}@users.noreply.github.com` },
    client,
  };
}
