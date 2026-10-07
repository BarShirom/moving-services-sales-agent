import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { evaluateRequirements } from '../src/domain/requirements/evaluateRequirements.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import type { AIExtraction } from '../src/integrations/openai/schema.js';
import type { Lead } from '../src/domain/lead.js';
import type { NextQuestion } from '../src/domain/requirements/types.js';

const keep = () => ({ action: 'keep' as const });
const set = <T>(value: T) => ({ action: 'set' as const, value });
const correct = <T>(value: T) => ({ action: 'correct' as const, value });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
function empty(): AIExtraction {
  return { items: [], pickup: location(), dropoff: location(), requestedDate: keep(),
    requestedTime: keep(), specialAccessNotes: keep() };
}
function fridge(patch: Partial<AIExtraction['items'][number]> = {}): AIExtraction['items'][number] {
  return { type: 'refrigerator', quantity: keep(), sizeCategory: keep(),
    photoStatus: keep(), dimensionsAvailable: keep(),
    dimensions: { width: keep(), height: keep(), depth: keep() },
    requiresDisassembly: keep(), requiresAssembly: keep(), ...patch };
}
function readyLead() {
  const lead = createLead();
  lead.moveDetails.items = [createMoveItem('refrigerator'), createMoveItem('box')];
  lead.moveDetails.items[0].sizeCategory = 'LARGE';
  lead.moveDetails.items[1].quantity = 15;
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'סלמה 67', floor: 5, elevator: true };
  lead.moveDetails.requestedDate = '2026-09-25';
  return lead;
}
const photo: NextQuestion = {
  text: 'אפשר לצרף תמונה של המקרר (פריט 1) לבדיקה?',
  requirements: [{ id: 'item.photo', itemIndex: 0 }],
};
const dimensionIds = ['item.width', 'item.height', 'item.depth'];

function wardrobeLead() {
  const lead = readyLead();
  lead.moveDetails.items = [lead.moveDetails.items[0], createMoveItem('wardrobe'), createMoveItem('dresser'),
    { ...createMoveItem('box'), quantity: 40 }];
  lead.moveDetails.dropoff.floor = 3;
  lead.moveDetails.dropoff.elevator = false;
  lead.moveDetails.requestedDate = '2026-10-09';
  return lead;
}

test('wardrobe unavailable dimensions and both services do not loop on the active size question', async () => {
  const lead = wardrobeLead();
  const question = evaluateRequirements(lead).nextQuestion!;
  assert.deepEqual(question.requirements, [{ id: 'item.size', itemIndex: 1 }, { id: 'item.disassembly', itemIndex: 1 }]);
  const data = empty();
  data.items = [fridge({ type: 'wardrobe', dimensionsAvailable: set(false), requiresDisassembly: set(true), requiresAssembly: set(true) })];
  const result = await turn(lead, 'אין לי כרגע את המידות ודרוש פירוק ואחר כך גם הרכבה.', data, question);
  const wardrobe = result.lead.moveDetails.items[1];
  assert.equal(wardrobe.dimensionsAvailable, false);
  assert.equal(wardrobe.requiresDisassembly, true);
  assert.equal(wardrobe.requiresAssembly, true);
  assert.deepEqual(wardrobe.dimensions, { width: null, height: null, depth: null });
  assert.ok(!result.nextQuestion?.requirements.some(ref => ref.itemIndex === 1));
  assert.equal(result.requirements.readyForPricing, false);
  assert.ok(result.requirements.missingRequired.some(ref => ref.id === 'item.size' && ref.itemIndex === 1));
  assert.deepEqual(result.lead.moveDetails, { ...lead.moveDetails, items: lead.moveDetails.items.map((item, i) => i === 1
    ? { ...item, dimensionsAvailable: false, requiresDisassembly: true, requiresAssembly: true } : item) });
  assert.match(result.responseText, /מידות.*כרגע/);
  assert.match(result.responseText, /פירוק.*הרכבה/);
  assert.equal(result.requirements.missingRequired.find(ref => ref.id === 'item.size' && ref.itemIndex === 1)?.availability, 'TEMPORARILY_UNAVAILABLE');
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.photo', itemIndex: 0 }]);
});

test('final manual-review response names pending wardrobe dimensions once and acknowledges the unavailable photo', async () => {
  const lead = wardrobeLead();
  lead.moveDetails.items[1].requiresDisassembly = true;
  lead.moveDetails.items[1].requiresAssembly = true;
  const data = empty();
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE') }),
    fridge({ type: 'wardrobe', dimensionsAvailable: set(false) })];
  const result = await turn(lead, 'אין תמונה של המקרר ואין לי כרגע את המידות של הארון', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.nextQuestion, null);
  assert.equal(result.requirements.readyForPricing, false);
  assert.equal(result.responseText.match(/המידות/gu)?.length, 1);
  assert.match(result.responseText, /אין בעיה, נמשיך בלי תמונה/);
  assert.match(result.responseText, /המידות של הארון נשארו להשלמה, והפרטים יעברו עכשיו לבדיקה ותמחור אצל בעל העסק/);
  assert.doesNotMatch(result.responseText, /פריט 2|נבקש השלמה בהמשך|הפרטים נשמרו/);
  assert.deepEqual(result.lead.moveDetails.items[1], { ...lead.moveDetails.items[1], dimensionsAvailable: false });
  assert.ok(result.requirements.missingRequired.some(requirement =>
    requirement.itemIndex === 1 && requirement.availability === 'TEMPORARILY_UNAVAILABLE' && requirement.status === 'MISSING'));
});

for (const text of ['אין לי כרגע את המידות', 'אני לא יודע את המידות', 'אבדוק את המידות ואעדכן', 'אין לי את המידה עכשיו', 'אבדוק ואעדכן']) {
  test('contextual unavailable wardrobe dimensions: ' + text, async () => {
    const lead = wardrobeLead();
    const data = empty();
    data.items = [fridge({ type: 'wardrobe', dimensionsAvailable: set(false) })];
    const result = await turn(lead, text, data, evaluateRequirements(lead).nextQuestion!);
    assert.equal(result.lead.moveDetails.items[1].dimensionsAvailable, false);
    assert.deepEqual(result.lead.moveDetails.items[1].dimensions, { width: null, height: null, depth: null });
    assert.ok(result.requirements.missingRequired.some(r => r.id === 'item.size' && r.status === 'MISSING' && r.question === null));
    assert.ok(!result.nextQuestion?.requirements.some(r => ['item.size', ...dimensionIds].includes(r.id)));
    assert.equal(result.lead.moveDetails.items[1].requiresAssembly, null);
    assert.equal(result.lead.moveDetails.items[1].requiresDisassembly, null);
    assert.deepEqual(result.lead.moveDetails.items[0], lead.moveDetails.items[0]);
  });
}

test('dimension unavailability persists, retains partial values, and a later offer reopens only missing axes', async () => {
  const lead = wardrobeLead();
  lead.moveDetails.items[1].dimensions.width = 90;
  lead.moveDetails.items[1].requiresDisassembly = true;
  lead.moveDetails.items[1].requiresAssembly = true;
  const unavailable = empty();
  unavailable.items = [fridge({ type: 'wardrobe', dimensionsAvailable: set(false) })];
  let result = await turn(lead, 'אין לי כרגע את שאר המידות', unavailable, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.items[1].dimensions.width, 90);
  assert.equal(result.requirements.requirements.find(r => r.id === 'item.width' && r.itemIndex === 1)?.status, 'SATISFIED');
  assert.ok(result.requirements.missingRequired.some(r => r.id === 'item.height' && r.availability === 'TEMPORARILY_UNAVAILABLE'));
  result = await turn(result.lead, 'תודה', empty(), result.nextQuestion!);
  assert.ok(!result.nextQuestion?.requirements.some(r => r.itemIndex === 1));
  const offer = empty();
  offer.items = [fridge({ type: 'wardrobe', dimensionsAvailable: correct(true) })];
  result = await turn(result.lead, 'עכשיו יש לי את המידות של הארון', offer, result.nextQuestion!);
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.height', itemIndex: 1 }, { id: 'item.depth', itemIndex: 1 }]);
  assert.ok(!result.requirements.requirements.some(r => r.itemIndex === 1 && r.availability));
  const measurements = empty();
  measurements.items = [fridge({ type: 'wardrobe', dimensions: { width: keep(), height: set(200), depth: set(60) } })];
  result = await turn(result.lead, 'הארון גובה 200 ועומק 60', measurements, result.nextQuestion!);
  assert.deepEqual(result.lead.moveDetails.items[1].dimensions, { width: 90, height: 200, depth: 60 });
  assert.equal(result.requirements.requirements.find(r => r.id === 'item.size' && r.itemIndex === 1)?.status, 'SATISFIED');
  assert.ok(!result.nextQuestion?.requirements.some(r => r.itemIndex === 1));
});

test('an unrelated unknown fact never globally defers wardrobe dimensions or invents availability', async () => {
  const lead = wardrobeLead();
  const question = evaluateRequirements(lead).nextQuestion!;
  const result = await turn(lead, 'אני לא יודע מה מזג האוויר', empty(), question);
  assert.deepEqual(result.nextQuestion, question);
  assert.deepEqual(result.lead.moveDetails, lead.moveDetails);
});

test('disassembly-only structured extraction leaves assembly unknown and asks its relevant question', async () => {
  const lead = wardrobeLead();
  lead.moveDetails.items[1].dimensionsAvailable = false;
  const data = empty();
  data.items = [fridge({ type: 'wardrobe', requiresDisassembly: set(true) })];
  const result = await turn(lead, 'נדרש פירוק', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.items[1].requiresDisassembly, true);
  assert.equal(result.lead.moveDetails.items[1].requiresAssembly, null);
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.assembly', itemIndex: 1 }]);
  assert.ok(result.requirements.missingRequired.some(requirement => requirement.id === 'item.assembly' && requirement.itemIndex === 1));
  assert.deepEqual(result.lead.moveDetails.pickup, lead.moveDetails.pickup);
  assert.deepEqual(result.lead.moveDetails.dropoff, lead.moveDetails.dropoff);
});

test('unsupported dresser still allows photo collection and an unavailable reply never loops', async () => {
  const lead = readyLead();
  lead.moveDetails.items.push({ ...createMoveItem('dresser'), sizeCategory: 'SMALL' });
  const result = await turn(lead, 'כל הפרטים נכונים', empty());
  assert.deepEqual(result.nextQuestion?.requirements, photo.requirements);
  const unavailable = await processCustomerMessageWithExtractor(result.lead, 'אין לי תמונה', {
    lastQuestion: result.nextQuestion!, referenceDate: '2026-10-07',
    extractor: () => assert.fail('An unambiguous photo decline uses the existing contextual reply path'),
  });
  assert.equal(unavailable.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(unavailable.nextQuestion, null);
  assert.match(unavailable.acknowledgement!, /נמשיך בלי תמונה/);
  assert.equal(unavailable.requirements.pendingReview.find(requirement => requirement.id === 'item.photo')?.status, 'MISSING');
  assert.ok(unavailable.requirements.missingRequired.some(requirement => requirement.id === 'item.support'));
  const repeated = await turn(unavailable.lead, 'תודה', empty());
  assert.equal(repeated.nextQuestion, null);
  assert.doesNotMatch(repeated.responseText, /אפשר לצרף תמונה/);
  assert.deepEqual(repeated.lead.moveDetails, unavailable.lead.moveDetails);
});

// Offline model fixtures verify context, strict conversion, merge and response selection;
// they do not measure the live model's Hebrew accuracy.
async function turn(lead: Lead, text: string, data: AIExtraction, lastQuestion?: NextQuestion) {
  const before = structuredClone(lead);
  let calls = 0;
  const extractor = createAIExtractor({ request: async request => {
    calls++;
    assert.ok(Array.isArray(request.input));
    const message = request.input[0];
    assert.ok('content' in message && typeof message.content === 'string');
    const context = JSON.parse(message.content);
    assert.equal(context.latestCustomerMessage, text);
    assert.deepEqual(context.currentLead.moveDetails, before.moveDetails);
    assert.deepEqual(context.lastQuestion, lastQuestion ?? null);
    return { status: 'completed', output: [], output_parsed: data };
  } });
  const result = await processCustomerMessageWithExtractor(lead, text, {
    extractor, lastQuestion, referenceDate: '2026-09-20',
  });
  assert.equal(calls, 1, 'compound replies are extracted in full; response composition makes no second call');
  assert.deepEqual(lead, before);
  assert.equal(result.lead.messages.at(-1)?.text, text);
  assert.deepEqual(result.nextQuestion, result.requirements.nextQuestion);
  return result;
}

for (const text of ['אין לי כרגע, אבל יש לי את המידות', 'אין לי תמונה אבל יש מידות']) {
  test('photo decline plus dimensions offer: ' + text, async () => {
    const lead = readyLead();
    const data = empty();
    data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'), dimensionsAvailable: set(true) })];
    const result = await turn(lead, text, data, photo);
    const item = result.lead.moveDetails.items[0];
    assert.equal(item.photoStatus, 'NOT_AVAILABLE');
    assert.equal(item.dimensionsAvailable, true);
    assert.deepEqual(item.dimensions, { width: null, height: null, depth: null });
    assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), dimensionIds);
    assert.match(result.responseText, /אין בעיה, המידות יעזרו/);
    assert.match(result.responseText, /הרוחב, הגובה והעומק/);
    assert.doesNotMatch(result.responseText, /אפשר לצרף תמונה/);
    assert.equal(result.requirements.readyForPricing, true, 'offering optional dimensions does not change pricing policy');
    assert.ok(result.requirements.pendingReview.some(r => r.id === 'item.photo' && r.question === null));
    assert.deepEqual(result.lead.moveDetails.pickup, lead.moveDetails.pickup);
    assert.deepEqual(result.lead.moveDetails.dropoff, lead.moveDetails.dropoff);
    assert.deepEqual(result.lead.moveDetails.items[1], lead.moveDetails.items[1]);
  });
}

test('offered measurements persist across unrelated turns and complete without a photo loop', async () => {
  const data = empty();
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'), dimensionsAvailable: set(true) })];
  let result = await turn(readyLead(), 'אין לי כרגע, אבל יש לי את המידות', data, photo);
  const offeredLead = structuredClone(result.lead);
  const extra = empty();
  extra.requestedTime = set('18:00');
  result = await turn(result.lead, 'בשעה 18:00', extra, result.nextQuestion!);
  assert.equal(result.lead.moveDetails.items[0].dimensionsAvailable, true);
  assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), dimensionIds);
  const width = empty();
  width.items = [fridge({ dimensions: { width: set(70), height: keep(), depth: keep() } })];
  result = await turn(result.lead, 'בערך 70 רוחב', width, result.nextQuestion!);
  assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), ['item.height', 'item.depth']);
  assert.doesNotMatch(result.responseText, /הרוחב|תמונה/);
  const remaining = empty();
  remaining.items = [fridge({ dimensions: { width: keep(), height: set(180), depth: set(70) } })];
  result = await turn(result.lead, 'גובה 180 ס"מ ועומק 70', remaining, result.nextQuestion!);
  assert.deepEqual(result.lead.moveDetails.items[0].dimensions, { width: 70, height: 180, depth: 70 });
  assert.equal(result.nextQuestion, null);
  assert.match(result.responseText, /המידות התקבלו.*בדיקה ותמחור/);
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(result.lead.moveDetails.requestedTime, '18:00');
  assert.equal(result.lead.moveDetails.requestedDate, offeredLead.moveDetails.requestedDate);
  result = await turn(result.lead, 'תודה', empty());
  assert.equal(result.nextQuestion, null);
  assert.doesNotMatch(result.responseText, /אפשר לצרף|אפשר לשלוח/);
});

for (const text of [
  'אין לי תמונה, רוחב 70 גובה 180 עומק 70',
  'אין לי תמונה, המקרר 70 רוחב, 180 גובה, 70 עומק',
]) {
  test('photo refusal and complete measurements are merged together: ' + text, async () => {
    const data = empty();
    data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'),
      dimensions: { width: set(70), height: set(180), depth: set(70) } })];
    const result = await turn(readyLead(), text, data, photo);
    assert.deepEqual(result.lead.moveDetails.items[0].dimensions, { width: 70, height: 180, depth: 70 });
    assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
    assert.equal(result.nextQuestion, null);
    assert.match(result.responseText, /המידות התקבלו.*בדיקה ותמחור/);
    assert.doesNotMatch(result.responseText, /אפשר לצרף|אפשר לשלוח/);
  });
}

for (const [text, patch] of [
  ['גובה 180 ס"מ', { height: 180 }],
  ['גובה 1.8 מטר', { height: 180 }],
  ['רוחב 700 מ"מ', { width: 70 }],
  ['בערך 70 רוחב', { width: 70 }],
  ['70 על 70 על 180 בסדר רוחב, עומק, גובה', { width: 70, height: 180, depth: 70 }],
] as const) {
  test('centimeter-normalized dimension fixture: ' + text, async () => {
    const lead = readyLead();
    lead.moveDetails.items[0].dimensionsAvailable = true;
    lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
    const data = empty();
    const dimensions = { width: keep(), height: keep(), depth: keep() } as AIExtraction['items'][number]['dimensions'];
    for (const [axis, value] of Object.entries(patch)) dimensions[axis as keyof typeof dimensions] = set(value);
    data.items = [fridge({ dimensions })];
    const result = await turn(lead, text, data, evaluateRequirements(lead).nextQuestion!);
    assert.deepEqual(result.lead.moveDetails.items[0].dimensions,
      { ...lead.moveDetails.items[0].dimensions, ...patch });
    for (const axis of Object.keys(patch)) {
      assert.ok(!result.nextQuestion?.requirements.some(r => r.id === 'item.' + axis));
    }
  });
}

test('an unlabelled triple never invents axes or clears the outstanding offer', async () => {
  const lead = readyLead();
  lead.moveDetails.items[0].dimensionsAvailable = true;
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  const result = await turn(lead, '70 על 70 על 180', empty(), evaluateRequirements(lead).nextQuestion!);
  assert.deepEqual(result.lead.moveDetails.items[0].dimensions, { width: null, height: null, depth: null });
  assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), dimensionIds);
});

test('offered dimensions with no size classification ask axes rather than the size category again', async () => {
  const lead = readyLead();
  lead.moveDetails.items[0].sizeCategory = null;
  const data = empty();
  data.items = [fridge({ dimensionsAvailable: set(true) })];
  const result = await turn(lead, 'יש לי את המידות של המקרר', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.requirements.readyForPricing, false);
  assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), dimensionIds);
});

test('withdrawing an optional dimensions offer retains actual measurements and avoids another loop', async () => {
  const lead = readyLead();
  const item = lead.moveDetails.items[0];
  item.dimensionsAvailable = true;
  item.photoStatus = 'NOT_AVAILABLE';
  item.dimensions.width = 70;
  const data = empty();
  data.items = [fridge({ dimensionsAvailable: correct(false) })];
  const result = await turn(lead, 'בסוף אין לי את שאר המידות', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.items[0].dimensionsAvailable, false);
  assert.equal(result.lead.moveDetails.items[0].dimensions.width, 70);
  assert.equal(result.nextQuestion, null);
});

test('address reply captures extra floor and elevator facts and skips both questions', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff = { city: 'תל אביב', address: null, floor: null, elevator: null };
  const data = empty();
  data.dropoff = { city: keep(), address: set('סלמה 67'), floor: set(5), elevator: set(true) };
  const question: NextQuestion = { text: 'מה כתובת הפריקה?', requirements: [{ id: 'dropoff.address' }] };
  const result = await turn(lead, 'סלמה 67, קומה 5 ויש מעלית', data, question);
  assert.deepEqual(result.lead.moveDetails.dropoff, readyLead().moveDetails.dropoff);
  assert.match(result.acknowledgement!, /קיבלתי/);
  assert.doesNotMatch(result.responseText, /באיזו קומה|האם יש מעלית|מה הכתובת/);
  assert.deepEqual(result.nextQuestion?.requirements, photo.requirements);
});

test('address and a date supplied early are retained and not asked again', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff = { city: 'תל אביב', address: null, floor: null, elevator: null };
  lead.moveDetails.requestedDate = null;
  const data = empty();
  data.dropoff = { city: keep(), address: set('סלמה 67'), floor: set(5), elevator: set(true) };
  data.requestedDate = set('25/09');
  const result = await turn(lead, 'סלמה 67 קומה 5 עם מעלית, וזה ל-25/09', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.requestedDate, '2026-09-25');
  assert.deepEqual(result.lead.moveDetails.dropoff, readyLead().moveDetails.dropoff);
  assert.match(result.acknowledgement!, /קיבלתי/);
  assert.doesNotMatch(result.responseText, /באיזו קומה|האם יש מעלית|מה הכתובת/);
  assert.deepEqual(result.nextQuestion?.requirements, photo.requirements);
});

test('a partial grouped answer asks only for the remaining floor', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff.address = null;
  lead.moveDetails.dropoff.floor = null;
  const data = empty();
  data.dropoff.address = set('סלמה 67');
  const result = await turn(lead, 'סלמה 67', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.dropoff.address, 'סלמה 67');
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'dropoff.floor' }]);
  assert.doesNotMatch(result.responseText, /כתובת|מעלית/);
});

test('correction while answering a photo request changes only the corrected floor', async () => {
  const lead = readyLead();
  const data = empty();
  data.pickup.floor = correct(3);
  const result = await turn(lead, 'טעיתי, האיסוף הוא מקומה 3', data, photo);
  assert.deepEqual(result.lead.moveDetails, {
    ...lead.moveDetails, pickup: { ...lead.moveDetails.pickup, floor: 3 },
  });
});

test('decline, alternative and unrelated correction in one message all survive extraction', async () => {
  const lead = readyLead();
  const data = empty();
  data.pickup.floor = correct(3);
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'), dimensionsAvailable: set(true) })];
  const result = await turn(lead, 'אין לי תמונה אבל יש מידות. טעיתי, האיסוף הוא מקומה 3', data, photo);
  assert.equal(result.lead.moveDetails.pickup.floor, 3);
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(result.lead.moveDetails.items[0].dimensionsAvailable, true);
  assert.deepEqual(result.lead.moveDetails.dropoff, lead.moveDetails.dropoff);
  assert.deepEqual(result.nextQuestion?.requirements.map(r => r.id), dimensionIds);
});

test('photo unavailability outside the active photo question uses the explicitly identified item', async () => {
  const lead = readyLead();
  lead.moveDetails.requestedDate = null;
  const data = empty();
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE') })];
  const result = await turn(lead, 'אין לי תמונה של המקרר', data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'requestedDate' }]);
  assert.match(result.responseText, /נמשיך בלי תמונה/);
});

test('ambiguous same-type item availability updates remain unapplied while clear corrections survive', async () => {
  const lead = readyLead();
  lead.moveDetails.items.push(createMoveItem('refrigerator'));
  const data = empty();
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'), dimensionsAvailable: set(true) })];
  data.pickup.floor = correct(3);
  const result = await turn(lead, 'אין תמונה, יש מידות. האיסוף בעצם בקומה 3', data);
  assert.equal(result.unappliedItems.length, 1);
  assert.deepEqual(result.lead.moveDetails.items, lead.moveDetails.items);
  assert.equal(result.lead.moveDetails.pickup.floor, 3);
  assert.match(result.acknowledgement!, /עדכנתי.*קומת האיסוף.*3/);
  assert.doesNotMatch(result.acknowledgement!, /מידות|תמונה/);
});

test('availability never erases received photos and invalid measurements reject the entire update', async () => {
  for (const received of [false, true]) {
    const lead = readyLead();
    if (received) lead.moveDetails.items[0].photoStatus = 'RECEIVED';
    const before = structuredClone(lead);
    const data = empty();
    data.pickup.floor = correct(3);
    data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'),
      dimensions: { width: received ? keep() : set(-70), height: keep(), depth: keep() } })];
    const extractor = createAIExtractor({ request: async () => ({ status: 'completed', output: [], output_parsed: data }) });
    await assert.rejects(processCustomerMessageWithExtractor(lead, 'אין לי תמונה, רוחב מינוס 70', { extractor }),
      (error: unknown) => error instanceof AIExtractionError && error.code === 'INVALID_EXTRACTION');
    assert.deepEqual(lead, before);
  }
});

test('a correction is acknowledged before the next missing date question', async () => {
  const lead = readyLead();
  lead.moveDetails.requestedDate = null;
  const data = empty();
  data.pickup.floor = correct(3);
  const result = await turn(lead, 'טעיתי, האיסוף הוא מקומה 3', data, evaluateRequirements(lead).nextQuestion!);
  assert.match(result.acknowledgement!, /עדכנתי.*קומת האיסוף.*3/);
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'requestedDate' }]);
  assert.equal(result.responseText, `${result.acknowledgement} ${result.nextQuestion!.text}`);
  assert.deepEqual(result.lead.moveDetails, { ...lead.moveDetails, pickup: { ...lead.moveDetails.pickup, floor: 3 } });
});

test('complete measurements and a floor correction both receive acknowledgement before review', async () => {
  const lead = readyLead();
  const data = empty();
  data.dropoff.floor = correct(4);
  data.items = [fridge({ photoStatus: set('NOT_AVAILABLE'),
    dimensions: { width: set(70), height: set(180), depth: set(68) } })];
  const result = await turn(lead, 'אין לי תמונה, גובה 180, רוחב 70 ועומק 68. טעיתי, הפריקה בקומה 4.', data, photo);
  assert.match(result.acknowledgement!, /מידות.*התקבלו/);
  assert.match(result.acknowledgement!, /עדכנתי.*קומת הפריקה.*4/);
  assert.match(result.responseText, /בדיקה ותמחור.*צוות/);
  assert.equal(result.nextQuestion, null);
  assert.equal(result.lead.moveDetails.dropoff.floor, 4);
  assert.deepEqual(result.lead.moveDetails.items[0].dimensions, { width: 70, height: 180, depth: 68 });
  assert.deepEqual(result.lead.moveDetails.pickup, lead.moveDetails.pickup);
  assert.deepEqual(result.lead.moveDetails.items[1], lead.moveDetails.items[1]);
});

test('a claimed correction with no applied change receives no correction acknowledgement', async () => {
  const result = await turn(readyLead(), 'טעיתי בפרטים', empty(), photo);
  assert.equal(result.acknowledgement, undefined);
  assert.deepEqual(result.nextQuestion?.requirements, photo.requirements);
});

test('stair carry acknowledgement retains elevator availability and does not re-ask known access facts', async () => {
  const lead = readyLead();
  const data = empty();
  data.dropoff.elevator = set(true);
  data.specialAccessNotes = set('בפריקה יש מעלית אך המקרר לא נכנס בה ונדרשת נשיאה במדרגות');
  const result = await turn(lead, 'יש מעלית אבל המקרר לא נכנס בה, צריך להעלות אותו במדרגות', data,
    { text: 'האם יש קשיי גישה בפריקה?', requirements: [{ id: 'specialAccessNotes' }] });
  assert.equal(result.lead.moveDetails.dropoff.elevator, true);
  assert.match(result.acknowledgement!, /נשיאה במדרגות/);
  assert.equal(result.responseText, `${result.acknowledgement} ${result.nextQuestion!.text}`);
  assert.deepEqual(result.nextQuestion?.requirements, photo.requirements);
  assert.deepEqual(result.lead.moveDetails, { ...lead.moveDetails,
    specialAccessNotes: 'בפריקה יש מעלית אך המקרר לא נכנס בה ונדרשת נשיאה במדרגות' });
  const repeated = await turn(result.lead, 'תודה', empty(), result.nextQuestion!);
  assert.equal(repeated.acknowledgement, undefined, 'old access notes are not acknowledged on unrelated turns');
});

for (const text of ['אני לא יודע כרגע, אבדוק ואעדכן', 'אבדוק ואעדכן']) {
  test('unknown floor stays missing without an immediate question loop: ' + text, async () => {
    const lead = readyLead();
    lead.moveDetails.dropoff.floor = null;
    const question = evaluateRequirements(lead).nextQuestion!;
    const result = await turn(lead, text, empty(), question);
    assert.match(result.acknowledgement!, /כשתדע/);
    assert.equal(result.responseText, result.acknowledgement);
    assert.equal(result.nextQuestion, null);
    assert.equal(result.requirements.readyForPricing, false);
    assert.equal(result.lead.status, 'COLLECTING_INFORMATION');
    assert.ok(result.requirements.missingRequired.some(ref => ref.id === 'dropoff.floor'));
    assert.deepEqual(result.lead.moveDetails, lead.moveDetails);
    assert.deepEqual(evaluateRequirements(result.lead).nextQuestion, question, 'deferral does not change persistent requirements');
    const next = await turn(result.lead, 'אפשר להמשיך', empty());
    assert.deepEqual(next.nextQuestion, question, 'the deferral lasts only one response');
    const data = empty();
    data.dropoff.floor = set(4);
    const confirmed = await turn(result.lead, 'בדקתי, הפריקה בקומה 4', data);
    assert.equal(confirmed.lead.moveDetails.dropoff.floor, 4);
    assert.deepEqual(confirmed.nextQuestion?.requirements, photo.requirements);
  });
}

test('will-check replies still merge extra facts and corrections before selecting another missing requirement', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff.floor = null;
  lead.moveDetails.dropoff.address = null;
  lead.moveDetails.requestedDate = null;
  const data = empty();
  data.dropoff.address = set('רחוב דוגמה ב 12');
  data.pickup.floor = correct(3);
  const result = await turn(lead, 'הכתובת רחוב דוגמה ב 12. את הקומה אבדוק ואעדכן. טעיתי, האיסוף קומה 3.',
    data, evaluateRequirements(lead).nextQuestion!);
  assert.equal(result.lead.moveDetails.dropoff.address, 'רחוב דוגמה ב 12');
  assert.equal(result.lead.moveDetails.dropoff.floor, null);
  assert.equal(result.lead.moveDetails.pickup.floor, 3);
  assert.match(result.acknowledgement!, /עדכנתי.*קומת האיסוף.*3/);
  assert.match(result.acknowledgement!, /כשתדע/);
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'requestedDate' }]);
  assert.doesNotMatch(result.responseText, /באיזו קומה|מה הכתובת/);
  assert.ok(result.requirements.missingRequired.some(ref => ref.id === 'dropoff.floor'));
  assert.deepEqual(result.lead.moveDetails.items, lead.moveDetails.items);
});

test('deferral applies only to the asked item and leaves another item measurement askable', async () => {
  const lead = readyLead();
  lead.moveDetails.items[0].dimensionsAvailable = true;
  lead.moveDetails.items[0].dimensions = { width: null, height: 180, depth: 68 };
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  const second = createMoveItem('refrigerator');
  second.sizeCategory = 'LARGE';
  second.dimensionsAvailable = true;
  second.dimensions = { width: null, height: 170, depth: 60 };
  second.photoStatus = 'NOT_AVAILABLE';
  lead.moveDetails.items.push(second);
  const question = evaluateRequirements(lead).nextQuestion!;
  assert.deepEqual(question.requirements, [{ id: 'item.width', itemIndex: 0 }]);
  const result = await turn(lead, 'אבדוק ואעדכן', empty(), question);
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.width', itemIndex: 2 }]);
  assert.deepEqual(result.lead.moveDetails, lead.moveDetails);
  assert.ok(result.requirements.pendingReview.some(ref => ref.id === 'item.width' && ref.itemIndex === 0));
});

test('an ordinary unanswered question and a will-check message without question context are not deferred', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff.floor = null;
  const question = evaluateRequirements(lead).nextQuestion!;
  const unanswered = await turn(lead, 'שלום', empty(), question);
  assert.deepEqual(unanswered.nextQuestion, question);
  assert.equal(unanswered.acknowledgement, undefined);
  const noContext = await turn(lead, 'אבדוק ואעדכן', empty());
  assert.deepEqual(noContext.nextQuestion, question);
  assert.equal(noContext.acknowledgement, undefined);
});
