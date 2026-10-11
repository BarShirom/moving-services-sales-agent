import { isIP } from 'node:net';
import type { Request, Response } from 'express';

export const clientIPHeader = 'x-demo-client-ip';

// One address, never a chain, port, CIDR, zone ID or hostname. Canonicalization
// prevents alternate IPv6 spellings and IPv4-mapped addresses splitting quotas.
export function canonicalIP(value: string | undefined): string | undefined {
  if (!value || value.includes('%') || !isIP(value)) return undefined;
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (normalized.startsWith('::ffff:')) {
    const [high, low] = normalized.slice(7).split(':').map(part => parseInt(part, 16));
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return normalized;
}

export function createClientIdentity(trustedProxyIP?: string) {
  const configured = trustedProxyIP?.trim();
  const trusted = canonicalIP(configured);
  if (configured && !trusted) throw new Error('DEMO_TRUSTED_PROXY_IP must be one literal IP address');
  return (request: Request): string | undefined => {
    const peer = canonicalIP(request.socket.remoteAddress);
    if (!trusted) return peer; // Local/direct mode ignores every forwarding header.
    if (peer !== trusted) return undefined; // Fail closed, even if someone publishes 3001.
    let occurrences = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (request.rawHeaders[i].toLowerCase() === clientIPHeader) occurrences++;
    }
    const value = request.headers[clientIPHeader];
    return occurrences === 1 && typeof value === 'string' ? canonicalIP(value) : undefined;
  };
}

// Admission sets this once; every client quota uses exactly the same identity.
export function admittedClientIP(response: Response): string {
  const identity: unknown = response.locals.demoClientIP;
  if (typeof identity !== 'string') throw new Error('Demo client admission is required');
  return identity;
}
