import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { normalizeRequestedDate } from '../src/domain/extraction/normalizeRequestedDate.js';
import { israelReferenceDate } from '../src/config/referenceDate.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { applyUnavailablePhotoReply } from '../src/domain/conversation/photoReply.js';
import { evaluateRequirements } from '../src/domain/requirements/evaluateRequirements.js';
import { createAIExtractor } from '../src/integrations/openai/extractMessageWithAI.js';
import { convertAIExtraction } from '../src/integrations/openai/convertExtraction.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import type { AIExtraction } from '../src/integrations/openai/schema.js';
import type { NextQuestion } from '../src/domain/requirements/types.js';

function readyLead(date: string | null = '2026-09-16') {
  const lead = createLead();
  const fridge = createMoveItem('refrigerator');
  fridge.sizeCategory = 'LARGE';
  const boxes = createMoveItem('box');
  boxes.quantity = 15;
  lead.moveDetails.items = [fridge, boxes];
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'רוטשילד 1', floor: 1, elevator: false };
  lead.moveDetails.requestedDate = date;
  return lead;
}
const photoQuestion: NextQuestion = { text: 'אפשר לצרף תמונה של המקרר (פריט 1) לבדיקה?', requirements: [{ id: 'item.photo', itemIndex: 0 }] };
const keep = () => ({ action: 'keep' as const });
function dateOutput(value: string): AIExtraction {
  return {
    items: [], pickup: { city: keep(), address: keep(), floor: keep(), elevator: keep() },
    dropoff: { city: keep(), address: keep(), floor: keep(), elevator: keep() },
    requestedDate: { action: 'set', value }, requestedTime: keep(), specialAccessNotes: keep(),
  };
}

for (const input of ['16/09', '16/09/2026', '16.09', '16.09.2026']) {
  test(`${input} normalizes through the AI boundary and progresses from date to photo`, async () => {
    const lead = readyLead(null);
    const before = structuredClone(lead);
    const question = evaluateRequirements(lead).nextQuestion!;
    const extractor = createAIExtractor({ request: async request => {
      assert.ok(Array.isArray(request.input));
      const message = request.input[0];
      assert.ok('content' in message && typeof message.content === 'string');
      const context = JSON.parse(message.content);
      assert.equal(context.referenceDate, '2026-09-15');
      assert.equal(context.latestCustomerMessage, input);
      assert.equal(context.lastQuestion.requirements[0].id, 'requestedDate');
      return { status: 'completed', output: [], output_parsed: dateOutput(input) };
    } });
    const result = await processCustomerMessageWithExtractor(lead, input, {
      extractor, lastQuestion: question, referenceDate: '2026-09-15',
    });
    assert.deepEqual(lead, before);
    assert.equal(result.lead.moveDetails.requestedDate, '2026-09-16');
    assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.photo', itemIndex: 0 }]);
    assert.equal(result.requirements.readyForPricing, true);
    assert.equal(result.responseText, result.nextQuestion?.text);
    assert.ok(!result.requirements.missingRequired.some(requirement => requirement.id === 'requestedDate'));
  });
}

for (const [value, reference, expected] of [
  ['16/09', '2026-09-16', '2026-09-16'],
  ['16/09', '2026-09-17', '2027-09-16'],
  ['01/01', '2026-12-31', '2027-01-01'],
  ['31.12', '2026-12-31', '2026-12-31'],
  ['16/09/2025', '2026-09-15', '2025-09-16'],
  ['29/02', '2027-03-01', '2028-02-29'],
  ['29.02.2028', '2026-01-01', '2028-02-29'],
  ['2026-09-16', '2026-09-15', '2026-09-16'],
]) {
  test(`date policy ${value} relative to ${reference} gives ${expected}`, () => {
    assert.equal(normalizeRequestedDate(value, reference), expected);
  });
}

test('missing reference leaves a yearless date unresolved while explicit full dates work', () => {
  assert.equal(normalizeRequestedDate('16/09'), undefined);
  assert.deepEqual(convertAIExtraction(dateOutput('16/09'), readyLead(null)), {});
  assert.equal(normalizeRequestedDate('16/09/2026'), '2026-09-16');
});

test('invalid calendar dates, mixed separators, unsupported relative dates, and non-leap selected years are rejected', () => {
  for (const value of ['31/04', '31.04.2026', '29/02/2026', '29/02', '16/09.2026', '16/09/26', '32/09', 'מחר']) {
    assert.throws(() => normalizeRequestedDate(value, '2026-01-01'), RangeError);
    assert.throws(() => convertAIExtraction(dateOutput(value), readyLead(null), { referenceDate: '2026-01-01' }),
      (error: unknown) => error instanceof AIExtractionError && error.code === 'INVALID_EXTRACTION');
  }
  assert.throws(() => normalizeRequestedDate('16/09', '2026-02-30'), RangeError);
});

test('normalized date updates retain correction semantics', () => {
  const lead = readyLead();
  assert.equal(convertAIExtraction(dateOutput('16/09/2026'), lead).moveDetails?.requestedDate, '2026-09-16');
  assert.throws(() => convertAIExtraction(dateOutput('17/09/2026'), lead), AIExtractionError);
  const corrected = dateOutput('17/09');
  corrected.requestedDate = { action: 'correct', value: '17/09' };
  assert.equal(convertAIExtraction(corrected, lead, { referenceDate: '2026-09-15' }).moveDetails?.requestedDate, '2026-09-17');
});

test('application reference date follows Jerusalem midnight rather than UTC or host locale', () => {
  assert.equal(israelReferenceDate(new Date('2026-09-15T20:59:00Z')), '2026-09-15');
  assert.equal(israelReferenceDate(new Date('2026-09-15T21:01:00Z')), '2026-09-16');
});

for (const reply of ['אין', 'אין לי', 'אין תמונה', 'אין לי תמונה', 'לא', 'לא כרגע']) {
  test(`photo request followed by ${reply} updates availability, acknowledges and never repeats`, async () => {
    const lead = readyLead();
    const before = structuredClone(lead);
    const result = await processCustomerMessageWithExtractor(lead, reply, {
      lastQuestion: photoQuestion,
      extractor: () => { assert.fail('A precise negative photo answer needs no AI call'); },
    });
    assert.deepEqual(lead, before);
    assert.equal(result.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
    assert.equal(result.lead.moveDetails.items[1].photoStatus, 'NOT_APPLICABLE');
    assert.equal(result.nextQuestion, null);
    assert.match(result.acknowledgement!, /נמשיך בלי תמונה/);
    assert.equal(result.responseText, `${result.acknowledgement} יש לי את הפרטים הדרושים. השלב הבא הוא בדיקה ותמחור על ידי הצוות.`);
    assert.doesNotMatch(result.responseText, /אפשר לצרף/);
    assert.equal(result.lead.status, 'READY_FOR_PRICING');
    assert.equal(result.requirements.pendingReview.length, 1);
    assert.equal(result.requirements.pendingReview[0].question, null);
    assert.equal(result.requirements.pendingReview[0].status, 'MISSING');
  });
}

test('photo acknowledgement is combined with the next missing pricing question', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff.elevator = null;
  const result = await processCustomerMessageWithExtractor(lead, 'אין', { lastQuestion: photoQuestion, extractor: () => ({}) });
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'dropoff.elevator' }]);
  assert.equal(result.responseText, `${result.acknowledgement} ${result.nextQuestion?.text}`);
});

test('photo acknowledgement advances to another pending item photo without changing it', async () => {
  const lead = readyLead();
  const second = createMoveItem('refrigerator');
  second.sizeCategory = 'REGULAR';
  lead.moveDetails.items.push(second);
  const result = await processCustomerMessageWithExtractor(lead, 'אין', { lastQuestion: photoQuestion, extractor: () => ({}) });
  assert.deepEqual(result.nextQuestion?.requirements, [{ id: 'item.photo', itemIndex: 2 }]);
  assert.equal(result.lead.moveDetails.items[2].photoStatus, 'REQUIRED');
  assert.equal(result.responseText, `${result.acknowledgement} ${result.nextQuestion?.text}`);
});

test('a random לא outside the photo question never changes photo availability', async () => {
  const lead = readyLead();
  lead.moveDetails.dropoff.elevator = null;
  const result = await processCustomerMessageWithExtractor(lead, 'לא', {
    lastQuestion: { text: 'האם יש מעלית בכתובת הפריקה?', requirements: [{ id: 'dropoff.elevator' }] },
    extractor: () => ({ moveDetails: { dropoff: { elevator: false } } }),
  });
  assert.equal(result.lead.moveDetails.dropoff.elevator, false);
  assert.equal(result.lead.moveDetails.items[0].photoStatus, 'REQUIRED');
  assert.equal(result.acknowledgement, undefined);
  assert.equal(applyUnavailablePhotoReply(lead, 'לא'), undefined);
});

test('uncertain, multi-fact, malformed-context and already-received photo replies are not forced into unavailable', () => {
  const lead = readyLead();
  for (const reply of ['אין?', 'אולי אין לי', 'אין תמונה, והכתובת השתנתה', 'יש לי תמונה']) {
    assert.equal(applyUnavailablePhotoReply(lead, reply, photoQuestion), undefined);
  }
  for (const itemIndex of [-1, 20, 0.5]) {
    assert.equal(applyUnavailablePhotoReply(lead, 'אין', { text: '', requirements: [{ id: 'item.photo', itemIndex }] }), undefined);
  }
  lead.moveDetails.items[0].photoStatus = 'RECEIVED';
  assert.equal(applyUnavailablePhotoReply(lead, 'אין', photoQuestion), undefined);
});

test('later messages retain unavailable photo state and still receive a backend response', async () => {
  const lead = readyLead();
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  const result = await processCustomerMessageWithExtractor(lead, 'תודה', { extractor: () => ({}) });
  assert.equal(result.nextQuestion, null);
  assert.ok(result.responseText.length > 0);
  assert.doesNotMatch(result.responseText, /אפשר לצרף/);
});

test('a blocked unsupported item still receives a human-review response when no question is available', async () => {
  const lead = readyLead();
  lead.moveDetails.items = [createMoveItem('washing_machine')];
  const result = await processCustomerMessageWithExtractor(lead, 'תודה', { extractor: () => ({}) });
  assert.equal(result.nextQuestion, null);
  assert.equal(result.requirements.readyForPricing, false);
  assert.match(result.responseText, /נדרשת בדיקה של הצוות/);
});
