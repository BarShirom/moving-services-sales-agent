import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { DemoProtection, ProtectionError } from '../src/demo/protection.js';
import { DemoSessionStore } from '../src/demo/sessions.js';
import { getDemoLimits, type DemoLimits } from '../src/config/demoLimits.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import { createLead } from '../src/domain/createLead.js';
import { browser } from './browser.js';

const config = (override: Partial<DemoLimits> = {}) => ({ ...getDemoLimits({}), ...override });
const payload = { model: 'test-model', input: 'synthetic', max_output_tokens: 4000 };
const session = () => new DemoSessionStore().create().session;
const fails = (code: string) => (error: unknown) => error instanceof ProtectionError && error.code === code && error.retryAfter > 0;
const headers = { 'X-Demo-Request': '1' };
const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function api(t: TestContext, protection: DemoProtection, options: Parameters<typeof createApp>[0] = {}) {
  const server = createApp({ protection, extractor: () => ({}), ...options }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`;
}

test('per-session HTTP quota rejects without state mutation and reset does not clear it', async t => {
  let now = 0;
  const root = await api(t, new DemoProtection(config({ sessionRequests: 3 }), () => now));
  const a = browser(), b = browser();
  await a(root);
  const reset = await (await a(root + '/reset', post())).json();
  await a(root);
  const blocked = await a(root + '/reset', post());
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal((await b(root)).status, 200);
  now = 60_000;
  assert.deepEqual(await (await a(root)).json(), reset);
});

test('socket client limits ignore forged forwarding headers and cookie churn; health is independent', async t => {
  const root = await api(t, new DemoProtection(config({ clientRequests: 2 })));
  for (let i = 0; i < 2; i++) {
    assert.equal((await fetch(root, { headers: { ...headers, 'X-Forwarded-For': `198.51.100.${i}`, 'X-Real-IP': `203.0.113.${i}` } })).status, 200);
  }
  const blocked = await fetch(root, { headers: { ...headers, 'X-Forwarded-For': '192.0.2.99', Forwarded: 'for=192.0.2.100' } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('set-cookie'), null);
  assert.equal((await fetch(root.replace('/demo', '/health'))).status, 200);
});

test('new-session limits apply per peer and globally across peers without evicting active counters', () => {
  const guard = new DemoProtection(config({ clientSessions: 1, globalSessions: 2 }));
  guard.createSession('198.51.100.1');
  assert.throws(() => guard.createSession('198.51.100.1'), fails('SESSION_RATE_LIMITED'));
  guard.createSession('198.51.100.2');
  assert.throws(() => guard.createSession('198.51.100.3'), fails('SESSION_RATE_LIMITED'));
});

test('global HTTP admission spans peers and recovers at the fixed-window boundary', () => {
  let now = 0;
  const guard = new DemoProtection(config({ globalRequests: 2 }), () => now);
  guard.request('one'); guard.request('two');
  assert.throws(() => guard.request('three'), fails('RATE_LIMITED'));
  now = 60_000; guard.request('three');
});

test('session creation 429 never issues a cookie, and existing visitors still work', async t => {
  const root = await api(t, new DemoProtection(config({ globalSessions: 1 })));
  const a = browser();
  const before = await (await a(root)).json();
  const blocked = await fetch(root, { headers });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('set-cookie'), null);
  assert.deepEqual(await (await a(root)).json(), before);
});

test('AI semaphore has no queue, never exceeds the ceiling, and releases even on failure', async () => {
  const guard = new DemoProtection(config({ aiConcurrency: 2 }));
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const run = async () => { calls++; await gate; };
  const first = guard.extract(session(), 'one', payload, run);
  const second = guard.extract(session(), 'two', payload, run);
  try {
    await assert.rejects(guard.extract(session(), 'three', payload, run), fails('AI_BUSY'));
    assert.equal(calls, 2); assert.equal(guard.snapshot().activeAI, 2);
    assert.equal(guard.snapshot().dailyAIRequests, 2);
  } finally { release(); }
  await Promise.all([first, second]);
  assert.equal(guard.snapshot().activeAI, 0);
  await assert.rejects(guard.extract(session(), 'four', payload, () => { throw new Error('synthetic'); }));
  assert.equal(guard.snapshot().activeAI, 0);
  assert.equal(guard.snapshot().dailyAIRequests, 3, 'failed attempt is not refunded');
});

test('HTTP excess AI concurrency returns 503 with retry guidance and unchanged state', async t => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const root = await api(t, new DemoProtection(config({ aiConcurrency: 1 })), { extractor: async () => { started(); await gate; return {}; } });
  const a = browser(), b = browser(); await a(root);
  const before = await (await b(root)).json();
  const pending = a(root + '/message', post({ message: 'one' })); await entered;
  try {
    const rejected = await b(root + '/message', post({ message: 'two' }));
    assert.equal(rejected.status, 503); assert.equal(rejected.headers.get('Retry-After'), '5');
    assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'AI_BUSY');
    assert.deepEqual(await (await b(root)).json(), before);
  } finally { release(); }
  assert.equal((await pending).status, 200);
  assert.equal((await b(root + '/reset', post())).status, 200);
});

test('per-session AI allowance survives reset and rejected messages preserve state', async t => {
  let calls = 0;
  const guard = new DemoProtection(config({ sessionAI: 1 }));
  const root = await api(t, guard, { extractor: () => { calls++; return {}; } });
  const a = browser(); await a(root);
  assert.equal((await a(root + '/message', post({ message: 'one' }))).status, 200);
  const reset = await (await a(root + '/reset', post())).json();
  assert.equal((await a(root + '/message', post({ message: 'two' }))).status, 429);
  assert.deepEqual(await (await a(root)).json(), reset);
  assert.equal(calls, 1); assert.equal(guard.snapshot().dailyAIRequests, 1);
});

test('client AI allowance survives new cookies; application allowance spans independent peers', async () => {
  const guard = new DemoProtection(config({ clientAI: 1, globalAI: 2 }));
  await guard.extract(session(), 'one', payload, () => ({}));
  await assert.rejects(guard.extract(session(), 'one', payload, () => assert.fail()), fails('AI_RATE_LIMITED'));
  await guard.extract(session(), 'two', payload, () => ({}));
  await assert.rejects(guard.extract(session(), 'three', payload, () => assert.fail()), fails('AI_RATE_LIMITED'));
});

test('daily request cutoff cannot be bypassed by session reset, new cookies or new peers', async () => {
  const guard = new DemoProtection(config({ dailyAI: 1 }));
  await guard.extract(session(), 'one', payload, () => ({}));
  await assert.rejects(guard.extract(session(), 'two', payload, () => assert.fail('paid call forbidden')), fails('AI_BUDGET_EXHAUSTED'));
  assert.equal(guard.snapshot().dailyAIRequests, 1);
});

test('token reservations are atomic, conservative, never refunded and reset only at UTC day boundary', async () => {
  const size = Buffer.byteLength(JSON.stringify(payload)) + 4000 + 4096;
  let now = Date.UTC(2026, 9, 11, 23, 59, 30);
  const guard = new DemoProtection(config({ dailyTokens: size }), () => now);
  await assert.rejects(guard.extract(session(), 'one', payload, () => { throw new Error('provider timeout'); }));
  assert.equal(guard.snapshot().dailyReservedTokens, size);
  now -= 60_000; // Clock rollback must not reset a budget.
  await assert.rejects(guard.extract(session(), 'two', payload, () => assert.fail()), fails('AI_BUDGET_EXHAUSTED'));
  now = Date.UTC(2026, 9, 12);
  await guard.extract(session(), 'three', payload, () => ({}));
  assert.equal(guard.snapshot().dailyAIRequests, 1);
});

test('in-flight reservations consume daily budget immediately and midnight never resets concurrency', async () => {
  let now = Date.UTC(2026, 9, 11, 23, 59, 30), release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const guard = new DemoProtection(config({ dailyAI: 1, aiConcurrency: 1 }), () => now);
  const pending = guard.extract(session(), 'one', payload, () => gate);
  try {
    await assert.rejects(guard.extract(session(), 'two', payload, () => assert.fail()), fails('AI_BUDGET_EXHAUSTED'));
    now = Date.UTC(2026, 9, 12);
    await assert.rejects(guard.extract(session(), 'three', payload, () => assert.fail()), fails('AI_BUSY'));
    assert.equal(guard.snapshot().activeAI, 1);
    assert.equal(guard.snapshot().dailyAIRequests, 0);
  } finally { release(); }
  await pending;
  await guard.extract(session(), 'four', payload, () => ({}));
});

test('oversized AI requests are rejected before transport without truncating input or spending budget', async () => {
  const guard = new DemoProtection(config({ requestBytes: 5 }));
  await assert.rejects(guard.extract(session(), 'peer', payload, () => assert.fail()), fails('AI_INPUT_LIMIT'));
  assert.equal(guard.snapshot().dailyAIRequests, 0);
});

for (const model of ['gpt-5.4-nano', 'gpt-6-luna']) {
test(`real ${model} extraction admission reserves the complete request and blocks paid calls`, async () => {
  let calls = 0, expectedReservation = 0;
  const guard = new DemoProtection(config({ dailyAI: 1 }));
  const extractor = createAIExtractor({ env: { OPENAI_MODEL: model }, request: async () => {
    calls++;
    assert.equal(guard.snapshot().dailyAIRequests, 1, 'admission precedes transport');
    assert.equal(guard.snapshot().dailyReservedTokens, expectedReservation);
    throw new Error('synthetic provider failure');
  } });
  const s = session();
  const admission: Parameters<typeof extractor>[1] = (request, run) => {
    assert.equal(request.max_output_tokens, 4000); assert.ok(request.instructions); assert.ok(request.text?.format);
    assert.equal(request.model, model);
    if (model === 'gpt-6-luna') {
      assert.deepEqual(request.reasoning, { effort: 'none' });
      assert.equal(request.service_tier, 'default');
    }
    expectedReservation = Buffer.byteLength(JSON.stringify(request)) + 4000 + 4096;
    return guard.extract(s, 'peer', request, run);
  };
  await assert.rejects(extractor({ lead: createLead(), text: 'synthetic' }, admission));
  await assert.rejects(extractor({ lead: createLead(), text: 'synthetic' }, admission), fails('AI_BUDGET_EXHAUSTED'));
  assert.equal(calls, 1);
  assert.equal(guard.snapshot().dailyReservedTokens, expectedReservation, 'failed attempt is not refunded');
});
}

test('zero AI budget still allows synthetic pricing, approval and deterministic quote acceptance', async t => {
  const root = await api(t, new DemoProtection(config({ dailyAI: 0 })), { extractor: () => assert.fail('No paid call allowed') });
  const a = browser(); await a(root);
  assert.equal((await a(root + '/message', post({ message: 'needs AI' }))).status, 429);
  const owner = await (await a(root + '/owner')).json() as import('../src/demo/ownerTypes.js').OwnerSnapshot;
  const sample = await (await a(root + '/owner/sample', post({ leadId: owner.customer.lead.id, revision: owner.revision }))).json() as typeof owner;
  const sent = await (await a(root + '/owner/action', post({ leadId: sample.customer.lead.id, revision: sample.revision,
    action: 'APPROVE', pricingEvaluationId: sample.pricingEvaluation!.id, reviewedPhotoItemIndices: sample.pendingPhotoItemIndices }))).json() as typeof owner;
  const accepted = await (await a(root + '/message', post({ message: 'כן', quoteId: sent.currentQuote!.id, quoteVersion: sent.currentQuote!.version }))).json() as import('../src/demo/types.js').DemoSnapshot;
  assert.equal(accepted.lead.status, 'WON');
});

test('bookkeeping is bounded, fails closed at capacity, expires without eviction bypass and contains no log identity', () => {
  let now = 0;
  const guard = new DemoProtection(config({ maxClients: 2, globalRequests: 10_000 }), () => now);
  guard.request('private-peer-one'); guard.request('private-peer-two');
  for (let i = 0; i < 100; i++) assert.throws(() => guard.request('other-' + i), fails('PROTECTION_CAPACITY'));
  assert.equal(guard.snapshot().trackedClients, 2);
  assert.doesNotMatch(JSON.stringify(guard.snapshot()), /private-peer|other-|cookie|message|apiKey/);
  now = 60_000; guard.cleanup(); assert.equal(guard.snapshot().trackedClients, 0);
  guard.request('new'); assert.equal(guard.snapshot().trackedClients, 1);
});

test('trusted CORS origin can read throttle responses and Retry-After; preflight is limited too', async t => {
  const origin = 'http://localhost:5173';
  const root = await api(t, new DemoProtection(config({ clientRequests: 1 })), { clientOrigin: origin });
  await fetch(root, { method: 'OPTIONS', headers: { Origin: origin } });
  const response = await fetch(root, { headers: { ...headers, Origin: origin } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
});

test('environment limits accept explicit zero budget and reject malformed or excessive values', () => {
  assert.equal(getDemoLimits({ DEMO_AI_REQUESTS_PER_DAY: '0' }).dailyAI, 0);
  for (const value of ['-1', 'Infinity', 'NaN', '1.2', '1e2', '11', 'true']) {
    assert.throws(() => getDemoLimits({ DEMO_AI_CONCURRENCY: value }));
  }
  assert.equal(getDemoLimits({}).aiConcurrency, 2);
});
