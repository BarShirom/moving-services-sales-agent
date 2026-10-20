import assert from 'node:assert/strict';
import { chmodSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { ResponseParseParams } from 'openai/resources/responses/responses';
import {
  AI_WINDOW_PROJECT_ID, AI_WINDOW_LIMITS, AIWindowError, createAIWindow, createAIWindowFromEnv,
  reserveAIWindowRequest, validateAIWindowPermit,
  type AIWindow, type AIWindowOptions, type AIWindowPermit, type AIWindowReason,
} from '../src/safety/aiWindow.js';

const START = Date.parse('2026-10-20T23:55:00Z');
const request = (content = 'A synthetic offline fixture'): ResponseParseParams => ({
  model: 'gpt-6-luna', instructions: 'Extract the supplied synthetic example.',
  reasoning: { effort: 'none' }, service_tier: 'default', store: false, max_output_tokens: 4000,
  input: [{ role: 'user', content }],
  text: { format: { type: 'json_schema', name: 'offline', strict: true,
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
});
const denied = (reason?: AIWindowReason) => (error: unknown) => error instanceof AIWindowError
  && error.code === 'AI_WINDOW_CLOSED' && (!reason || error.reason === reason)
  && error.message === 'The limited AI window is unavailable.';

function fixture(t: TestContext, changes: Partial<AIWindowPermit> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'moving-ai-window-offline-'));
  const stateDir = join(base, 'durable-state');
  const permitPath = join(base, 'permit.json');
  mkdirSync(stateDir);
  const permit: AIWindowPermit = { version: 1, windowId: 'offline-test',
    startsAt: new Date(START).toISOString(), expiresAt: new Date(START + 900_000).toISOString(),
    maxAttempts: 10, maxReservedUnits: 400_000, maxReservedMicros: 500_000,
    projectId: AI_WINDOW_PROJECT_ID, operatorApprovalRef: 'offline-approval-fixture',
    credentialKeyId: 'key-new-fixture', rotatedFromKeyId: 'key-old-fixture',
    credentialExpiresAt: '2026-11-20T00:00:00Z', rotationVerifiedAt: '2026-10-20T12:00:00Z', ...changes };
  writeFileSync(permitPath, JSON.stringify(permit));
  chmodSync(permitPath, 0o444);
  let wall = START, monotonic = 0;
  let tick: () => void = () => {};
  let cancelled = false;
  const windows: AIWindow[] = [];
  const options: AIWindowOptions = { stateDir, permitPath, wallNow: () => wall,
    monotonicNow: () => monotonic,
    // Windows cannot directory-fsync. This explicit test substitute is never an environment option.
    syncDirectory: () => {},
    scheduleWatchdog: check => { tick = check; return () => { cancelled = true; }; },
  };
  t.after(() => {
    windows.forEach(window => window.close('shutdown'));
    chmodSync(permitPath, 0o644);
    rmSync(base, { recursive: true, force: true });
  });
  return { options, permit, stateDir, permitPath,
    open: (overrides: Partial<AIWindowOptions> = {}) => {
      const window = createAIWindow({ ...options, ...overrides }); windows.push(window); return window;
    },
    advance: (milliseconds: number) => { wall += milliseconds; monotonic += milliseconds; },
    setWall: (value: number) => { wall = value; },
    setMonotonic: (value: number) => { monotonic = value; },
    tick: () => tick(), cancelled: () => cancelled,
    journal: () => readFileSync(join(stateDir, 'window.claim.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>),
  };
}

test('disabled and zero daily quotas do not open or create any state', async () => {
  const base = { AI_WINDOW_MODE: 'armed', AI_WINDOW_STATE_DIR: 'missing', AI_WINDOW_PERMIT_PATH: 'missing',
    OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID };
  for (const env of [{}, { ...base, DEMO_AI_REQUESTS_PER_DAY: '0' },
    { ...base, DEMO_AI_RESERVED_TOKENS_PER_DAY: '0' }]) {
    const window = createAIWindowFromEnv(env);
    assert.equal(window.snapshot().reason, 'disabled');
    await assert.rejects(window.run(request(), async () => assert.fail('dispatch')), denied('disabled'));
  }
  for (const env of [base, { ...base, DEMO_AI_REQUESTS_PER_DAY: '11', DEMO_AI_RESERVED_TOKENS_PER_DAY: '400000' },
    { ...base, OPENAI_PROJECT_ID: 'wrong-project', DEMO_AI_REQUESTS_PER_DAY: '10', DEMO_AI_RESERVED_TOKENS_PER_DAY: '400000' }]) {
    assert.equal(createAIWindowFromEnv(env).snapshot().reason, 'invalid_configuration');
  }
});

test('claim and every attempt are durable before dispatch; journal omits request and key data', async t => {
  const f = fixture(t);
  let syncs = 0, directories = 0;
  const window = f.open({ syncFile: fd => { fsyncSync(fd); syncs++; }, syncDirectory: () => { directories++; } });
  assert.equal(window.snapshot().state, 'open');
  assert.equal(directories, 1);
  const value = await window.run(request('private-content-never-log'), async signal => {
    assert.equal(signal.aborted, false);
    assert.equal(syncs, 2);
    assert.equal(f.journal().at(-1)?.event, 'attempt');
    return 'synthetic-response';
  });
  assert.equal(value, 'synthetic-response');
  assert.equal(syncs, 3);
  assert.equal(window.snapshot().attempts, 1);
  assert.deepEqual(f.journal().map(row => row.event), ['claimed', 'attempt', 'outcome']);
  assert.doesNotMatch(JSON.stringify(f.journal()), /private-content|key-new|key-old|synthetic-response/);
});

test('another process/startup and restart cannot resume a consumed state directory', async t => {
  const f = fixture(t), first = f.open();
  assert.equal(f.open().snapshot().reason, 'already_consumed');
  await first.run(request(), async () => 'ok');
  first.close('shutdown');
  assert.equal(f.open().snapshot().reason, 'already_consumed');
  chmodSync(f.permitPath, 0o644);
  writeFileSync(f.permitPath, JSON.stringify({ ...f.permit, windowId: 'changed-id-cannot-reuse' }));
  chmodSync(f.permitPath, 0o444);
  assert.equal(f.open().snapshot().reason, 'already_consumed');
});

test('an incomplete crash claim is consumed permanently without parsing or repairing it', t => {
  const f = fixture(t);
  writeFileSync(join(f.stateDir, 'window.claim.jsonl'), '{partial');
  assert.equal(f.open().snapshot().reason, 'already_consumed');
  assert.equal(readFileSync(join(f.stateDir, 'window.claim.jsonl'), 'utf8'), '{partial');
});

test('UTC midnight never resets attempt or reservation counters', async t => {
  const f = fixture(t, { maxAttempts: 2 }), window = f.open();
  await window.run(request(), async () => 'first');
  const before = window.snapshot();
  f.advance(6 * 60_000);
  await window.run(request(), async () => 'second');
  assert.equal(window.snapshot().attempts, 2);
  assert.equal(window.snapshot().reservedUnits, before.reservedUnits * 2);
  await assert.rejects(window.run(request(), async () => assert.fail('third dispatch')), denied('budget_exhausted'));
});

test('at most ten small requests dispatch; large requests consume the same fixed total budget sooner', async t => {
  const f = fixture(t), window = f.open();
  for (let i = 0; i < 10; i++) await window.run(request(), async () => i);
  await assert.rejects(window.run(request(), async () => assert.fail('eleventh dispatch')), denied('budget_exhausted'));
  const g = fixture(t), large = g.open(), largeRequest = request('x'.repeat(193_000));
  await large.run(largeRequest, async () => 'ok');
  await assert.rejects(large.run(largeRequest, async () => assert.fail('unreserved dispatch')), denied('budget_exhausted'));
});

test('USD reserve is conservative, deterministic, capped and never refunded', async t => {
  const reservation = reserveAIWindowRequest(request());
  const bytes = Buffer.byteLength(JSON.stringify(request()), 'utf8');
  assert.equal(reservation.units, bytes + 4096 + 4000);
  assert.equal(reservation.micros, Math.ceil(((bytes + 4096) * 225 + 4000 * 500) * 22 / 10000));
  const f = fixture(t, { maxReservedMicros: reservation.micros }), window = f.open();
  await window.run(request(), async () => 'ok');
  assert.equal(window.snapshot().reservedMicros, reservation.micros);
  await assert.rejects(window.run(request(), async () => assert.fail('unfunded dispatch')), denied('budget_exhausted'));
  assert.equal(window.snapshot().reservedMicros, reservation.micros);
});

test('provider failure stops the window, sanitizes errors and retains all reservations', async t => {
  const f = fixture(t), window = f.open();
  await assert.rejects(window.run(request(), async () => { throw new Error('sk-secret provider private payload'); }), denied('request_failed'));
  assert.equal(window.snapshot().attempts, 1);
  assert.equal(window.snapshot().reservedUnits, reserveAIWindowRequest(request()).units);
  await assert.rejects(window.run(request(), async () => assert.fail('retry')), denied('request_failed'));
  assert.doesNotMatch(JSON.stringify(f.journal()), /sk-secret|private payload/);
});

test('concurrent calls cannot reserve or dispatch a second provider attempt', async t => {
  const f = fixture(t), window = f.open();
  let finish!: (value: string) => void;
  const pending = window.run(request(), () => new Promise<string>(resolve => { finish = resolve; }));
  await assert.rejects(window.run(request(), async () => assert.fail('concurrent dispatch')), denied('busy'));
  assert.equal(window.snapshot().attempts, 1);
  finish('ok');
  assert.equal(await pending, 'ok');
});

test('watchdog closes and aborts an in-flight request without operator activity, even if transport ignores abort', async t => {
  const f = fixture(t), window = f.open();
  let signal!: AbortSignal;
  const pending = window.run(request(), received => { signal = received; return new Promise(() => {}); });
  await Promise.resolve();
  f.advance(900_000);
  f.tick();
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, denied('expired'));
  assert.equal(f.cancelled(), true);
  assert.equal(window.snapshot().state, 'closed');
  assert.equal(f.journal().at(-1)?.reason, 'expired');
});

test('monotonic deadline caps duration when wall clock stalls; rollback latches closed', async t => {
  const f = fixture(t), window = f.open();
  f.setMonotonic(900_000); f.tick();
  assert.equal(window.snapshot().reason, 'expired');
  const g = fixture(t), rollback = g.open();
  g.advance(1000); rollback.snapshot();
  g.setWall(START + 999); g.tick();
  assert.equal(rollback.snapshot().reason, 'clock_rollback');
  g.setWall(START + 10_000);
  await assert.rejects(rollback.run(request(), async () => assert.fail('rollback recovery')), denied('clock_rollback'));
});

test('expiry during reservation fsync consumes the attempt but never dispatches', async t => {
  const f = fixture(t);
  let syncs = 0;
  const window = f.open({ syncFile: fd => { fsyncSync(fd); if (++syncs === 2) f.advance(900_000); } });
  await assert.rejects(window.run(request(), async () => assert.fail('late dispatch')), denied('expired'));
  assert.equal(window.snapshot().attempts, 1);
});

test('attempt journal failure denies before dispatch and remains sticky', async t => {
  const f = fixture(t);
  let syncs = 0;
  const window = f.open({ syncFile: fd => { fsyncSync(fd); if (++syncs === 2) throw new Error('offline disk fault'); } });
  await assert.rejects(window.run(request(), async () => assert.fail('dispatch without durable record')), denied('journal_failed'));
  assert.equal(window.snapshot().reason, 'journal_failed');
  assert.equal(f.open().snapshot().reason, 'already_consumed');
});

test('directory fsync failure cannot open the window or make its consumed claim reusable', t => {
  const f = fixture(t);
  assert.equal(f.open({ syncDirectory: () => { throw new Error('offline directory sync fault'); } }).snapshot().state, 'closed');
  assert.equal(f.open().snapshot().reason, 'already_consumed');
});

test('missing state, malformed/writable permit and excessive authority all fail closed', t => {
  const f = fixture(t);
  assert.equal(f.open({ stateDir: join(f.stateDir, 'missing') }).snapshot().reason, 'state_unavailable');
  assert.equal(existsSync(join(f.stateDir, 'missing')), false);
  chmodSync(f.permitPath, 0o644);
  assert.equal(f.open().snapshot().reason, 'invalid_permit');
  writeFileSync(f.permitPath, '{broken'); chmodSync(f.permitPath, 0o444);
  assert.equal(f.open().snapshot().state, 'closed');
  const invalid: Partial<AIWindowPermit>[] = [
    { expiresAt: new Date(START + 900_001).toISOString() }, { maxAttempts: 11 },
    { maxReservedUnits: 400_001 }, { maxReservedMicros: 500_001 },
    { credentialKeyId: 'sk-project-secret' }, { credentialKeyId: 'key-old-fixture' },
    { credentialExpiresAt: '2026-10-21T01:00:00Z' }, { rotationVerifiedAt: '2026-10-10T00:00:00Z' },
    { operatorApprovalRef: 'bad\ncontrol' }, { windowId: '../traversal' },
  ];
  for (const changes of invalid) assert.throws(() => validateAIWindowPermit({ ...f.permit, ...changes }), denied('invalid_permit'));
});

test('tools, remote continuation, request expansion and wrong billing parameters cannot dispatch', async t => {
  const badRequests: ResponseParseParams[] = [
    { ...request(), tools: [] }, { ...request(), previous_response_id: 'remote-context' },
    { ...request(), model: 'different-model' }, { ...request(), reasoning: { effort: 'low' } },
    { ...request(), service_tier: 'priority' }, { ...request(), store: true },
    { ...request(), max_output_tokens: 4001 }, request('x'.repeat(AI_WINDOW_LIMITS.requestBytes)),
  ];
  for (const bad of badRequests) {
    const f = fixture(t), window = f.open();
    await assert.rejects(window.run(bad, async () => assert.fail('invalid dispatch')), denied('invalid_request'));
    assert.equal(window.snapshot().attempts, 0);
  }
});

test('operator stop or shutdown aborts active work and never resumes', async t => {
  const f = fixture(t), window = f.open();
  let signal!: AbortSignal;
  const pending = window.run(request(), received => { signal = received; return new Promise(() => {}); });
  await Promise.resolve();
  window.close('shutdown');
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, denied('shutdown'));
  assert.equal(f.open().snapshot().reason, 'already_consumed');
});

test('synchronous dispatch exceptions safely close without an orphan abort rejection', async t => {
  const f = fixture(t), window = f.open();
  await assert.rejects(window.run(request(), () => { throw new Error('offline synchronous transport fault'); }), denied('request_failed'));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(window.snapshot().reason, 'request_failed');
  assert.equal(window.snapshot().attempts, 1);
});

test('independent request timeout aborts transport and closes after at most 30 seconds', async t => {
  const f = fixture(t);
  let expire!: () => void;
  let cancelled = false;
  const window = f.open({ scheduleRequestTimeout: callback => { expire = callback; return () => { cancelled = true; }; } });
  let signal!: AbortSignal;
  const pending = window.run(request(), received => { signal = received; return new Promise(() => {}); });
  await Promise.resolve();
  expire();
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, denied('request_failed'));
  assert.equal(cancelled, true);
  assert.equal(window.snapshot().reason, 'request_failed');
});

test('a delayed watchdog still rejects a response after the monotonic per-request deadline', async t => {
  const f = fixture(t), window = f.open();
  await assert.rejects(window.run(request(), async () => { f.advance(30_000); return 'too late'; }), denied('request_failed'));
  assert.equal(window.snapshot().attempts, 1);
});

test('clock rollback or expiry while creating the durable claim cannot open a window', t => {
  const f = fixture(t);
  const expired = f.open({ syncDirectory: () => f.advance(900_000) });
  assert.equal(expired.snapshot().reason, 'expired');
  const g = fixture(t);
  const rollback = g.open({ syncDirectory: () => g.setWall(START - 1) });
  assert.equal(rollback.snapshot().reason, 'clock_rollback');
});

test('permit unknown fields and non-string identifiers are rejected instead of copied', t => {
  const f = fixture(t);
  assert.throws(() => validateAIWindowPermit({ ...f.permit, apiKey: 'never-accepted' }), denied('invalid_permit'));
  assert.throws(() => validateAIWindowPermit({ ...f.permit, windowId: 123 }), denied('invalid_permit'));
  for (const windowId of ['sk-proj-synthetic-placeholder', 'prefix_sk-synthetic-placeholder', 'SK-synthetic-placeholder']) {
    assert.throws(() => validateAIWindowPermit({ ...f.permit, windowId }), denied('invalid_permit'));
  }
  assert.throws(() => validateAIWindowPermit({ ...f.permit, credentialKeyId: 'metadata sk-proj-secret' }), denied('invalid_permit'));
});
