import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { ITEM_TYPES, type ItemType } from '../src/domain/itemTypes.js';
import { extractMessage } from '../src/domain/extraction/extractMessage.js';
import { evaluateRequirements } from '../src/domain/requirements/evaluateRequirements.js';
import { buildPricingInput } from '../src/domain/pricing/buildPricingInput.js';
import { calculatePrice } from '../src/domain/pricing/calculatePrice.js';
import type { PricingComponent } from '../src/domain/pricing/types.js';
import { convertAIExtraction } from '../src/integrations/openai/convertExtraction.js';
import { AIExtractionSchema, type AIExtraction } from '../src/integrations/openai/schema.js';

interface ItemExpectation {
  customerText: string;
  collection: { quantity: boolean; size: boolean; services: boolean; photo: boolean; standardTransport: boolean };
  transport: { code: PricingComponent['code']; amount: number } | null;
  serviceAmount: number | null;
  singularQuantity: boolean;
}

// Explicit expectations make adding a recognized type require behavioral review,
// including deliberate decisions for services that do not price transportation.
const expectations = {
  refrigerator: {
    customerText: 'מקרר',
    collection: { quantity: false, size: true, services: false, photo: true, standardTransport: true },
    transport: { code: 'REFRIGERATOR', amount: 350 }, serviceAmount: null, singularQuantity: true,
  },
  box: {
    customerText: 'ארגזים',
    collection: { quantity: true, size: false, services: false, photo: false, standardTransport: true },
    transport: { code: 'BOXES', amount: 75 }, serviceAmount: null, singularQuantity: false,
  },
  washing_machine: {
    customerText: 'מכונת כביסה',
    collection: { quantity: false, size: false, services: false, photo: false, standardTransport: true },
    transport: { code: 'WASHING_MACHINE', amount: 300 }, serviceAmount: null, singularQuantity: false,
  },
  wardrobe: {
    customerText: 'ארון',
    collection: { quantity: false, size: true, services: true, photo: false, standardTransport: false },
    transport: null, serviceAmount: 475, singularQuantity: true,
  },
  bed: {
    customerText: 'מיטה',
    collection: { quantity: false, size: true, services: true, photo: false, standardTransport: false },
    transport: null, serviceAmount: 265, singularQuantity: false,
  },
  dresser: {
    customerText: 'שידה',
    collection: { quantity: false, size: false, services: false, photo: false, standardTransport: false },
    transport: null, serviceAmount: null, singularQuantity: false,
  },
} satisfies Record<ItemType, ItemExpectation>;

const metadata = { id: 'item-policy-test', createdAt: '2026-10-21T10:00:00.000Z' };
const context = { distanceKm: 10, specialDifficulty: [] };
const keep = () => ({ action: 'keep' as const });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });

function extractionFixture(type: string): unknown {
  return {
    items: [{ type, quantity: keep(), sizeCategory: keep(), photoStatus: keep(), dimensionsAvailable: keep(),
      dimensions: { width: keep(), height: keep(), depth: keep() }, requiresDisassembly: keep(), requiresAssembly: keep() }],
    pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep(),
  };
}

function leadFixture(type: string | null) {
  const lead = createLead();
  lead.moveDetails.items = [{ ...createMoveItem(type), quantity: 1, sizeCategory: 'REGULAR',
    photoStatus: 'RECEIVED', requiresAssembly: false, requiresDisassembly: false }];
  lead.moveDetails.pickup = { city: 'Synthetic city', address: 'Synthetic pickup', floor: 1, elevator: false };
  lead.moveDetails.dropoff = { city: 'Synthetic city', address: 'Synthetic dropoff', floor: 0, elevator: false };
  lead.moveDetails.requestedDate = '2026-11-08';
  return lead;
}

test('every recognized type is extracted offline through deterministic and structured-output boundaries', () => {
  for (const type of ITEM_TYPES) {
    const expected = expectations[type];
    assert.deepEqual(extractMessage(expected.customerText).moveDetails?.items, [{ type }]);
    const parsed: AIExtraction = AIExtractionSchema.parse(extractionFixture(type));
    assert.deepEqual(convertAIExtraction(parsed, createLead()).moveDetails?.items, [{ type }]);
  }
  assert.equal(AIExtractionSchema.safeParse(extractionFixture('piano')).success, false);
});

test('each recognized type retains independent collection, photo and human-review requirements', () => {
  for (const type of ITEM_TYPES) {
    const expected = expectations[type].collection;
    const lead = leadFixture(type);
    lead.moveDetails.items = [createMoveItem(type)];
    const requirements = evaluateRequirements(lead).requirements.filter(result => result.itemIndex === 0);
    const status = (id: string) => requirements.find(result => result.id === id)?.status;
    assert.equal(status('item.type'), 'SATISFIED', type);
    assert.equal(status('item.support'), expected.standardTransport ? 'SATISFIED' : 'MISSING', type);
    for (const [field, relevant] of [
      ['quantity', expected.quantity], ['size', expected.size], ['disassembly', expected.services],
      ['assembly', expected.services], ['photo', expected.photo],
    ] as const) {
      assert.equal(status(`item.${field}`), relevant ? 'MISSING' : 'NOT_APPLICABLE', `${type}.${field}`);
    }
    assert.equal(lead.moveDetails.items[0].photoStatus, expected.photo ? 'REQUIRED' : 'NOT_APPLICABLE');
    if (type === 'dresser') {
      const size = evaluateRequirements(lead, { items: { 0: { disassemblyRelevant: true } } })
        .requirements.find(result => result.id === 'item.disassembly');
      assert.equal(size?.question, 'האם נדרש פירוק של הפריט?');
    }
  }
});

test('transport tariffs and ordinary stairs stay independent from furniture service tariffs', () => {
  for (const type of ITEM_TYPES) {
    const expected = expectations[type];
    const lead = leadFixture(type);
    const result = calculatePrice(buildPricingInput(lead, context), metadata);
    assert.equal(result.ruleVersion, 'MOVING_PRICING_V0_1_3');
    assert.equal(result.humanApprovalRequired, true);
    assert.deepEqual(result.breakdown.filter(part => ['REFRIGERATOR', 'WASHING_MACHINE', 'BOXES'].includes(part.code))
      .map(part => ({ code: part.code, amount: part.amount })), expected.transport ? [expected.transport] : [], type);
    assert.equal(result.breakdown.find(part => part.code === 'FLOORS')?.amount ?? null, expected.transport ? 125 : null, type);
    assert.equal(result.omittedComponents.some(part => part.code === 'UNSUPPORTED_ITEM'), expected.transport === null, type);

    lead.moveDetails.items[0].requiresAssembly = true;
    const service = calculatePrice(buildPricingInput(lead, { ...context, serviceComplexity: { '0': 'STANDARD' } }), metadata);
    assert.equal(service.breakdown.find(part => part.code === 'ASSEMBLY_DISASSEMBLY')?.amount ?? null, expected.serviceAmount, type);
    assert.equal(service.omittedComponents.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'), expected.serviceAmount === null, type);
    assert.equal(service.omittedComponents.some(part => part.code === 'UNSUPPORTED_ITEM'), expected.transport === null, type);
    assert.equal(service.humanApprovalRequired, true);
  }
});

test('only the existing refrigerator and wardrobe conventions normalize unknown singular quantities', () => {
  for (const type of ITEM_TYPES) {
    const lead = leadFixture(type);
    lead.moveDetails.items[0].quantity = null;
    const input = buildPricingInput(lead, context);
    assert.equal(input.moveDetails.items[0].quantity, expectations[type].singularQuantity ? 1 : null, type);
    assert.equal(lead.moveDetails.items[0].quantity, null, 'pricing assumptions never overwrite customer facts');
  }
});

test('unrecognized item types never inherit photo, transport or service policies', () => {
  for (const type of ['piano', '__proto__', 'constructor', null]) {
    const lead = leadFixture(type);
    lead.moveDetails.items[0].requiresAssembly = true;
    const result = calculatePrice(buildPricingInput(lead, { ...context, serviceComplexity: { '0': 'STANDARD' } }), metadata);
    assert.equal(createMoveItem(type).photoStatus, 'NOT_APPLICABLE');
    assert.equal(result.suggestedAmount, null);
    assert.deepEqual(result.breakdown, []);
    assert.ok(result.omittedComponents.some(part => part.code === 'UNSUPPORTED_ITEM'));
    assert.ok(result.omittedComponents.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'));
    assert.equal(result.humanApprovalRequired, true);
  }
});
