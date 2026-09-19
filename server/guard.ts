/**
 * SSRF guard for the bridge. The bridge fetches whatever URL a visitor submits, so refuse
 * targets that resolve to loopback / private / link-local space (cloud metadata lives at
 * 169.254.169.254). Set APERTURE_ALLOW_PRIVATE=1 to scan a local mock site during development.
 *
 * Note: this checks DNS at request time; it does not defend against DNS rebinding.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for addresses a public website should never resolve to. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 6) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const parts = v.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed: refuse
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** Resolves the host and returns an error message if it points at private space, else null. */
export async function checkPublicHost(target: string): Promise<string | null> {
  if (process.env.APERTURE_ALLOW_PRIVATE === '1') return null;
  let host: string;
  try {
    host = new URL(target).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return 'invalid url';
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return 'that host is not a public website';
  }
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.length === 0) return 'host did not resolve';
    if (addrs.some((a) => isPrivateAddress(a.address))) return 'that host resolves to a private address';
    return null;
  } catch {
    return 'host did not resolve';
  }
}
