import assert from 'node:assert/strict';
import { chmodSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { ResponseParseParams } from 'openai/resources/responses/responses';
import { AI_WINDOW_PROJECT_ID, PUBLIC_BETA_RELEASE_ID, PUBLIC_BETA_STATE_DIR, AIWindowError,
  createPublicBeta, createAIWindowFromEnv, publicBetaJournalHeader, reserveAIWindowRequest, validatePublicBetaPermit,
  type AIWindow, type AIWindowOptions, type PublicBetaPermit } from '../src/safety/aiWindow.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import { createLead } from '../src/domain/createLead.js';

const START = Date.parse('2026-10-20T23:59:00Z'), IMAGE = 'sha256:' + 'a'.repeat(64);
const request = (): ResponseParseParams => ({ model: 'gpt-6-luna', instructions: 'Offline synthetic example.',
  reasoning: { effort: 'none' }, service_tier: 'default', store: false, max_output_tokens: 4000,
  input: [{ role: 'user', content: 'synthetic only' }], text: { format: { type: 'json_schema', name: 'offline',
    strict: true, schema: { type: 'object', properties: {}, required: [], additionalProperties: false } } } });
const denied = (reason: string) => (error: unknown) => error instanceof AIWindowError && error.reason === reason;
function fixture(t: TestContext, changes: Partial<PublicBetaPermit> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'moving-public-beta-offline-'));
  const stateDir = join(root, 'release'), permitPath = join(root, 'permit.json'); mkdirSync(stateDir);
  const permit: PublicBetaPermit = { version: 2, mode: 'public_beta', imageDigest: IMAGE,
    windowId: PUBLIC_BETA_RELEASE_ID, startsAt: new Date(START).toISOString(), expiresAt: '2026-11-19T00:00:00Z',
    maxAttempts: 25, maxReservedUnits: 5120000, maxReservedMicros: 500000, projectId: AI_WINDOW_PROJECT_ID,
    operatorApprovalRef: 'offline-release-authorization', credentialKeyId: 'metadata-existing-key',
    rotatedFromKeyId: 'metadata-prior-key', credentialExpiresAt: '2026-11-20T00:00:00Z',
    rotationVerifiedAt: '2026-10-20T12:00:00Z', ...changes };
  writeFileSync(permitPath, JSON.stringify(permit)); chmodSync(permitPath, 0o444);
  const journalPath = join(stateDir, 'release.claim.jsonl'), ownerPath = join(stateDir, 'release.owner.json');
  writeFileSync(journalPath, JSON.stringify(publicBetaJournalHeader(permit)) + '\n', { mode: 0o600 });
  const historical = join(root, 'historical-consumed-window.claim.jsonl');
  const historicalBytes = '{"event":"attempt","reservedUnits":31259,"reservedMicros":17894}\n';
  writeFileSync(historical, historicalBytes);
  let wall = START, monotonic = 0;
  const windows: AIWindow[] = [];
  const options: AIWindowOptions = { stateDir, permitPath, wallNow: () => wall, monotonicNow: () => monotonic,
    syncDirectory: () => {}, scheduleWatchdog: () => () => {} };
  const open = (overrides: Partial<AIWindowOptions> = {}) => {
    const value = createPublicBeta({ ...options, ...overrides }, IMAGE); windows.push(value); return value;
  };
  t.after(() => { windows.forEach(value => value.close('shutdown')); chmodSync(permitPath, 0o600);
    chmodSync(journalPath, 0o600); assert.equal(readFileSync(historical, 'utf8'), historicalBytes);
    rmSync(root, { recursive: true, force: true }); });
  return { root, stateDir, permitPath, journalPath, ownerPath, permit, options, open,
    advance(ms: number) { wall += ms; monotonic += ms; },
    journal: () => readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

test('explicit beta policy permits ongoing operation but rejects other release, overbudget and image bindings', t => {
  const f = fixture(t);
  assert.equal(f.open().snapshot().state, 'open');
  for (const changes of [{ version: 1 }, { mode: 'armed' }, { windowId: 'a-new-window' }, { maxAttempts: 26 },
    { maxReservedMicros: 500001 }, { maxReservedUnits: 5120001 }, { imageDigest: 'wrong' }, { apiKey: 'never' }]) {
    assert.throws(() => validatePublicBetaPermit({ ...f.permit, ...changes }), denied('invalid_permit'));
  }
  assert.equal(createPublicBeta(f.options, 'sha256:' + 'b'.repeat(64)).snapshot().reason, 'invalid_permit');
});

test('precreated authorization is mandatory: missing state/journal never creates or replenishes allowance', t => {
  const f = fixture(t);
  const absent = join(f.root, 'absent');
  assert.equal(f.open({ stateDir: absent }).snapshot().reason, 'state_unavailable');
  assert.equal(existsSync(absent), false);
  rmSync(f.journalPath);
  assert.equal(f.open().snapshot().reason, 'state_unavailable');
  assert.equal(existsSync(f.journalPath), false);
  // Restore only this temporary fixture for cleanup; production has no reset function.
  writeFileSync(f.journalPath, JSON.stringify(publicBetaJournalHeader(f.permit)) + '\n');
});

test('graceful restart, deployment image change and UTC midnight replay one cumulative release budget', async t => {
  const f = fixture(t), first = f.open();
  await first.run(request(), async () => 'first');
  const spent = first.snapshot(); first.close('shutdown');
  assert.equal(existsSync(f.ownerPath), false);
  f.advance(120000);
  const second = f.open();
  assert.equal(second.snapshot().attempts, 1); assert.equal(second.snapshot().reservedMicros, spent.reservedMicros);
  await second.run(request(), async () => 'second'); second.close('shutdown');
  chmodSync(f.permitPath, 0o600);
  const newImage = 'sha256:' + 'b'.repeat(64);
  writeFileSync(f.permitPath, JSON.stringify({ ...f.permit, imageDigest: newImage })); chmodSync(f.permitPath, 0o444);
  const rolled = createPublicBeta(f.options, newImage);
  assert.equal(rolled.snapshot().attempts, 2); assert.equal(rolled.snapshot().reservedMicros, spent.reservedMicros * 2);
  rolled.close('shutdown');
  assert.equal(f.journal().filter(row => row.event === 'release_authorized').length, 1);
});

test('25 attempts are shared across repeated starts and never replenish', async t => {
  const f = fixture(t);
  for (let index = 0; index < 25; index++) {
    const window = f.open(); assert.equal(window.snapshot().attempts, index);
    await window.run(request(), async () => index);
    if (index < 24) window.close('shutdown');
    f.advance(61000);
  }
  const rejected = f.open();
  assert.ok(['already_consumed', 'budget_exhausted'].includes(rejected.snapshot().reason!));
  await assert.rejects(rejected.run(request(), async () => assert.fail('26th')), AIWindowError);
  assert.equal(f.journal().filter(row => row.event === 'attempt').length, 25);
});

test('USD500000 micros cumulative conservative reservation cap wins before attempt cap without refunds', async t => {
  const reserve = reserveAIWindowRequest(request()), f = fixture(t, { maxReservedMicros: reserve.micros }), window = f.open();
  await window.run(request(), async () => 'one');
  await assert.rejects(window.run(request(), async () => assert.fail('unfunded')), denied('budget_exhausted'));
  assert.equal(window.snapshot().attempts, 1); assert.equal(window.snapshot().reservedMicros, reserve.micros);
});

test('ordinary failed submissions consume allowance, save sanitized metadata and do not retry/refund', async t => {
  const f = fixture(t), window = f.open(); let calls = 0;
  await assert.rejects(window.run(request(), async () => {
    calls++; window.recordDiagnostic!({ stage: 'domain_validation', classification: 'domain_validation',
      validationField: 'requestedTime', validationRule: 'time_hh_mm', dispatchStarted: true,
      providerHttpStatus: 200, providerRequestId: 'req_' + 'a'.repeat(32), rejectedValue: 'CUSTOMER SECRET' });
    throw new Error('never retained customer text');
  }), denied('request_failed'));
  assert.equal(calls, 1); assert.equal(window.snapshot().state, 'open');
  assert.equal(window.snapshot().attempts, 1); assert.ok(window.snapshot().reservedMicros > 0);
  const diagnostic = f.journal().find(row => row.event === 'diagnostic').diagnostic;
  assert.equal(diagnostic.validationField, 'requestedTime'); assert.equal(diagnostic.validationRule, 'time_hh_mm');
  assert.doesNotMatch(JSON.stringify(f.journal()), /CUSTOMER SECRET|never retained/);
  window.close('shutdown'); assert.equal(f.open().snapshot().attempts, 1);
});

test('rolling three per minute survives restart and concurrency remains one', async t => {
  const f = fixture(t); let finish!: () => void;
  const first = f.open(); const pending = first.run(request(), () => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(first.run(request(), async () => assert.fail('concurrent')), denied('busy'));
  await Promise.resolve(); finish(); await pending;
  await first.run(request(), async () => 'second'); first.close('shutdown');
  const next = f.open(); await next.run(request(), async () => 'third');
  await assert.rejects(next.run(request(), async () => assert.fail('fourth in minute')), denied('rate_limited'));
  assert.equal(next.snapshot().attempts, 3); f.advance(60000);
  await next.run(request(), async () => 'fourth later'); assert.equal(next.snapshot().attempts, 4);
});

test('an extant or interrupted owner lease is never automatically stolen or reset', async t => {
  const f = fixture(t), first = f.open();
  assert.equal(f.open().snapshot().reason, 'already_consumed');
  await first.run(request(), async () => 'one'); first.close('operator_stop');
  assert.equal(existsSync(f.ownerPath), true);
  assert.equal(f.open().snapshot().reason, 'already_consumed');
  assert.equal(f.journal().filter(row => row.event === 'attempt').length, 1);
});

test('corrupt, partial, contradictory or readonly accounting fails closed and is not repaired', t => {
  for (const corruption of ['{partial', '{}\n', JSON.stringify({ ...publicBetaJournalHeader(fixture(t).permit), maxAttempts: 26 }) + '\n']) {
    const f = fixture(t); writeFileSync(f.journalPath, corruption);
    assert.equal(f.open().snapshot().reason, 'state_unavailable'); assert.equal(readFileSync(f.journalPath, 'utf8'), corruption);
  }
  const readonly = fixture(t); chmodSync(readonly.journalPath, 0o444);
  assert.equal(readonly.open().snapshot().reason, 'state_unavailable');
});

test('reservation fsync failure prevents transport, retains uncertain hold and cannot reopen after restart', async t => {
  const f = fixture(t); let syncs = 0, calls = 0;
  const window = f.open({ syncFile: fd => { fsyncSync(fd); if (++syncs === 3) throw new Error('offline disk fault'); } });
  await assert.rejects(window.run(request(), async () => { calls++; }), denied('journal_failed'));
  assert.equal(calls, 0); assert.equal(window.snapshot().attempts, 1); assert.ok(window.snapshot().reservedMicros > 0);
  assert.equal(f.open().snapshot().reason, 'already_consumed');
});

test('diagnostic fsync failure closes admission, keeps hold/evidence and blocks further dispatch', async t => {
  const f = fixture(t); let syncs = 0;
  const window = f.open({ syncFile: fd => { fsyncSync(fd); if (++syncs === 4) throw new Error('diagnostic sync fault'); } });
  await assert.rejects(window.run(request(), async () => {
    window.recordDiagnostic!({ dispatchStarted: true, stage: 'domain_validation', validationField: 'customer text',
      validationRule: 'sk-do-not-save' }); return 'must fail';
  }), denied('journal_failed'));
  assert.equal(window.snapshot().reason, 'journal_failed'); assert.equal(window.snapshot().attempts, 1);
  const record = f.journal().find(row => row.event === 'diagnostic');
  assert.equal(record.diagnostic.validationField, 'unknown'); assert.equal(record.diagnostic.validationRule, 'unknown');
  await assert.rejects(window.run(request(), async () => assert.fail('second')), denied('journal_failed'));
  assert.equal(existsSync(f.ownerPath), true);
});

test('actual extractor stores exact safe rejection before failed outcome and preserves the lead', async t => {
  const f = fixture(t), window = f.open(), lead = createLead(), before = structuredClone(lead);
  const keep = () => ({ action: 'keep' }), location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
  const extractor = createAIExtractor({ env: { OPENAI_MODEL: 'gpt-6-luna' }, window, onDiagnostic: () => {},
    request: async () => ({ status: 'completed', output: [], output_parsed: { items: [], pickup: location(), dropoff: location(),
      requestedDate: keep(), requestedTime: { action: 'set', value: '25:99' }, specialAccessNotes: keep() } }) });
  await assert.rejects(extractor({ lead, text: 'offline synthetic' }), AIWindowError);
  assert.deepEqual(lead, before);
  const rows = f.journal(), diagnosticIndex = rows.findIndex(row => row.event === 'diagnostic');
  assert.equal(rows[diagnosticIndex].diagnostic.validationField, 'requestedTime');
  assert.equal(rows[diagnosticIndex].diagnostic.validationRule, 'time_hh_mm');
  assert.ok(diagnosticIndex < rows.findIndex(row => row.event === 'outcome'));
  assert.equal(window.snapshot().attempts, 1);
});

test('environment beta mode keeps independent kill switches and exact release path/rate/image requirements', () => {
  const valid = { AI_WINDOW_MODE: 'public_beta', AI_WINDOW_STATE_DIR: PUBLIC_BETA_STATE_DIR,
    AI_WINDOW_PERMIT_PATH: '/missing/read-only-permit.json', AI_PUBLIC_BETA_RELEASE_ID: PUBLIC_BETA_RELEASE_ID,
    AI_PUBLIC_BETA_IMAGE_DIGEST: IMAGE, OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID, OPENAI_MODEL: 'gpt-6-luna',
    DEMO_AI_CONCURRENCY: '1', DEMO_AI_REQUESTS_PER_MINUTE: '3', DEMO_AI_REQUESTS_PER_DAY: '25',
    DEMO_AI_RESERVED_TOKENS_PER_DAY: '5120000' };
  for (const changes of [{ AI_PUBLIC_BETA_RELEASE_ID: 'replacement' }, { AI_WINDOW_STATE_DIR: '/new-budget' },
    { DEMO_AI_REQUESTS_PER_MINUTE: '4' }, { DEMO_AI_CONCURRENCY: '2' }, { OPENAI_BASE_URL: 'https://other.invalid' }]) {
    assert.equal(createAIWindowFromEnv({ ...valid, ...changes }).snapshot().reason, 'invalid_configuration');
  }
  assert.equal(createAIWindowFromEnv({ ...valid, DEMO_AI_REQUESTS_PER_DAY: '0' }).snapshot().reason, 'disabled');
});

test('changed cumulative authorization or cap cannot resume an existing release journal', t => {
  for (const changes of [{ operatorApprovalRef: 'different-authorization' }, { maxAttempts: 24 }, { maxReservedMicros: 499999 }]) {
    const f = fixture(t); chmodSync(f.permitPath, 0o600);
    writeFileSync(f.permitPath, JSON.stringify({ ...f.permit, ...changes })); chmodSync(f.permitPath, 0o444);
    assert.equal(f.open().snapshot().reason, 'state_unavailable');
    assert.equal(f.journal().filter(row => row.event === 'attempt').length, 0);
  }
});

test('successful actual SDK fake-fetch receipt is durable without response or customer data', async t => {
  const f = fixture(t), window = f.open(); let calls = 0;
  const keep = () => ({ action: 'keep' }), location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
  const output = { items: [], pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep() };
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; assert.equal(f.journal().at(-1).event, 'attempt');
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }] }),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'req_' + 'b'.repeat(32) } });
  });
  const extractor = createAIExtractor({ window, env: { OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID,
    OPENAI_API_KEY: 'test-only' } });
  await extractor({ lead: createLead(), text: 'synthetic customer data not logged' });
  assert.equal(calls, 1);
  const receipt = f.journal().find(row => row.event === 'provider_receipt');
  assert.equal(receipt.providerHttpStatus, 200); assert.equal(receipt.providerRequestId, 'req_' + 'b'.repeat(32));
  assert.doesNotMatch(JSON.stringify(f.journal()), /synthetic customer|test-only|output_text|pickup/);
  window.close('shutdown'); assert.equal(f.open().snapshot().attempts, 1);
});
