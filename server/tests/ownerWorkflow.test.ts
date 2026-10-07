import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { acceptCustomerResult, applyOwnerAction, freshOwnerState, generatePricing, ownerSnapshot, sampleOwnerState } from '../src/demo/ownerWorkflow.js';
import type { OwnerSnapshot } from '../src/demo/ownerTypes.js';
import type { DemoSnapshot } from '../src/demo/types.js';
import type { MessageExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { ownerActionSchema } from '../src/domain/ownerReview/types.js';

async function api(t: TestContext, extractor: MessageExtractor = () => { assert.fail('Unexpected extraction'); }, now?: () => Date) {
  const server = createApp({ extractor, now }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`;
  const get = async <T>(path = '') => await (await fetch(root + path)).json() as T;
  const post = (path: string, body: unknown = {}) => fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const owner = () => get<OwnerSnapshot>('/owner');
  const sample = async () => {
    const state = await owner();
    return await (await post('/owner/sample', token(state))).json() as OwnerSnapshot;
  };
  return { get, post, owner, sample };
}
const token = (owner: OwnerSnapshot) => ({ leadId: owner.customer.lead.id, revision: owner.revision });
const approval = (owner: OwnerSnapshot) => ({ ...token(owner), action: 'APPROVE', pricingEvaluationId: owner.pricingEvaluation!.id,
  reviewedPhotoItemIndices: owner.pendingPhotoItemIndices });
const finalization = (owner: OwnerSnapshot, amount: number) => ({ ...approval(owner), action: 'ADJUST_PRICE', amount,
  scopeConfirmed: true, omittedCostsAcknowledged: true });

test('reported fridge and 15 boxes HTTP flow prices all components and photo refusal keeps the recommendation current', async t => {
  const { createAIExtractor } = await import('../src/integrations/openai/extractMessageWithAI.js');
  const keep = () => ({ action: 'keep' as const });
  const set = <T>(value: T) => ({ action: 'set' as const, value });
  const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
  let calls = 0;
  const extractor = createAIExtractor({ request: async request => {
    calls++;
    assert.ok(Array.isArray(request.input));
    const message = request.input[0];
    assert.ok('content' in message && typeof message.content === 'string');
    const context = JSON.parse(message.content);
    assert.equal(context.referenceDate, '2026-10-07');
    const data: import('../src/integrations/openai/schema.js').AIExtraction = {
      items: [], pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep(),
    };
    if (calls === 1) {
      data.items = ['refrigerator', 'box'].map(type => ({
        type: type as 'refrigerator' | 'box', quantity: type === 'box' ? set(15) : keep(),
        sizeCategory: type === 'refrigerator' ? set('LARGE') : keep(), photoStatus: keep(), dimensionsAvailable: keep(),
        dimensions: { width: keep(), height: keep(), depth: keep() }, requiresDisassembly: keep(), requiresAssembly: keep(),
      }));
      data.pickup = { city: set('רמת גן'), address: set('ביאליק 20'), floor: set(2), elevator: set(false) };
      data.dropoff.city = set('תל אביב');
    } else if (calls === 2) {
      assert.equal(context.latestCustomerMessage, 'סלמה 37, קומה 2 בלי מעלית');
      data.dropoff = { city: keep(), address: set('סלמה 37'), floor: set(2), elevator: set(false) };
    } else if (context.latestCustomerMessage === 'הקומה באיסוף השתנתה ל-3') {
      data.pickup.floor = { action: 'correct', value: 3 };
    } else assert.equal(context.latestCustomerMessage, 'תודה');
    return { status: 'completed', output: [], output_parsed: data };
  } });
  const app = await api(t, extractor, () => new Date('2026-10-07T09:00:00Z'));
  for (const message of [
    'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.',
    'סלמה 37, קומה 2 בלי מעלית', '8/11',
  ]) assert.equal((await app.post('/message', { message })).status, 200);
  const beforePhoto = await app.owner();
  assert.equal(beforePhoto.pricingStale, false);
  assert.equal(beforePhoto.pricingEvaluation?.inputSnapshot.moveDetails.items[0].photoStatus, 'REQUIRED');
  assert.equal(beforePhoto.customer.nextQuestion?.requirements[0].id, 'item.photo');
  assert.equal((await app.post('/message', { message: 'אין לי כרגע' })).status, 200);
  const owner = await app.owner();
  assert.equal(calls, 2, 'Date and photo replies use the deterministic conversation handlers');
  assert.equal(owner.pricingStale, false, 'Photo refusal must not stale an evaluation that already treats the photo as absent');
  assert.equal(owner.pricingEvaluation?.id, beforePhoto.pricingEvaluation?.id);
  assert.equal(owner.customer.lead.status, 'AWAITING_REVIEW');
  assert.equal(owner.customer.lead.moveDetails.requestedDate, '2026-11-08');
  assert.equal(owner.customer.lead.moveDetails.items[0].quantity, null);
  assert.equal(owner.customer.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  const evaluation = owner.pricingEvaluation!;
  assert.equal(evaluation.suggestedAmount, 1150);
  assert.deepEqual(evaluation.priceRange, { min: 950, max: 1350 });
  assert.equal(evaluation.confidence, 60);
  assert.equal(evaluation.completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(evaluation.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(evaluation.humanApprovalRequired, true);
  assert.equal(evaluation.inputSnapshot.moveDetails.items[0].quantity, 1);
  assert.equal(evaluation.inputSnapshot.moveDetails.items[0].photoStatus, 'REQUIRED', 'Original audit snapshot is retained after photo refusal');
  assert.equal(evaluation.inputSnapshot.context.distanceKm, 20);
  assert.equal(owner.demoDistanceKm, 20);
  assert.deepEqual(evaluation.breakdown.map(part => [part.code, part.amount]), [
    ['REFRIGERATOR', 425], ['BOXES', 150], ['DISTANCE', 75], ['FLOORS', 250], ['FLOORS', 250],
  ]);
  const reasons = evaluation.reviewReasons.map(reason => reason.code);
  assert.equal(new Set(reasons).size, reasons.length);
  assert.ok(!reasons.some(code => /_QUANTITY$|_SERVICES_UNKNOWN$/.test(code) && code.startsWith('ITEM_')));
  assert.deepEqual(owner.actions, { approve: true, adjust: true, requestMoreInfo: true, takeOver: true, recalculate: true });
  assert.deepEqual(owner.reviews, []);
  assert.ok(owner.customer.lead.messages.every(message => message.sender !== 'HUMAN'));
  assert.doesNotMatch(JSON.stringify(await app.get<DemoSnapshot>()), /suggestedAmount|approvedAmount|demoDistanceKm|1150 ₪/);

  assert.equal((await app.post('/message', { message: 'תודה' })).status, 200);
  const unchanged = await app.owner();
  assert.equal(unchanged.pricingStale, false);
  assert.equal(unchanged.pricingEvaluation?.id, evaluation.id);
  assert.equal((await app.post('/message', { message: 'הקומה באיסוף השתנתה ל-3' })).status, 200);
  const stale = await app.owner();
  assert.equal(stale.pricingStale, true);
  assert.equal(stale.actions.approve, false);
  assert.equal(stale.actions.adjust, false);
  assert.equal((await app.post('/owner/action', approval(stale))).status, 409);
  const fresh = await (await app.post('/owner/pricing', token(stale))).json() as OwnerSnapshot;
  assert.equal(fresh.pricingStale, false);
  assert.equal(fresh.pricingEvaluation?.suggestedAmount, 1275);
  assert.equal(fresh.actions.approve, true);
  assert.equal((await app.post('/owner/action', approval(fresh))).status, 200);
  assert.match((await app.get<DemoSnapshot>()).responseText, /1,275 ₪/);
});

test('mixed inventory HTTP flow prices supported transport and keeps wardrobe costs manual', async t => {
  for (const { registeredRoute, assembly } of [
    { registeredRoute: true, assembly: true }, { registeredRoute: true, assembly: null }, { registeredRoute: false, assembly: true },
  ]) await t.test(`${registeredRoute ? 'registered synthetic route' : 'unknown route'}; assembly=${assembly}`, async t => {
    let calls = 0;
    const app = await api(t, input => {
      calls++;
      assert.equal(input.referenceDate, '2026-10-07');
      assert.equal(calls, 1, 'The complete inventory is supplied in one structured extraction');
      return { moveDetails: {
        items: [{ type: 'refrigerator', sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE' },
          { type: 'wardrobe', sizeCategory: 'LARGE', dimensionsAvailable: false, requiresDisassembly: true,
            ...(assembly === null ? {} : { requiresAssembly: assembly }) },
          { type: 'box', quantity: 15 }],
        pickup: { city: 'רמת גן', address: registeredRoute ? 'ביאליק 20' : 'רחוב הדגמה לא רשום 20', floor: 2, elevator: false },
        dropoff: { city: 'תל אביב', address: 'סלמה 37', floor: 3, elevator: true },
        requestedDate: '2026-11-08',
      } };
    }, () => new Date('2026-10-07T09:00:00Z'));
    const inventory = 'צריך להעביר מקרר גדול, ארון ו-15 ארגזים מרמת גן לתל אביב. האיסוף בקומה 2 בלי מעלית והפריקה בקומה 3 עם מעלית. התאריך 8/11. הארון די גדול, אין לי מידות וצריך פירוק.'
      + (assembly === null ? '' : ' צריך גם הרכבה.') + ' אין לי תמונה של המקרר.';
    assert.equal((await app.post('/message', { message: inventory })).status, 200);
    const before = await app.get<DemoSnapshot>();
    if (assembly === null) {
      assert.equal(before.nextQuestion?.requirements[0].id, 'item.assembly');
      const collecting = await app.owner();
      assert.equal(collecting.pricingEvaluation, null, 'An active customer question still prevents automatic generation');
      assert.equal(collecting.actions.recalculate, true, 'Owner can explicitly calculate the supported subtotal');
      assert.equal((await app.post('/owner/pricing', token(collecting))).status, 200);
    } else assert.equal(before.nextQuestion, null);
    const owner = await app.owner();
    const evaluation = owner.pricingEvaluation!;
    assert.ok(evaluation);
    assert.equal(owner.pricingStale, false);
    if (assembly === null) {
      assert.equal(owner.customer.nextQuestion?.requirements[0].id, 'item.assembly');
      assert.ok(owner.customer.requirements.missingRequired.some(r => r.id === 'item.assembly'));
    } else assert.equal(owner.customer.nextQuestion, null);
    assert.equal(owner.customer.requirements.readyForPricing, false, 'Pending wardrobe requirements are not satisfied by a subtotal');
    assert.ok(owner.customer.requirements.pendingReview.some(r => r.id === 'item.width' && r.itemIndex === 1 && r.availability === 'TEMPORARILY_UNAVAILABLE'));
    assert.deepEqual(owner.customer.lead.moveDetails.items.map(item => item.quantity), [null, null, 15]);
    assert.deepEqual(evaluation.inputSnapshot.moveDetails.items.map(item => item.quantity), [1, 1, 15]);
    assert.equal(owner.customer.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
    assert.equal(evaluation.suggestedAmount, registeredRoute ? 900 : 825);
    assert.deepEqual(evaluation.priceRange, registeredRoute ? { min: 750, max: 1050 } : { min: 700, max: 950 });
    assert.equal(evaluation.confidence, registeredRoute ? 40 : 30);
    assert.equal(evaluation.completeness, 'PARTIAL_RECOMMENDATION');
    assert.equal(evaluation.amountScope, 'SUPPORTED_COMPONENTS_ONLY');
    assert.equal(evaluation.status, 'MANUAL_REVIEW_REQUIRED');
    assert.equal(evaluation.humanApprovalRequired, true);
    assert.equal(owner.demoDistanceKm, registeredRoute ? 20 : null);
    assert.deepEqual(evaluation.breakdown.map(part => [part.code, part.amount]), [
      ['REFRIGERATOR', 425], ['BOXES', 150], ...(registeredRoute ? [['DISTANCE', 75]] : []), ['FLOORS', 250],
    ]);
    assert.match(evaluation.breakdown.find(part => part.code === 'FLOORS')!.label, /pickup/);
    const reasons = evaluation.reviewReasons;
    assert.equal(new Set(reasons.map(reason => reason.code)).size, reasons.length);
    assert.ok(!reasons.some(reason => /ITEM_\d+_QUANTITY|ELEVATOR_FIT_UNKNOWN|SERVICES_UNKNOWN|SERVICE_COMPLEXITY/.test(reason.code)));
    assert.equal(reasons.filter(reason => reason.code.startsWith('ITEM_1_')).reduce((sum, reason) => sum + reason.confidenceDeduction, 0), 20);
    for (const code of ['UNSUPPORTED_ITEM', 'ASSEMBLY_DISASSEMBLY', 'ITEM_DIMENSIONS', 'UNSUPPORTED_ITEM_ACCESS']) {
      assert.ok(evaluation.omittedComponents.some(part => part.code === code && part.itemIndex === 1), code);
    }
    assert.equal(owner.actions.approve, false, 'A supported subtotal cannot be approved as a whole-job quote');
    assert.equal(owner.actions.adjust, true);
    assert.deepEqual(owner.reviews, []);
    const customer = await app.get<DemoSnapshot>();
    assert.ok(customer.lead.messages.every(message => message.sender !== 'HUMAN'));
    assert.doesNotMatch(JSON.stringify(customer), /suggestedAmount|approvedAmount|מחיר ההובלה הוא/);
    assert.equal((await app.post('/owner/action', approval(owner))).status, 409);
    assert.equal((await app.post('/owner/action', finalization(owner, registeredRoute ? 900 : 825))).status, 200);
    assert.match((await app.get<DemoSnapshot>()).responseText, registeredRoute ? /900 ₪/ : /825 ₪/);
  });
});

test('HTTP wardrobe loop retains services and pending dimensions through collection and owner manual pricing', async t => {
  const { createAIExtractor } = await import('../src/integrations/openai/extractMessageWithAI.js');
  const keep = () => ({ action: 'keep' as const });
  const set = <T>(value: T) => ({ action: 'set' as const, value });
  const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
  const compound = createAIExtractor({ request: async request => {
    assert.ok(Array.isArray(request.input));
    const message = request.input[0];
    assert.ok('content' in message && typeof message.content === 'string');
    const context = JSON.parse(message.content);
    assert.deepEqual(context.lastQuestion.requirements, [{ id: 'item.size', itemIndex: 1 }, { id: 'item.disassembly', itemIndex: 1 }]);
    return { status: 'completed', output: [], output_parsed: {
      items: [{ type: 'wardrobe', quantity: keep(), sizeCategory: keep(), photoStatus: keep(), dimensionsAvailable: set(false),
        dimensions: { width: keep(), height: keep(), depth: keep() }, requiresDisassembly: set(true), requiresAssembly: set(true) }],
      pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep(),
    } };
  } });
  let calls = 0;
  const app = await api(t, input => {
    calls++;
    assert.equal(input.referenceDate, '2026-10-07');
    if (calls === 1) return { moveDetails: {
      items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'wardrobe' }, { type: 'dresser' }, { type: 'box', quantity: 40 }],
      pickup: { city: 'רמת גן', address: 'רחוב דוגמה א 20', floor: 2, elevator: false }, dropoff: { city: 'תל אביב' },
    } };
    if (calls === 2) return { moveDetails: { dropoff: { address: 'רחוב דוגמה ב 12', floor: 3 } } };
    if (calls === 3) { assert.equal(input.text, 'לא'); return { moveDetails: { dropoff: { elevator: false } } }; }
    if (calls === 4) return compound(input);
    return {};
  }, () => new Date('2026-10-07T09:00:00Z'));
  for (const message of [
    'צריך להעביר מקרר גדול, ארון ושידה מרמת גן לתל אביב. האיסוף מרחוב דוגמה א 20, קומה 2 בלי מעלית. יש גם בערך 40 ארגזים.',
    'רחוב דוגמה ב 12, קומה 3', 'לא', '09/10',
  ]) assert.equal((await app.post('/message', { message })).status, 200);
  const before = await app.get<DemoSnapshot>();
  assert.equal(before.lead.moveDetails.requestedDate, '2026-10-09');
  const response = await app.post('/message', { message: 'אין לי כרגע את המידות ודרוש פירוק ואחר כך גם הרכבה.' });
  assert.equal(response.status, 200);
  const after = await response.json() as DemoSnapshot;
  assert.deepEqual(after.nextQuestion?.requirements, [{ id: 'item.photo', itemIndex: 0 }]);
  assert.deepEqual(after.lead.moveDetails, { ...before.lead.moveDetails, items: before.lead.moveDetails.items.map((item, i) =>
    i === 1 ? { ...item, dimensionsAvailable: false, requiresDisassembly: true, requiresAssembly: true } : item) });
  assert.ok(after.requirements.missingRequired.some(r => r.itemIndex === 1 && r.id === 'item.size' && r.availability === 'TEMPORARILY_UNAVAILABLE'));
  assert.equal((await app.post('/message', { message: 'אין' })).status, 200);
  const owner = await app.owner();
  assert.equal(owner.customer.nextQuestion, null);
  assert.equal(owner.customer.requirements.readyForPricing, false);
  assert.equal(owner.customer.lead.status, 'AWAITING_REVIEW');
  assert.equal(owner.customer.responseText, 'אין בעיה, נמשיך בלי תמונה. המידות של הארון נשארו להשלמה, והפרטים יעברו עכשיו לבדיקה ותמחור אצל בעל העסק.');
  assert.equal(owner.pricingEvaluation?.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(owner.pricingEvaluation?.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(owner.pricingEvaluation?.suggestedAmount, 425, 'Only the singular large fridge is priced; furniture, 40 boxes and complex stairs stay manual');
  assert.deepEqual(owner.pricingEvaluation?.breakdown.map(part => part.code), ['REFRIGERATOR']);
  assert.equal(owner.pricingEvaluation?.humanApprovalRequired, true);
  const codes = owner.pricingEvaluation!.reviewReasons.map(r => r.code);
  for (const code of ['ITEM_1_DIMENSIONS_UNAVAILABLE', 'ITEM_1_UNSUPPORTED', 'ITEM_2_UNSUPPORTED', 'HIGH_VOLUME']) assert.ok(codes.includes(code), code);
  assert.deepEqual(owner.reviews, []);
  assert.ok(owner.customer.lead.messages.every(m => m.sender !== 'HUMAN'));
  assert.equal(owner.actions.approve, false, 'A partial subtotal needs explicit final whole-job pricing');
  assert.equal(owner.actions.adjust, true);
  assert.equal((await app.post('/owner/pricing', token(owner))).status, 200);
  assert.equal((await app.post('/message', { message: 'תודה' })).status, 200);
  const later = await app.owner();
  assert.equal(later.customer.nextQuestion, null);
  assert.equal(later.customer.lead.moveDetails.items[1].dimensionsAvailable, false);
  assert.equal(later.pricingEvaluation?.humanApprovalRequired, true);
});

test('recommendation is private to owner; GET and calculation alone cannot send a quote', async t => {
  const app = await api(t);
  const owner = await app.sample();
  assert.equal(owner.pricingEvaluation?.suggestedAmount, 900);
  assert.equal(owner.pricingEvaluation?.confidence, 75);
  assert.equal(owner.customer.lead.status, 'AWAITING_REVIEW');
  assert.equal(owner.reviews.length, 0);
  const customer = await app.get<DemoSnapshot>();
  assert.doesNotMatch(JSON.stringify(customer), /suggestedAmount|approvedAmount|inputSnapshot|internalReason|900 ₪|750–1050/);
  assert.deepEqual(customer, owner.customer);
  assert.equal((await app.post('/owner/pricing', token(owner))).status, 200);
  assert.doesNotMatch(JSON.stringify(await app.get()), /suggestedAmount|900 ₪/);
});

test('approve sends exactly the approved quote, retains separate audit amounts, rejects replay', async t => {
  const app = await api(t);
  const initial = await app.sample();
  const response = await app.post('/owner/action', approval(initial));
  assert.equal(response.status, 200);
  const reviewed = await response.json() as OwnerSnapshot;
  assert.equal(reviewed.customer.lead.status, 'QUOTE_SENT');
  assert.equal(reviewed.pricingEvaluation?.suggestedAmount, 900);
  assert.deepEqual([reviewed.reviews[0].suggestedAmount, reviewed.reviews[0].approvedAmount, reviewed.reviews[0].decision], [900, 900, 'APPROVED']);
  assert.ok(reviewed.reviews[0].createdAt);
  const customer = await app.get<DemoSnapshot>();
  assert.match(customer.lead.messages.at(-1)!.text, /900 ₪/);
  assert.match(customer.responseText, /האם לאשר את הצעת המחיר/);
  assert.equal((await app.post('/owner/action', approval(initial))).status, 409);
  assert.equal((await app.post('/owner/action', approval(reviewed))).status, 409);
  assert.equal((await app.get<DemoSnapshot>()).lead.messages.length, customer.lead.messages.length);
});

test('adjusted price goes to customer, recommendation and internal reason remain owner-only', async t => {
  const app = await api(t);
  const initial = await app.sample();
  const response = await app.post('/owner/action', { ...approval(initial), action: 'ADJUST_PRICE', amount: 950, internalReason: 'גישה מורכבת — פנימי' });
  assert.equal(response.status, 200);
  const reviewed = await response.json() as OwnerSnapshot;
  assert.equal(reviewed.reviews[0].suggestedAmount, 900);
  assert.equal(reviewed.reviews[0].approvedAmount, 950);
  assert.equal(reviewed.reviews[0].decision, 'ADJUSTED');
  assert.equal(reviewed.pricingEvaluation?.suggestedAmount, 900);
  assert.equal(reviewed.reviews[0].internalReason, 'גישה מורכבת — פנימי');
  const customer = await app.get<DemoSnapshot>();
  assert.match(customer.responseText, /950 ₪/);
  assert.doesNotMatch(JSON.stringify(customer), /900 ₪|פנימי|internalReason|suggestedAmount/);
});

test('invalid owner commands and amounts cannot modify workflow or inject evaluations', async t => {
  const app = await api(t);
  const initial = await app.sample();
  for (const amount of [0, -1, null, '950', 1.001, Number.MAX_VALUE]) {
    assert.equal((await app.post('/owner/action', { ...approval(initial), action: 'ADJUST_PRICE', amount })).status, 400);
  }
  assert.equal((await app.post('/owner/action', { ...approval(initial), suggestedAmount: 1 })).status, 400);
  assert.equal((await app.post('/owner/action', { ...token(initial), action: 'REQUEST_MORE_INFO', question: ' ' })).status, 400);
  assert.equal((await app.post('/owner/action', { ...approval(initial), pricingEvaluationId: 'old-evaluation' })).status, 409);
  assert.deepEqual(await app.owner(), initial);
  assert.ok(ownerActionSchema.safeParse({ ...approval(initial), action: 'ADJUST_PRICE', amount: 950.29 }).success);
});

test('request information asks the real customer, preserves question context, blocks reuse and allows recalculation', async t => {
  let calls = 0;
  const app = await api(t, input => {
    calls++;
    assert.equal(input.lastQuestion?.text, 'מהי קומת הפריקה המעודכנת?');
    assert.deepEqual(input.lastQuestion?.requirements, []);
    return { moveDetails: { dropoff: { floor: 2 } } };
  });
  const initial = await app.sample();
  const requested = await (await app.post('/owner/action', { ...token(initial), action: 'REQUEST_MORE_INFO', question: 'מהי קומת הפריקה המעודכנת?' })).json() as OwnerSnapshot;
  assert.equal(requested.customer.lead.status, 'COLLECTING_INFORMATION');
  assert.equal(requested.pricingStale, true);
  assert.equal(requested.actions.approve, false);
  assert.equal(requested.actions.recalculate, false);
  assert.equal((await app.get<DemoSnapshot>()).responseText, 'מהי קומת הפריקה המעודכנת?');
  assert.equal((await app.post('/owner/action', approval(requested))).status, 409);
  assert.equal((await app.post('/message', { message: 'קומה 2' })).status, 200);
  assert.equal(calls, 1);
  const stale = await app.owner();
  assert.equal(stale.pendingOwnerQuestion, null);
  assert.equal(stale.pricingStale, true);
  assert.equal(stale.customer.lead.moveDetails.dropoff.floor, 2);
  const fresh = await (await app.post('/owner/pricing', token(stale))).json() as OwnerSnapshot;
  assert.equal(fresh.pricingStale, false);
  assert.equal(fresh.pricingEvaluation?.suggestedAmount, 900);
  assert.notEqual(fresh.pricingEvaluation?.id, initial.pricingEvaluation?.id);
  assert.equal(fresh.pricingHistory.length, 2);
  assert.equal(fresh.reviews[0].decision, 'REQUEST_MORE_INFO');
  assert.equal(fresh.actions.approve, true);
});

test('takeover stops extraction and automated replies while recording customer messages', async t => {
  const app = await api(t);
  const initial = await app.sample();
  const taken = await (await app.post('/owner/action', { ...token(initial), action: 'TAKE_OVER_CONVERSATION' })).json() as OwnerSnapshot;
  assert.equal(taken.customer.lead.status, 'HUMAN_HANDOFF');
  assert.equal(taken.reviews[0].decision, 'HUMAN_HANDOFF');
  assert.match(taken.customer.responseText, /נציג/);
  assert.equal(taken.customer.nextQuestion, null);
  const response = await app.post('/message', { message: 'מחכה לנציג' });
  assert.equal(response.status, 200);
  const customer = await response.json() as DemoSnapshot;
  assert.equal(customer.lead.messages.length, taken.customer.lead.messages.length + 1);
  assert.equal(customer.lead.messages.at(-1)?.sender, 'CUSTOMER');
  assert.equal(customer.lead.status, 'HUMAN_HANDOFF');
  assert.equal((await app.post('/owner/action', approval(await app.owner()))).status, 409);
});

test('customer changes invalidate already approved pricing and block stale owner screens', async t => {
  const app = await api(t, () => ({ moveDetails: { pickup: { address: 'רחוב דוגמה 9' } } }));
  const initial = await app.sample();
  await app.post('/owner/action', approval(initial));
  const customer = await (await app.post('/message', { message: 'שינוי כתובת' })).json() as DemoSnapshot;
  assert.notEqual(customer.lead.status, 'QUOTE_SENT');
  assert.match(customer.responseText, /הצעת המחיר הקודמת דורשת אישור מחדש/);
  const stale = await app.owner();
  assert.equal(stale.pricingStale, true);
  assert.equal(stale.actions.approve, false);
  assert.equal(stale.reviews.length, 1);
  assert.equal((await app.post('/owner/action', approval(stale))).status, 409);
});

test('reset clears all owner state and rejects actions from a previous Lead', async t => {
  const app = await api(t);
  const initial = await app.sample();
  await app.post('/owner/action', approval(initial));
  assert.equal((await app.post('/reset')).status, 200);
  const reset = await app.owner();
  assert.equal(reset.pricingEvaluation, null);
  assert.deepEqual(reset.pricingHistory, []);
  assert.deepEqual(reset.reviews, []);
  assert.equal(reset.pricingStale, false);
  assert.equal(reset.pendingOwnerQuestion, null);
  assert.equal(reset.customer.lead.messages.length, 0);
  assert.equal((await app.post('/owner/action', approval(initial))).status, 409);
});

test('a completed normal customer conversation automatically generates an owner-only evaluation', async t => {
  const app = await api(t, () => ({ moveDetails: {
    items: [{ type: 'refrigerator', quantity: 1, sizeCategory: 'REGULAR', requiresAssembly: false, requiresDisassembly: false }],
    pickup: { city: 'עיר דוגמה', address: 'רחוב דוגמה 1', floor: 0, elevator: false },
    dropoff: { city: 'עיר דוגמה', address: 'רחוב דוגמה 2', floor: 0, elevator: false }, requestedDate: '2026-10-20',
  } }));
  const response = await app.post('/message', { message: 'כל פרטי ההובלה' });
  assert.equal(response.status, 200);
  const customer = await response.json() as DemoSnapshot;
  assert.equal(customer.lead.status, 'AWAITING_REVIEW');
  assert.doesNotMatch(JSON.stringify(customer), /suggestedAmount|approvedAmount/);
  const owner = await app.owner();
  assert.ok(owner.pricingEvaluation);
  assert.equal(owner.reviews.length, 0);
});

test('owner mutations and reset are blocked during extraction; failed extraction preserves review state', async t => {
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const app = await api(t, async () => { started(); await waiting; throw new Error('Synthetic extraction failure'); });
  const initial = await app.sample();
  const message = app.post('/message', { message: 'עדכון' });
  await entered;
  for (const [path, body] of [['/owner/action', approval(initial)], ['/owner/pricing', token(initial)], ['/owner/sample', token(initial)], ['/reset', {}]] as const) {
    assert.equal((await app.post(path, body)).status, 409);
  }
  release();
  assert.equal((await message).status, 502);
  assert.deepEqual(await app.owner(), initial);
});

test('workflow actions do not mutate their input and closed states reject actions', () => {
  const state = sampleOwnerState();
  const before = structuredClone(state);
  const result = applyOwnerAction(state, finalization(ownerSnapshot(state), 950) as Parameters<typeof applyOwnerAction>[1]);
  assert.deepEqual(state, before);
  assert.equal(result.customer.lead.status, 'QUOTE_SENT');
  for (const status of ['WON', 'LOST', 'HUMAN_HANDOFF'] as const) {
    state.customer.lead.status = status;
    const changed = structuredClone(state.customer);
    changed.lead.moveDetails.pickup.address = 'כתובת דוגמה שונה';
    assert.equal(acceptCustomerResult(state, changed).customer.lead.status, status);
    assert.throws(() => applyOwnerAction(state, { ...token(ownerSnapshot(state)), action: 'TAKE_OVER_CONVERSATION' }));
  }
  assert.throws(() => generatePricing(freshOwnerState()));
});

test('null recommendation blocks approve but permits explicit owner pricing; unchanged facts preserve current snapshot', () => {
  let state = sampleOwnerState();
  state.customer.lead.moveDetails.items = state.customer.lead.moveDetails.items.slice(0, 1);
  state.customer.lead.moveDetails.items[0].quantity = null;
  state.pricingContext.inventoryComplete = false;
  state = generatePricing(state);
  assert.equal(state.pricingEvaluation?.suggestedAmount, null);
  assert.equal(ownerSnapshot(state).actions.approve, false);
  assert.equal(ownerSnapshot(state).actions.adjust, true);
  assert.throws(() => applyOwnerAction(state, approval(ownerSnapshot(state)) as Parameters<typeof applyOwnerAction>[1]));
  const result = applyOwnerAction(state, finalization(ownerSnapshot(state), 950) as Parameters<typeof applyOwnerAction>[1]);
  assert.equal(result.reviews[0].suggestedAmount, null);
  const original = sampleOwnerState();
  const after = acceptCustomerResult(original, structuredClone(original.customer));
  assert.equal(after.pricingStale, false);
  assert.equal(after.pricingEvaluation?.id, original.pricingEvaluation?.id);
});

test('synthetic route adapter supplies numeric distance and clears it after a route correction', async t => {
  const app = await api(t, () => ({ moveDetails: { pickup: { address: 'Synthetic changed address' } } }));
  const initial = await app.sample();
  assert.equal(initial.pricingEvaluation?.suggestedAmount, 900);
  assert.equal(initial.pricingEvaluation?.completeness, 'COMPLETE_RECOMMENDATION');
  assert.deepEqual(initial.pricingEvaluation?.priceRange, { min: 750, max: 1050 });
  assert.equal(initial.pricingEvaluation?.inputSnapshot.context.distanceKm, 20);
  assert.equal(initial.demoDistanceKm, 20);
  assert.deepEqual(initial.pricingEvaluation?.breakdown.map(part => part.code), ['REFRIGERATOR', 'BOXES', 'DISTANCE', 'FLOORS']);
  await app.post('/message', { message: 'Changed route' });
  const stale = await app.owner();
  assert.equal(stale.pricingStale, true);
  const updated = await (await app.post('/owner/pricing', token(stale))).json() as OwnerSnapshot;
  assert.equal(updated.pricingEvaluation?.inputSnapshot.context.distanceKm, null);
  assert.equal(updated.demoDistanceKm, null);
  assert.equal(updated.pricingEvaluation?.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(updated.pricingEvaluation?.humanApprovalRequired, true);
});
