import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One GitHub App installation: who installed it and which repos we may touch. */
export interface InstallationRecord {
  installationId: number;
  /** GitHub login of the user or org that installed the App. */
  account: string;
  repositorySelection: 'all' | 'selected';
  /** Full names ("owner/name"), lowercased. Under `all` this is a snapshot; access is decided by `account`. */
  repos: string[];
  installedAt: string;
}

export interface InstallationStore {
  get(installationId: number): Promise<InstallationRecord | undefined>;
  put(record: InstallationRecord): Promise<void>;
  delete(installationId: number): Promise<void>;
  list(): Promise<InstallationRecord[]>;
}

export const normalizeRepo = (fullName: string) => fullName.trim().toLowerCase();

/** The installation that lets us act on `owner/name`, or undefined if the App isn't installed there. */
export async function findInstallationForRepo(
  store: InstallationStore,
  owner: string,
  name: string,
): Promise<InstallationRecord | undefined> {
  const full = normalizeRepo(`${owner}/${name}`);
  const account = owner.trim().toLowerCase();
  return (await store.list()).find(
    (r) => r.repos.includes(full) || (r.repositorySelection === 'all' && r.account.toLowerCase() === account),
  );
}

export class MemoryInstallationStore implements InstallationStore {
  protected readonly records = new Map<number, InstallationRecord>();
  async get(installationId: number) {
    return this.records.get(installationId);
  }
  async put(record: InstallationRecord) {
    this.records.set(record.installationId, record);
  }
  async delete(installationId: number) {
    this.records.delete(installationId);
  }
  async list() {
    return [...this.records.values()];
  }
}

/** A single JSON file; stands in for the real data store. Writes are serialized and atomic (temp file + rename). */
export class FileInstallationStore extends MemoryInstallationStore {
  private loaded: Promise<void> | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    super();
  }

  private load() {
    this.loaded ??= readFile(this.file, 'utf8').then(
      (text) => {
        for (const r of JSON.parse(text) as InstallationRecord[]) this.records.set(r.installationId, r);
      },
      (err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err; // a missing file is a fresh start; a corrupt one must not be silently overwritten
      },
    );
    return this.loaded;
  }

  private persist() {
    const snapshot = JSON.stringify([...this.records.values()], null, 2);
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    return this.writes;
  }

  override async get(installationId: number) {
    await this.load();
    return super.get(installationId);
  }
  override async put(record: InstallationRecord) {
    await this.load();
    await super.put(record);
    await this.persist();
  }
  override async delete(installationId: number) {
    await this.load();
    await super.delete(installationId);
    await this.persist();
  }
  override async list() {
    await this.load();
    return super.list();
  }
}
