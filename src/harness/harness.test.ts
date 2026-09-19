import { createHmac, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHarnessConfig } from './config.js';
import { createGithubApp } from './github.js';
import {
  onInstallationCreated,
  onInstallationDeleted,
  onRepositoriesChanged,
  registerInstallationHandlers,
  type InstallationPayload,
  type Logger,
} from './installationEvents.js';
import { FileInstallationStore, findInstallationForRepo, MemoryInstallationStore } from './installations.js';
import { createHarnessServer } from './server.js';

const silent: Logger = { info() {}, warn() {}, error() {} };
const SECRET = 'test-webhook-secret';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const created = (over: Partial<InstallationPayload> = {}): InstallationPayload => ({
  installation: { id: 7, account: { login: 'Acme' }, repository_selection: 'selected' },
  repositories: [{ full_name: 'Acme/Site' }],
  ...over,
});

describe('loadHarnessConfig', () => {
  const good = { GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----', GITHUB_WEBHOOK_SECRET: 's' };

  it('loads a complete environment, with defaults and unescaped key newlines', () => {
    const c = loadHarnessConfig(good);
    expect(c).toMatchObject({ appId: '123', webhookSecret: 's', port: 3000, dataDir: 'data/harness' });
    expect(c.privateKey).toContain('\nabc\n');
  });

  it('reports every problem at once', () => {
    expect(() => loadHarnessConfig({ PORT: '99999' })).toThrow(/GITHUB_APP_ID[\s\S]*PRIVATE_KEY[\s\S]*GITHUB_WEBHOOK_SECRET[\s\S]*PORT/);
  });

  it('rejects a key that is not a PEM, and an unreadable key path', () => {
    expect(() => loadHarnessConfig({ ...good, GITHUB_APP_PRIVATE_KEY: 'hunter2' })).toThrow(/PEM/);
    expect(() => loadHarnessConfig({ ...good, GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_APP_PRIVATE_KEY_PATH: join(tmpdir(), 'nope.pem') })).toThrow(
      /could not read/,
    );
  });
});

describe('installation events', () => {
  it('creates a record with lowercased repos, and deletes it', async () => {
    const store = new MemoryInstallationStore();
    await onInstallationCreated(store, created(), silent);
    expect(await store.get(7)).toMatchObject({ account: 'Acme', repositorySelection: 'selected', repos: ['acme/site'] });

    await onInstallationDeleted(store, created(), silent);
    expect(await store.get(7)).toBeUndefined();
  });

  it('applies added and removed repositories, keeping installedAt', async () => {
    const store = new MemoryInstallationStore();
    await onInstallationCreated(store, created(), silent);
    const installedAt = (await store.get(7))!.installedAt;

    await onRepositoriesChanged(store, created({ repositories: undefined, repositories_added: [{ full_name: 'Acme/Blog' }] }), silent);
    expect((await store.get(7))!.repos).toEqual(['acme/site', 'acme/blog']);

    await onRepositoriesChanged(store, created({ repositories: undefined, repositories_removed: [{ full_name: 'ACME/site' }] }), silent);
    const after = (await store.get(7))!;
    expect(after.repos).toEqual(['acme/blog']);
    expect(after.installedAt).toBe(installedAt);
  });

  it('creates an unknown installation from a repository event (App installed while we were down)', async () => {
    const store = new MemoryInstallationStore();
    await onRepositoriesChanged(store, created({ repositories: undefined, repositories_added: [{ full_name: 'Acme/Site' }] }), silent);
    expect(await store.get(7)).toMatchObject({ account: 'Acme', repos: ['acme/site'] });
  });

  it('ignores repository entries without a full_name', async () => {
    const store = new MemoryInstallationStore();
    await onRepositoriesChanged(store, created({ repositories: undefined, repositories_added: [{}, { full_name: 'Acme/Site' }] }), silent);
    expect((await store.get(7))!.repos).toEqual(['acme/site']);
  });
});

describe('findInstallationForRepo', () => {
  it('matches a listed repo case-insensitively, and any repo of an all-repos installation', async () => {
    const store = new MemoryInstallationStore();
    await onInstallationCreated(store, created(), silent);
    await onInstallationCreated(store, created({ installation: { id: 8, account: { login: 'Globex' }, repository_selection: 'all' }, repositories: [] }), silent);

    expect((await findInstallationForRepo(store, 'ACME', 'site'))?.installationId).toBe(7);
    expect((await findInstallationForRepo(store, 'globex', 'anything'))?.installationId).toBe(8);
    expect(await findInstallationForRepo(store, 'acme', 'other')).toBeUndefined();
    expect(await findInstallationForRepo(store, 'initech', 'site')).toBeUndefined();
  });
});

describe('FileInstallationStore', () => {
  let dir: string;
  afterEach(async () => dir && rm(dir, { recursive: true, force: true }));

  it('persists across instances and treats a missing file as empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'geo-harness-'));
    const file = join(dir, 'nested', 'installations.json');

    expect(await new FileInstallationStore(file).list()).toEqual([]);

    const a = new FileInstallationStore(file);
    await onInstallationCreated(a, created(), silent);
    expect((await new FileInstallationStore(file).get(7))?.repos).toEqual(['acme/site']);

    await a.delete(7);
    expect(await new FileInstallationStore(file).list()).toEqual([]);
  });

  it('refuses to start over a corrupt file instead of overwriting it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'geo-harness-'));
    const file = join(dir, 'installations.json');
    await writeFile(file, '{not json');

    const store = new FileInstallationStore(file);
    await expect(store.put({ installationId: 1, account: 'a', repositorySelection: 'all', repos: [], installedAt: 'x' })).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{not json');
  });

  it('keeps every record when writes race', async () => {
    dir = await mkdtemp(join(tmpdir(), 'geo-harness-'));
    const file = join(dir, 'installations.json');
    const store = new FileInstallationStore(file);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.put({ installationId: i, account: 'a', repositorySelection: 'all', repos: [], installedAt: 'x' })),
    );
    expect(await new FileInstallationStore(file).list()).toHaveLength(10);
  });
});

describe('webhook server', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function start(store = new MemoryInstallationStore()) {
    const app = createGithubApp({ appId: '1', privateKey, webhookSecret: SECRET });
    registerInstallationHandlers(app.webhooks, store, silent);
    server = createHarnessServer(app, silent);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { store, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  const post = (base: string, event: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'x-github-delivery': 'd-1', 'x-github-event': event, 'x-hub-signature-256': sign(body), 'content-type': 'application/json', ...headers },
      body,
    });

  it('handles a correctly signed installation event', async () => {
    const { base, store } = await start();
    const res = await post(base, 'installation', JSON.stringify({ action: 'created', ...created(), sender: { login: 'x' } }));
    expect(res.status).toBe(200);
    expect(await store.get(7)).toMatchObject({ account: 'Acme', repos: ['acme/site'] });
  });

  it('rejects a wrong or malformed signature without running any handler', async () => {
    const { base, store } = await start();
    const body = JSON.stringify({ action: 'created', ...created() });

    expect((await post(base, 'installation', body, { 'x-hub-signature-256': sign(body, 'wrong-secret') })).status).toBe(401);
    expect((await post(base, 'installation', body, { 'x-hub-signature-256': 'garbage' })).status).toBe(401);
    expect((await post(base, 'installation', body, { 'x-hub-signature-256': sign(body.replace('Acme', 'Evil')) })).status).toBe(401); // body altered after signing
    expect(await store.list()).toEqual([]);
  });

  it('rejects requests missing GitHub headers, non-JSON bodies, and oversize bodies', async () => {
    const { base } = await start();
    const body = '{}';
    expect((await fetch(`${base}/webhook`, { method: 'POST', body })).status).toBe(400);
    expect((await post(base, 'installation', 'not json', { 'x-hub-signature-256': sign('not json') })).status).toBe(400);

    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    const res = await post(base, 'installation', big, { 'x-hub-signature-256': sign(big) }).catch(() => undefined);
    // The server may close the connection before the client finishes sending; either outcome means it was refused.
    if (res) expect(res.status).toBe(413);
  });

  it('accepts events it has no handler for, and serves health and 404/405', async () => {
    const { base } = await start();
    expect((await post(base, 'ping', JSON.stringify({ zen: 'hi' }))).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/webhook`)).status).toBe(405);
  });

  it('returns 500 (so GitHub can redeliver) when a handler fails, without crashing', async () => {
    const store = new MemoryInstallationStore();
    store.put = async () => {
      throw new Error('disk full');
    };
    const { base } = await start(store);

    expect((await post(base, 'installation', JSON.stringify({ action: 'created', ...created() }))).status).toBe(500);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
