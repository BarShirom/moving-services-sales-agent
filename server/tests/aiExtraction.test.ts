import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { mergeExtraction } from '../src/domain/extraction/mergeExtraction.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { DEFAULT_OPENAI_MODEL, getOpenAIConfig } from '../src/config/openai.js';
import { buildExtractionContext, EXTRACTION_CONTEXT_LIMITS } from '../src/integrations/openai/context.js';
import { convertAIExtraction } from '../src/integrations/openai/convertExtraction.js';
import { AIExtractionError, type AIExtractionErrorCode } from '../src/integrations/openai/errors.js';
import { createAIExtractor, type StructuredResponseRequest } from '../src/integrations/openai/extractMessageWithAI.js';
import { extractionTextFormat, type AIExtraction } from '../src/integrations/openai/schema.js';
import type { NextQuestion } from '../src/domain/requirements/types.js';

const keep = () => ({ action: 'keep' as const });
const set = <T>(value: T) => ({ action: 'set' as const, value });
const correct = <T>(value: T) => ({ action: 'correct' as const, value });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
function empty(): AIExtraction {
  return { items: [], pickup: location(), dropoff: location(), requestedDate: keep(),
    requestedTime: keep(), specialAccessNotes: keep() };
}
function item(type: AIExtraction['items'][number]['type']): AIExtraction['items'][number] {
  return { type, quantity: keep(), sizeCategory: keep(),
    photoStatus: keep(), dimensionsAvailable: keep(),
    dimensions: { width: keep(), height: keep(), depth: keep() },
    requiresDisassembly: keep(), requiresAssembly: keep() };
}
const hasCode = (code: AIExtractionErrorCode) => (error: unknown) =>
  error instanceof AIExtractionError && error.code === code;
const reply = (output: unknown): StructuredResponseRequest => async () => ({
  status: 'completed', output: [], output_parsed: output,
});

// These are contract tests with explicit model fixtures, not claims of live language accuracy.
test('strict SDK JSON Schema requires every property and disallows extras without null updates', () => {
  assert.equal(extractionTextFormat.type, 'json_schema');
  assert.equal(extractionTextFormat.strict, true);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const schema = node as Record<string, unknown>;
    assert.notEqual(schema.type, 'null');
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(new Set(schema.required as string[]), new Set(Object.keys(schema.properties as object)));
    }
    Object.values(schema).forEach(walk);
  };
  walk(extractionTextFormat.schema);
});

test('structured output converts all supported fields to the existing partial patch contract', () => {
  const data = empty();
  const fridge = item('refrigerator');
  fridge.quantity = set(2);
  fridge.sizeCategory = set('FOUR_DOOR');
  fridge.dimensions = { width: set(90), height: set(180), depth: set(75) };
  fridge.requiresDisassembly = set(false);
  fridge.requiresAssembly = set(true);
  data.items = [fridge, { ...item('box'), quantity: set(20) }, item('washing_machine'), item('wardrobe'), item('bed')];
  data.pickup = { city: set('רמת גן'), address: set('ביאליק 20'), floor: set(0), elevator: set(false) };
  data.dropoff = { city: set('תל אביב'), address: set('הרצל 10'), floor: set(3), elevator: set(true) };
  data.requestedDate = set('2028-02-29');
  data.requestedTime = set('18:00');
  data.specialAccessNotes = set('מעבר צר בכניסה');
  const extraction = convertAIExtraction(data, createLead());
  assert.deepEqual(extraction, { moveDetails: {
    items: [{ type: 'refrigerator', quantity: 2, sizeCategory: 'FOUR_DOOR',
      dimensions: { width: 90, height: 180, depth: 75 }, requiresDisassembly: false, requiresAssembly: true },
    { type: 'box', quantity: 20 }, { type: 'washing_machine' }, { type: 'wardrobe' }, { type: 'bed' }],
    pickup: { city: 'רמת גן', address: 'ביאליק 20', floor: 0, elevator: false },
    dropoff: { city: 'תל אביב', address: 'הרצל 10', floor: 3, elevator: true },
    requestedDate: '2028-02-29', requestedTime: '18:00', specialAccessNotes: 'מעבר צר בכניסה',
  } });
});

test('partial merge preserves known fields, dimensions, false, zero and input immutability', () => {
  const lead = createLead();
  const fridge = createMoveItem('refrigerator');
  fridge.dimensions.width = 90;
  fridge.requiresAssembly = false;
  lead.moveDetails.items = [fridge];
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 0, elevator: false };
  lead.moveDetails.requestedDate = '2026-10-01';
  const before = structuredClone(lead);
  const data = empty();
  const update = item('refrigerator');
  update.dimensions.height = set(180);
  update.requiresDisassembly = set(false);
  data.items = [update];
  data.requestedTime = set('18:00');
  data.specialAccessNotes = set('כניסה מהחצר');
  const extraction = convertAIExtraction(data, lead);
  const result = mergeExtraction(lead, extraction);
  assert.deepEqual(lead, before);
  assert.deepEqual(result.lead.moveDetails.pickup, before.moveDetails.pickup);
  assert.deepEqual(result.lead.moveDetails.items[0].dimensions, { width: 90, height: 180, depth: null });
  assert.equal(result.lead.moveDetails.items[0].requiresAssembly, false);
  assert.equal(result.lead.moveDetails.items[0].requiresDisassembly, false);
  assert.equal(result.lead.moveDetails.requestedDate, '2026-10-01');
  assert.equal(result.lead.moveDetails.requestedTime, '18:00');
  assert.equal(result.lead.moveDetails.specialAccessNotes, 'כניסה מהחצר');
  result.lead.moveDetails.items[0].dimensions.height = 1;
  assert.equal(extraction.moveDetails?.items?.[0].dimensions?.height, 180);
});

for (const scenario of [
  { text: '2', question: { text: 'באיזו קומה האיסוף?', requirements: [{ id: 'pickup.floor' }] },
    output: () => ({ ...empty(), pickup: { ...location(), floor: set(2) } }), expected: { pickup: { floor: 2 } } },
  { text: 'לא', question: { text: 'יש מעלית באיסוף?', requirements: [{ id: 'pickup.elevator' }] },
    output: () => ({ ...empty(), pickup: { ...location(), elevator: set(false) } }), expected: { pickup: { elevator: false } } },
  { text: 'גדול', question: { text: 'איזה גודל המקרר?', requirements: [{ id: 'item.size', itemIndex: 0 }] },
    output: () => ({ ...empty(), items: [{ ...item('refrigerator'), sizeCategory: set('LARGE' as const) }] }),
    expected: { items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }] } },
] satisfies { text: string; question: NextQuestion; output: () => AIExtraction; expected: object }[]) {
  test(`contextual answer ${scenario.text} passes the actual question and maps the model fixture`, async () => {
    const lead = createLead();
    lead.moveDetails.items = [createMoveItem('refrigerator')];
    const extractor = createAIExtractor({ env: {}, request: async request => {
      assert.ok(Array.isArray(request.input));
      const message = request.input[0];
      assert.ok('content' in message && typeof message.content === 'string');
      const context = JSON.parse(message.content);
      assert.deepEqual(context.lastQuestion, scenario.question);
      assert.equal(context.latestCustomerMessage, scenario.text);
      assert.deepEqual(context.currentLead.moveDetails, lead.moveDetails);
      assert.equal(request.text?.format, extractionTextFormat);
      assert.equal(request.store, false);
      assert.equal(request.model, DEFAULT_OPENAI_MODEL);
      return { status: 'completed', output: [], output_parsed: scenario.output() };
    } });
    const result = await processCustomerMessageWithExtractor(lead, scenario.text, {
      extractor, lastQuestion: scenario.question,
    });
    assert.deepEqual(result.extraction, { moveDetails: scenario.expected });
    assert.equal(result.lead.moveDetails.items.length, 1);
    assert.equal(result.lead.messages.length, 1);
    assert.equal(result.lead.messages[0].text, scenario.text);
    assert.equal(lead.messages.length, 0);
  });
}

test('an explicit correction changes only its field, including correction to false and zero', () => {
  const lead = createLead();
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: true };
  const data = empty();
  data.pickup.floor = correct(3);
  const result = mergeExtraction(lead, convertAIExtraction(data, lead));
  assert.deepEqual(result.lead.moveDetails.pickup, { ...lead.moveDetails.pickup, floor: 3 });
  data.pickup.floor = correct(0);
  data.pickup.elevator = correct(false);
  assert.deepEqual(convertAIExtraction(data, lead), { moveDetails: { pickup: { floor: 0, elevator: false } } });
});

test('set cannot overwrite a known fact, while an explicit repeated value is safe', () => {
  const lead = createLead();
  lead.moveDetails.pickup.floor = 2;
  const data = empty();
  data.pickup.floor = set(3);
  assert.throws(() => convertAIExtraction(data, lead), hasCode('INVALID_EXTRACTION'));
  data.pickup.floor = set(2);
  assert.deepEqual(convertAIExtraction(data, lead), { moveDetails: { pickup: { floor: 2 } } });
});

test('ambiguous output with keep operations produces no invented facts', async () => {
  const lead = createLead();
  lead.moveDetails.pickup.floor = 2;
  const extractor = createAIExtractor({ request: reply(empty()) });
  const result = await processCustomerMessageWithExtractor(lead, 'אולי 2 או 3', { extractor });
  assert.deepEqual(result.extraction, {});
  assert.deepEqual(result.lead.moveDetails, lead.moveDetails);
});

for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid quantity ${value}`, () => {
    const data = empty();
    data.items = [{ ...item('box'), quantity: set(value) }];
    assert.throws(() => convertAIExtraction(data, createLead()), hasCode('INVALID_EXTRACTION'));
  });
}
for (const value of [0, -1, Infinity, NaN]) {
  test(`rejects invalid dimension ${value}`, () => {
    const data = empty();
    data.items = [{ ...item('bed'), dimensions: { width: set(value), height: keep(), depth: keep() } }];
    assert.throws(() => convertAIExtraction(data, createLead()), hasCode('INVALID_EXTRACTION'));
  });
}
for (const value of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', 'מחר', '31/04/2026']) {
  test(`rejects invalid normalized date ${value}`, () => {
    assert.throws(() => convertAIExtraction({ ...empty(), requestedDate: set(value) }, createLead()), hasCode('INVALID_EXTRACTION'));
  });
}
for (const value of ['24:00', '18:60', '8:00']) {
  test(`rejects invalid normalized time ${value}`, () => {
    assert.throws(() => convertAIExtraction({ ...empty(), requestedTime: set(value) }, createLead()), hasCode('INVALID_EXTRACTION'));
  });
}

test('rejects fractional floors, blank strings, nulls, unknown enums, extra fields and contradictory item patches', () => {
  for (const data of [
    { ...empty(), pickup: { ...location(), floor: set(1.5) } },
    { ...empty(), pickup: { ...location(), city: set(' ') } },
    { ...empty(), requestedTime: null },
    { ...empty(), pickup: { ...location(), elevator: set('false') } },
    { ...empty(), items: [{ ...item('refrigerator'), sizeCategory: set('HUGE') }] },
    { ...empty(), items: [{ ...item('box'), type: 'piano' }] },
    { ...empty(), items: [{ ...item('box'), sizeCategory: set('LARGE') }] },
    { ...empty(), items: [item('box'), item('box')] },
    { ...empty(), status: 'WON' },
    { ...empty(), pickup: { ...location(), floor: { action: 'keep', value: 2 } } },
  ]) assert.throws(() => convertAIExtraction(data, createLead()), hasCode('INVALID_EXTRACTION'));
});

test('multiple existing items remain unapplied without choosing one', () => {
  const lead = createLead();
  lead.moveDetails.items = [createMoveItem('bed'), createMoveItem('bed')];
  const data = empty();
  data.items = [{ ...item('bed'), dimensions: { width: set(150), height: keep(), depth: keep() } }];
  const extraction = convertAIExtraction(data, lead);
  const result = mergeExtraction(lead, extraction);
  assert.deepEqual(result.lead.moveDetails.items, lead.moveDetails.items);
  assert.deepEqual(result.unappliedItems, extraction.moveDetails?.items);
  result.unappliedItems[0].dimensions!.width = 1;
  assert.equal(extraction.moveDetails?.items?.[0].dimensions?.width, 150);
});

test('context uses a detached state snapshot and bounded whole messages without timestamps or workflow status', () => {
  const lead = createLead();
  lead.messages = Array.from({ length: 12 }, (_, i) => ({
    id: String(i), sender: 'CUSTOMER', text: String(i), timestamp: lead.createdAt,
  }));
  lead.messages[10] = { ...lead.messages[10], sender: 'AGENT', text: 'יש מעלית באיסוף?' };
  const context = buildExtractionContext({ lead, text: 'לא' });
  assert.equal(context.recentMessages.length, 6);
  assert.equal(context.recentMessages[0].text, '6');
  assert.deepEqual(context.recentMessages[4], { sender: 'AGENT', text: 'יש מעלית באיסוף?' });
  assert.equal(context.historyOmitted, true);
  assert.equal(context.lastQuestion, null);
  assert.equal(context.relativeDatesSupported, false);
  assert.deepEqual(Object.keys(context.currentLead), ['moveDetails']);
  context.currentLead.moveDetails.pickup.floor = 4;
  assert.equal(lead.moveDetails.pickup.floor, null);
  lead.messages[11].text = 'x'.repeat(EXTRACTION_CONTEXT_LIMITS.historyMessageChars + 1);
  assert.equal(buildExtractionContext({ lead, text: 'לא' }).recentMessages.length, 5);
});

test('oversized current input is rejected before calling the provider', async () => {
  const extractor = createAIExtractor({ request: async () => { assert.fail('must not request'); } });
  await assert.rejects(extractor({ lead: createLead(), text: 'x'.repeat(4_001) }), hasCode('CONTEXT_TOO_LARGE'));
  const lead = createLead();
  lead.moveDetails.specialAccessNotes = 'x'.repeat(24_001);
  assert.throws(() => buildExtractionContext({ lead, text: 'hello' }), hasCode('CONTEXT_TOO_LARGE'));
});

test('missing or blank API keys produce a clear lazy configuration error', async () => {
  for (const env of [{}, { OPENAI_API_KEY: '  ' }]) {
    const extractor = createAIExtractor({ env });
    await assert.rejects(extractor({ lead: createLead(), text: 'שלום' }), hasCode('MISSING_API_KEY'));
  }
  assert.equal(getOpenAIConfig({ OPENAI_API_KEY: 'test-only', OPENAI_MODEL: ' custom-model ' }).model, 'custom-model');
  assert.equal(getOpenAIConfig({ OPENAI_API_KEY: 'test-only' }).maxRetries, 0);
});

test('provider failures are typed, do not leak raw errors, and leave the lead untouched', async (t) => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const lead = createLead();
  const before = structuredClone(lead);
  const extractor = createAIExtractor({ request: async () => { throw new Error('private-provider-details'); } });
  await assert.rejects(processCustomerMessageWithExtractor(lead, 'מקרר', { extractor }), error => {
    assert.ok(hasCode('REQUEST_FAILED')(error));
    assert.doesNotMatch((error as Error).message, /private-provider-details/);
    assert.equal(errorLog.mock.callCount(), 0);
    return true;
  });
  assert.deepEqual(lead, before);
});

for (const status of ['incomplete', 'failed', 'cancelled'] as const) {
  test(`provider status ${status} never merges even with parsed data`, async () => {
    const extractor = createAIExtractor({ request: async () => ({ status, output: [], output_parsed: empty() }) });
    await assert.rejects(extractor({ lead: createLead(), text: 'שלום' }),
      hasCode(status === 'failed' ? 'REQUEST_FAILED' : 'NO_STRUCTURED_OUTPUT'));
  });
}

test('refusal and missing structured output are clear failures', async () => {
  for (const response of [
    { status: 'completed' as const, output: [], output_parsed: null },
    { status: 'completed' as const, output: [{ id: 'msg', type: 'message' as const,
      role: 'assistant' as const, status: 'completed' as const,
      content: [{ type: 'refusal' as const, refusal: 'No' }] }], output_parsed: empty() },
  ]) {
    const extractor = createAIExtractor({ request: async () => response });
    await assert.rejects(extractor({ lead: createLead(), text: 'שלום' }), hasCode('NO_STRUCTURED_OUTPUT'));
  }
});

test('official SDK parses a strict schema through a fake HTTP transport with no network', async () => {
  let calls = 0;
  const data = empty();
  data.pickup.floor = set(0);
  data.pickup.elevator = set(false);
  const client = new OpenAI({ apiKey: 'test-only', maxRetries: 0, fetch: async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.model, 'test-model');
    return new Response(JSON.stringify({ id: 'test-response', status: 'completed', output: [{
      id: 'test-message', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(data), annotations: [] }],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const extractor = createAIExtractor({ env: { OPENAI_MODEL: 'test-model' }, request: request => client.responses.parse(request) });
  assert.deepEqual(await extractor({ lead: createLead(), text: 'איסוף קומת קרקע בלי מעלית' }),
    { moveDetails: { pickup: { floor: 0, elevator: false } } });
  assert.equal(calls, 1);
});

test('SDK malformed JSON and schema-invalid output are mapped to invalid extraction errors', async () => {
  for (const output of ['{', JSON.stringify({ ...empty(), status: 'WON' })]) {
    const client = new OpenAI({ apiKey: 'test-only', fetch: async () => new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }],
    }), { headers: { 'content-type': 'application/json' } }) });
    const extractor = createAIExtractor({ request: request => client.responses.parse(request) });
    await assert.rejects(extractor({ lead: createLead(), text: 'שלום' }), hasCode('INVALID_EXTRACTION'));
  }
});

test('injected workflow preserves requirement context and isolates extractor mutation', async () => {
  const lead = createLead();
  lead.moveDetails.items = [createMoveItem('refrigerator')];
  lead.moveDetails.items[0].sizeCategory = 'LARGE';
  lead.moveDetails.pickup = { city: 'א', address: 'ב', floor: 0, elevator: false };
  lead.moveDetails.dropoff = { city: 'ג', address: 'ד', floor: 0, elevator: false };
  lead.moveDetails.requestedDate = '2026-10-01';
  const before = structuredClone(lead);
  const result = await processCustomerMessageWithExtractor(lead, 'רוחב 90 ס״מ', {
    requirementsContext: { items: { 0: { dimensionsRequired: true } } },
    extractor: input => {
      input.lead.status = 'WON';
      input.lead.moveDetails.pickup.city = 'mutated';
      return { moveDetails: { items: [{ type: 'refrigerator', dimensions: { width: 90 } }] } };
    },
  });
  assert.deepEqual(lead, before);
  assert.equal(result.lead.status, 'COLLECTING_INFORMATION');
  assert.equal(result.lead.moveDetails.pickup.city, 'א');
  assert.deepEqual(result.requirements.missingRequired.map(requirement => requirement.id), ['item.height', 'item.depth']);
  assert.equal(result.nextQuestion, result.requirements.nextQuestion);
});

test('relative-date fixture keeps a known date while correcting an explicit time', async () => {
  const lead = createLead();
  lead.moveDetails.requestedDate = '2026-10-01';
  lead.moveDetails.requestedTime = '17:00';
  const data = empty();
  data.requestedTime = correct('18:00');
  const extractor = createAIExtractor({ request: async request => {
    assert.match(request.instructions!, /Relative dates.*unresolved/);
    return { status: 'completed', output: [], output_parsed: data };
  } });
  const result = await processCustomerMessageWithExtractor(lead, 'לא, התכוונתי ליום חמישי ב-18:00', { extractor });
  assert.deepEqual(result.extraction, { moveDetails: { requestedTime: '18:00' } });
  assert.equal(result.lead.moveDetails.requestedDate, '2026-10-01');
});

test('invalid AI output rejects the workflow atomically instead of merging valid siblings', async () => {
  const lead = createLead();
  const before = structuredClone(lead);
  const data = empty();
  data.pickup.city = set('רמת גן');
  data.items = [{ ...item('box'), quantity: set(0) }];
  const extractor = createAIExtractor({ request: reply(data) });
  await assert.rejects(processCustomerMessageWithExtractor(lead, 'רמת גן, אפס ארגזים', { extractor }), hasCode('INVALID_EXTRACTION'));
  assert.deepEqual(lead, before);
});


test('obvious placeholder API keys fail locally with a setup instruction and no leaked value', async () => {
  for (const value of [
    'your_real_key_here', 'YOUR_API_KEY_HERE', '<your-api-key>', 'your_openai_api_key_here',
    'sk-proj-your-real-api-key-here', 'sk-your-key-here', 'replace_me', 'changeme',
    'placeholder', 'paste_api_key_here', 'insert_key_here', 'OPENAI_API_KEY',
    'sk-xxxxxxxx', 'sk-...', 'dummy_key',
  ]) {
    const extractor = createAIExtractor({ env: { OPENAI_API_KEY: value } });
    await assert.rejects(extractor({ lead: createLead(), text: 'שלום' }), error => {
      assert.ok(error instanceof AIExtractionError);
      assert.equal(error.code, 'MISSING_API_KEY');
      assert.equal(error.message,
        'OPENAI_API_KEY is missing or still contains a placeholder value. Add a real API key to the root .env file.');
      return true;
    });
  }
});

const reportedMultiItemMessage = 'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.';

// Model fixtures test transport/schema/conversion/merge; separate live checks evaluate language accuracy.
function multiItemFixture(quantity?: number): AIExtraction {
  const data = empty();
  data.items = [
    { ...item('refrigerator'), sizeCategory: set('LARGE') },
    { ...item('box'), quantity: quantity === undefined ? keep() : set(quantity) },
  ];
  return data;
}

function sdkFixtureExtractor(expectedMessage: string, data: AIExtraction) {
  const client = new OpenAI({ apiKey: 'test-only', maxRetries: 0, fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.input[0].content);
    assert.equal(context.latestCustomerMessage, expectedMessage, 'all lines must reach the model unchanged');
    assert.equal(request.text.format.strict, true);
    assert.ok(request.instructions.includes(reportedMultiItemMessage), 'the multi-item example must reach the model');
    return new Response(JSON.stringify({ status: 'completed', output: [{
      type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(data), annotations: [] }],
    }] }), { headers: { 'content-type': 'application/json' } });
  } });
  return createAIExtractor({ env: {}, request: request => client.responses.parse(request) });
}

test('exact reported live demo message preserves refrigerator AND 15 boxes through SDK parsing and workflow', async () => {
  const lead = createLead();
  const data = multiItemFixture(15);
  data.pickup = { city: set('רמת גן'), address: set('ביאליק 20'), floor: set(2), elevator: set(false) };
  data.dropoff.city = set('תל אביב');
  const result = await processCustomerMessageWithExtractor(lead, reportedMultiItemMessage, {
    extractor: sdkFixtureExtractor(reportedMultiItemMessage, data),
  });
  assert.deepEqual(result.extraction, { moveDetails: {
    items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box', quantity: 15 }],
    pickup: { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false },
    dropoff: { city: 'תל אביב' },
  } });
  assert.deepEqual(result.lead.moveDetails.items.map(({ type, quantity, sizeCategory }) => ({ type, quantity, sizeCategory })), [
    { type: 'refrigerator', quantity: null, sizeCategory: 'LARGE' },
    { type: 'box', quantity: 15, sizeCategory: null },
  ]);
  assert.equal(result.lead.messages[0].text, reportedMultiItemMessage);
  assert.equal(result.requirements.missingRequired.some(requirement => requirement.id === 'item.quantity'), false);
  assert.equal(result.lead.moveDetails.requestedDate, null);
  assert.equal(result.lead.moveDetails.requestedTime, null);
  assert.deepEqual(lead.moveDetails.items, []);
});

for (const phrase of ['בערך 15 ארגזים', 'כ-15 ארגזים', 'משהו כמו 15 ארגזים']) {
  test(`multi-item fixture for ${phrase} keeps the approximate supplied total`, async () => {
    const text = `צריך להעביר מקרר גדול. יש גם ${phrase}.`;
    const result = await processCustomerMessageWithExtractor(createLead(), text, {
      extractor: sdkFixtureExtractor(text, multiItemFixture(15)),
    });
    assert.deepEqual(result.extraction.moveDetails?.items, [
      { type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box', quantity: 15 },
    ]);
    assert.deepEqual(result.lead.moveDetails.items[1].dimensions, { width: null, height: null, depth: null });
  });
}

test('יש גם ארגזים includes boxes alongside a refrigerator without inventing quantity', async () => {
  const text = 'צריך להעביר מקרר גדול. יש גם ארגזים.';
  const result = await processCustomerMessageWithExtractor(createLead(), text, {
    extractor: sdkFixtureExtractor(text, multiItemFixture()),
  });
  assert.deepEqual(result.extraction.moveDetails?.items, [
    { type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box' },
  ]);
  assert.equal(result.lead.moveDetails.items[1].quantity, null);
  assert.ok(result.requirements.missingRequired.some(requirement => requirement.id === 'item.quantity' && requirement.itemIndex === 1));
});

test('adding boxes keeps an existing refrigerator and unrelated known item facts', async () => {
  const lead = createLead();
  const fridge = createMoveItem('refrigerator');
  fridge.sizeCategory = 'LARGE';
  fridge.dimensions.width = 90;
  fridge.photoStatus = 'RECEIVED';
  lead.moveDetails.items = [fridge];
  const text = 'יש גם בערך 15 ארגזים';
  const data = empty();
  data.items = [{ ...item('box'), quantity: set(15) }];
  const result = await processCustomerMessageWithExtractor(lead, text, {
    extractor: sdkFixtureExtractor(text, data),
    lastQuestion: { text: 'באיזו קומה האיסוף?', requirements: [{ id: 'pickup.floor' }] },
  });
  assert.equal(result.lead.moveDetails.items.length, 2);
  assert.deepEqual(result.lead.moveDetails.items[0], fridge);
  assert.equal(result.lead.moveDetails.items[1].type, 'box');
  assert.equal(result.lead.moveDetails.items[1].quantity, 15);
  assert.equal(result.lead.moveDetails.pickup.floor, null);
});

test('unknown or incremental box totals keep existing quantities without dropping the refrigerator', async () => {
  for (const text of ['צריך להעביר מקרר גדול. יש גם ארגזים.', 'צריך להעביר מקרר גדול. יש עוד 5 ארגזים.']) {
    const lead = createLead();
    const fridge = createMoveItem('refrigerator');
    fridge.sizeCategory = 'LARGE';
    const box = createMoveItem('box');
    box.quantity = 20;
    lead.moveDetails.items = [fridge, box];
    const result = await processCustomerMessageWithExtractor(lead, text, {
      extractor: sdkFixtureExtractor(text, multiItemFixture()),
    });
    assert.equal(result.lead.moveDetails.items.length, 2);
    assert.equal(result.lead.moveDetails.items[1].quantity, 20);
  }
});

test('negative and uncertain box fixtures do not copy boxes from the multi-item prompt example', async () => {
  for (const text of ['צריך להעביר מקרר גדול. אין ארגזים.', 'צריך להעביר מקרר גדול. אולי יהיו גם 15 ארגזים.']) {
    const data = empty();
    data.items = [{ ...item('refrigerator'), sizeCategory: set('LARGE') }];
    const result = await processCustomerMessageWithExtractor(createLead(), text, {
      extractor: sdkFixtureExtractor(text, data),
    });
    assert.deepEqual(result.extraction, { moveDetails: { items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }] } });
    assert.equal(result.lead.moveDetails.items.length, 1);
  }
});
