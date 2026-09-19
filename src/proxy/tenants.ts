import { readFile } from 'node:fs/promises';
import { DELIVERY_MODES, type DeliveryMode } from '../mode.js';

export interface Tenant {
  id: string;
  /** Hostnames (no port) that route to this tenant. */
  hosts: string[];
  /** Where the real site lives; every request that isn't served an artifact is passed through here. */
  origin: string;
  mode: DeliveryMode;
  /** Paths that have approved artifacts (exact match). Defaults to the homepage. */
  paths?: string[];
}

export interface TenantDirectory {
  byHost(host: string): Tenant | undefined;
}

/** "Example.com:8080" -> "example.com" */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

export function createTenantDirectory(tenants: Tenant[]): TenantDirectory {
  const index = new Map<string, Tenant>();
  for (const tenant of tenants) {
    for (const host of tenant.hosts) index.set(normalizeHost(host), tenant);
  }
  return { byHost: (host) => index.get(normalizeHost(host)) };
}

/** Validates untrusted JSON (a tenants file) into Tenants; throws naming the offending tenant and field. */
export function parseTenants(input: unknown): Tenant[] {
  if (!Array.isArray(input)) throw new Error('tenants must be an array');
  return input.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    const where = `tenants[${i}]`;
    if (typeof t?.id !== 'string' || !t.id) throw new Error(`${where}.id must be a non-empty string`);
    if (!Array.isArray(t.hosts) || t.hosts.length === 0 || !t.hosts.every((h) => typeof h === 'string' && h)) {
      throw new Error(`${where}.hosts must be a non-empty array of hostnames`);
    }
    if (typeof t.origin !== 'string') throw new Error(`${where}.origin must be a URL string`);
    try {
      new URL(t.origin);
    } catch {
      throw new Error(`${where}.origin is not a valid URL`);
    }
    if (!(DELIVERY_MODES as readonly unknown[]).includes(t.mode)) {
      throw new Error(`${where}.mode must be one of ${DELIVERY_MODES.join(', ')}`);
    }
    if (t.paths !== undefined && (!Array.isArray(t.paths) || !t.paths.every((p) => typeof p === 'string' && p.startsWith('/')))) {
      throw new Error(`${where}.paths must be an array of paths starting with "/"`);
    }
    return {
      id: t.id,
      hosts: t.hosts as string[],
      origin: t.origin,
      mode: t.mode as DeliveryMode,
      paths: t.paths as string[] | undefined,
    };
  });
}

export async function loadTenants(file: string): Promise<TenantDirectory> {
  return createTenantDirectory(parseTenants(JSON.parse(await readFile(file, 'utf8'))));
}
