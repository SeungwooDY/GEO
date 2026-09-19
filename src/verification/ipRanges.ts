/** IPv4/IPv6 CIDR matching without dependencies. Addresses are compared as BigInts. */

interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

export interface Cidr extends ParsedIp {
  bits: number;
}

function parseIpv4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(p);
  }
  return n;
}

function parseIpv6(input: string): bigint | null {
  let s = input.split('%')[0]; // drop a zone id like "fe80::1%eth0"

  // Rewrite an embedded IPv4 tail ("::ffff:1.2.3.4") as two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  }

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parses an IP; IPv4-mapped IPv6 ("::ffff:1.2.3.4", what Node reports for IPv4 clients on a dual-stack socket) becomes IPv4. */
export function parseIp(ip: string): ParsedIp | null {
  const s = ip.trim();
  if (s.includes(':')) {
    const v6 = parseIpv6(s);
    if (v6 === null) return null;
    if (v6 >> 32n === 0xffffn) return { version: 4, value: v6 & 0xffffffffn };
    return { version: 6, value: v6 };
  }
  const v4 = parseIpv4(s);
  return v4 === null ? null : { version: 4, value: v4 };
}

export function parseCidr(cidr: string): Cidr | null {
  const [addr, bitsPart, ...extra] = cidr.trim().split('/');
  if (extra.length > 0) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.version === 4 ? 32 : 128;
  const bits = bitsPart === undefined ? max : Number(bitsPart);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  return { ...ip, bits };
}

export function ipInCidr(ip: ParsedIp, cidr: Cidr): boolean {
  if (ip.version !== cidr.version) return false;
  const total = ip.version === 4 ? 32 : 128;
  const shift = BigInt(total - cidr.bits);
  return ip.value >> shift === cidr.value >> shift;
}

/** Converts a vendor range file ({"prefixes": [{"ipv4Prefix"|"ipv6Prefix": "..."}]}) into CIDRs; unparseable entries are skipped. */
export function parsePrefixFile(json: unknown): Cidr[] {
  const prefixes = (json as { prefixes?: unknown })?.prefixes;
  if (!Array.isArray(prefixes)) return [];
  const out: Cidr[] = [];
  for (const entry of prefixes) {
    const raw = (entry as { ipv4Prefix?: unknown; ipv6Prefix?: unknown } | null) ?? {};
    const text = typeof raw.ipv4Prefix === 'string' ? raw.ipv4Prefix : typeof raw.ipv6Prefix === 'string' ? raw.ipv6Prefix : null;
    const cidr = text ? parseCidr(text) : null;
    if (cidr) out.push(cidr);
  }
  return out;
}
