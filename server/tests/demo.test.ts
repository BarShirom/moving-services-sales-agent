import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import type { MessageExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import type { DemoSnapshot } from '../src/demo/types.js';

async function demo(t: TestContext, extractor: MessageExtractor) {
  const server = createApp({ extractor }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = () => fetch(`${root}/api/demo`);
  const post = (path: string, body: unknown = {}) => fetch(`${root}/api/demo/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { root, get, post };
}

test('demo initializes from requirements and preserves the existing health endpoint', async t => {
  const api = await demo(t, () => { assert.fail('GET must not call extraction'); });
  const response = await api.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state: DemoSnapshot = await response.json() as DemoSnapshot;
  assert.equal(state.lead.messages.length, 0);
  assert.deepEqual(state.nextQuestion, state.requirements.nextQuestion);
  assert.equal(state.nextQuestion?.requirements[0].id, 'items');
  assert.deepEqual(await (await fetch(`${api.root}/api/health`)).json(), {
    status: 'ok', service: 'Rick & GO Sales Agent', version: '0.1',
  });
});

test('message route retains facts, forwards the displayed question and records both sides', async t => {
  let calls = 0;
  const api = await demo(t, input => {
    calls++;
    if (calls === 1) {
      assert.equal(input.text, 'צריך מקרר');
      assert.equal(input.lastQuestion?.requirements[0].id, 'items');
      return { moveDetails: { items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }],
        pickup: { city: 'רמת גן', address: 'ביאליק 20', floor: 0, elevator: false },
        dropoff: { city: 'תל אביב', address: 'הרצל 10' } } };
    }
    assert.equal(input.text, '2');
    assert.ok(input.lastQuestion?.requirements.some(requirement => requirement.id === 'dropoff.floor'));
    assert.equal(input.lead.messages.at(-1)?.sender, 'AGENT');
    return { moveDetails: { dropoff: { floor: 2 } } };
  });
  const firstResponse = await api.post('message', { message: 'צריך מקרר' });
  assert.equal(firstResponse.status, 200);
  const first: DemoSnapshot = await firstResponse.json() as DemoSnapshot;
  assert.deepEqual(first.lead.messages.map(message => message.sender), ['CUSTOMER', 'AGENT']);
  assert.equal(first.lead.messages[1].text, first.nextQuestion?.text);
  assert.equal(first.requirements.missingRequired.some(requirement => requirement.id === 'pickup.elevator'), false);
  const second: DemoSnapshot = await (await api.post('message', { message: '2' })).json() as DemoSnapshot;
  assert.equal(second.lead.moveDetails.pickup.floor, 0);
  assert.equal(second.lead.moveDetails.pickup.elevator, false);
  assert.equal(second.lead.moveDetails.dropoff.floor, 2);
  assert.equal(second.lead.messages.length, 4);
  assert.deepEqual(await (await api.get()).json(), second);
});

test('reset creates a fresh Lead with backend-derived requirements', async t => {
  const api = await demo(t, () => ({ moveDetails: { items: [{ type: 'box', quantity: 15 }] } }));
  const previous: DemoSnapshot = await (await api.post('message', { message: '15 ארגזים' })).json() as DemoSnapshot;
  const reset: DemoSnapshot = await (await api.post('reset')).json() as DemoSnapshot;
  assert.notEqual(reset.lead.id, previous.lead.id);
  assert.deepEqual(reset.lead.messages, []);
  assert.deepEqual(reset.lead.moveDetails.items, []);
  assert.deepEqual(reset.extraction, {});
  assert.equal(reset.nextQuestion?.requirements[0].id, 'items');
});

test('invalid messages and caller-supplied Lead state are rejected without extraction', async t => {
  const api = await demo(t, () => { assert.fail('must not extract invalid input'); });
  for (const body of [{}, { message: '' }, { message: '  ' }, { message: 2 },
    { message: 'x'.repeat(4001) }, { message: 'שלום', lead: { status: 'WON' } }]) {
    assert.equal((await api.post('message', body)).status, 400);
  }
  for (const body of ['{ invalid json', JSON.stringify({ message: 'x'.repeat(40_000) })]) {
    const response = await fetch(`${api.root}/api/demo/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  }
});

for (const failure of [
  new AIExtractionError('MISSING_API_KEY', 'private configuration data'),
  new AIExtractionError('REQUEST_FAILED', 'private provider data'),
  new AIExtractionError('INVALID_EXTRACTION', 'private extraction data'),
  new Error('private unexpected data'),
]) {
  test(`safe route error for ${failure instanceof AIExtractionError ? failure.code : 'unexpected failure'} preserves state`, async t => {
    const api = await demo(t, () => { throw failure; });
    const before = await (await api.get()).json();
    const response = await api.post('message', { message: 'שלום' });
    assert.equal(response.status, failure instanceof AIExtractionError && failure.code === 'MISSING_API_KEY' ? 503 : 502);
    const body = await response.json() as { error: { message: string } };
    assert.doesNotMatch(JSON.stringify(body), /private/);
    assert.equal(typeof body.error.message, 'string');
    assert.deepEqual(await (await api.get()).json(), before);
    assert.equal((await api.post('reset')).status, 200);
  });
}

test('simultaneous sends and resets cannot race an in-flight extraction', async t => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = await demo(t, async () => { started(); await gate; return {}; });
  const pending = api.post('message', { message: 'שלום' });
  await entered;
  try {
    assert.equal((await api.post('message', { message: 'עוד הודעה' })).status, 409);
    assert.equal((await api.post('reset')).status, 409);
  } finally { release(); }
  assert.equal((await pending).status, 200);
  assert.equal((await api.post('reset')).status, 200);
});

test('reported conversation progresses through address, elevator, date and unavailable photo with a final response', async t => {
  const { createAIExtractor } = await import('../src/integrations/openai/extractMessageWithAI.js');
  const { normalizeRequestedDate } = await import('../src/domain/extraction/normalizeRequestedDate.js');
  let calls = 0;
  let referenceDate = '';
  const keep = () => ({ action: 'keep' as const });
  const set = <T>(value: T) => ({ action: 'set' as const, value });
  const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
  const extractor = createAIExtractor({ request: async request => {
    assert.ok(Array.isArray(request.input));
    const message = request.input[0];
    assert.ok('content' in message && typeof message.content === 'string');
    const context = JSON.parse(message.content);
    referenceDate = context.referenceDate;
    assert.match(referenceDate, /^\d{4}-\d{2}-\d{2}$/);
    const data: import('../src/integrations/openai/schema.js').AIExtraction = {
      items: [], pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep(),
    };
    if (calls === 0) {
      data.items = ['refrigerator', 'box'].map(type => ({
        type: type as 'refrigerator' | 'box', quantity: type === 'box' ? set(15) : keep(),
        sizeCategory: type === 'refrigerator' ? set('LARGE') : keep(),
        photoStatus: keep(), dimensionsAvailable: keep(),
        dimensions: { width: keep(), height: keep(), depth: keep() }, requiresDisassembly: keep(), requiresAssembly: keep(),
      }));
      data.pickup = { city: set('רמת גן'), address: set('ביאליק 20'), floor: set(2), elevator: set(false) };
      data.dropoff.city = set('תל אביב');
    } else if (calls === 1) {
      assert.equal(context.latestCustomerMessage, 'רוטשילד 1, קומה 1');
      assert.equal(context.lastQuestion.requirements[0].id, 'dropoff.address');
      data.dropoff.address = set('רוטשילד 1');
      data.dropoff.floor = set(1);
    } else if (calls === 2) {
      assert.equal(context.latestCustomerMessage, 'לא');
      assert.equal(context.lastQuestion.requirements[0].id, 'dropoff.elevator');
      data.dropoff.elevator = set(false);
    } else if (calls === 3) {
      assert.equal(context.latestCustomerMessage, '16/09');
      assert.equal(context.lastQuestion.requirements[0].id, 'requestedDate');
      data.requestedDate = set('16/09');
    } else { assert.fail('Photo refusal should not call the model'); }
    calls++;
    return { status: 'completed', output: [], output_parsed: data };
  } });
  const api = await demo(t, extractor);
  const messages = [
    'צריך להעביר מקרר גדול מרמת גן לתל אביב. האיסוף מביאליק 20, קומה 2 בלי מעלית. יש גם בערך 15 ארגזים.',
    'רוטשילד 1, קומה 1', 'לא', '16/09', 'אין',
  ];
  let result!: DemoSnapshot;
  for (const message of messages) {
    const response = await api.post('message', { message });
    assert.equal(response.status, 200);
    result = await response.json() as DemoSnapshot;
    assert.ok(result.responseText.length > 0);
    assert.equal(result.lead.messages.at(-1)?.text, result.responseText);
    if (message === '16/09') assert.equal(result.nextQuestion?.requirements[0].id, 'item.photo');
  }
  assert.equal(calls, 4);
  assert.equal(result.lead.moveDetails.requestedDate, normalizeRequestedDate('16/09', referenceDate));
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(result.lead.moveDetails.items[1].quantity, 15);
  assert.equal(result.lead.moveDetails.dropoff.elevator, false);
  assert.equal(result.nextQuestion, null);
  assert.match(result.responseText, /אין בעיה, נמשיך בלי תמונה/);
  assert.match(result.responseText, /בדיקה ותמחור/);
  assert.equal(result.lead.messages.length, 10);
});


test('HTTP demo persists a compound photo alternative and all three dimension question references', async t => {
  let calls = 0;
  const api = await demo(t, input => {
    calls++;
    if (calls === 1) return { moveDetails: {
      items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box', quantity: 15 }],
      pickup: { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false },
      dropoff: { city: 'תל אביב', address: 'סלמה 67', floor: 5, elevator: true },
      requestedDate: '2026-09-25',
    } };
    if (calls === 2) {
      assert.equal(input.text, 'אין לי כרגע, אבל יש לי את המידות');
      assert.deepEqual(input.lastQuestion?.requirements, [{ id: 'item.photo', itemIndex: 0 }]);
      return { moveDetails: { items: [{
        type: 'refrigerator', photoStatus: 'NOT_AVAILABLE', dimensionsAvailable: true,
      }] } };
    }
    assert.equal(calls, 3);
    assert.deepEqual(input.lastQuestion?.requirements.map(r => r.id), ['item.width', 'item.height', 'item.depth']);
    assert.equal(input.lead.moveDetails.items[0].dimensionsAvailable, true);
    assert.equal(input.lead.messages.at(-1)?.sender, 'AGENT');
    return { moveDetails: { items: [{ type: 'refrigerator', dimensions: { width: 70, height: 180, depth: 70 } }] } };
  });
  let response = await api.post('message', { message:
    'מקרר גדול ו-15 ארגזים מרמת גן ביאליק 20 קומה 2 בלי מעלית לתל אביב סלמה 67 קומה 5 עם מעלית ב-25/09/2026' });
  assert.equal(response.status, 200);
  response = await api.post('message', { message: 'אין לי כרגע, אבל יש לי את המידות' });
  assert.equal(response.status, 200);
  const offered = await response.json() as DemoSnapshot;
  assert.equal(offered.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.match(offered.responseText, /המידות יעזרו/);
  assert.equal(offered.lead.messages.at(-1)?.text, offered.responseText);
  assert.deepEqual(await (await api.get()).json(), offered);
  response = await api.post('message', { message: '70 רוחב, 180 גובה, 70 עומק' });
  assert.equal(response.status, 200);
  const completed = await response.json() as DemoSnapshot;
  assert.equal(calls, 3);
  assert.equal(completed.nextQuestion, null);
  assert.deepEqual(completed.lead.moveDetails.items[0].dimensions, { width: 70, height: 180, depth: 70 });
  assert.equal(completed.lead.moveDetails.items[1].quantity, 15);
  assert.equal(completed.lead.messages.at(-1)?.text, completed.responseText);
  assert.match(completed.responseText, /בדיקה ותמחור/);
  assert.deepEqual(await (await api.get()).json(), completed);
});
