import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import { createApp } from '../src/app.js';
import { canonicalIP, createClientIdentity } from '../src/demo/clientIdentity.js';
import { DemoProtection } from '../src/demo/protection.js';
import { getDemoLimits, type DemoLimits } from '../src/config/demoLimits.js';

const origin = 'https://demo.example.test';
const headers = (ip = '198.51.100.1') => ({ 'X-Demo-Request': '1', 'X-Demo-Client-IP': ip, Origin: origin });
const config = { trustedProxyIP: '127.0.0.1', secureCookies: true, publicOrigin: origin };
async function api(t: TestContext, limits: Partial<DemoLimits> = {}, options: Parameters<typeof createApp>[0] = {}) {
  const protection = new DemoProtection({ ...getDemoLimits({}), ...limits });
  const app = createApp({ ...config, protection, extractor: () => ({}), ...options });
  assert.equal(app.get('trust proxy'), false);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  return { root: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`, protection };
}
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];

test('IP validation rejects ambiguous input and canonicalizes IPv6 and mapped IPv4', () => {
  for (const value of ['', 'unknown', '1.2.3.4, 5.6.7.8', '1.2.3.4:80', '[::1]', 'fe80::1%eth0', '127.1', '01.2.3.4', ' 1.2.3.4', '::/0']) {
    assert.equal(canonicalIP(value), undefined, value);
  }
  assert.equal(canonicalIP('2001:0DB8:0000:0000::1'), '2001:db8::1');
  assert.equal(canonicalIP('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(canonicalIP('::ffff:c000:201'), '192.0.2.1');
});

test('proxy configuration rejects ranges, names and insecure/cross-origin modes', () => {
  for (const value of ['true', 'loopback', '172.30.30.0/29', '172.30.30.2,127.0.0.1']) {
    assert.throws(() => createClientIdentity(value), /one literal IP/);
  }
  assert.throws(() => createApp({ ...config, secureCookies: false }), /secure cookies/);
  assert.throws(() => createApp({ ...config, publicOrigin: undefined }), /DEMO_PUBLIC_ORIGIN/);
  assert.throws(() => createApp({ ...config, clientOrigin: origin }), /same-origin/);
  assert.throws(() => createApp({ ...config, publicOrigin: 'http://demo.example.test' }), /HTTPS/);
});

test('direct mode ignores the dedicated header as well as standard forwarding headers', () => {
  const request = { socket: { remoteAddress: '::ffff:192.0.2.7' }, headers: { 'x-demo-client-ip': '198.51.100.1' } } as unknown as Request;
  assert.equal(createClientIdentity()(request), '192.0.2.7');
  assert.equal(createClientIdentity('192.0.2.8')(request), undefined);
});

test('two clients behind the exact proxy have independent request limits; spoofed standard headers cannot rotate identities', async t => {
  const { root } = await api(t, { clientRequests: 2 });
  const a = await fetch(root, { headers: headers() });
  assert.equal(a.status, 200);
  const aCookie = cookie(a);
  assert.equal((await fetch(root, { headers: { ...headers(), Cookie: aCookie, 'X-Forwarded-For': '203.0.113.1' } })).status, 200);
  const blocked = await fetch(root, { headers: { ...headers(), Cookie: aCookie, Forwarded: 'for=203.0.113.2', 'X-Real-IP': '203.0.113.3' } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal((await fetch(root, { headers: headers('198.51.100.2') })).status, 200);
});

test('proxy session creation limits isolate clients while global limits span them', async t => {
  const { root } = await api(t, { clientSessions: 1, globalSessions: 2 });
  assert.equal((await fetch(root, { headers: headers() })).status, 200);
  assert.equal((await fetch(root, { headers: headers() })).status, 429);
  assert.equal((await fetch(root, { headers: headers('198.51.100.2') })).status, 200);
  assert.equal((await fetch(root, { headers: headers('198.51.100.3') })).status, 429);
});

test('per-client AI quotas follow the admitted visitor and rejected calls preserve state', async t => {
  let calls = 0;
  const { root } = await api(t, { clientAI: 1 }, { extractor: () => { calls++; return {}; } });
  const first = await fetch(root, { headers: headers() });
  const a = { ...headers(), Cookie: cookie(first), 'Content-Type': 'application/json' };
  const send = (h: typeof a) => fetch(root + '/message', { method: 'POST', headers: h, body: JSON.stringify({ message: 'synthetic input' }) });
  assert.equal((await send(a)).status, 200);
  const before = await (await fetch(root, { headers: a })).json();
  assert.equal((await send(a)).status, 429);
  assert.deepEqual(await (await fetch(root, { headers: a })).json(), before);
  const second = await fetch(root, { headers: headers('198.51.100.2') });
  assert.equal((await send({ ...headers('198.51.100.2'), Cookie: cookie(second), 'Content-Type': 'application/json' })).status, 200);
  assert.equal(calls, 2);
});

test('untrusted direct peer cannot reach demo routes even with cookies and forged headers; health remains available', async t => {
  const { root, protection } = await api(t, {}, { trustedProxyIP: '172.30.30.2' });
  for (const path of ['', '/reset', '/owner', '/owner/action', '/message']) {
    const response = await fetch(root + path, { method: path && path !== '/owner' ? 'POST' : 'GET', headers: { ...headers(), Cookie: '__Host-moving-demo=' + 'a'.repeat(43), 'X-Forwarded-For': '172.30.30.2' } });
    assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'REQUEST_FORBIDDEN');
  }
  assert.equal(protection.snapshot().trackedClients, 0);
  assert.equal((await fetch(root.replace('/demo', '/health'))).status, 200);
});

test('trusted peer with absent, malformed or duplicate identity fails closed before allocating clients', async t => {
  const { root, protection } = await api(t);
  for (const value of ['', '198.51.100.1, 198.51.100.2', 'for=198.51.100.1', '[::1]', 'fe80::1%eth0']) {
    assert.equal((await fetch(root, { headers: headers(value) })).status, 403);
  }
  assert.equal((await fetch(root, { headers: { 'X-Demo-Request': '1' } })).status, 403);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(root, { headers: ['Host', new URL(root).host, 'X-Demo-Request', '1', 'X-Demo-Client-IP', '198.51.100.1', 'x-demo-client-ip', '198.51.100.1'] }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403); assert.equal(protection.snapshot().trackedClients, 0);
});

test('equivalent IPv6 and mapped addresses share client counters', async t => {
  const { root } = await api(t, { clientRequests: 1 });
  for (const [first, second] of [['2001:db8::1', '2001:0DB8:0:0:0:0:0:1'], ['192.0.2.1', '::ffff:c000:201']]) {
    assert.equal((await fetch(root, { headers: headers(first) })).status, 200);
    assert.equal((await fetch(root, { headers: headers(second) })).status, 429);
  }
});

test('proxy mode preserves secure host-only cookies and rejects cross-origin or simple requests regardless of forwarded host/proto', async t => {
  const { root } = await api(t);
  const response = await fetch(root, { headers: { ...headers(), 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'evil.example' } });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /^__Host-moving-demo=/);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes('Domain='));
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const before = await response.json();
  for (const h of [{ ...headers(), Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' }, { 'X-Demo-Client-IP': '198.51.100.1', Origin: origin }, { ...headers(), 'Sec-Fetch-Site': 'cross-site' }]) {
    const rejected = await fetch(root + '/reset', { method: 'POST', headers: { ...h, Cookie: cookie(response) } });
    assert.equal(rejected.status, 403);
  }
  const preflight = await fetch(root, { method: 'OPTIONS', headers: { ...headers(), Origin: 'https://evil.example', 'Access-Control-Request-Headers': 'X-Demo-Request' } });
  assert.equal(preflight.status, 403); assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await (await fetch(root, { headers: { ...headers(), Cookie: cookie(response) } })).json(), before);
});
