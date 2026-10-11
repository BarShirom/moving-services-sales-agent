import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { DemoSessionStore } from '../src/demo/sessions.js';
import type { DemoSnapshot } from '../src/demo/types.js';
import type { OwnerSnapshot } from '../src/demo/ownerTypes.js';
import { browser } from './browser.js';
import { DemoProtection } from '../src/demo/protection.js';
import { getDemoLimits } from '../src/config/demoLimits.js';

async function api(t: TestContext, options: Parameters<typeof createApp>[0] = {}) {
  const app = createApp({ extractor: () => ({}), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, app };
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const token = (owner: OwnerSnapshot) => ({ leadId: owner.customer.lead.id, revision: owner.revision });
const headers = { 'X-Demo-Request': '1' };

test('two visitors have independent conversations, resets, reviews, pricing and quotes', async t => {
  const { root } = await api(t);
  const a = browser(), b = browser();
  const aInitial = await (await a(root + '/api/demo')).json() as DemoSnapshot;
  const bInitial = await (await b(root + '/api/demo')).json() as DemoSnapshot;
  assert.notEqual(aInitial.lead.id, bInitial.lead.id);
  const aMessage = await (await a(root + '/api/demo/message', json({ message: 'private visitor A' }))).json() as DemoSnapshot;
  assert.equal(aMessage.lead.messages[0].text, 'private visitor A');
  assert.deepEqual(await (await b(root + '/api/demo')).json(), bInitial);
  assert.equal((await b(root + '/api/demo/reset', json({}))).status, 200);
  assert.deepEqual(await (await a(root + '/api/demo')).json(), aMessage);
  const ownerA = await (await a(root + '/api/demo/owner')).json() as OwnerSnapshot;
  const ownerB = await (await b(root + '/api/demo/owner')).json() as OwnerSnapshot;
  for (const path of ['/owner/sample', '/owner/pricing']) {
    assert.equal((await b(root + '/api/demo' + path, json(token(ownerA)))).status, 409);
  }
  const sample = await (await a(root + '/api/demo/owner/sample', json(token(ownerA)))).json() as OwnerSnapshot;
  assert.equal(sample.pricingEvaluation!.humanApprovalRequired, true);
  assert.deepEqual(sample.reviews, []);
  const approve = { ...token(sample), action: 'APPROVE', pricingEvaluationId: sample.pricingEvaluation!.id,
    reviewedPhotoItemIndices: sample.pendingPhotoItemIndices };
  assert.equal((await b(root + '/api/demo/owner/action', json(approve))).status, 409);
  assert.deepEqual(await (await b(root + '/api/demo/owner')).json(), ownerB);
  const approved = await (await a(root + '/api/demo/owner/action', json(approve))).json() as OwnerSnapshot;
  assert.equal(approved.currentQuote!.status, 'SENT');
  assert.equal(approved.reviews.length, 1);
  assert.deepEqual(await (await b(root + '/api/demo/owner')).json(), ownerB);
  // Knowing another visitor's quote ID/version does not select their session.
  await b(root + '/api/demo/message', json({ message: 'כן', quoteId: approved.currentQuote!.id, quoteVersion: approved.currentQuote!.version }));
  assert.deepEqual(await (await a(root + '/api/demo/owner')).json(), approved);
  await b(root + '/api/demo/reset', json({}));
  assert.deepEqual(await (await a(root + '/api/demo/owner')).json(), approved);
});

test('unknown, malformed, encoded and duplicate cookie IDs never select existing state', async t => {
  // Exercise all malformed-cookie variants independently of the creation quota.
  const { root } = await api(t, { protection: new DemoProtection({ ...getDemoLimits({}), clientSessions: 20 }) });
  const issued = await fetch(root + '/api/demo', { headers });
  const cookie = issued.headers.get('set-cookie')!.split(';')[0];
  const original = await issued.json() as DemoSnapshot;
  const id = cookie.split('=')[1];
  for (const value of ['', 'moving-demo=' + 'A'.repeat(43), 'moving-demo=../invalid',
    'moving-demo=' + encodeURIComponent('%' + id), `${cookie}; ${cookie}`, 'moving-demo=short']) {
    const rejected = await fetch(root + '/api/demo/reset', { method: 'POST', headers: { ...headers, Cookie: value } });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.headers.get('set-cookie'), null);
    const fresh = await fetch(root + '/api/demo', { headers: { ...headers, Cookie: value } });
    assert.notEqual((await fresh.json() as DemoSnapshot).lead.id, original.lead.id);
    assert.notEqual(fresh.headers.get('set-cookie')!.split(';')[0], value);
  }
  assert.deepEqual(await (await fetch(root + '/api/demo', { headers: { ...headers, Cookie: cookie } })).json(), original);
});

test('expiry rejects stale writes and reads establish a new server-issued identity without replay', async t => {
  let time = 0;
  const store = new DemoSessionStore({ clock: () => time, ttlMs: 1000, maxSessions: 1 });
  const { root } = await api(t, { sessionStore: store });
  const first = await fetch(root + '/api/demo', { headers });
  const cookie = first.headers.get('set-cookie')!.split(';')[0];
  const initial = await first.json() as DemoSnapshot;
  time = 1000;
  const stale = await fetch(root + '/api/demo/reset', { method: 'POST', headers: { ...headers, Cookie: cookie } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { error: { code: string } }).error.code, 'SESSION_EXPIRED');
  const next = await fetch(root + '/api/demo', { headers: { ...headers, Cookie: cookie } });
  assert.equal(next.status, 200);
  assert.notEqual(next.headers.get('set-cookie')!.split(';')[0], cookie);
  assert.notEqual((await next.json() as DemoSnapshot).lead.id, initial.lead.id);
});

test('capacity rejects new sessions without eviction, while existing visitors still work', async t => {
  let time = 0;
  const store = new DemoSessionStore({ clock: () => time, ttlMs: 1000, maxSessions: 1 });
  const { root } = await api(t, { sessionStore: store });
  const visit = browser();
  const original = await (await visit(root + '/api/demo')).json();
  const full = await fetch(root + '/api/demo', { headers });
  assert.equal(full.status, 503);
  assert.equal(full.headers.get('set-cookie'), null);
  assert.deepEqual(await (await visit(root + '/api/demo')).json(), original);
  time = 1000;
  assert.equal((await fetch(root + '/api/demo', { headers })).status, 200);
});

test('one busy session rejects conflicting mutations while another processes messages and owner actions', async t => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const { root } = await api(t, { extractor: async input => {
    if (input.text === 'blocked') { started(); await gate; }
    return {};
  } });
  const a = browser(), b = browser();
  await a(root + '/api/demo'); await b(root + '/api/demo');
  const pending = a(root + '/api/demo/message', json({ message: 'blocked' }));
  await entered;
  try {
    for (const path of ['/reset', '/message', '/owner/action', '/owner/pricing', '/owner/sample']) {
      assert.equal((await a(root + '/api/demo' + path, json({ message: 'conflict' }))).status, 409);
    }
    const before = await (await a(root + '/api/demo')).json() as DemoSnapshot;
    assert.equal(before.lead.messages.length, 0);
    assert.equal((await b(root + '/api/demo/message', json({ message: 'independent' }))).status, 200);
    const ownerB = await (await b(root + '/api/demo/owner')).json() as OwnerSnapshot;
    assert.equal((await b(root + '/api/demo/owner/sample', json(token(ownerB)))).status, 200);
  } finally { release(); }
  assert.equal((await pending).status, 200);
  assert.equal((await a(root + '/api/demo/reset', json({}))).status, 200);
});

test('expiry during extraction cannot commit or free its capacity until work finishes', async t => {
  let time = 0, release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const store = new DemoSessionStore({ clock: () => time, ttlMs: 1000, maxSessions: 1 });
  const { root } = await api(t, { sessionStore: store, extractor: async () => { started(); await gate; return {}; } });
  const visit = browser();
  await visit(root + '/api/demo');
  const pending = visit(root + '/api/demo/message', json({ message: 'wait' }));
  await entered;
  try {
    time = 1000;
    assert.equal((await fetch(root + '/api/demo', { headers })).status, 503);
    assert.equal((await visit(root + '/api/demo/reset', json({}))).status, 409);
  } finally { release(); }
  assert.equal((await pending).status, 409);
  const fresh = await visit(root + '/api/demo');
  assert.equal(fresh.status, 200);
  assert.deepEqual((await fresh.json() as DemoSnapshot).lead.messages, []);
});

test('session state byte limit rejects atomic writes and reset recovers without losing prior state', async t => {
  const store = new DemoSessionStore({ maxStateBytes: 12_000 });
  const { root } = await api(t, { sessionStore: store });
  const visit = browser();
  let previous = await (await visit(root + '/api/demo')).json();
  let reachedLimit = false;
  for (let i = 0; i < 12; i++) {
    const result = await visit(root + '/api/demo/message', json({ message: 'x'.repeat(3000) }));
    if (result.status === 413) {
      reachedLimit = true;
      assert.equal((await result.json() as { error: { code: string } }).error.code, 'SESSION_FULL');
      assert.deepEqual(await (await visit(root + '/api/demo')).json(), previous);
      break;
    }
    assert.equal(result.status, 200);
    previous = await result.json();
  }
  assert.equal(reachedLimit, true);
  assert.equal((await visit(root + '/api/demo/reset', json({}))).status, 200);
  assert.deepEqual((await (await visit(root + '/api/demo')).json() as DemoSnapshot).lead.messages, []);
});

test('timed cleanup runs without traffic and session store instances share no state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  const store = new DemoSessionStore({ ttlMs: 1000, maxSessions: 1, clock: () => time });
  const first = store.create();
  const cleanup = t.mock.method(store, 'cleanup');
  assert.equal(new DemoSessionStore().get(first.id), undefined);
  time = 1000;
  t.mock.timers.tick(1000);
  assert.equal(cleanup.mock.callCount(), 1);
  assert.equal(store.get(first.id), undefined);
  assert.notEqual(store.create().id, first.id);
});

test('production cookie is opaque, host-only, Secure and HttpOnly independent of proxy headers', async t => {
  const { root, app } = await api(t, { secureCookies: true, publicOrigin: 'https://demo.example' });
  assert.equal(app.get('trust proxy'), false);
  const response = await fetch(root + '/api/demo', { headers: { ...headers, Origin: 'https://demo.example', 'X-Forwarded-Proto': 'http' } });
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-moving-demo=[A-Za-z0-9_-]{43};/);
  for (const flag of ['HttpOnly', 'Secure', 'Path=/', 'SameSite=Lax', 'Max-Age=1800']) assert.ok(cookie.includes(flag));
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.equal(JSON.stringify(await response.json()).includes(cookie.split(';')[0].split('=')[1]), false);
  const insecure = await fetch(root + '/api/demo', { headers: { ...headers, Origin: root, 'X-Forwarded-Proto': 'https' } });
  assert.equal(insecure.status, 403);
});

test('origin configuration rejects wildcard, path and insecure production origins', () => {
  for (const clientOrigin of ['*', 'null', 'https://demo.example/path', 'https://user:pass@demo.example', 'http://demo.example']) {
    assert.throws(() => createApp({ secureCookies: true, clientOrigin }));
  }
  assert.throws(() => createApp({ secureCookies: true, publicOrigin: 'http://demo.example' }));
});

test('CSRF guards reject forms, missing headers, untrusted and null origins without mutation', async t => {
  const { root } = await api(t);
  const first = await fetch(root + '/api/demo', { headers });
  const cookie = first.headers.get('set-cookie')!.split(';')[0];
  const before = await first.json();
  const rejectedHeaders: Record<string, string>[] = [{}, { Origin: root }, { ...headers, Origin: 'https://evil.example' },
    { ...headers, Origin: 'null' }, { ...headers, Origin: root + '.evil.example' },
    { ...headers, 'Sec-Fetch-Site': 'cross-site' }];
  for (const extra of rejectedHeaders) {
    const result = await fetch(root + '/api/demo/reset', { method: 'POST', headers: { Cookie: cookie, ...extra } });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('set-cookie'), null);
  }
  assert.deepEqual(await (await fetch(root + '/api/demo', { headers: { ...headers, Cookie: cookie } })).json(), before);
  assert.equal((await fetch(root + '/api/demo/reset', { method: 'POST', headers: { ...headers, Cookie: cookie, Origin: root } })).status, 200);
});

test('health, preflight, unsupported routes and invalid bodies cannot consume session capacity', async t => {
  const { root } = await api(t, { sessionStore: new DemoSessionStore({ maxSessions: 1 }) });
  for (const [path, init] of [
    ['/api/health', {}], ['/api/demo/no-such-route', { headers }],
    ['/api/demo', { method: 'OPTIONS', headers }],
    ['/api/demo/message', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' }],
  ] as const) {
    assert.equal((await fetch(root + path, init)).headers.get('set-cookie'), null);
  }
  assert.equal((await fetch(root + '/api/demo', { headers })).status, 200);
});
