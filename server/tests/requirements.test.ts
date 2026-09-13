import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import type { Lead } from '../src/domain/lead.js';
import { evaluateRequirements, updateLeadReadiness } from '../src/domain/requirements/evaluateRequirements.js';
import type { RequirementContext, RequirementId } from '../src/domain/requirements/types.js';

function completeLead(): Lead {
  const lead = createLead();
  const item = createMoveItem('refrigerator');
  item.sizeCategory = 'standard';
  lead.moveDetails.items.push(item);
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'הרצל 10', floor: 0, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'דיזנגוף 20', floor: 2, elevator: true };
  lead.moveDetails.requestedDate = '2026-10-01';
  return lead;
}

function result(lead: Lead, id: RequirementId, context: RequirementContext = {}, itemIndex?: number) {
  const found = evaluateRequirements(lead, context).requirements.find(
    requirement => requirement.id === id && requirement.itemIndex === itemIndex,
  );
  assert.ok(found, `Expected requirement ${id}`);
  return found;
}

test('empty lead requests items first without mutating or storing derived requirements', () => {
  const lead = createLead();
  const before = structuredClone(lead);
  const evaluation = evaluateRequirements(lead);
  assert.equal(evaluation.readyForPricing, false);
  assert.deepEqual(evaluation.nextQuestion, { text: 'מה צריך להעביר?', requirements: [{ id: 'items' }] });
  assert.deepEqual(lead, before);
  assert.equal('missingFields' in lead, false);
  evaluation.missingRequired.length = 0;
  assert.ok(evaluateRequirements(lead).missingRequired.length > 0);
});

test('known refrigerator and cities lead to a concise pickup group without asking cities', () => {
  const lead = createLead();
  lead.moveDetails.items.push(createMoveItem('refrigerator'));
  lead.moveDetails.pickup.city = 'רמת גן';
  lead.moveDetails.dropoff.city = 'תל אביב';
  const evaluation = evaluateRequirements(lead);
  assert.equal(result(lead, 'item.type', {}, 0).status, 'SATISFIED');
  assert.equal(result(lead, 'pickup.city').status, 'SATISFIED');
  assert.equal(result(lead, 'dropoff.city').status, 'SATISFIED');
  assert.deepEqual(evaluation.nextQuestion?.requirements, [{ id: 'pickup.address' }, { id: 'pickup.floor' }]);
  assert.match(evaluation.nextQuestion!.text, /רמת גן/);
  assert.doesNotMatch(evaluation.nextQuestion!.text, /באיזו עיר/);
});

test('floor zero and explicit false elevator answers are satisfied', () => {
  const lead = completeLead();
  lead.moveDetails.dropoff.floor = 0;
  lead.moveDetails.dropoff.elevator = false;
  for (const side of ['pickup', 'dropoff'] as const) {
    assert.equal(result(lead, `${side}.floor`).status, 'SATISFIED');
    assert.equal(result(lead, `${side}.elevator`).status, 'SATISFIED');
  }
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
});

test('known pickup floor and elevator never appear in the next question', () => {
  const lead = completeLead();
  lead.moveDetails.pickup.address = null;
  const question = evaluateRequirements(lead).nextQuestion;
  assert.deepEqual(question?.requirements, [{ id: 'pickup.address' }]);
  assert.doesNotMatch(question!.text, /קומה|מעלית/);
});

test('partial dimensions request only missing axes, then satisfy size without a category', () => {
  const lead = completeLead();
  const item = lead.moveDetails.items[0];
  item.sizeCategory = null;
  item.dimensions.width = 80;
  const evaluation = evaluateRequirements(lead);
  assert.equal(evaluation.readyForPricing, false);
  assert.deepEqual(evaluation.nextQuestion?.requirements, [
    { id: 'item.height', itemIndex: 0 }, { id: 'item.depth', itemIndex: 0 },
  ]);
  assert.doesNotMatch(evaluation.nextQuestion!.text, /הרוחב/);
  item.dimensions.height = 180;
  item.dimensions.depth = 70;
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
});

test('a structured size category makes exact refrigerator dimensions optional', () => {
  const lead = completeLead();
  lead.moveDetails.items[0].dimensions.width = 80;
  assert.equal(result(lead, 'item.width', {}, 0).status, 'NOT_APPLICABLE');
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
});

test('unassessed free-text description does not establish sufficient size information', () => {
  const lead = completeLead();
  lead.moveDetails.items[0].sizeCategory = null;
  lead.moveDetails.items[0].description = 'A refrigerator';
  assert.equal(result(lead, 'item.size', {}, 0).status, 'MISSING');
  assert.deepEqual(evaluateRequirements(lead).nextQuestion?.requirements, [{ id: 'item.size', itemIndex: 0 }]);
});

test('required photos remain pending review without blocking initial pricing readiness', () => {
  const lead = completeLead();
  const evaluation = evaluateRequirements(lead);
  assert.equal(evaluation.readyForPricing, true);
  assert.deepEqual(evaluation.pendingReview.map(entry => entry.id), ['item.photo']);
  assert.equal(evaluation.pendingReview[0].status, 'MISSING');
  assert.deepEqual(evaluation.nextQuestion?.requirements, [{ id: 'item.photo', itemIndex: 0 }]);
});

test('received and not-applicable photos are distinguished and never requested', () => {
  for (const photoStatus of ['RECEIVED', 'NOT_APPLICABLE'] as const) {
    const lead = completeLead();
    lead.moveDetails.items[0].photoStatus = photoStatus;
    const evaluation = evaluateRequirements(lead);
    assert.equal(result(lead, 'item.photo', {}, 0).status, photoStatus === 'RECEIVED' ? 'SATISFIED' : 'NOT_APPLICABLE');
    assert.deepEqual(evaluation.pendingReview, []);
    assert.equal(evaluation.nextQuestion, null);
  }
});

test('context can require exact dimensions, quantity, access notes, and assembly information', () => {
  const lead = completeLead();
  const context: RequirementContext = {
    items: { 0: { dimensionsRequired: true, quantityRequired: true, disassemblyRelevant: true, assemblyRelevant: true } },
    specialAccessDetailsRequired: true,
  };
  for (const id of ['item.width', 'item.quantity', 'item.disassembly', 'item.assembly'] as const) {
    assert.equal(result(lead, id, context, 0).status, 'MISSING');
    assert.equal(result(lead, id, context, 0).conditional, true);
  }
  assert.equal(result(lead, 'specialAccessNotes', context).status, 'MISSING');
  assert.equal(evaluateRequirements(lead, context).readyForPricing, false);
  const item = lead.moveDetails.items[0];
  item.dimensions = { width: 80, height: 180, depth: 70 };
  item.quantity = 2;
  item.requiresDisassembly = false;
  item.requiresAssembly = false;
  lead.moveDetails.specialAccessNotes = 'Narrow entry';
  assert.equal(evaluateRequirements(lead, context).readyForPricing, true);
  assert.equal(result(lead, 'item.assembly', context, 0).status, 'SATISFIED');
  assert.equal(result(lead, 'item.disassembly', context, 0).status, 'SATISFIED');
});

test('ordinary refrigerator does not require quantity, assembly, or special access answers', () => {
  const lead = completeLead();
  for (const id of ['item.quantity', 'item.disassembly', 'item.assembly'] as const) {
    assert.equal(result(lead, id, {}, 0).status, 'NOT_APPLICABLE');
  }
  assert.equal(result(lead, 'specialAccessNotes').status, 'NOT_APPLICABLE');
  assert.equal(lead.moveDetails.items[0].quantity, null);
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
});

test('all mandatory refrigerator pricing fields independently block readiness when unknown', () => {
  const changes: ((lead: Lead) => void)[] = [
    lead => { lead.moveDetails.items = []; },
    lead => { lead.moveDetails.items[0].type = null; },
    lead => { lead.moveDetails.items[0].sizeCategory = null; },
    lead => { lead.moveDetails.requestedDate = null; },
  ];
  for (const side of ['pickup', 'dropoff'] as const) {
    for (const field of ['city', 'address', 'floor', 'elevator'] as const) {
      changes.push(lead => { lead.moveDetails[side][field] = null; });
    }
  }
  for (const change of changes) {
    const lead = completeLead();
    change(lead);
    assert.equal(evaluateRequirements(lead).readyForPricing, false);
  }
});

test('readiness transition is immutable, reversible, and preserves later lifecycle statuses', () => {
  const lead = completeLead();
  const ready = updateLeadReadiness(lead);
  assert.equal(lead.status, 'COLLECTING_INFORMATION');
  assert.equal(ready.status, 'READY_FOR_PRICING');
  assert.equal(updateLeadReadiness(ready), ready);
  const incomplete = structuredClone(ready);
  incomplete.moveDetails.pickup.address = null;
  assert.equal(updateLeadReadiness(incomplete).status, 'COLLECTING_INFORMATION');
  for (const status of ['AWAITING_REVIEW', 'QUOTE_SENT', 'WON', 'LOST'] as const) {
    incomplete.status = status;
    assert.equal(updateLeadReadiness(incomplete), incomplete);
    assert.equal(incomplete.status, status);
  }
});

test('boxes with unknown quantity block readiness and request quantity without dimensions', () => {
  const lead = completeLead();
  lead.moveDetails.items.push(createMoveItem('box'));
  assert.equal(result(lead, 'item.quantity', {}, 1).status, 'MISSING');
  assert.equal(evaluateRequirements(lead).readyForPricing, false);
  assert.deepEqual(evaluateRequirements(lead).nextQuestion?.requirements, [{ id: 'item.quantity', itemIndex: 1 }]);
  for (const id of ['item.width', 'item.height', 'item.depth', 'item.size'] as const) {
    assert.equal(result(lead, id, {}, 1).status, 'NOT_APPLICABLE');
  }
});

test('known box quantity stays known and is never asked again, including box-only moves', () => {
  const lead = completeLead();
  const box = createMoveItem('box');
  box.quantity = 20;
  lead.moveDetails.items = [box];
  assert.equal(result(lead, 'item.quantity', {}, 0).status, 'SATISFIED');
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
  assert.equal(evaluateRequirements(lead).nextQuestion, null);
  assert.equal(box.quantity, 20);
});

test('quantity null is unknown; zero, negative, fractional, and nonfinite counts are invalid', () => {
  for (const quantity of [null, 0, -1, 1.5, NaN, Infinity]) {
    const lead = completeLead();
    const box = createMoveItem('box');
    box.quantity = quantity;
    lead.moveDetails.items = [box];
    assert.equal(result(lead, 'item.quantity', {}, 0).status, 'MISSING');
    assert.equal(box.quantity, quantity);
  }
  const lead = completeLead();
  const box = createMoveItem('box');
  box.quantity = 1;
  lead.moveDetails.items = [box];
  assert.equal(evaluateRequirements(lead).readyForPricing, true);
});

test('item references keep known and missing quantities separate across multiple entries', () => {
  const lead = completeLead();
  const first = createMoveItem('box');
  first.quantity = 20;
  lead.moveDetails.items = [first, createMoveItem('box')];
  assert.deepEqual(evaluateRequirements(lead).nextQuestion?.requirements, [{ id: 'item.quantity', itemIndex: 1 }]);
  assert.match(evaluateRequirements(lead).nextQuestion!.text, /פריט 2/);
});

test('future item profiles express conditional needs but cannot silently become ready', () => {
  for (const type of ['wardrobe', 'bed', 'washing_machine', 'piano', 'constructor']) {
    const lead = completeLead();
    lead.moveDetails.items = [createMoveItem(type)];
    assert.equal(result(lead, 'item.type', {}, 0).status, 'SATISFIED');
    assert.equal(result(lead, 'item.support', {}, 0).status, 'MISSING');
    assert.equal(evaluateRequirements(lead).readyForPricing, false);
    const assemblyExpected = type === 'wardrobe' || type === 'bed';
    assert.equal(result(lead, 'item.assembly', {}, 0).status, assemblyExpected ? 'MISSING' : 'NOT_APPLICABLE');
    assert.equal(result(lead, 'item.width', {}, 0).status, 'NOT_APPLICABLE');
  }
});

test('washing machine dimensions can be required explicitly for an access issue', () => {
  const lead = completeLead();
  lead.moveDetails.items = [createMoveItem('washing_machine')];
  assert.equal(result(lead, 'item.width', { items: { 0: { dimensionsRequired: true } } }, 0).status, 'MISSING');
});

test('no customer requirements exist for distance, workers, or requested time by default', () => {
  const evaluation = evaluateRequirements(completeLead());
  assert.ok(evaluation.requirements.every(entry => !/distance|workers|requestedTime/.test(entry.id)));
});

test('factory leaves unknown values explicit and creates independent dimensions', () => {
  const first = createMoveItem();
  const second = createMoveItem('box');
  assert.equal(first.type, null);
  assert.equal(first.quantity, null);
  assert.equal(first.requiresAssembly, null);
  assert.equal(first.requiresDisassembly, null);
  assert.equal(first.photoStatus, 'NOT_APPLICABLE');
  assert.equal(createMoveItem('refrigerator').photoStatus, 'REQUIRED');
  first.dimensions.width = 80;
  assert.equal(second.dimensions.width, null);
});

test('whitespace does not count as an answered required text field', () => {
  const lead = completeLead();
  lead.moveDetails.pickup.address = '   ';
  assert.equal(result(lead, 'pickup.address').status, 'MISSING');
});
