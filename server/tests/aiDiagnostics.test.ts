import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import OpenAI from 'openai';
import { ZodError } from 'zod';
import { createLead } from '../src/domain/createLead.js';
import { createApp } from '../src/app.js';
import { ProtectionError } from '../src/demo/protection.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import { createAIExtractor, type StructuredResponse } from '../src/integrations/openai/extractMessageWithAI.js';
import { AI_WINDOW_PROJECT_ID, AIWindowError, createAIWindow, type AIWindow } from '../src/safety/aiWindow.js';
import { browser } from './browser.js';

// Every provider response and credential in this file is synthetic. The test preloader
// blocks external networking; fake fetch exercises the installed SDK without dispatch.
const env = { OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID,
  OPENAI_API_KEY: 'offline-diagnostics-credential' };
const requestId = `req_${'a1'.repeat(16)}`;
const privateSentinel = 'SYNTHETIC_PRIVATE_PAYLOAD_NEVER_LOG';
const keep = () => ({ action: 'keep' as const });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
const empty = () => ({ items: [], pickup: location(), dropoff: location(),
  requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep() });
const input = () => ({ lead: createLead(), text: privateSentinel });
const completed = (parsed: unknown = empty()): StructuredResponse =>
  ({ status: 'completed', output: [], output_parsed: parsed });
const sdkWindow: AIWindow = {
  run: async (_request, dispatch) => dispatch(new AbortController().signal), close: () => {},
  snapshot: () => ({ state: 'closed', reason: 'disabled', windowId: null, expiresAt: null,
    attempts: 0, reservedUnits: 0, reservedMicros: 0, active: false }),
};

interface Diagnostic {
  event: string;
  stage: string;
  classification: string;
  localHttpStatus: number;
  localHttpStatusSource: string;
  providerHttpStatus: number | null;
  providerRequestId: string | null;
  sdkErrorType: string | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  networkCode: string | null;
  elapsedMs: number;
  dispatchStarted: boolean;
  providerResponseObserved: boolean;
  providerOutcome: string;
  zodIssues: { path: string; code: string }[];
  windowReason: string | null;
  validationField: string;
  validationRule: string;
}

function only(events: unknown[]): Diagnostic {
  assert.equal(events.length, 1, 'one diagnostic per failed extraction');
  const record = events[0] as Diagnostic;
  assert.equal(record.event, 'ai_extraction_failure');
  assert.equal(record.localHttpStatusSource, 'router_mapping');
  assert.ok(Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0);
  assert.ok(Array.isArray(record.zodIssues) && record.zodIssues.length <= 8);
  assert.equal(typeof record.validationField, 'string');
  assert.equal(typeof record.validationRule, 'string');
  if (record.stage !== 'schema_validation' && record.stage !== 'domain_validation') {
    assert.equal(record.validationField, 'unknown');
    assert.equal(record.validationRule, 'unknown');
  }
  assert.doesNotMatch(JSON.stringify(record), new RegExp(privateSentinel));
  return record;
}

function response(text: string, status = 200, id = requestId): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json',
    'x-request-id': id, 'x-private-debug': privateSentinel, 'set-cookie': privateSentinel } });
}

function sdkBody(text = JSON.stringify(empty())) {
  return JSON.stringify({ id: 'resp_offline_test', object: 'response', status: 'completed',
    output: [{ type: 'message', id: 'msg_offline_test', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] }] });
}

function durable(t: TestContext, failAttemptSync = false) {
  const root = mkdtempSync(join(tmpdir(), 'moving-diag-offline-'));
  const stateDir = join(root, 'state'), permitPath = join(root, 'permit.json');
  const start = Date.parse('2026-10-21T23:59:00Z');
  mkdirSync(stateDir);
  writeFileSync(permitPath, JSON.stringify({ version: 1, windowId: 'offline-diagnostics',
    startsAt: new Date(start).toISOString(), expiresAt: new Date(start + 300000).toISOString(),
    maxAttempts: 1, maxReservedUnits: 400000, maxReservedMicros: 500000,
    projectId: AI_WINDOW_PROJECT_ID, operatorApprovalRef: 'offline-test-only',
    credentialKeyId: 'key_offline_new', rotatedFromKeyId: 'key_offline_old',
    credentialExpiresAt: '2026-11-01T00:00:00Z', rotationVerifiedAt: '2026-10-21T22:00:00Z' }));
  chmodSync(permitPath, 0o444);
  let syncs = 0;
  const window = createAIWindow({ stateDir, permitPath, wallNow: () => start, monotonicNow: () => 0,
    ...(process.platform === 'win32' ? { syncDirectory: () => {} } : {}),
    ...(failAttemptSync ? { syncFile: () => { if (++syncs > 1) throw new Error(privateSentinel); } } : {}) });
  assert.equal(window.snapshot().state, 'open');
  t.after(() => { window.close(); chmodSync(permitPath, 0o600); rmSync(root, { recursive: true, force: true }); });
  return { window, journal: () => readFileSync(join(stateDir, 'window.claim.jsonl'), 'utf8') };
}

test('diagnostics do not emit success events or change a valid synthetic extraction', async t => {
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => response(sdkBody()));
  const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
  const request = input(), before = structuredClone(request);
  assert.deepEqual(await extractor(request), {});
  assert.deepEqual(request, before);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(events, []);
});

test('missing credential is distinguished from a provider rejection and never dispatches', async t => {
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  const extractor = createAIExtractor({ env: { OPENAI_MODEL: 'gpt-6-luna' }, window: sdkWindow,
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()), (error: unknown) =>
    error instanceof AIExtractionError && error.code === 'MISSING_API_KEY');
  const event = only(events);
  assert.equal(event.stage, 'configuration');
  assert.equal(event.classification, 'missing_credential');
  assert.equal(event.localHttpStatus, 503);
  assert.equal(event.providerHttpStatus, null);
  assert.equal(event.providerRequestId, null);
  assert.equal(event.dispatchStarted, false);
  assert.equal(event.providerResponseObserved, false);
  assert.equal(event.providerOutcome, 'not_dispatched');
  assert.equal(fetch.mock.callCount(), 0);
});

for (const scenario of [
  { status: 401, code: 'invalid_api_key', type: 'invalid_request_error', sdk: 'AuthenticationError' },
  { status: 403, code: 'insufficient_permissions', type: 'permission_error', sdk: 'PermissionDeniedError' },
  { status: 404, code: 'model_not_found', type: 'invalid_request_error', sdk: 'NotFoundError' },
  { status: 429, code: 'insufficient_quota', type: 'insufficient_quota', sdk: 'RateLimitError' },
  { status: 429, code: 'rate_limit_exceeded', type: 'rate_limit_error', sdk: 'RateLimitError' },
  { status: 503, code: 'server_error', type: 'server_error', sdk: 'InternalServerError' },
]) {
  test(`installed SDK preserves sanitized HTTP ${scenario.status}/${scenario.code} without retry`, async t => {
    const events: unknown[] = [];
    const fetch = t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
      assert.equal(new Headers(options?.headers).get('x-stainless-retry-count'), '0');
      return response(JSON.stringify({ error: { message: privateSentinel, param: privateSentinel,
        code: scenario.code, type: scenario.type, private: privateSentinel } }), scenario.status);
    });
    const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
    await assert.rejects(extractor(input()), (error: unknown) =>
      error instanceof AIExtractionError && error.code === 'REQUEST_FAILED');
    const event = only(events);
    assert.equal(event.stage, 'transport');
    assert.equal(event.classification, 'http_error');
    assert.equal(event.localHttpStatus, 502);
    assert.equal(event.providerHttpStatus, scenario.status);
    assert.equal(event.providerRequestId, requestId);
    assert.equal(event.sdkErrorType, scenario.sdk);
    assert.equal(event.providerErrorCode, scenario.code);
    assert.equal(event.providerErrorType, scenario.type);
    assert.equal(event.dispatchStarted, true);
    assert.equal(event.providerResponseObserved, true);
    assert.equal(event.providerOutcome, 'http_rejected');
    assert.equal(fetch.mock.callCount(), 1);
  });
}

for (const scenario of [
  { name: 'DNS failure', code: 'ENOTFOUND', classification: 'network' },
  { name: 'connection reset', code: 'ECONNRESET', classification: 'network' },
  { name: 'TLS certificate failure', code: 'CERT_HAS_EXPIRED', classification: 'tls' },
]) {
  test(`installed SDK distinguishes ${scenario.name} without inventing HTTP metadata`, async t => {
    const events: unknown[] = [];
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError(privateSentinel, { cause: Object.assign(new Error(privateSentinel), { code: scenario.code }) });
    });
    const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
    await assert.rejects(extractor(input()));
    const event = only(events);
    assert.equal(event.classification, scenario.classification);
    assert.equal(event.stage, 'transport');
    assert.equal(event.networkCode, scenario.code);
    assert.equal(event.providerHttpStatus, null);
    assert.equal(event.providerRequestId, null);
    assert.equal(event.providerResponseObserved, false);
    assert.equal(event.providerOutcome, 'unknown');
    assert.equal(fetch.mock.callCount(), 1);
  });
}

for (const scenario of [
  { name: 'timeout', error: () => new OpenAI.APIConnectionTimeoutError({ message: privateSentinel }), classification: 'timeout' },
  { name: 'abort', error: () => new OpenAI.APIUserAbortError({ message: privateSentinel }), classification: 'aborted' },
]) {
  test(`diagnostics distinguish an SDK ${scenario.name} and retain uncertain dispatch outcome`, async () => {
    const events: unknown[] = [];
    let calls = 0;
    const extractor = createAIExtractor({ env, request: async () => { calls++; throw scenario.error(); },
      onDiagnostic: record => { events.push(record); } });
    await assert.rejects(extractor(input()));
    const event = only(events);
    assert.equal(event.classification, scenario.classification);
    assert.equal(event.stage, 'transport');
    assert.equal(event.dispatchStarted, true);
    assert.equal(event.providerOutcome, 'unknown');
    assert.equal(event.providerHttpStatus, null);
    assert.equal(calls, 1);
  });
}

test('HTTP 200 and request ID survive SDK structured JSON parsing failure', async t => {
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => response(sdkBody(`{${privateSentinel}`)));
  const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.stage, 'structured_parsing');
  assert.equal(event.classification, 'invalid_json');
  assert.equal(event.providerHttpStatus, 200);
  assert.equal(event.providerRequestId, requestId);
  assert.equal(event.providerResponseObserved, true);
  assert.equal(event.providerOutcome, 'response_received');
  assert.equal(fetch.mock.callCount(), 1, 'observing headers must reuse the same APIPromise');
});

test('HTTP receipt also survives malformed top-level response JSON without another dispatch', async t => {
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => response(`{${privateSentinel}`));
  const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.stage, 'structured_parsing');
  assert.equal(event.classification, 'invalid_json');
  assert.equal(event.providerHttpStatus, 200);
  assert.equal(event.providerRequestId, requestId);
  assert.equal(event.providerOutcome, 'response_received');
  assert.equal(fetch.mock.callCount(), 1);
});

test('oversized context is distinguished as a local request-construction failure before lazy credential handling', async t => {
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  const extractor = createAIExtractor({ env: { OPENAI_MODEL: 'gpt-6-luna' },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor({ lead: createLead(), text: 'x'.repeat(4001) }), (error: unknown) =>
    error instanceof AIExtractionError && error.code === 'CONTEXT_TOO_LARGE');
  const event = only(events);
  assert.equal(event.stage, 'request_construction');
  assert.equal(event.localHttpStatus, 502);
  assert.equal(event.dispatchStarted, false);
  assert.equal(event.providerOutcome, 'not_dispatched');
  assert.equal(event.providerHttpStatus, null);
  assert.equal(fetch.mock.callCount(), 0);
});

test('injected transports retain safe schema issue paths from application Zod validation', async () => {
  const events: unknown[] = [];
  const extractor = createAIExtractor({ env, request: async () => completed({ ...empty(),
    pickup: { ...location(), city: { action: 'set', value: 123 } } }),
  onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.stage, 'schema_validation');
  assert.equal(event.classification, 'schema_validation');
  assert.ok(event.zodIssues.length > 0);
  assert.equal(event.providerHttpStatus, null, 'a synthetic transport must not invent a receipt');
});

test('HTTP 200 metadata survives SDK Zod failure without exposing unknown property names or values', async t => {
  const events: unknown[] = [];
  const hostile = { ...empty(), [privateSentinel]: privateSentinel,
    pickup: { ...location(), city: { action: 'set', value: 123 }, [privateSentinel]: privateSentinel } };
  const fetch = t.mock.method(globalThis, 'fetch', async () => response(sdkBody(JSON.stringify(hostile))));
  const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.classification, 'schema_validation');
  assert.equal(event.providerHttpStatus, 200);
  assert.equal(event.providerRequestId, requestId);
  assert.equal(event.providerOutcome, 'response_received');
  assert.equal(fetch.mock.callCount(), 1);
  assert.ok(event.zodIssues.length > 0);
  for (const issue of event.zodIssues) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'path']);
    assert.doesNotMatch(issue.path, new RegExp(privateSentinel));
  }
});

for (const scenario of [
  { name: 'refusal', classification: 'refusal', body: () => ({ status: 'completed', output: [
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: privateSentinel }] } ] }) },
  { name: 'incomplete', classification: 'incomplete_response', body: () => ({ status: 'incomplete', output: [],
    incomplete_details: { reason: 'max_output_tokens' } }) },
  { name: 'failed', classification: 'failed_response', body: () => ({ status: 'failed', output: [],
    error: { code: 'server_error', message: privateSentinel } }) },
  { name: 'missing parsed output', classification: 'missing_output', body: () => ({ status: 'completed', output: [] }) },
]) {
  test(`installed SDK ${scenario.name} retains observed HTTP receipt without extraction data`, async t => {
    const events: unknown[] = [];
    const fetch = t.mock.method(globalThis, 'fetch', async () => response(JSON.stringify(scenario.body())));
    const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
    await assert.rejects(extractor(input()));
    const event = only(events);
    assert.equal(event.stage, 'response_validation');
    assert.equal(event.classification, scenario.classification);
    assert.equal(event.providerHttpStatus, 200);
    assert.equal(event.providerRequestId, requestId);
    assert.equal(event.providerOutcome, 'response_received');
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('domain failure is separate from schema failure and never mutates the lead', async () => {
  const events: unknown[] = [];
  const request = input(), before = structuredClone(request);
  const data = { ...empty(), requestedTime: { action: 'set' as const, value: '29:99' } };
  const extractor = createAIExtractor({ env, request: async () => completed(data),
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(request));
  const event = only(events);
  assert.equal(event.stage, 'domain_validation');
  assert.equal(event.classification, 'domain_validation');
  assert.deepEqual(event.zodIssues, []);
  assert.deepEqual(request, before);
});

test('schema diagnostics bound issue count and normalize attacker-controlled paths', async () => {
  const events: unknown[] = [];
  const issues = Array.from({ length: 20 }, () => ({ code: 'custom' as const,
    path: ['items', 987654321, privateSentinel], message: privateSentinel, params: { secret: privateSentinel } }));
  const extractor = createAIExtractor({ env, request: async () => { throw new ZodError(issues); },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.classification, 'schema_validation');
  assert.ok(event.zodIssues.length <= 8);
  assert.doesNotMatch(JSON.stringify(event), /987654321/);
});

test('pre-attached extraction issues are reconstructed from allowlisted fields rather than trusted', async () => {
  const events: unknown[] = [];
  const hostileIssues = Array.from({ length: 20 }, (_, index) => index === 1
    ? { path: 'pickup.city.value', code: 'invalid_type', message: privateSentinel, value: privateSentinel }
    : { path: privateSentinel, code: privateSentinel, secret: privateSentinel });
  const error = new AIExtractionError('INVALID_EXTRACTION', privateSentinel,
    hostileIssues as unknown as NonNullable<ConstructorParameters<typeof AIExtractionError>[2]>);
  const extractor = createAIExtractor({ env, request: async () => { throw error; },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.classification, 'schema_validation');
  assert.equal(event.zodIssues.length, 8);
  assert.deepEqual(event.zodIssues[0], { path: 'schema', code: 'unknown' });
  assert.deepEqual(event.zodIssues[1], { path: 'pickup.city.value', code: 'invalid_type' });
  for (const issue of event.zodIssues) assert.deepEqual(Object.keys(issue).sort(), ['code', 'path']);
});

test('pre-attached issue arrays cannot substitute their own slice, map or serialization methods', async () => {
  const events: unknown[] = [];
  let methodCalls = 0;
  const issues = [{ path: 'pickup.city', code: 'invalid_type' }];
  Object.defineProperties(issues, {
    slice: { value: () => { methodCalls++; return { map: () => [{ path: 'pickup.city',
      code: privateSentinel, extra: privateSentinel }] }; } },
    map: { value: () => { methodCalls++; return [{ path: privateSentinel, code: privateSentinel }]; } },
    toJSON: { value: () => { methodCalls++; return privateSentinel; } },
  });
  const error = new AIExtractionError('INVALID_EXTRACTION', privateSentinel,
    issues as unknown as NonNullable<ConstructorParameters<typeof AIExtractionError>[2]>);
  const extractor = createAIExtractor({ env, request: async () => { throw error; },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(methodCalls, 0);
  assert.deepEqual(event.zodIssues, [{ path: 'pickup.city', code: 'invalid_type' }]);
});

for (const poisoned of ['issues', 'path'] as const) {
  test(`Zod ${poisoned} arrays cannot run substituted map, slice or serialization methods`, async () => {
    const events: unknown[] = [];
    let methodCalls = 0;
    const path = ['pickup', 'city', 'value'];
    const issues = [{ code: 'invalid_type' as const, expected: 'string' as const, path, message: privateSentinel }];
    const error = new ZodError(issues);
    const target = poisoned === 'issues' ? issues : path;
    Object.defineProperties(target, {
      slice: { value: () => { methodCalls++; return { map: () => [{ path: 'pickup.city',
        code: privateSentinel, extra: privateSentinel }] }; } },
      map: { value: () => { methodCalls++; return { join: () => privateSentinel }; } },
      toJSON: { value: () => { methodCalls++; return privateSentinel; } },
    });
    const extractor = createAIExtractor({ env, request: async () => { throw error; },
      onDiagnostic: record => { events.push(record); } });
    await assert.rejects(extractor(input()));
    const event = only(events);
    assert.equal(methodCalls, 0);
    assert.deepEqual(event.zodIssues, [{ path: 'pickup.city.value', code: 'invalid_type' }]);
  });
}

test('valid-looking request IDs and schema paths with trailing newlines are discarded', async () => {
  const events: unknown[] = [];
  const sdkError = new OpenAI.AuthenticationError(401, { code: 'invalid_api_key' }, privateSentinel,
    new Headers({ 'x-request-id': requestId }));
  Object.defineProperty(sdkError, 'requestID', { value: requestId + '\n' });
  const sdkExtractor = createAIExtractor({ env, request: async () => { throw sdkError; },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(sdkExtractor(input()));
  assert.equal(only(events).providerRequestId, null);
  events.length = 0;
  const extractionError = new AIExtractionError('INVALID_EXTRACTION', privateSentinel,
    [{ path: 'pickup.city\n', code: 'invalid_type' }]);
  const extractor = createAIExtractor({ env, request: async () => { throw extractionError; },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  assert.deepEqual(only(events).zodIssues, [{ path: 'schema', code: 'invalid_type' }]);
});

test('unreadable window error metadata cannot invoke getters or replace the original admission error', async () => {
  const events: unknown[] = [];
  const original = new AIWindowError('disabled');
  let getterCalls = 0, transportCalls = 0;
  Object.defineProperty(original, 'reason', { get: () => { getterCalls++; throw new Error(privateSentinel); } });
  const window: AIWindow = { ...sdkWindow, run: async () => { throw original; } };
  const extractor = createAIExtractor({ env, window, request: async () => { transportCalls++; return completed(); },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()), (error: unknown) => error === original);
  assert.equal(getterCalls, 0);
  assert.equal(transportCalls, 0);
  assert.ok(events.length <= 1);
  for (const event of events) assert.doesNotMatch(JSON.stringify(event), new RegExp(privateSentinel));
});

test('a window abort after dispatch is not mislabeled as rejected admission or a provider receipt', async () => {
  const events: unknown[] = [];
  let transportCalls = 0;
  const original = new AIWindowError('request_failed');
  const window: AIWindow = { ...sdkWindow, run: async (request, dispatch) => {
    await sdkWindow.run(request, dispatch);
    throw original;
  } };
  const extractor = createAIExtractor({ env, window, request: async () => { transportCalls++; return completed(); },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()), (error: unknown) => error === original);
  const event = only(events);
  assert.equal(event.classification, 'aborted');
  assert.equal(event.localHttpStatus, 503);
  assert.equal(event.dispatchStarted, true);
  assert.equal(event.providerOutcome, 'unknown');
  assert.equal(event.providerResponseObserved, false);
  assert.equal(event.providerHttpStatus, null);
  assert.equal(event.providerRequestId, null);
  assert.equal(event.windowReason, 'request_failed');
  assert.equal(transportCalls, 1);
});

test('all unapproved SDK metadata fields, messages, stack, body, headers and request IDs are discarded', async () => {
  const events: unknown[] = [];
  const error = new OpenAI.APIError(401, { code: privateSentinel, type: privateSentinel,
    message: privateSentinel, param: privateSentinel }, privateSentinel,
  new Headers({ 'x-request-id': `req_${privateSentinel}`, authorization: privateSentinel }));
  Object.assign(error, { request: { headers: { authorization: privateSentinel }, body: privateSentinel },
    body: privateSentinel, stack: privateSentinel, cause: { code: privateSentinel, message: privateSentinel } });
  const extractor = createAIExtractor({ env, request: async () => { throw error; },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.providerErrorCode, null);
  assert.equal(event.providerErrorType, null);
  assert.equal(event.providerRequestId, null);
  assert.equal(event.networkCode, null);
  assert.deepEqual(Object.keys(event).sort(), ['event', 'stage', 'classification', 'localHttpStatus',
    'localHttpStatusSource', 'providerHttpStatus', 'providerRequestId', 'sdkErrorType', 'providerErrorCode',
    'providerErrorType', 'networkCode', 'elapsedMs', 'dispatchStarted', 'providerResponseObserved',
    'providerOutcome', 'zodIssues', 'windowReason', 'validationField', 'validationRule'].sort());
});

test('plain thrown objects cannot spoof SDK status, identity or provider receipt', async () => {
  const events: unknown[] = [];
  const extractor = createAIExtractor({ env, request: async () => { throw { name: 'AuthenticationError',
    status: 401, code: 'invalid_api_key', type: 'invalid_request_error', requestID: requestId,
    message: privateSentinel, headers: { authorization: privateSentinel } }; },
  onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  const event = only(events);
  assert.equal(event.classification, 'unknown');
  assert.equal(event.providerHttpStatus, null);
  assert.equal(event.providerRequestId, null);
  assert.equal(event.sdkErrorType, null);
  assert.equal(event.providerResponseObserved, false);
});

test('cached SDK client does not leak metadata from one extraction into the next', async t => {
  const events: unknown[] = [];
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return response(sdkBody('{malformed'));
    throw new TypeError(privateSentinel, { cause: Object.assign(new Error(privateSentinel), { code: 'ENOTFOUND' }) });
  });
  const extractor = createAIExtractor({ env, window: sdkWindow, onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()));
  await assert.rejects(extractor(input()));
  assert.equal(events.length, 2);
  const first = only([events[0]]), second = only([events[1]]);
  assert.equal(first.providerHttpStatus, 200);
  assert.equal(first.providerRequestId, requestId);
  assert.equal(second.classification, 'network');
  assert.equal(second.providerHttpStatus, null);
  assert.equal(second.providerRequestId, null);
  assert.equal(second.providerResponseObserved, false);
  assert.equal(second.providerOutcome, 'unknown');
  assert.equal(fetch.mock.callCount(), 2);
});

test('diagnostic callback failure cannot replace the public error or trigger duplicate emission', async () => {
  let callbacks = 0, calls = 0;
  const extractor = createAIExtractor({ env, request: async () => { calls++; throw new Error(privateSentinel); },
    onDiagnostic: () => { callbacks++; throw new Error(privateSentinel); } });
  await assert.rejects(extractor(input()), (error: unknown) =>
    error instanceof AIExtractionError && error.code === 'REQUEST_FAILED' && !error.message.includes(privateSentinel));
  assert.equal(callbacks, 1);
  assert.equal(calls, 1);
});

test('independent protection admission records its router status without dispatch or accounting changes', async t => {
  const { window, journal } = durable(t);
  const events: unknown[] = [];
  const before = journal();
  let calls = 0;
  const extractor = createAIExtractor({ env, window, request: async () => { calls++; return completed(); },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input(), async () => { throw new ProtectionError('AI_RATE_LIMITED', 429, 1); }), ProtectionError);
  const event = only(events);
  assert.equal(event.stage, 'admission');
  assert.equal(event.classification, 'admission');
  assert.equal(event.localHttpStatus, 429);
  assert.equal(event.dispatchStarted, false);
  assert.equal(event.providerOutcome, 'not_dispatched');
  assert.equal(calls, 0);
  assert.equal(journal(), before);
  assert.equal(window.snapshot().attempts, 0);
});

test('ledger persistence failure prevents provider dispatch and diagnostics do not reopen the window', async t => {
  const { window, journal } = durable(t, true);
  const events: unknown[] = [];
  let calls = 0;
  const extractor = createAIExtractor({ env, window, request: async () => { calls++; return completed(); },
    onDiagnostic: record => { events.push(record); } });
  await assert.rejects(extractor(input()), AIWindowError);
  const event = only(events);
  assert.equal(event.stage, 'admission');
  assert.equal(event.classification, 'admission');
  assert.equal(event.localHttpStatus, 503);
  assert.equal(event.windowReason, 'journal_failed');
  assert.equal(event.dispatchStarted, false);
  assert.equal(event.providerOutcome, 'not_dispatched');
  assert.equal(calls, 0);
  assert.equal(window.snapshot().state, 'closed');
  assert.equal(window.snapshot().reason, 'journal_failed');
  const retained = journal();
  await assert.rejects(extractor(input()), AIWindowError);
  assert.equal(calls, 0);
  assert.equal(journal(), retained);
  assert.equal(events.length, 2, 'each extraction emits at most one failure event');
});

test('provider metadata and inner classification survive durable-window error wrapping without changing reservation', async t => {
  const { window, journal } = durable(t);
  const events: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    const entries = journal().trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries.at(-1).event, 'attempt', 'durable reservation precedes SDK fake fetch');
    return response(JSON.stringify({ error: { code: 'invalid_api_key', type: 'invalid_request_error',
      message: privateSentinel } }), 401);
  });
  const extractor = createAIExtractor({ env, window, onDiagnostic: record => { events.push(record); } });
  const request = input(), before = structuredClone(request);
  await assert.rejects(extractor(request), AIWindowError);
  const event = only(events);
  assert.equal(event.classification, 'http_error');
  assert.equal(event.stage, 'transport');
  assert.equal(event.localHttpStatus, 503, 'router sees the existing AIWindowError');
  assert.equal(event.providerHttpStatus, 401);
  assert.equal(event.providerRequestId, requestId);
  assert.equal(event.windowReason, 'request_failed');
  assert.equal(window.snapshot().attempts, 1);
  assert.ok(window.snapshot().reservedMicros > 0);
  assert.equal(window.snapshot().state, 'closed');
  assert.deepEqual(request, before);
  const retained = journal();
  await assert.rejects(extractor(input()), AIWindowError);
  assert.equal(journal(), retained);
  assert.equal(fetch.mock.callCount(), 1, 'no SDK or diagnostic retry may spend a second attempt');
  assert.doesNotMatch(journal(), new RegExp(privateSentinel));
});

test('real loopback router exposes only public AI_WINDOW_CLOSED after durable SDK failure and preserves session state', async t => {
  const { window, journal } = durable(t);
  const events: unknown[] = [];
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) === 'https://api.openai.com/v1/responses') {
      providerCalls++;
      return response(JSON.stringify({ error: { code: 'invalid_api_key', type: 'invalid_request_error',
        message: privateSentinel } }), 401);
    }
    // The offline preloader permits only this loopback HTTP traffic.
    return originalFetch(url, options);
  });
  const extractor = createAIExtractor({ env, window, onDiagnostic: record => { events.push(record); } });
  const app = createApp({ extractor, secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const visit = browser();
  const before = await (await visit(root + '/api/demo')).json();
  const result = await visit(root + '/api/demo/message', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: privateSentinel }) });
  assert.equal(result.status, 503);
  const body = await result.json() as { error: { code: string; message: string } };
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, 'AI_WINDOW_CLOSED');
  assert.doesNotMatch(JSON.stringify(body), /providerHttpStatus|providerRequestId|invalid_api_key|diagnostic|401/);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(privateSentinel));
  assert.deepEqual(await (await visit(root + '/api/demo')).json(), before);
  const event = only(events);
  assert.equal(event.localHttpStatus, result.status);
  assert.equal(event.providerHttpStatus, 401);
  assert.equal(event.providerRequestId, requestId);
  assert.equal(event.classification, 'http_error');
  assert.equal(providerCalls, 1);
  assert.equal(window.snapshot().attempts, 1);
  assert.ok(window.snapshot().reservedMicros > 0);
  assert.equal(window.snapshot().state, 'closed');
  assert.doesNotMatch(journal(), new RegExp(privateSentinel));
});
