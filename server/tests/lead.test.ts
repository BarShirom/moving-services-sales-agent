import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import type { MoveItem } from '../src/domain/lead.js';

test('new leads start collecting with explicitly unknown move details', () => {
  const lead = createLead();

  assert.equal(lead.status, 'COLLECTING_INFORMATION');
  assert.deepEqual(lead.messages, []);
  assert.deepEqual(lead.moveDetails, {
    items: [],
    pickup: { city: null, address: null, floor: null, elevator: null },
    dropoff: { city: null, address: null, floor: null, elevator: null },
    requestedDate: null,
    requestedTime: null,
    specialAccessNotes: null,
  });
  assert.equal('missingFields' in lead, false);
  assert.equal('missingFields' in lead.moveDetails, false);
});

test('factory generates unique UUIDs and matching current UTC timestamps', () => {
  const before = Date.now();
  const first = createLead();
  const second = createLead();
  const after = Date.now();

  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal(first.createdAt, first.updatedAt);
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
  assert.ok(Date.parse(first.createdAt) >= before);
  assert.ok(Date.parse(first.createdAt) <= after);
});

test('leads and their pickup/dropoff objects do not share mutable defaults', () => {
  const first = createLead();
  const second = createLead();

  first.moveDetails.pickup.city = 'Ramat Gan';
  first.messages.push({ id: 'message-1', sender: 'CUSTOMER', text: 'Hello', timestamp: first.createdAt });

  assert.equal(first.moveDetails.dropoff.city, null);
  assert.equal(second.moveDetails.pickup.city, null);
  assert.deepEqual(second.messages, []);
  assert.notStrictEqual(first.moveDetails.items, second.moveDetails.items);
  assert.notStrictEqual(first.moveDetails.dropoff, second.moveDetails.dropoff);
});

test('unknown booleans, confirmed false, and confirmed true survive JSON serialization', () => {
  for (const value of [null, false, true] as const) {
    const lead = createLead();
    const item: MoveItem = {
      type: 'refrigerator',
      quantity: null,
      sizeCategory: null,
      photoStatus: 'REQUIRED',
      dimensionsAvailable: value,
      description: null,
      dimensions: { width: null, height: 180, depth: null },
      requiresDisassembly: value,
      requiresAssembly: value,
    };
    lead.moveDetails.items.push(item);
    lead.moveDetails.pickup.elevator = value;
    lead.moveDetails.dropoff.elevator = value;
    lead.moveDetails.pickup.floor = 0;

    const restored = JSON.parse(JSON.stringify(lead));
    assert.deepEqual(restored, lead);
    assert.equal(restored.moveDetails.pickup.elevator, value);
    assert.equal(restored.moveDetails.dropoff.elevator, value);
    assert.equal(restored.moveDetails.items[0].requiresDisassembly, value);
    assert.equal(restored.moveDetails.items[0].requiresAssembly, value);
    assert.equal(restored.moveDetails.items[0].dimensionsAvailable, value);
    assert.equal(restored.moveDetails.pickup.floor, 0);
  }
});
