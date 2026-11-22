import { createHash, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export function tokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || expected.length < 24) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function privateIp(ip: string): boolean {
  const t = net.isIP(ip);
  if (t === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
      a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31 || a === 192 && b === 168 ||
      a === 100 && (b ?? 0) >= 64 && (b ?? 0) <= 127 || a === 192 && b === 0 ||
      a === 198 && ((b ?? 0) === 18 || (b ?? 0) === 19) || a === 198 && (b ?? 0) === 51 || a === 203 && b === 0 || a! >= 224;
  }
  if (t === 6) {
    const v = ip.toLowerCase();
    return v === '::' || v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') ||
      v.startsWith('fd') || v.startsWith('ff') || v.startsWith('2001:db8') || v.startsWith('::ffff:');
  }
  return true;
}

export async function validateExternalImageUrl(raw: string, allowedHosts: string[]): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
    throw new Error('Image URL must be a public HTTPS URL without credentials or custom port');
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) throw new Error('Image host not in IMAGE_ALLOWED_HOSTS');
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) {
    throw new Error('Image domain resolves to a restricted network');
  }
  return url;
}

export function noteUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.hostname !== 'note.com' || u.port || u.username || u.password ||
    !/^\/(?:[^/]+\/n\/[A-Za-z0-9_-]+|notes\/(?:new|[A-Za-z0-9_-]+(?:\/edit)?))(?:\/)?$/.test(u.pathname)) {
    throw new Error('Expected an official note.com article/editor URL');
  }
  return u.origin + u.pathname;
}

export function safeError(error: unknown): string {
  // Never expose Browserbase connection URLs, secrets or cookies in a tool result.
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/(token|password|cookie|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 300);
}
