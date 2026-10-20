import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { freshOwnerState } from '../src/demo/ownerWorkflow.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import type { Lead } from '../src/domain/lead.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import type { AIExtractionDiagnostic } from '../src/integrations/openai/diagnostics.js';
import { AIExtractionSchema, extractionTextFormat, type AIExtraction } from '../src/integrations/openai/schema.js';
import { AI_WINDOW_PROJECT_ID, AIWindowError, type AIWindow } from '../src/safety/aiWindow.js';

// RECONSTRUCTED fixtures, never the original provider response. These tests use
// the installed SDK with intercepted fetch and the external-network offlineGuard.
// The simulated gate below copies only the production failure-envelope behavior;
// it does not exercise admission, accounting, real credentials or a provider.
// Inline copies were checked against preserved operator artifacts once. They
// remain independent of that evidence directory at test runtime:
// execution.approved.json SHA256 60ed849f60c19f91ccf1c3f96efe915f87fec2af509d764e7ccdf0247959c8eb
// result.json SHA256 de18600edabc157bc04f44f5a97cd304880de9751bdff2a8baa9ad07081a713c
// Recorded provider identity req_f2b32f316c0145249028eab35483077b; elapsed 4744 ms.
// Only the synthetic input and safe metadata are copied, never provider output.
const message = "אני צריך להעביר מקרר גדול אחד ו-15 ארגזים. האיסוף ברחוב הדגמה 11 ברמת גן, קומה 2 בלי מעלית. הפריקה ברחוב הדגמה 22 בתל אביב, קומה 1 בלי מעלית. ההובלה ב-8 בנובמבר 2026. אין צורך בפירוק או בהרכבה. אין לי תמונה כרגע.";
const recordedProjection: Omit<AIExtractionDiagnostic, 'providerRequestId' | 'elapsedMs' | 'validationField' | 'validationRule'> = {
  "classification": "domain_validation",
  "dispatchStarted": true,
  "event": "ai_extraction_failure",
  "localHttpStatus": 503,
  "localHttpStatusSource": "router_mapping",
  "networkCode": null,
  "providerErrorCode": null,
  "providerErrorType": null,
  "providerHttpStatus": 200,
  "providerOutcome": "response_received",
  "providerResponseObserved": true,
  "sdkErrorType": null,
  "stage": "domain_validation",
  "windowReason": "request_failed",
  "zodIssues": []
};
const referenceDate = '2026-10-19';
const fakeRequestId = `req_${'c7'.repeat(16)}`;
const keep = () => ({ action: 'keep' as const });
const set = <T>(value: T) => ({ action: 'set' as const, value });
const correct = <T>(value: T) => ({ action: 'correct' as const, value });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
function empty(): AIExtraction {
  return { items: [], pickup: location(), dropoff: location(), requestedDate: keep(),
    requestedTime: keep(), specialAccessNotes: keep() };
}
function item(type: AIExtraction['items'][number]['type']): AIExtraction['items'][number] {
  return { type, quantity: keep(), sizeCategory: keep(), photoStatus: keep(), dimensionsAvailable: keep(),
    dimensions: { width: keep(), height: keep(), depth: keep() },
    requiresDisassembly: keep(), requiresAssembly: keep() };
}
function reconstructedScenario(): AIExtraction {
  return { ...empty(),
    items: [
      { ...item('refrigerator'), quantity: set(1), sizeCategory: set('LARGE'), photoStatus: set('NOT_AVAILABLE'),
        requiresDisassembly: set(false), requiresAssembly: set(false) },
      { ...item('box'), quantity: set(15), requiresDisassembly: set(false), requiresAssembly: set(false) },
    ],
    pickup: { city: set('רמת גן'), address: set('הדגמה 11'), floor: set(2), elevator: set(false) },
    dropoff: { city: set('תל אביב'), address: set('הדגמה 22'), floor: set(1), elevator: set(false) },
    // Deliberately hand-normalized fixture, not evidence of what the model did.
    requestedDate: set('2026-11-08'),
  };
}
function projection(event: AIExtractionDiagnostic) {
  // Actual request identity and elapsed time differ between independent calls.
  const { providerRequestId: _requestId, elapsedMs: _elapsed,
    validationField: _field, validationRule: _rule, ...safe } = event;
  return safe;
}
function sdk(t: TestContext, fixture: AIExtraction) {
  assert.equal(AIExtractionSchema.safeParse(fixture).success, true, 'fixture must pass the wire schema');
  const diagnostics: AIExtractionDiagnostic[] = [], innerFailures: unknown[] = [];
  let receivedContext: Record<string, unknown> | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('x-stainless-retry-count'), '0');
    const request = JSON.parse(String(init?.body));
    assert.equal(request.text.format.strict, true);
    assert.deepEqual(request.text.format.schema, extractionTextFormat.schema);
    receivedContext = JSON.parse(request.input[0].content);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant',
      status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(fixture), annotations: [] }] }] }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': fakeRequestId } });
  });
  const simulatedWindow: AIWindow = {
    run: async (_request, dispatch) => {
      try { return await dispatch(new AbortController().signal); }
      catch (error) { innerFailures.push(error); throw new AIWindowError('request_failed'); }
    },
    close: () => {},
    snapshot: () => ({ state: 'closed', reason: 'disabled', windowId: null, expiresAt: null,
      attempts: 0, reservedUnits: 0, reservedMicros: 0, active: false }),
  };
  const extractor = createAIExtractor({ env: { OPENAI_API_KEY: 'synthetic-offline-only',
    OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID }, window: simulatedWindow,
    onDiagnostic: value => { diagnostics.push(value); } });
  return { extractor, diagnostics, innerFailures, calls: () => fetch.mock.callCount(), context: () => receivedContext };
}
function assertDomainFailure(harness: ReturnType<typeof sdk>, expectedMessage: string, field: string, rule: string) {
  assert.equal(harness.calls(), 1);
  assert.equal(harness.innerFailures.length, 1);
  const failure = harness.innerFailures[0];
  assert.ok(failure instanceof AIExtractionError);
  assert.equal(failure.code, 'INVALID_EXTRACTION');
  assert.equal(failure.message, expectedMessage);
  assert.equal(harness.diagnostics.length, 1);
  const event = harness.diagnostics[0];
  assert.equal(event.providerRequestId, fakeRequestId);
  assert.equal(event.stage, 'domain_validation');
  assert.equal(event.classification, 'domain_validation');
  assert.deepEqual(event.zodIssues, []);
  assert.equal(event.validationField, field);
  assert.equal(event.validationRule, rule);
  assert.deepEqual(projection(event), recordedProjection, 'different reconstructed errors have the same recorded safe projection');
  const persistedProjection = JSON.stringify(event);
  assert.equal(persistedProjection.includes(expectedMessage), false);
  assert.equal(persistedProjection.includes(message), false);
  assert.equal(persistedProjection.includes('synthetic-offline-only'), false);
}
async function workflow(lead: Lead, harness: ReturnType<typeof sdk>, text = message) {
  const initial = freshOwnerState();
  return processCustomerMessageWithExtractor(lead, text, { extractor: harness.extractor,
    lastQuestion: initial.customer.nextQuestion ?? undefined, referenceDate });
}

test('reconstructed full saved Hebrew scenario succeeds through installed SDK and actual fresh-owner context', async t => {
  const owner = freshOwnerState(), before = structuredClone(owner);
  assert.deepEqual(owner.customer.lead.moveDetails.items, []);
  assert.deepEqual(owner.customer.nextQuestion?.requirements, [{ id: 'items' }]);
  assert.ok(message.includes('8 בנובמבר 2026'));
  const harness = sdk(t, reconstructedScenario());
  const result = await workflow(owner.customer.lead, harness);
  assert.equal(harness.calls(), 1);
  assert.deepEqual(harness.diagnostics, []);
  assert.deepEqual(owner, before);
  const context = harness.context();
  assert.equal(context?.latestCustomerMessage, message);
  assert.deepEqual(context?.lastQuestion, owner.customer.nextQuestion);
  assert.deepEqual(context?.currentLead, { moveDetails: owner.customer.lead.moveDetails });
  assert.equal(result.lead.moveDetails.requestedDate, '2026-11-08');
  assert.deepEqual(result.lead.moveDetails.pickup, { city: 'רמת גן', address: 'הדגמה 11', floor: 2, elevator: false });
  assert.deepEqual(result.lead.moveDetails.dropoff, { city: 'תל אביב', address: 'הדגמה 22', floor: 1, elevator: false });
  assert.deepEqual(result.lead.moveDetails.items.map(x => [x.type, x.quantity]), [['refrigerator', 1], ['box', 15]]);
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(result.lead.moveDetails.items[0].requiresDisassembly, false);
  assert.equal(result.lead.moveDetails.items[0].requiresAssembly, false);
});

test('reconstructed empty keep output remains valid and invents no facts', async t => {
  const owner = freshOwnerState(), before = structuredClone(owner.customer.lead);
  const harness = sdk(t, empty());
  const result = await workflow(owner.customer.lead, harness);
  assert.deepEqual(result.extraction, {});
  assert.deepEqual(result.lead.moveDetails, before.moveDetails);
  assert.deepEqual(owner.customer.lead, before);
  assert.deepEqual(harness.diagnostics, []);
  assert.equal(harness.calls(), 1);
});

for (const variant of [
  { name: 'non-refrigerator size', change: (data: AIExtraction) => { data.items[1].sizeCategory = set('LARGE'); },
    error: 'Invalid AI extraction at box.sizeCategory.', field: 'items[].sizeCategory', rule: 'refrigerator_only' },
  { name: 'invalid local time', change: (data: AIExtraction) => { data.requestedTime = set('29:99'); },
    error: 'Invalid AI extraction at requestedTime.', field: 'requestedTime', rule: 'time_hh_mm' },
  { name: 'literal Hebrew month date', change: (data: AIExtraction) => { data.requestedDate = set('8 בנובמבר 2026'); },
    error: 'Invalid AI extraction at requestedDate.', field: 'requestedDate', rule: 'date_normalization' },
]) {
  test(`reconstructed schema-valid ${variant.name} rejects atomically with the same safe production projection`, async t => {
    const owner = freshOwnerState(), before = structuredClone(owner);
    const data = reconstructedScenario(); variant.change(data);
    const harness = sdk(t, data);
    await assert.rejects(workflow(owner.customer.lead, harness), error => error instanceof AIWindowError && error.reason === 'request_failed');
    assertDomainFailure(harness, variant.error, variant.field, variant.rule);
    assert.deepEqual(owner, before, 'failed workflow preserves all lead facts, messages and owner state');
  });
}

test('reconstructed explicit correction preserves legitimate zero and false without mutating the prior lead', async t => {
  const owner = freshOwnerState();
  owner.customer.lead.moveDetails.pickup.floor = 2;
  owner.customer.lead.moveDetails.pickup.elevator = true;
  const before = structuredClone(owner);
  const data = empty();
  data.pickup.floor = correct(0); data.pickup.elevator = correct(false);
  const harness = sdk(t, data);
  const result = await workflow(owner.customer.lead, harness, 'טעיתי, האיסוף מקומת קרקע בלי מעלית.');
  assert.equal(result.lead.moveDetails.pickup.floor, 0);
  assert.equal(result.lead.moveDetails.pickup.elevator, false);
  assert.deepEqual(owner, before);
  assert.deepEqual(harness.diagnostics, []);
  assert.equal(harness.calls(), 1);
});

test('reconstructed unauthorized known-value overwrite rejects atomically rather than silently replacing a fact', async t => {
  const owner = freshOwnerState(); owner.customer.lead.moveDetails.pickup.floor = 2;
  const before = structuredClone(owner);
  const data = empty(); data.pickup.floor = set(3);
  const harness = sdk(t, data);
  await assert.rejects(workflow(owner.customer.lead, harness), error => error instanceof AIWindowError && error.reason === 'request_failed');
  assertDomainFailure(harness, 'Invalid AI extraction at pickup.floor (overwriting a known value requires an explicit correction).',
    'pickup.floor', 'explicit_correction_required');
  assert.deepEqual(owner, before);
});
