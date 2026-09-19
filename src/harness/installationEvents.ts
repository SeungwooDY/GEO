import type { App } from '@octokit/app';
import { normalizeRepo, type InstallationRecord, type InstallationStore } from './installations.js';

type RepoRefs = Array<{ full_name?: string }>;

/** The slice of GitHub's installation webhook payloads we read. Everything optional: we don't trust the shape. */
export interface InstallationPayload {
  installation: {
    id: number;
    // Enterprises have a slug instead of a login.
    account?: { login?: string; slug?: string } | null;
    repository_selection?: string;
  };
  /** `installation.created`: repos granted at install time. */
  repositories?: RepoRefs;
  /** `installation_repositories`: the change, and the resulting selection. */
  repositories_added?: RepoRefs;
  repositories_removed?: RepoRefs;
  repository_selection?: string;
}

export interface Logger {
  info(message: string, extra?: object): void;
  warn(message: string, extra?: object): void;
  error(message: string, extra?: object): void;
}

const selection = (value: string | undefined): InstallationRecord['repositorySelection'] =>
  value === 'all' ? 'all' : 'selected';

const repoNames = (repos: RepoRefs | undefined) =>
  (repos ?? []).flatMap((r) => (r.full_name ? [normalizeRepo(r.full_name)] : []));

function recordFrom(payload: InstallationPayload, repos: string[], existing?: InstallationRecord): InstallationRecord {
  const account = payload.installation.account?.login ?? payload.installation.account?.slug ?? existing?.account ?? 'unknown';
  return {
    installationId: payload.installation.id,
    account,
    repositorySelection: selection(payload.repository_selection ?? payload.installation.repository_selection),
    repos,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
  };
}

export async function onInstallationCreated(store: InstallationStore, payload: InstallationPayload, log: Logger) {
  const record = recordFrom(payload, repoNames(payload.repositories), await store.get(payload.installation.id));
  await store.put(record);
  log.info('installation created', { installationId: record.installationId, account: record.account, repos: record.repos });
}

export async function onInstallationDeleted(store: InstallationStore, payload: InstallationPayload, log: Logger) {
  await store.delete(payload.installation.id);
  log.info('installation deleted', { installationId: payload.installation.id });
}

/** Also the recovery path: an installation we never heard about (App installed while we were down) is created from this event. */
export async function onRepositoriesChanged(store: InstallationStore, payload: InstallationPayload, log: Logger) {
  const existing = await store.get(payload.installation.id);
  const removed = new Set(repoNames(payload.repositories_removed));
  const repos = [...new Set([...(existing?.repos ?? []), ...repoNames(payload.repositories_added)])].filter((r) => !removed.has(r));

  const record = recordFrom(payload, repos, existing);
  await store.put(record);
  log.info('installation repositories changed', {
    installationId: record.installationId,
    added: repoNames(payload.repositories_added),
    removed: [...removed],
    known: !!existing,
  });
}

/** Wires the handlers onto the App's webhook router. */
export function registerInstallationHandlers(webhooks: App['webhooks'], store: InstallationStore, log: Logger) {
  webhooks.on('installation.created', ({ payload }) => onInstallationCreated(store, payload, log));
  webhooks.on('installation.deleted', ({ payload }) => onInstallationDeleted(store, payload, log));
  webhooks.on(['installation_repositories.added', 'installation_repositories.removed'], ({ payload }) =>
    onRepositoriesChanged(store, payload, log),
  );
}
