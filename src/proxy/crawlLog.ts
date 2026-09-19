import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DeliveryMode } from '../mode.js';
import type { VerificationReason } from '../verification/botIdentity.js';

export type CrawlAction =
  | 'served-amplify'
  | 'served-mirror'
  | 'blocked'
  | 'passthrough'
  | 'passthrough-unverified-bot'
  | 'passthrough-no-artifact'
  | 'passthrough-fallback'
  | 'error';

/** One proxied request. Also the raw input for the log-based diagnostics (last crawled, freshness, zero-crawl). */
export interface CrawlLogEntry {
  ts: string;
  tenant: string;
  mode: DeliveryMode;
  path: string;
  method: string;
  /** Token of the AI bot the UA claims to be; null for ordinary visitors. */
  bot: string | null;
  /** Whether the claim was confirmed by IP range; null when no verification was attempted. */
  verified: boolean | null;
  verifyReason: VerificationReason | null;
  action: CrawlAction;
  status: number;
}

export interface CrawlLog {
  /** Must never throw or block the request: the log is not allowed to take a site down. */
  record(entry: CrawlLogEntry): void;
}

export const nullCrawlLog: CrawlLog = { record() {} };

export class MemoryCrawlLog implements CrawlLog {
  readonly entries: CrawlLogEntry[] = [];
  record(entry: CrawlLogEntry) {
    this.entries.push(entry);
  }
}

/** Appends one JSON object per line. Writes are queued in order and failures are swallowed (reported via onError). */
export class JsonlCrawlLog implements CrawlLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  record(entry: CrawlLogEntry) {
    this.queue = this.queue
      .then(() => mkdir(dirname(this.file), { recursive: true }))
      .then(() => appendFile(this.file, JSON.stringify(entry) + '\n'))
      .catch(this.onError);
  }

  /** Resolves once everything recorded so far has been written. */
  flush(): Promise<void> {
    return this.queue;
  }
}
