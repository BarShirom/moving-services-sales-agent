import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { buildPricingInput, fingerprintPricingInput, isPricingEvaluationCurrent } from '../src/domain/pricing/buildPricingInput.js';
import { calculatePrice } from '../src/domain/pricing/calculatePrice.js';
import { evaluateLeadPricing } from '../src/domain/pricing/evaluateLeadPricing.js';
import { midpoint, sumRanges, pricingRules } from '../src/domain/pricing/pricingRules.js';
import type { PricingContext, PricingEvaluation } from '../src/domain/pricing/types.js';
import { assertPricingInvariants, comparePricingEvidence, runPricingEvals } from '../src/evals/runPricingEvals.js';
import { hydratePricingLead } from '../src/evals/hydratePricingLead.js';
import { parsePricingCases } from '../src/evals/loadEvalCases.js';

const metadata = { id: 'test-evaluation', createdAt: '2026-10-06T10:00:00.000Z' };
const context: PricingContext = { distanceKm: 10, specialDifficulty: [] };
function leadFixture() {
  const lead = createLead();
  lead.id = 'pricing-test';
  lead.status = 'READY_FOR_PRICING';
  lead.moveDetails.items = [{ ...createMoveItem('refrigerator'), quantity: 1, sizeCategory: 'REGULAR',
    photoStatus: 'RECEIVED', requiresAssembly: false, requiresDisassembly: false }];
  lead.moveDetails.pickup = { city: 'Synthetic city', address: 'Synthetic pickup', floor: 0, elevator: false };
  lead.moveDetails.dropoff = { city: 'Synthetic city', address: 'Synthetic dropoff', floor: 0, elevator: false };
  lead.moveDetails.requestedDate = '2026-10-20';
  return lead;
}
const price = (lead = leadFixture(), external = context) => calculatePrice(buildPricingInput(lead, external), metadata);
const hasReason = (result: PricingEvaluation, code: string) => result.reviewReasons.some(reason => reason.code === code);

test('complex wardrobe lead retains defensible components while unavailable dimensions and unsupported transport stay under review', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].sizeCategory = 'LARGE';
  lead.moveDetails.items.push(
    { ...createMoveItem('wardrobe'), quantity: 1, dimensionsAvailable: false, requiresDisassembly: true, requiresAssembly: true },
    { ...createMoveItem('dresser'), quantity: 1 }, { ...createMoveItem('box'), quantity: 40 },
  );
  lead.moveDetails.pickup.floor = 2;
  lead.moveDetails.dropoff.floor = 3;
  const result = price(lead);
  assert.equal(result.suggestedAmount, 425, 'only known fridge transport; unresolved wardrobe services and high-volume boxes are unpriced');
  assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(result.humanApprovalRequired, true);
  for (const code of ['ITEM_1_DIMENSIONS_UNAVAILABLE', 'ITEM_1_SERVICES_MANUAL', 'ITEM_1_UNSUPPORTED', 'ITEM_2_UNSUPPORTED', 'HIGH_VOLUME']) {
    assert.ok(hasReason(result, code), code);
  }
  assert.equal(result.inputSnapshot.moveDetails.items[1].dimensionsAvailable, false);
  assert.deepEqual(result.inputSnapshot.moveDetails.items[1].dimensions, { width: null, height: null, depth: null });
  assert.ok(result.omittedComponents.some(part => part.code === 'BOXES' && part.quantity === 40));
  assertPricingInvariants(result);
});

test('identical validated input and metadata produce identical complete evaluations without mutation', () => {
  const lead = leadFixture();
  const before = structuredClone(lead);
  const input = buildPricingInput(lead, context);
  const beforeInput = structuredClone(input);
  assert.deepEqual(calculatePrice(input, metadata), calculatePrice(input, metadata));
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(lead, before);
});

test('simple refrigerator reference preserves floor zero and elevator false', () => {
  const result = price();
  assert.equal(result.suggestedAmount, 350);
  assert.deepEqual(result.priceRange, { min: 350, max: 350 });
  assert.equal(result.inputSnapshot.moveDetails.pickup.floor, 0);
  assert.equal(result.inputSnapshot.moveDetails.pickup.elevator, false);
  assert.equal(result.breakdown.length, 2);
  assert.equal(result.confidence, 85);
  assert.equal(result.status, 'RECOMMENDATION_READY');
  assert.equal(result.completeness, 'COMPLETE_RECOMMENDATION');
  assert.ok(!hasReason(result, 'pickup_FLOOR'));
  assert.ok(!hasReason(result, 'pickup_ELEVATOR'));
  assert.ok(hasReason(result, 'PROVISIONAL_DISTANCE_RATE'));
});

test('all documented fridge categories use source endpoints and deterministic midpoints', () => {
  for (const [size, expected, range] of [
    ['SMALL', 300, { min: 300, max: 300 }], ['REGULAR', 350, { min: 350, max: 350 }],
    ['LARGE', 425, { min: 400, max: 450 }], ['FOUR_DOOR', 425, { min: 400, max: 450 }],
  ] as const) {
    const lead = leadFixture();
    lead.moveDetails.items[0].sizeCategory = size;
    const result = price(lead);
    assert.equal(result.suggestedAmount, expected);
    assert.deepEqual(result.priceRange, range);
  }
});

test('stairs apply once per endpoint for a simple fridge, summing amounts and source ranges', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup.floor = 3;
  lead.moveDetails.dropoff.floor = 1;
  const result = price(lead);
  assert.equal(result.suggestedAmount, 850);
  assert.deepEqual(result.priceRange, { min: 750, max: 950 });
  assert.equal(result.breakdown.reduce((sum, part) => sum + part.amount, 0), result.suggestedAmount);
  assert.equal(result.breakdown.filter(part => part.code === 'FLOORS').length, 2);
  assert.ok(hasReason(result, 'FLOOR_COMPOSITION'));
});

test('central range policy sums endpoints rather than inventing percentage margins', () => {
  assert.equal(midpoint(pricingRules.refrigerator.LARGE), 425);
  assert.deepEqual(sumRanges([{ min: 400, max: 450 }, { min: 100, max: 150 }]), { min: 500, max: 600 });
});

test('fridge plus boxes uses one provisional volume band and quantity affects price', () => {
  const lead = leadFixture();
  lead.moveDetails.items.push({ ...createMoveItem('box'), quantity: 8, requiresAssembly: false, requiresDisassembly: false });
  const first = price(lead);
  lead.moveDetails.items[1].quantity = 12;
  const second = price(lead);
  assert.equal(first.suggestedAmount, 425);
  assert.equal(second.suggestedAmount, 500);
  assert.equal(first.breakdown.find(part => part.code === 'BOXES')?.amount, 75);
  assert.equal(second.breakdown.find(part => part.code === 'BOXES')?.amount, 150);
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  assert.equal(first.status, 'RECOMMENDATION_READY');
});

test('missing distance, even with an explicit band, requires review without inferred kilometers', () => {
  const result = price(leadFixture(), { distanceBand: 'local', specialDifficulty: [] });
  assert.equal(result.inputSnapshot.context.distanceKm, null);
  assert.ok(hasReason(result, 'MISSING_DISTANCE'));
  assert.ok(result.confidence < price().confidence);
  assert.ok(!hasReason(price(leadFixture(), { ...context, distanceKm: 0 }), 'MISSING_DISTANCE'));
});

test('unsupported items, electric piano, multiple beds and wardrobes never receive invented rates', () => {
  for (const type of ['electric_piano', 'wardrobe', 'bed', 'other']) {
    const lead = leadFixture();
    lead.moveDetails.items.push({ ...createMoveItem(type), quantity: 2 });
    const result = price(lead);
    assert.ok(hasReason(result, 'ITEM_1_UNSUPPORTED'));
    assert.equal(result.suggestedAmount, 350);
    assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED');
  }
});

test('special access lowers confidence and keeps ordinary stairs separate from unpriced difficulty', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup.floor = 2;
  const ordinary = price(lead);
  lead.moveDetails.specialAccessNotes = 'Narrow staircase';
  const result = price(lead);
  assert.ok(result.confidence < ordinary.confidence);
  assert.ok(hasReason(result, 'SPECIAL_ACCESS'));
  assert.equal(result.breakdown.length, 3);
  assert.equal(price(leadFixture(), { ...context, specialDifficulty: ['Long carry'] }).status, 'MANUAL_REVIEW_REQUIRED');
});

test('non-fitting elevator stays true, prices stair work and flags additional difficulty', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup = { ...lead.moveDetails.pickup, floor: 3, elevator: true };
  const result = price(lead, { ...context, pickupElevatorFits: false });
  assert.equal(result.inputSnapshot.moveDetails.pickup.elevator, true);
  assert.equal(result.inputSnapshot.context.pickupElevatorFits, false);
  assert.ok(hasReason(result, 'pickup_ELEVATOR_DOES_NOT_FIT'));
  assert.equal(result.breakdown.length, 3);
  assert.ok(!hasReason(price(lead), 'pickup_ELEVATOR_FIT_UNKNOWN'));
  assert.ok(hasReason(price(lead, { ...context, pickupElevatorFitRequiredItems: [0] }), 'pickup_ELEVATOR_FIT_UNKNOWN'));
});

test('all statuses require approval, store rule version and detached snapshots', () => {
  for (const lead of [leadFixture(), createLead()]) {
    const result = price(lead);
    assert.equal(result.humanApprovalRequired, true);
    assert.equal(result.ruleVersion, 'MOVING_PRICING_V0_1_3');
    assert.equal(result.provisional, true);
    assert.deepEqual(result.inputSnapshot.moveDetails, lead.moveDetails);
    lead.moveDetails.pickup.floor = 99;
    assert.notEqual(result.inputSnapshot.moveDetails.pickup.floor, 99);
  }
});

test('address, floor, quantity, item, date, and external distance changes invalidate snapshots', () => {
  const changes = [
    (lead: ReturnType<typeof leadFixture>) => { lead.moveDetails.pickup.address = 'Changed address'; },
    (lead: ReturnType<typeof leadFixture>) => { lead.moveDetails.dropoff.floor = 3; },
    (lead: ReturnType<typeof leadFixture>) => { lead.moveDetails.items[0].quantity = 2; },
    (lead: ReturnType<typeof leadFixture>) => { lead.moveDetails.items.push(createMoveItem('box')); },
    (lead: ReturnType<typeof leadFixture>) => { lead.moveDetails.requestedDate = '2026-10-21'; },
  ];
  for (const change of changes) {
    const lead = leadFixture();
    const result = price(lead);
    assert.equal(isPricingEvaluationCurrent(result, lead, context), true);
    change(lead);
    assert.equal(isPricingEvaluationCurrent(result, lead, context), false);
  }
  const lead = leadFixture();
  const result = price(lead);
  lead.messages.push({ id: 'message', sender: 'CUSTOMER', text: 'price 99999', timestamp: metadata.createdAt });
  lead.status = 'AWAITING_REVIEW';
  assert.equal(isPricingEvaluationCurrent(result, lead, context), true);
  assert.equal(isPricingEvaluationCurrent(result, lead, { ...context, distanceKm: 20 }), false);
  assert.equal(fingerprintPricingInput(buildPricingInput(lead, context)), result.inputFingerprint);
});

test('only ready Leads with current requirements and an amount prepare for review; sent/won/lost are preserved', () => {
  const lead = leadFixture();
  const output = evaluateLeadPricing(lead, context, metadata);
  assert.equal(output.lead.status, 'AWAITING_REVIEW');
  assert.equal(output.lead.updatedAt, metadata.createdAt);
  assert.equal(lead.status, 'READY_FOR_PRICING');
  for (const status of ['COLLECTING_INFORMATION', 'AWAITING_REVIEW', 'QUOTE_SENT', 'WON', 'LOST'] as const) {
    lead.status = status;
    assert.equal(evaluateLeadPricing(lead, context, metadata).lead.status, status);
  }
  lead.status = 'READY_FOR_PRICING';
  lead.moveDetails.pickup.floor = null;
  assert.equal(evaluateLeadPricing(lead, context, metadata).lead.status, 'READY_FOR_PRICING');
});

test('unresolved quantity outside the singular convention and unsupported sizes do not invent a fridge amount', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].quantity = null;
  assert.equal(price(lead, { ...context, inventoryComplete: false }).suggestedAmount, null);
  lead.moveDetails.items[0].quantity = 3;
  assert.equal(price(lead).status, 'CANNOT_PRICE');
  lead.moveDetails.items[0].quantity = 1;
  lead.moveDetails.items[0].sizeCategory = 'UNKNOWN';
  lead.moveDetails.items[0].dimensions = { width: 70, height: 180, depth: 60 };
  assert.equal(price(lead).suggestedAmount, null);
  assert.ok(hasReason(price(lead), 'ITEM_0_SIZE'));
});

test('irrelevant unknown appliance services do not block pricing while explicit services still require review', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup.floor = 2;
  lead.moveDetails.items[0].requiresDisassembly = null;
  assert.ok(!hasReason(price(lead), 'ITEM_0_SERVICES_UNKNOWN'));
  assert.equal(price(lead).completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(price(lead).breakdown.length, 3);
  lead.moveDetails.items[0].requiresDisassembly = true;
  assert.ok(hasReason(price(lead), 'ITEM_0_SERVICES_MANUAL'));
  assert.ok(price(lead).omittedComponents.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'));
});

test('complete dimensions or received photo improve completeness but do not imply size or elevator fit', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  const missing = price(lead);
  assert.ok(hasReason(missing, 'ITEM_0_VISUAL_EVIDENCE'));
  lead.moveDetails.items[0].dimensions = { width: 70, height: 180, depth: 60 };
  assert.ok(price(lead).confidence > missing.confidence);
  assert.ok(!hasReason(price(lead), 'ITEM_0_VISUAL_EVIDENCE'));
});

test('multiple points, high volume, many types, basement, workers and duration flag manual review', () => {
  const lead = leadFixture();
  lead.moveDetails.items.push({ ...createMoveItem('box'), quantity: 31 }, createMoveItem('bed'), createMoveItem('electric_piano'));
  lead.moveDetails.pickup.floor = -1;
  const result = price(lead, { ...context, pickupPoints: 2, workers: 3, estimatedDurationHours: 3 });
  for (const code of ['MULTIPLE_POINTS', 'HIGH_VOLUME', 'MANY_ITEM_TYPES', 'pickup_BASEMENT', 'WORKERS_COMPLEXITY', 'DURATION_COMPLEXITY']) assert.ok(hasReason(result, code), code);
  assert.equal(result.breakdown.length, 3);
  assert.equal(result.confidence, 0);
});

test('monetary and confidence invariants hold across categories, access and missing inputs', () => {
  for (const category of ['SMALL', 'REGULAR', 'LARGE', 'FOUR_DOOR', null]) {
    for (const floor of [null, -1, 0, 1, 12]) {
      for (const elevator of [null, false, true]) {
        const lead = leadFixture();
        lead.moveDetails.items[0].sizeCategory = category;
        lead.moveDetails.pickup.floor = floor;
        lead.moveDetails.pickup.elevator = elevator;
        const result = price(lead);
        assertPricingInvariants(result);
        assert.equal(result.confidence, result.suggestedAmount === null ? 0 : Math.max(0, 100 - result.reviewReasons.reduce((sum, reason) => sum + reason.confidenceDeduction, 0)));
      }
    }
  }
});

test('invalid external and Lead facts reject before calculation; overflow is rejected', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    const lead = leadFixture();
    lead.moveDetails.items[0].quantity = quantity;
    assert.throws(() => price(lead));
  }
  for (const distanceKm of [-1, NaN, Infinity]) assert.throws(() => price(leadFixture(), { distanceKm }));
  const lead = leadFixture();
  lead.moveDetails.requestedDate = '2026-02-30';
  assert.throws(() => price(lead));
  lead.moveDetails.requestedDate = '2026-10-20';
  lead.moveDetails.pickup.floor = Number.MAX_SAFE_INTEGER;
  assert.throws(() => price(lead), /safe monetary/);
});

test('eval adapter preserves unknowns, false, zero and avoids duplicate box counts', () => {
  const entry = parsePricingCases([{ id: 'synthetic', sourceQuality: 'closed_job', items: [{ type: 'refrigerator', quantity: 1 }],
    boxCount: 8, currency: 'ILS', outcome: 'WON', closedPrice: 450, pickup: { floor: 0, elevator: false } }])[0];
  const { lead, context: external } = hydratePricingLead(entry);
  assert.equal(lead.moveDetails.items.length, 2);
  assert.equal(lead.moveDetails.pickup.floor, 0);
  assert.equal(lead.moveDetails.pickup.elevator, false);
  assert.equal(lead.moveDetails.requestedDate, null);
  assert.equal(lead.moveDetails.items[0].sizeCategory, null);
  assert.equal(external.inventoryComplete, false);
  assert.throws(() => hydratePricingLead({ ...entry, items: [{ type: 'box', quantity: 8 }] }), /not both/);
});

test('closed comparisons report differences but remain explicitly partial and never accuracy gates', () => {
  const raw = { id: 'synthetic', sourceQuality: 'closed_job', items: [{ type: 'refrigerator', quantity: 1, sizeCategory: 'REGULAR' }],
    currency: 'ILS', outcome: 'WON', closedPrice: 1000, pricingContext: { distanceKm: 10 } };
  const result = runPricingEvals([raw]);
  assert.equal(result.invalid, 0);
  assert.equal(result.partialInput, 1);
  assert.equal(result.results[0].comparison?.recommendedAmount, 350);
  assert.equal(result.results[0].comparison?.closedAmount, 1000);
  assert.equal(result.results[0].comparison?.absoluteDifference, 650);
  assert.equal(result.results[0].comparison?.percentageDifference, 65);
  assert.equal(result.results[0].comparison?.comparableToWholeJob, false);
});

test('historical estimates compare ranges informationally, never becoming actual closed evidence', () => {
  const entry = parsePricingCases([{ id: 'synthetic', sourceQuality: 'historical_estimate',
    items: [{ type: 'refrigerator', quantity: 1 }], currency: 'ILS', outcome: 'UNKNOWN', priceRange: { min: 300, max: 400 } }])[0];
  const comparison = comparePricingEvidence(entry, price());
  assert.equal(comparison.informational, true);
  assert.equal(comparison.rangeComparison, 'WITHIN');
  assert.equal(comparison.closedAmount, null);
  assert.equal(comparison.absoluteDifference, null);
  assert.equal(comparePricingEvidence({ ...entry, priceRange: { min: 400, max: 450 } }, price()).rangeComparison, 'BELOW');
  assert.equal(comparePricingEvidence({ ...entry, priceRange: { min: 200, max: 300 } }, price()).rangeComparison, 'ABOVE');
});

test('structural invariant failures are rejected independently of historical price error', () => {
  assert.throws(() => assertPricingInvariants({ ...price(), suggestedAmount: 999 }), /invariant/);
  assert.throws(() => assertPricingInvariants({ ...price(), confidence: 101 }), /invariant/);
  assert.throws(() => assertPricingInvariants({ ...price(), priceRange: { min: -1, max: 400 } }), /invariant/);
});

test('pricing is offline and has no OpenAI/network imports or runtime fetch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('Pricing must not fetch'); };
  try {
    assert.equal(price().suggestedAmount, 350);
    const directory = new URL('../src/domain/pricing/', import.meta.url);
    for (const name of await readdir(directory)) {
      const source = await readFile(new URL(name, directory), 'utf8');
      assert.doesNotMatch(source, /from\s+['"].*(?:openai|node:https?|integrations)|\bfetch\s*\(/i);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('box volume boundaries, zero boxes, aggregated rows and high-volume omission are explicit', () => {
  assert.equal(price().breakdown.some(part => part.code === 'BOXES'), false);
  for (const [quantity, addition] of [[1, 75], [10, 75], [11, 150], [20, 150], [21, 250], [30, 250]]) {
    const lead = leadFixture();
    lead.moveDetails.items.push({ ...createMoveItem('box'), quantity, requiresAssembly: false, requiresDisassembly: false });
    const result = price(lead);
    assert.equal(result.suggestedAmount, 350 + addition);
    assert.equal(result.completeness, 'COMPLETE_RECOMMENDATION');
  }
  const lead = leadFixture();
  lead.moveDetails.items.push(...[15, 15].map(quantity => ({ ...createMoveItem('box'), quantity, requiresAssembly: false, requiresDisassembly: false })));
  assert.equal(price(lead).breakdown.find(part => part.code === 'BOXES')?.amount, 250);
  lead.moveDetails.items[1].quantity = 16;
  assert.equal(price(lead).completeness, 'PARTIAL_RECOMMENDATION');
  assert.ok(price(lead).omittedComponents.some(part => part.code === 'BOXES'));
});

test('numeric distance uses included threshold then per-km band including fractional kilometers', () => {
  for (const [distanceKm, amount] of [[0, 0], [10, 0], [10.1, 0.75], [20, 75]]) {
    const result = price(leadFixture(), { ...context, distanceKm });
    assert.equal(result.breakdown.find(part => part.code === 'DISTANCE')?.amount, amount);
    assert.equal(result.completeness, 'COMPLETE_RECOMMENDATION');
    assertPricingInvariants(result);
  }
  const missing = price(leadFixture(), { ...context, distanceKm: null });
  assert.equal(missing.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(missing.amountScope, 'SUPPORTED_COMPONENTS_ONLY');
});

test('washing machine uses historical band and no duplicate base; workers/time are complexity only', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0] = { ...lead.moveDetails.items[0], type: 'washing_machine', sizeCategory: null };
  const result = price(lead);
  assert.equal(result.suggestedAmount, 300);
  assert.deepEqual(result.priceRange, { min: 280, max: 320 });
  assert.equal(result.completeness, 'COMPLETE_RECOMMENDATION');
  const workers = price(lead, { ...context, workers: 3, estimatedDurationHours: 4 });
  assert.equal(workers.suggestedAmount, 300);
  assert.equal(workers.completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(workers.status, 'MANUAL_REVIEW_REQUIRED');
  assert.ok(workers.confidence < result.confidence);
});

test('explicit standard service bundles use full historical bands once; unresolved complexity is unpriced', () => {
  for (const [type, amount] of [['bed', 265], ['wardrobe', 475]] as const) {
    const lead = leadFixture();
    lead.moveDetails.items.push({ ...createMoveItem(type), quantity: 1, requiresAssembly: true, requiresDisassembly: true });
    assert.equal(price(lead).breakdown.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'), false);
    assert.ok(hasReason(price(lead), 'ITEM_1_SERVICES_MANUAL'));
    const standard = { ...context, serviceComplexity: { '1': 'STANDARD' as const } };
    const result = price(lead, standard);
    assert.equal(result.breakdown.filter(part => part.code === 'ASSEMBLY_DISASSEMBLY').length, 1);
    assert.equal(result.breakdown.find(part => part.code === 'ASSEMBLY_DISASSEMBLY')?.amount, amount);
    assert.ok(!hasReason(result, 'ITEM_1_SERVICES_MANUAL'));
    assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION', 'service does not establish furniture transport rate');
    lead.moveDetails.items[1].requiresAssembly = false;
    assert.equal(price(lead, standard).breakdown.find(part => part.code === 'ASSEMBLY_DISASSEMBLY')?.amount, amount);
    lead.moveDetails.items[1].requiresDisassembly = false;
    assert.equal(price(lead, standard).breakdown.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'), false);
  }
});

test('explicit extra stops have a fee but unmodeled access keeps recommendation partial', () => {
  const result = price(leadFixture(), { ...context, pickupPoints: 2, dropoffPoints: 2 });
  assert.equal(result.breakdown.find(part => part.code === 'EXTRA_STOP')?.amount, 500);
  assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
  assert.ok(hasReason(result, 'MULTIPLE_POINTS'));
});

test('waiting rounds started half-hours upward and is never inferred from duration', () => {
  for (const [waitingMinutes, expected] of [[1, 150], [30, 150], [31, 300], [60, 300]]) {
    assert.equal(price(leadFixture(), { ...context, waitingMinutes }).breakdown.find(part => part.code === 'WAITING')?.amount, expected);
  }
  assert.equal(price(leadFixture(), { ...context, estimatedDurationHours: 4 }).breakdown.some(part => part.code === 'WAITING'), false);
});

test('student discount is explicit, applies once and preserves correlated range bounds', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].sizeCategory = 'LARGE';
  const result = price(lead, { ...context, studentDiscountEligible: true });
  assert.equal(result.suggestedAmount, 382.5);
  assert.deepEqual(result.priceRange, { min: 360, max: 405 });
  assert.equal(result.breakdown.find(part => part.code === 'DISCOUNT')?.amount, -42.5);
  assert.equal(result.breakdown.reduce((sum, part) => sum + part.amount, 0), result.suggestedAmount);
  assertPricingInvariants(result);
  assert.equal(price(lead).breakdown.some(part => part.code === 'DISCOUNT'), false);
  const fractional = price(lead, { ...context, distanceKm: 26.123, studentDiscountEligible: true });
  assertPricingInvariants(fractional);
});

test('missing floor or fit prevents complete recommendation; irrelevant appliance services do not', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup.elevator = null;
  assert.equal(price(lead).completeness, 'COMPLETE_RECOMMENDATION');
  lead.moveDetails.pickup.floor = 2;
  assert.equal(price(lead).completeness, 'PARTIAL_RECOMMENDATION');
  lead.moveDetails.pickup.elevator = true;
  assert.equal(price(lead).completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(price(lead, { ...context, pickupElevatorFitRequiredItems: [0] }).completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(price(lead, { ...context, pickupElevatorFits: true }).completeness, 'COMPLETE_RECOMMENDATION');
  lead.moveDetails.items[0].requiresAssembly = null;
  assert.equal(price(lead, { ...context, pickupElevatorFits: true }).completeness, 'COMPLETE_RECOMMENDATION');
});

test('browser refrigerator with unknown quantity, 15 boxes, no photo and two stair endpoints prices every supported component', () => {
  const lead = leadFixture();
  lead.moveDetails.items = [
    { ...createMoveItem('refrigerator'), sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE' },
    { ...createMoveItem('box'), quantity: 15 },
  ];
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'סלמה 37', floor: 2, elevator: false };
  lead.moveDetails.requestedDate = '2026-11-08';
  const before = structuredClone(lead);
  const result = price(lead, { distanceKm: 20 });
  assert.deepEqual(lead, before, 'pricing must not fill customer facts on the Lead');
  assert.equal(lead.moveDetails.items[0].quantity, null);
  assert.equal(result.inputSnapshot.moveDetails.items[0].quantity, 1);
  assert.equal(result.inputSnapshot.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.deepEqual(result.inputSnapshot.assumptions.singularRefrigeratorQuantity, [0]);
  assert.equal(result.suggestedAmount, 1150);
  assert.deepEqual(result.priceRange, { min: 950, max: 1350 });
  assert.equal(result.confidence, 60);
  assert.equal(result.completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(result.humanApprovalRequired, true);
  assert.deepEqual(result.breakdown.map(part => [part.code, part.amount]), [
    ['REFRIGERATOR', 425], ['BOXES', 150], ['DISTANCE', 75], ['FLOORS', 250], ['FLOORS', 250],
  ]);
  assert.deepEqual(result.omittedComponents, []);
  assert.deepEqual(result.reviewReasons.map(reason => reason.code), [
    'PROVISIONAL_RULES', 'SINGULAR_ITEM_QUANTITY', 'ACCESS_UNKNOWN', 'ITEM_0_VISUAL_EVIDENCE',
    'PROVISIONAL_BOX_RATE', 'PROVISIONAL_DISTANCE_RATE', 'FLOOR_COMPOSITION',
  ]);
  assert.equal(new Set(result.reviewReasons.map(reason => reason.code)).size, result.reviewReasons.length);
  assert.equal(isPricingEvaluationCurrent(result, lead, { distanceKm: 20 }), true);
  assertPricingInvariants(result);
});

test('singular fridge normalization rejects duplicate, incomplete or ambiguous item evidence', () => {
  const make = () => {
    const lead = leadFixture();
    lead.moveDetails.items[0].quantity = null;
    return lead;
  };
  const scenarios = [
    { change: (lead: ReturnType<typeof make>) => { lead.moveDetails.items.push(createMoveItem('refrigerator')); } },
    { change: (lead: ReturnType<typeof make>) => { lead.moveDetails.items.push({ ...createMoveItem('refrigerator'), quantity: 2 }); } },
    { change: (lead: ReturnType<typeof make>) => { lead.moveDetails.items[0].description = 'Several refrigerators, count pending'; } },
    { change: (lead: ReturnType<typeof make>) => { lead.moveDetails.items.push(createMoveItem()); } },
  ];
  for (const scenario of scenarios) {
    const lead = make();
    scenario.change(lead);
    const input = buildPricingInput(lead, context);
    assert.equal(input.moveDetails.items[0].quantity, null);
    assert.deepEqual(input.assumptions.singularRefrigeratorQuantity, []);
    assert.ok(hasReason(calculatePrice(input, metadata), 'ITEM_0_QUANTITY'));
  }
  const input = buildPricingInput(make(), { ...context, inventoryComplete: false });
  assert.equal(input.moveDetails.items[0].quantity, null);
  assert.deepEqual(input.assumptions.singularRefrigeratorQuantity, []);
  const explicit = make();
  explicit.moveDetails.items[0].quantity = 2;
  assert.equal(price(explicit).breakdown.find(part => part.code === 'REFRIGERATOR')?.amount, 700);
  assert.deepEqual(price(explicit).inputSnapshot.assumptions.singularRefrigeratorQuantity, []);
});

test('unknown assembly is irrelevant for transport appliances/boxes but furniture reasons remain item-specific', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].requiresAssembly = null;
  lead.moveDetails.items[0].requiresDisassembly = null;
  lead.moveDetails.items.push({ ...createMoveItem('box'), quantity: 15 });
  assert.equal(price(lead).reviewReasons.some(reason => /_SERVICES_(MANUAL|UNKNOWN)$/.test(reason.code)), false);
  lead.moveDetails.items.push({ ...createMoveItem('bed'), quantity: 1 }, { ...createMoveItem('wardrobe'), quantity: 1 });
  const result = price(lead);
  assert.deepEqual(result.reviewReasons.filter(reason => reason.code.endsWith('_SERVICES_UNKNOWN')).map(reason => reason.code), ['ITEM_2_SERVICES_UNKNOWN', 'ITEM_3_SERVICES_UNKNOWN']);
  assert.equal(result.reviewReasons.some(reason => reason.code.endsWith('_SERVICES_MANUAL')), false);
  assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
});

test('photo refusal and conversational metadata preserve freshness; received evidence and actual cost facts invalidate it', () => {
  const lead = leadFixture();
  lead.moveDetails.items[0].quantity = null;
  lead.moveDetails.items[0].photoStatus = 'REQUIRED';
  const result = price(lead);
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  lead.messages.push({ id: 'photo-refusal', sender: 'CUSTOMER', text: 'אין לי כרגע', timestamp: metadata.createdAt });
  lead.status = 'AWAITING_REVIEW';
  lead.updatedAt = '2026-10-07T10:00:00.000Z';
  assert.equal(isPricingEvaluationCurrent(result, lead, context), true);
  assert.equal(result.inputSnapshot.moveDetails.items[0].photoStatus, 'REQUIRED', 'audit snapshot keeps original evidence status');
  assert.equal(fingerprintPricingInput(buildPricingInput(lead, context)), result.inputFingerprint);
  lead.moveDetails.items[0].photoStatus = 'RECEIVED';
  assert.equal(isPricingEvaluationCurrent(result, lead, context), false);
  lead.moveDetails.items[0].photoStatus = 'NOT_AVAILABLE';
  lead.moveDetails.items[0].quantity = 1;
  assert.equal(isPricingEvaluationCurrent(result, lead, context), false, 'confirming quantity changes confidence and assumption provenance');
});

test('unknown extra difficulty is an owner caution, while explicit difficulty remains unpriced', () => {
  const lead = leadFixture();
  lead.moveDetails.pickup.floor = 2;
  const unknown = price(lead, { distanceKm: 10 });
  assert.equal(unknown.completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(unknown.status, 'MANUAL_REVIEW_REQUIRED');
  assert.ok(hasReason(unknown, 'ACCESS_UNKNOWN'));
  assert.equal(unknown.breakdown.find(part => part.code === 'FLOORS')?.amount, 250);
  lead.moveDetails.specialAccessNotes = 'Narrow stairwell; crane may be needed';
  const explicit = price(lead, { distanceKm: 10 });
  assert.equal(explicit.completeness, 'PARTIAL_RECOMMENDATION');
  assert.ok(hasReason(explicit, 'SPECIAL_ACCESS'));
  assert.ok(explicit.omittedComponents.some(part => part.code === 'SPECIAL_DIFFICULTY'));
});

test('complete engine evaluations are SCORED even when historical prices differ', () => {
  const lead = leadFixture();
  const result = runPricingEvals([{ id: 'supported-job', sourceQuality: 'closed_job', currency: 'ILS', outcome: 'WON',
    items: [{ type: 'refrigerator', sizeCategory: 'REGULAR', quantity: 1 }], closedPrice: 999,
    pickup: lead.moveDetails.pickup, dropoff: lead.moveDetails.dropoff, requestedDate: lead.moveDetails.requestedDate,
    specialDifficulty: [], disassemblyAssembly: { assembly: false, disassembly: false },
    pricingContext: { distanceKm: 10, inventoryComplete: true },
  }]);
  assert.equal(result.scored, 1);
  assert.equal(result.invalid, 0);
  assert.equal(result.results[0].comparison?.completeness, 'COMPLETE_RECOMMENDATION');
  assert.equal(result.results[0].comparison?.absoluteDifference, 649);
  assert.equal(result.results[0].comparison?.comparableToWholeJob, true);
});

test('structural checks reject negative totals/components, missing version and absent human approval', () => {
  assert.throws(() => assertPricingInvariants({ ...price(), suggestedAmount: -1 }), /invariant/);
  assert.throws(() => assertPricingInvariants({ ...price(), ruleVersion: '' }), /invariant/);
  assert.throws(() => assertPricingInvariants({ ...price(), humanApprovalRequired: false } as unknown as PricingEvaluation), /invariant/);
  const negative = price();
  negative.breakdown[0].amount = -1;
  assert.throws(() => assertPricingInvariants(negative), /invariant/);
});

test('provisional version changes invalidate earlier recommendations and extra context validates', () => {
  const lead = leadFixture();
  assert.equal(isPricingEvaluationCurrent({ ...price(lead), ruleVersion: 'MOVING_PRICING_V0_1' }, lead, context), false);
  for (const waitingMinutes of [-1, 1.5, NaN, Infinity]) assert.throws(() => price(lead, { ...context, waitingMinutes }));
});

function mixedLeadFixture() {
  const lead = leadFixture();
  lead.moveDetails.items = [
    { ...createMoveItem('refrigerator'), sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE' },
    { ...createMoveItem('wardrobe'), sizeCategory: 'די גדול', dimensionsAvailable: false, requiresDisassembly: true },
    { ...createMoveItem('box'), quantity: 15 },
  ];
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'סלמה 37', floor: 3, elevator: true };
  lead.moveDetails.requestedDate = '2026-11-08';
  return lead;
}

test('mixed fridge/wardrobe/boxes prices the supported load and groups unresolved wardrobe risk once', () => {
  for (const assembly of [null, false, true]) {
    const lead = mixedLeadFixture();
    lead.moveDetails.items[1].requiresAssembly = assembly;
    const before = structuredClone(lead);
    const result = price(lead, { distanceKm: 20 });
    assert.deepEqual(lead, before);
    assert.equal(result.suggestedAmount, 900);
    assert.deepEqual(result.priceRange, { min: 750, max: 1050 });
    assert.equal(result.confidence, 40);
    assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
    assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED');
    assert.equal(result.amountScope, 'SUPPORTED_COMPONENTS_ONLY');
    assert.equal(result.humanApprovalRequired, true);
    assert.deepEqual(result.breakdown.map(part => [part.code, part.amount]), [
      ['REFRIGERATOR', 425], ['BOXES', 150], ['DISTANCE', 75], ['FLOORS', 250],
    ]);
    assert.equal(result.breakdown.find(part => part.code === 'FLOORS')?.label, 'pickup stair carry');
    assert.match(result.breakdown.find(part => part.code === 'FLOORS')!.basis, /supported load only/);
    assert.deepEqual(result.inputSnapshot.assumptions, { singularRefrigeratorQuantity: [0], singularWardrobeQuantity: [1] });
    assert.equal(result.inputSnapshot.moveDetails.items[0].quantity, 1);
    assert.equal(result.inputSnapshot.moveDetails.items[1].quantity, 1);
    assert.deepEqual(result.omittedComponents.map(part => [part.code, part.itemIndex]), [
      ['ITEM_DIMENSIONS', 1], ['ASSEMBLY_DISASSEMBLY', 1], ['UNSUPPORTED_ITEM', 1], ['UNSUPPORTED_ITEM_ACCESS', 1],
    ]);
    assert.ok(!result.reviewReasons.some(reason => /_QUANTITY$/.test(reason.code) && reason.code.startsWith('ITEM_')));
    assert.ok(!hasReason(result, 'dropoff_ELEVATOR_FIT_UNKNOWN'));
    assert.deepEqual(result.reviewReasons.filter(reason => reason.code.startsWith('ITEM_1_')).map(reason => [reason.code, reason.confidenceDeduction]), [
      ['ITEM_1_DIMENSIONS_UNAVAILABLE', 0], ['ITEM_1_SERVICES_MANUAL', 0], ['ITEM_1_UNSUPPORTED', 20],
    ]);
    assert.equal(result.reviewReasons.filter(reason => reason.code === 'SINGULAR_ITEM_QUANTITY').length, 1);
    assert.equal(isPricingEvaluationCurrent(result, lead, { distanceKm: 20 }), true);
    assertPricingInvariants(result);
  }
});

test('missing distance keeps the mixed supported subtotal useful without inventing geographic facts', () => {
  const result = price(mixedLeadFixture(), {});
  assert.equal(result.suggestedAmount, 825);
  assert.deepEqual(result.priceRange, { min: 700, max: 950 });
  assert.equal(result.confidence, 30);
  assert.ok(hasReason(result, 'MISSING_DISTANCE'));
  assert.equal(result.breakdown.some(part => part.code === 'DISTANCE'), false);
  assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
});

test('unsupported item risk groups preserve distinct notes without stacking the same unresolved item cost', () => {
  const lead = mixedLeadFixture();
  const original = price(lead, { distanceKm: 20 });
  lead.moveDetails.items[1].requiresDisassembly = null;
  const unknownServices = price(lead, { distanceKm: 20 });
  assert.equal(unknownServices.confidence, original.confidence);
  assert.equal(unknownServices.reviewReasons.filter(reason => reason.code.startsWith('ITEM_1_')).reduce((sum, reason) => sum + reason.confidenceDeduction, 0), 20);
  lead.moveDetails.items[1].description = 'Possibly more than one wardrobe';
  const uncertainQuantity = price(lead, { distanceKm: 20 });
  assert.ok(hasReason(uncertainQuantity, 'ITEM_1_QUANTITY'));
  assert.equal(uncertainQuantity.reviewReasons.filter(reason => reason.code.startsWith('ITEM_1_')).reduce((sum, reason) => sum + reason.confidenceDeduction, 0), 20);
  lead.moveDetails.items.push({ ...createMoveItem('dresser'), quantity: 1 });
  const anotherItem = price(lead, { distanceKm: 20 });
  assert.ok(anotherItem.confidence < uncertainQuantity.confidence);
  assert.equal(anotherItem.reviewReasons.filter(reason => reason.code.startsWith('ITEM_3_')).reduce((sum, reason) => sum + reason.confidenceDeduction, 0), 20);
});

test('unknown dresser services are not manufactured, while an explicit service remains manual', () => {
  const lead = mixedLeadFixture();
  lead.moveDetails.items[1] = { ...createMoveItem('dresser'), quantity: 1, sizeCategory: 'SMALL' };
  lead.moveDetails.dropoff = { ...lead.moveDetails.dropoff, floor: 1, elevator: false };
  const before = structuredClone(lead);
  const unknown = price(lead);
  assert.equal(unknown.suggestedAmount, 950);
  assert.equal(unknown.completeness, 'PARTIAL_RECOMMENDATION');
  assert.ok(!unknown.reviewReasons.some(reason => /^ITEM_1_SERVICES/.test(reason.code)));
  assert.ok(!unknown.omittedComponents.some(part => part.itemIndex === 1 && ['ASSEMBLY_DISASSEMBLY', 'SERVICE_REQUIREMENTS'].includes(part.code)));
  assert.ok(unknown.omittedComponents.some(part => part.itemIndex === 1 && part.code === 'UNSUPPORTED_ITEM'));
  assert.deepEqual(lead, before);
  lead.moveDetails.items[1].requiresDisassembly = true;
  const requested = price(lead);
  assert.ok(hasReason(requested, 'ITEM_1_SERVICES_MANUAL'));
  assert.ok(requested.omittedComponents.some(part => part.code === 'ASSEMBLY_DISASSEMBLY' && part.itemIndex === 1));
  assert.equal(requested.inputSnapshot.moveDetails.items[1].requiresAssembly, null);
  assert.equal(requested.suggestedAmount, unknown.suggestedAmount);
  assert.equal(requested.confidence, unknown.confidence, 'The existing unsupported-item risk grouping is unchanged');
});

test('unknown bed and wardrobe service needs remain clarification without claiming required services', () => {
  for (const type of ['bed', 'wardrobe']) {
    const lead = mixedLeadFixture();
    lead.moveDetails.items[1] = { ...createMoveItem(type), quantity: 1 };
    const result = price(lead);
    assert.ok(hasReason(result, 'ITEM_1_SERVICES_UNKNOWN'));
    assert.ok(!hasReason(result, 'ITEM_1_SERVICES_MANUAL'));
    assert.ok(result.omittedComponents.some(part => part.code === 'SERVICE_REQUIREMENTS' && part.itemIndex === 1));
    assert.ok(!result.omittedComponents.some(part => part.code === 'ASSEMBLY_DISASSEMBLY' && part.itemIndex === 1));
    assert.equal(result.inputSnapshot.moveDetails.items[1].requiresAssembly, null);
    assert.equal(result.inputSnapshot.moveDetails.items[1].requiresDisassembly, null);
    assert.equal(result.suggestedAmount, 825);
    assert.equal(result.humanApprovalRequired, true);
  }
});

test('high box volume and unresolved supported counts retain refrigerator pricing but suppress unsupported stair composition', () => {
  for (const quantity of [null, 31, 40]) {
    const lead = mixedLeadFixture();
    lead.moveDetails.items[2].quantity = quantity;
    const result = price(lead, { distanceKm: 20 });
    assert.equal(result.breakdown.find(part => part.code === 'REFRIGERATOR')?.amount, 425);
    assert.equal(result.breakdown.some(part => part.code === 'BOXES'), false);
    assert.equal(result.breakdown.some(part => part.code === 'FLOORS'), false);
    assert.ok(hasReason(result, 'HIGH_VOLUME'));
    assert.equal(result.completeness, 'PARTIAL_RECOMMENDATION');
  }
  const lead = mixedLeadFixture();
  lead.moveDetails.items.push(createMoveItem('washing_machine'));
  assert.equal(price(lead).breakdown.some(part => part.code === 'FLOORS'), false);
  lead.moveDetails.items[3].quantity = 2;
  const complex = price(lead);
  assert.equal(complex.breakdown.some(part => ['REFRIGERATOR', 'WASHING_MACHINE', 'FLOORS'].includes(part.code)), false);
  assert.ok(hasReason(complex, 'HIGH_VOLUME'));
});

test('wardrobe singular assumptions reject duplicates, explicit quantities, ambiguous descriptions and incomplete inventory', () => {
  const lead = mixedLeadFixture();
  for (const type of ['wardrobe', 'refrigerator'] as const) {
    const duplicate = structuredClone(lead);
    duplicate.moveDetails.items.push(createMoveItem(type));
    const input = buildPricingInput(duplicate);
    assert.equal(input.moveDetails.items.find(item => item.type === type)?.quantity, null);
  }
  const ambiguous = structuredClone(lead);
  ambiguous.moveDetails.items[1].description = 'Count unresolved';
  assert.equal(buildPricingInput(ambiguous).moveDetails.items[1].quantity, null);
  const explicit = structuredClone(lead);
  explicit.moveDetails.items[1].quantity = 2;
  assert.equal(buildPricingInput(explicit).moveDetails.items[1].quantity, 2);
  assert.deepEqual(buildPricingInput(explicit).assumptions.singularWardrobeQuantity, []);
  const incomplete = buildPricingInput(lead, { inventoryComplete: false });
  assert.equal(incomplete.moveDetails.items[0].quantity, null);
  assert.equal(incomplete.moveDetails.items[1].quantity, null);
});

test('fit checks require explicit item-specific context, while explicit non-fit still prices supported stairs', () => {
  const lead = mixedLeadFixture();
  const ordinary = price(lead, { distanceKm: 20 });
  const requiredContext = { distanceKm: 20, dropoffElevatorFitRequiredItems: [0] };
  const required = price(lead, requiredContext);
  assert.ok(hasReason(required, 'dropoff_ELEVATOR_FIT_UNKNOWN'));
  assert.equal(required.breakdown.filter(part => part.code === 'FLOORS').length, 1);
  assert.ok(required.confidence < ordinary.confidence);
  assert.equal(isPricingEvaluationCurrent(ordinary, lead, requiredContext), false);
  assert.equal(hasReason(price(lead, { ...requiredContext, dropoffElevatorFits: true }), 'dropoff_ELEVATOR_FIT_UNKNOWN'), false);
  const nonFit = price(lead, { distanceKm: 20, dropoffElevatorFits: false });
  assert.equal(nonFit.breakdown.filter(part => part.code === 'FLOORS').length, 2);
  assert.equal(nonFit.inputSnapshot.moveDetails.dropoff.elevator, true);
  assert.ok(hasReason(nonFit, 'dropoff_ELEVATOR_DOES_NOT_FIT'));
  assert.equal(nonFit.omittedComponents.filter(part => part.code === 'UNSUPPORTED_ITEM_ACCESS' && part.itemIndex === 1).length, 1);
  for (const indices of [[-1], [0.5], [3]]) assert.throws(() => buildPricingInput(lead, { dropoffElevatorFitRequiredItems: indices }));
});

test('standard service context does not override explicitly unavailable dimensions', () => {
  const lead = mixedLeadFixture();
  const standard = { distanceKm: 20, serviceComplexity: { '1': 'STANDARD' as const } };
  assert.equal(price(lead, standard).breakdown.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'), false);
  lead.moveDetails.items[1].dimensions = { width: 120, height: 200, depth: 60 };
  const supplied = price(lead, standard);
  assert.equal(supplied.breakdown.find(part => part.code === 'ASSEMBLY_DISASSEMBLY')?.amount, 475);
  assert.equal(supplied.omittedComponents.some(part => part.code === 'UNSUPPORTED_ITEM'), true);
  assert.equal(supplied.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(price(lead, { ...standard, serviceComplexity: { '1': 'COMPLEX' } }).breakdown.some(part => part.code === 'ASSEMBLY_DISASSEMBLY'), false);
});
