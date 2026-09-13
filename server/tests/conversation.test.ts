import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { processCustomerMessage } from '../src/domain/conversation/processCustomerMessage.js';

test('processes the initial request, records original text, and asks only missing details', () => {
  const lead = createLead();
  lead.updatedAt = '2026-01-01T00:00:00.000Z';
  const before = structuredClone(lead);
  const text = 'צריך להעביר מקרר מרמת גן לתל אביב';
  const started = Date.now();
  const output = processCustomerMessage(lead, text);
  assert.deepEqual(lead, before);
  assert.equal(output.lead.moveDetails.pickup.city, 'רמת גן');
  assert.equal(output.lead.moveDetails.dropoff.city, 'תל אביב');
  assert.equal(output.lead.moveDetails.items[0].type, 'refrigerator');
  assert.equal(output.lead.messages.length, 1);
  const message = output.lead.messages[0];
  assert.equal(message.sender, 'CUSTOMER');
  assert.equal(message.text, text);
  assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(new Date(message.timestamp).toISOString(), message.timestamp);
  assert.ok(Date.parse(message.timestamp) >= started);
  assert.ok(Date.parse(message.timestamp) <= Date.now());
  assert.notEqual(output.lead.updatedAt, lead.updatedAt);
  assert.equal(output.lead.createdAt, lead.createdAt);
  assert.deepEqual(output.nextQuestion?.requirements, [{ id: 'pickup.address' }, { id: 'pickup.floor' }]);
  assert.equal(output.requirements.requirements.find(entry => entry.id === 'pickup.city')?.status, 'SATISFIED');
  assert.equal(output.nextQuestion, output.requirements.nextQuestion);
});

test('latest access answers and existing known fields are not asked again', () => {
  const lead = createLead();
  lead.moveDetails.items.push(createMoveItem('refrigerator'));
  lead.moveDetails.pickup.city = 'רמת גן';
  const output = processCustomerMessage(lead, 'איסוף קומת קרקע בלי מעלית');
  assert.equal(output.lead.moveDetails.pickup.floor, 0);
  assert.equal(output.lead.moveDetails.pickup.elevator, false);
  assert.deepEqual(output.nextQuestion?.requirements, [{ id: 'pickup.address' }]);
  assert.doesNotMatch(output.nextQuestion!.text, /קומה|מעלית/);
  const later = processCustomerMessage(output.lead, 'הכתובת היא ביאליק 20');
  assert.equal(later.lead.moveDetails.pickup.elevator, false);
  assert.equal(later.lead.moveDetails.pickup.floor, 0);
  assert.equal(later.lead.moveDetails.pickup.address, null);
});

test('repeated messages append distinct history entries without duplicate items', () => {
  const text = 'מקרר גדול';
  const first = processCustomerMessage(createLead(), text);
  const second = processCustomerMessage(first.lead, text);
  assert.equal(first.lead.messages.length, 1);
  assert.equal(second.lead.messages.length, 2);
  assert.equal(second.lead.moveDetails.items.length, 1);
  assert.notEqual(second.lead.messages[0].id, second.lead.messages[1].id);
  assert.ok(second.lead.messages.every(message => message.sender === 'CUSTOMER'));
});

test('unsupported text still appends the exact original message without altering move details', () => {
  const lead = createLead();
  const text = '  שלום\nתודה רבה  ';
  const output = processCustomerMessage(lead, text);
  assert.deepEqual(output.extraction, {});
  assert.deepEqual(output.lead.moveDetails, lead.moveDetails);
  assert.equal(output.lead.messages[0].text, text);
});

test('a multi-message flow reaches readiness with a pending review photo', () => {
  let output = processCustomerMessage(createLead(), 'צריך להעביר מקרר מרמת גן לתל אביב');
  output = processCustomerMessage(output.lead, 'המקרר גדול');
  output = processCustomerMessage(output.lead, 'איסוף קומה 2 בלי מעלית');
  output = processCustomerMessage(output.lead, 'פריקה קומה 3 עם מעלית');
  // Address extraction is outside this milestone; the caller provides known addresses.
  output.lead.moveDetails.pickup.address = 'ביאליק 20';
  output.lead.moveDetails.dropoff.address = 'הרצל 10';
  assert.equal(output.lead.status, 'COLLECTING_INFORMATION');
  output = processCustomerMessage(output.lead, 'בתאריך 2026-10-01');
  assert.equal(output.lead.status, 'READY_FOR_PRICING');
  assert.equal(output.requirements.readyForPricing, true);
  assert.deepEqual(output.requirements.missingRequired, []);
  assert.deepEqual(output.requirements.pendingReview.map(entry => entry.id), ['item.photo']);
  assert.equal(output.lead.messages.length, 5);
  output = processCustomerMessage(output.lead, 'יש גם ארגזים');
  assert.equal(output.lead.status, 'COLLECTING_INFORMATION');
  assert.deepEqual(output.nextQuestion?.requirements, [{ id: 'item.quantity', itemIndex: 1 }]);
  output = processCustomerMessage(output.lead, 'יש 20 ארגזים');
  assert.equal(output.lead.status, 'READY_FOR_PRICING');
  assert.equal(output.lead.moveDetails.items.length, 2);
});

test('requirement context is retained through evaluation and readiness updates', () => {
  const lead = createLead();
  const fridge = createMoveItem('refrigerator');
  fridge.sizeCategory = 'REGULAR';
  lead.moveDetails.items.push(fridge);
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'A', floor: 0, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'B', floor: 0, elevator: false };
  const output = processCustomerMessage(lead, '2026-10-01', { items: { 0: { dimensionsRequired: true } } });
  assert.equal(output.lead.status, 'COLLECTING_INFORMATION');
  assert.equal(output.requirements.readyForPricing, false);
  assert.deepEqual(output.requirements.missingRequired.map(entry => entry.id), ['item.width', 'item.height', 'item.depth']);
});

test('later lifecycle statuses are preserved', () => {
  for (const status of ['AWAITING_REVIEW', 'QUOTE_SENT', 'WON', 'LOST'] as const) {
    const lead = createLead();
    lead.status = status;
    const output = processCustomerMessage(lead, 'יש 20 ארגזים');
    assert.equal(output.lead.status, status);
    assert.equal(lead.messages.length, 0);
  }
});

test('workflow surfaces item ambiguity without altering existing items', () => {
  const lead = createLead();
  lead.moveDetails.items = [createMoveItem('box'), createMoveItem('box')];
  const output = processCustomerMessage(lead, 'יש 20 ארגזים');
  assert.deepEqual(output.unappliedItems, [{ type: 'box', quantity: 20 }]);
  assert.deepEqual(output.lead.moveDetails.items, lead.moveDetails.items);
  assert.equal(output.lead.messages.length, 1);
});
