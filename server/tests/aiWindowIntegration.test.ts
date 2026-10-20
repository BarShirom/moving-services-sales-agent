import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLead } from '../src/domain/createLead.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import { AI_WINDOW_PROJECT_ID, AIWindowError, createAIWindow } from '../src/safety/aiWindow.js';
import { DemoProtection, ProtectionError } from '../src/demo/protection.js';
import { getDemoLimits } from '../src/config/demoLimits.js';
import { DemoSessionStore } from '../src/demo/sessions.js';

function fixture(t: TestContext, attempts = 10) {
  const root = mkdtempSync(join(tmpdir(), 'moving-window-integration-'));
  const stateDir = join(root, 'state'), permitPath = join(root, 'permit.json');
  mkdirSync(stateDir);
  const start = Date.parse('2026-10-21T23:59:00Z');
  writeFileSync(permitPath, JSON.stringify({ version: 1, windowId: 'offline-integration',
    startsAt: new Date(start).toISOString(), expiresAt: new Date(start + 900000).toISOString(),
    maxAttempts: attempts, maxReservedUnits: 400000, maxReservedMicros: 500000,
    projectId: AI_WINDOW_PROJECT_ID, operatorApprovalRef: 'offline-test-only',
    credentialKeyId: 'key_test_replacement', rotatedFromKeyId: 'key_test_old',
    credentialExpiresAt: '2026-11-01T00:00:00Z', rotationVerifiedAt: '2026-10-21T22:00:00Z' }));
  chmodSync(permitPath, 0o444);
  const window = createAIWindow({ stateDir, permitPath, wallNow: () => start, monotonicNow: () => 0,
    ...(process.platform === 'win32' ? { syncDirectory: () => {} } : {}) });
  assert.equal(window.snapshot().state, 'open');
  t.after(() => { window.close(); chmodSync(permitPath, 0o600); rmSync(root, { recursive: true, force: true }); });
  return { window, journal: () => readFileSync(join(stateDir, 'window.claim.jsonl'), 'utf8') };
}

const keep = () => ({ action: 'keep' });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
const empty = () => ({ items: [], pickup: location(), dropoff: location(),
  requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep() });
const env = { OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID, OPENAI_API_KEY: 'test-only' };

test('real SDK boundary is blocked by default even with a credential-shaped test value', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not dispatch'); });
  const extractor = createAIExtractor({ env });
  await assert.rejects(extractor({ lead: createLead(), text: 'מקרר' }), AIWindowError);
  assert.equal(fetch.mock.callCount(), 0);
});

test('fsynced attempt exists before actual SDK fake-fetch; request/project/abort stay pinned', async t => {
  const { window, journal } = fixture(t, 1);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    const entries = journal().trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries.at(-1).event, 'attempt');
    assert.equal(entries.at(-1).attempt, 1);
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('openai-project'), AI_WINDOW_PROJECT_ID);
    assert.equal(new Headers(init?.headers).get('x-stainless-retry-count'), '0');
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-6-luna');
    assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.equal(body.service_tier, 'default');
    assert.equal(body.text.format.strict, true);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message',
      role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(empty()), annotations: [] }] }] }),
    { headers: { 'content-type': 'application/json' } });
  });
  const extractor = createAIExtractor({ env: { ...env, OPENAI_BASE_URL: 'https://invalid.example' }, window });
  await extractor({ lead: createLead(), text: 'מקרר בדיקה סינתטי' });
  await assert.rejects(extractor({ lead: createLead(), text: 'עוד מקרר' }), AIWindowError);
  assert.equal(calls, 1);
  assert.equal(window.snapshot().attempts, 1);
  assert.doesNotMatch(journal(), /test-only|מקרר|authorization|pickup|output_parsed/);
});

test('provider refusal/invalid extraction closes window, retains reservation and preserves lead', async t => {
  const { window } = fixture(t);
  const lead = createLead(), before = structuredClone(lead);
  let calls = 0;
  const extractor = createAIExtractor({ env, window, request: async () => {
    calls++;
    return { status: 'completed', output: [], output_parsed: { ...empty(), price: 1, status: 'APPROVED' } };
  } });
  await assert.rejects(extractor({ lead, text: 'מחיר שקל' }), AIWindowError);
  const snapshot = window.snapshot();
  assert.equal(snapshot.state, 'closed');
  assert.equal(snapshot.attempts, 1);
  assert.ok(snapshot.reservedMicros > 0);
  await assert.rejects(extractor({ lead, text: 'שוב' }), AIWindowError);
  assert.equal(calls, 1);
  assert.deepEqual(lead, before);
});

test('zero daily quotas remain an independent kill switch before durable admission', async t => {
  const { window } = fixture(t);
  let calls = 0;
  const protection = new DemoProtection(getDemoLimits({ DEMO_AI_REQUESTS_PER_DAY: '0', DEMO_AI_RESERVED_TOKENS_PER_DAY: '0' }));
  const session = new DemoSessionStore().create().session;
  const extractor = createAIExtractor({ env, window, request: async () => {
    calls++; return { status: 'completed', output: [], output_parsed: empty() };
  } });
  await assert.rejects(extractor({ lead: createLead(), text: 'מקרר' },
    (request, run) => protection.extract(session, '127.0.0.1', request, run)), ProtectionError);
  assert.equal(calls, 0);
  assert.equal(window.snapshot().attempts, 0);
});

test('emergency close reaches SDK AbortSignal and leaves the consumed attempt reserved', async t => {
  const { window } = fixture(t);
  let seen: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    assert.ok(seen);
    window.close('operator_stop');
    return await new Promise<Response>((_resolve, reject) => {
      if (seen!.aborted) reject(new Error('aborted'));
      else seen!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  const extractor = createAIExtractor({ env, window });
  await assert.rejects(extractor({ lead: createLead(), text: 'מקרר' }), AIWindowError);
  assert.equal(seen?.aborted, true);
  assert.equal(window.snapshot().attempts, 1);
});
