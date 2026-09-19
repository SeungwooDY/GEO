import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeliveryMode } from '../mode.js';

/** A gate-approved artifact the proxy may serve to verified bots. */
export interface ApprovedArtifact {
  contentType: string;
  body: string;
  approvedAt: string;
}

export interface ArtifactKey {
  tenant: string;
  path: string;
  mode: Extract<DeliveryMode, 'amplify' | 'mirror'>;
}

/** Only content that passed the gate is ever `put` here; the proxy only reads. A held artifact leaves the last approved one in place. */
export interface ApprovedStore {
  get(key: ArtifactKey): Promise<ApprovedArtifact | undefined>;
  put(key: ArtifactKey, artifact: ApprovedArtifact): Promise<void>;
}

const keyString = (k: ArtifactKey) => `${k.tenant}\0${k.mode}\0${k.path}`;

export class MemoryApprovedStore implements ApprovedStore {
  private readonly entries = new Map<string, ApprovedArtifact>();
  async get(key: ArtifactKey) {
    return this.entries.get(keyString(key));
  }
  async put(key: ArtifactKey, artifact: ApprovedArtifact) {
    this.entries.set(keyString(key), artifact);
  }
}

/** One JSON file per artifact; stands in for the Phase 1 data store until that exists. */
export class FileApprovedStore implements ApprovedStore {
  constructor(private readonly dir: string) {}

  private file(key: ArtifactKey) {
    return join(this.dir, `${createHash('sha256').update(keyString(key)).digest('hex')}.json`);
  }

  async get(key: ArtifactKey) {
    try {
      return JSON.parse(await readFile(this.file(key), 'utf8')) as ApprovedArtifact;
    } catch {
      return undefined; // missing or unreadable: the proxy falls back to the origin
    }
  }

  async put(key: ArtifactKey, artifact: ApprovedArtifact) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(artifact));
  }
}
