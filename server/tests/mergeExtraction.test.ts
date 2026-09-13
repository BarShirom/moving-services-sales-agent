import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { extractMessage } from '../src/domain/extraction/extractMessage.js';
import { mergeExtraction } from '../src/domain/extraction/mergeExtraction.js';

test('nested partial updates preserve unrelated known state including false and zero', () => {
  const lead = createLead();
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'Old address', floor: 0, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'Other address', floor: 4, elevator: true };
  lead.moveDetails.requestedDate = '2026-10-01';
  lead.moveDetails.requestedTime = '10:00';
  lead.moveDetails.specialAccessNotes = 'Narrow entrance';
  const before = structuredClone(lead);
  const { lead: merged } = mergeExtraction(lead, { moveDetails: { pickup: { address: 'ביאליק 20' } } });
  assert.deepEqual(merged.moveDetails, { ...before.moveDetails, pickup: { ...before.moveDetails.pickup, address: 'ביאליק 20' } });
  assert.deepEqual(lead, before);
  assert.equal(merged.createdAt, lead.createdAt);
  assert.equal(merged.updatedAt, lead.updatedAt);
});

test('explicit false and zero updates overwrite prior values', () => {
  const lead = createLead();
  lead.moveDetails.pickup.floor = 5;
  lead.moveDetails.pickup.elevator = true;
  const merged = mergeExtraction(lead, { moveDetails: { pickup: { floor: 0, elevator: false } } }).lead;
  assert.equal(merged.moveDetails.pickup.floor, 0);
  assert.equal(merged.moveDetails.pickup.elevator, false);
});

test('empty patches and undefined properties cannot erase known values', () => {
  const lead = createLead();
  lead.moveDetails.pickup.city = 'רמת גן';
  lead.moveDetails.pickup.elevator = false;
  lead.moveDetails.requestedDate = '2026-10-01';
  assert.deepEqual(mergeExtraction(lead, {}).lead, lead);
  assert.deepEqual(mergeExtraction(lead, { moveDetails: { pickup: { city: undefined, elevator: undefined }, requestedDate: undefined } }).lead, lead);
});

test('fridge updates preserve dimensions, photo receipt, and service answers without duplicates', () => {
  const lead = createLead();
  const fridge = createMoveItem('refrigerator');
  fridge.dimensions.width = 80;
  fridge.requiresAssembly = false;
  fridge.photoStatus = 'RECEIVED';
  lead.moveDetails.items.push(fridge);
  const before = structuredClone(lead);
  const patch = extractMessage('המקרר גדול');
  const first = mergeExtraction(lead, patch).lead;
  const second = mergeExtraction(first, patch).lead;
  assert.equal(second.moveDetails.items.length, 1);
  assert.deepEqual(second.moveDetails.items[0], { ...fridge, sizeCategory: 'LARGE' });
  assert.deepEqual(lead, before);
});

test('box mentions retain known quantities and explicit counts update the existing item', () => {
  let lead = createLead();
  lead = mergeExtraction(lead, extractMessage('יש גם ארגזים')).lead;
  assert.equal(lead.moveDetails.items[0].quantity, null);
  lead = mergeExtraction(lead, extractMessage('יש 20 ארגזים')).lead;
  assert.equal(lead.moveDetails.items[0].quantity, 20);
  lead = mergeExtraction(lead, extractMessage('יש גם ארגזים')).lead;
  assert.equal(lead.moveDetails.items[0].quantity, 20);
  lead = mergeExtraction(lead, extractMessage('יש 15 ארגזים')).lead;
  assert.equal(lead.moveDetails.items[0].quantity, 15);
  assert.equal(lead.moveDetails.items.length, 1);
});

test('new items use domain factory defaults and do not displace other items', () => {
  const lead = createLead();
  lead.moveDetails.items.push(createMoveItem('wardrobe'));
  const merged = mergeExtraction(lead, extractMessage('מקרר קטן')).lead;
  assert.equal(merged.moveDetails.items.length, 2);
  assert.deepEqual(merged.moveDetails.items[0], lead.moveDetails.items[0]);
  assert.deepEqual(merged.moveDetails.items[1], { ...createMoveItem('refrigerator'), sizeCategory: 'SMALL' });
});

test('multiple items of the same type produce an unapplied update instead of a guess', () => {
  const lead = createLead();
  lead.moveDetails.items = [createMoveItem('refrigerator'), createMoveItem('refrigerator')];
  const before = structuredClone(lead);
  const merged = mergeExtraction(lead, extractMessage('המקרר גדול'));
  assert.deepEqual(merged.lead, before);
  assert.deepEqual(merged.unappliedItems, [{ type: 'refrigerator', sizeCategory: 'LARGE' }]);
  assert.deepEqual(lead, before);
});

test('merged output and patch do not share mutable nested data with the input', () => {
  const lead = createLead();
  lead.moveDetails.items.push(createMoveItem('refrigerator'));
  lead.messages.push({ id: 'existing', sender: 'CUSTOMER', text: 'Original', timestamp: lead.createdAt });
  const before = structuredClone(lead);
  const patch = extractMessage('המקרר גדול');
  const patchBefore = structuredClone(patch);
  const output = mergeExtraction(lead, patch).lead;
  output.moveDetails.items[0].dimensions.width = 80;
  output.moveDetails.pickup.city = 'חולון';
  output.messages[0].text = 'Changed';
  assert.deepEqual(lead, before);
  assert.deepEqual(patch, patchBefore);
});
