import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadEvalCases } from '../src/evals/loadEvalCases.js';
import { evidenceCategories, loadPricingEvidence, parsePricingEvidence } from '../src/evals/loadPricingEvidence.js';
import { pricingRules } from '../src/domain/pricing/pricingRules.js';

const loaded = await loadPricingEvidence();
const sources = await loadEvalCases();
const fresh = () => structuredClone({ evidence: loaded.evidence, readiness: loaded.readiness });
const parse = (value: ReturnType<typeof fresh>) => parsePricingEvidence(value.evidence, value.readiness);

test('offline evidence layer covers all categories and references the current unmodified rule version', () => {
  assert.equal(loaded.readiness.pricingRuleVersion, pricingRules.version);
  assert.deepEqual(loaded.readiness.categories.map(row => row.category).sort(), [...evidenceCategories].sort());
  assert.ok(loaded.evidence.records.length >= 20);
  assert.ok(loaded.evidence.records.every(record => record.currency === 'ILS' && record.humanApprovalRequired));
});

test('duplicate IDs and invalid evidence/readiness enums fail instead of silently overwriting records', () => {
  const duplicate = fresh();
  duplicate.evidence.records.push(duplicate.evidence.records[0]);
  assert.throws(() => parse(duplicate), /unique/);
  for (const [field, value] of [['evidenceType', 'PRICE'], ['sourceQuality', 'closed_job'], ['scope', 'BUNDLE'], ['currency', 'USD']]) {
    const candidate = fresh();
    Object.assign(candidate.evidence.records[0], { [field]: value });
    assert.throws(() => parse(candidate), field);
  }
  for (const [field, value] of [['status', 'SUPPORTED'], ['category', 'unknown']]) {
    const candidate = fresh();
    Object.assign(candidate.readiness.categories[0], { [field]: value });
    assert.throws(() => parse(candidate), field);
  }
});

test('all supplied price fields reject zero, negative and non-finite amounts; ranges reject inverted bounds', () => {
  for (const field of ['referencePrice', 'estimatedPrice', 'quotedPrice', 'closedPrice', 'expectedClosePrice']) {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidate = fresh();
      Object.assign(candidate.evidence.records[0], { [field]: value });
      assert.throws(() => parse(candidate), `${field}:${value}`);
    }
  }
  for (const field of ['priceRange', 'expectedCloseRange']) {
    const candidate = fresh();
    Object.assign(candidate.evidence.records[0], { [field]: { min: 450, max: 300 } });
    assert.throws(() => parse(candidate), /minimum/);
  }
});

test('confirmed closed jobs require an actual price; estimates cannot silently become sent or closed jobs', () => {
  const missing = fresh();
  const closed = missing.evidence.records.find(record => record.evidenceType === 'CLOSED_JOB')!;
  delete closed.closedPrice;
  assert.throws(() => parse(missing), /closedPrice/);
  for (const patch of [{ closedPrice: 2000 }, { quotedPrice: 2200 }, { outcome: 'WON' }, { evidenceType: 'CLOSED_JOB', closedPrice: 2200, outcome: 'WON' }]) {
    const candidate = fresh();
    const estimate = candidate.evidence.records.find(record => record.originalSourceQuality === 'historical_estimate')!;
    Object.assign(estimate, patch);
    assert.throws(() => parse(candidate));
  }
});

test('existing six cases retain source identity, amounts, outcome, staffing, known access and original inventory', () => {
  for (const source of sources.pricingCases) {
    const reference = `data/evals/pricing-cases.json#${source.id}`;
    const matches = loaded.evidence.records.filter(record => record.sourceReference.includes(reference));
    assert.equal(matches.length, 1, `one linked record for ${source.id}`);
    const record = matches[0];
    assert.equal(record.originalSourceQuality, source.sourceQuality);
    assert.equal(record.sourceQuality, source.sourceQuality === 'closed_job' ? 'STRONG' : 'WEAK');
    assert.equal(record.scope, 'JOB_LEVEL');
    assert.equal(record.quotedPrice, source.quotedPrice);
    assert.equal(record.closedPrice, source.closedPrice);
    assert.equal(record.outcome, source.outcome);
    assert.equal(record.estimatedPrice ?? null, source.estimatedPrice ?? null);
    assert.equal(record.workers, source.workers);
    assert.equal(record.vehicles, source.vehicles);
    for (const side of ['pickup', 'dropoff'] as const) {
      assert.equal(record[side]?.floor, source[side]?.floor);
      assert.equal(record[side]?.elevator, source[side]?.elevator);
    }
    for (const item of source.items) {
      const matching = record.items?.find(candidate => candidate.type === item.type);
      assert.ok(matching, `${source.id}:${item.type}`);
      assert.equal(matching.quantity, item.quantity);
    }
    if (source.boxCount !== null && source.boxCount !== undefined) {
      assert.equal(record.items?.find(item => item.type === 'box')?.quantity, source.boxCount);
    }
  }
  assert.deepEqual(loaded.evidence.records.filter(record => record.evidenceType === 'CLOSED_JOB').map(record => record.closedPrice).sort((a, b) => a! - b!), [450, 1200, 2990]);
});

test('bundle prices cannot be smuggled into item fields or linked as tariff evidence', () => {
  const candidate = fresh();
  const job = candidate.evidence.records.find(record => record.evidenceType === 'CLOSED_JOB')!;
  Object.assign(job.items![0], { transportPrice: 225 });
  assert.throws(() => parse(candidate));
  const decomposed = fresh();
  const jobWithSofa = decomposed.evidence.records.find(record => record.evidenceType === 'CLOSED_JOB' && record.categories.includes('sofa_transport'))!;
  const sofa = decomposed.readiness.categories.find(row => row.category === 'sofa_transport')!;
  sofa.status = 'PROVISIONAL';
  sofa.evidenceIds = [jobWithSofa.id];
  sofa.tariffEvidenceIds = [jobWithSofa.id];
  assert.throws(() => parse(decomposed), /cannot be decomposed/);
  sofa.tariffEvidenceIds = [];
  assert.throws(() => parse(decomposed), /require direct evidence/);
});

test('readiness rejects missing IDs, mismatched categories, cross-scope service evidence and unearned READY', () => {
  const unknown = fresh();
  unknown.readiness.categories[0].evidenceIds.push('missing-evidence');
  assert.throws(() => parse(unknown), /unknown evidence ID/);
  const mismatched = fresh();
  const fridge = mismatched.readiness.categories.find(row => row.category === 'refrigerator_transport')!;
  fridge.evidenceIds.push(mismatched.evidence.records.find(record => record.categories.includes('waiting'))!.id);
  assert.throws(() => parse(mismatched), /mismatched category/);
  const scope = fresh();
  const wardrobeService = scope.evidence.records.find(record => record.scope === 'SERVICE_LEVEL' && record.categories.includes('wardrobe_assembly_disassembly'))!;
  const wardrobeTransport = scope.readiness.categories.find(row => row.category === 'wardrobe_transport')!;
  wardrobeService.categories.push('wardrobe_transport');
  wardrobeTransport.evidenceIds = [wardrobeService.id];
  wardrobeTransport.tariffEvidenceIds = [wardrobeService.id];
  assert.throws(() => parse(scope), /matching isolated/);
  const unearned = fresh();
  unearned.readiness.categories.find(row => row.category === 'distance')!.status = 'READY';
  assert.throws(() => parse(unearned), /strong direct evidence/);
});

test('box and distance tariffs explicitly remain weak engineering assumptions, not historical calibration', () => {
  for (const category of ['boxes', 'distance']) {
    const row = loaded.readiness.categories.find(entry => entry.category === category)!;
    assert.equal(row.engineRule.provenance, 'ENGINEERING_ASSUMPTION');
    assert.equal(row.status, 'PROVISIONAL');
    assert.ok(row.tariffEvidenceIds.length);
    for (const evidenceId of row.tariffEvidenceIds) {
      const record = loaded.evidence.records.find(entry => entry.id === evidenceId)!;
      assert.equal(record.sourceBasis, 'ENGINEERING_ASSUMPTION');
      assert.equal(record.sourceQuality, 'WEAK');
    }
  }
  const candidate = fresh();
  candidate.evidence.records.find(record => record.sourceBasis === 'ENGINEERING_ASSUMPTION')!.sourceQuality = 'STRONG';
  assert.throws(() => parse(candidate), /Engineering assumptions/);
});

test('privacy checks reject phone/email/export metadata including decoded escapes; identity/address keys are unsupported', () => {
  const privateValues = ['050-123-4567', 'person@example.test', '[01/02/2026, 12:30] Example: exported message', '<Media omitted>'];
  for (const value of privateValues) {
    const candidate = fresh();
    candidate.evidence.records[0].evidenceNote = value;
    assert.throws(() => parse(candidate), /Public eval content/);
  }
  const escaped = fresh();
  escaped.evidence.records[0].evidenceNote = JSON.parse('"person\\u0040example.test"') as string;
  assert.throws(() => parse(escaped), /email/);
  for (const field of ['customerName', 'customerId', 'phone', 'email', 'wa_id', 'pushName']) {
    const candidate = fresh();
    Object.assign(candidate.evidence.records[0], { [field]: 'not-public' });
    assert.throws(() => parse(candidate));
  }
  const address = fresh();
  address.evidence.records[0].pickup = { floor: 0 };
  Object.assign(address.evidence.records[0].pickup, { address: 'raw address' });
  assert.throws(() => parse(address));
});

test('open-ended references, expected closes and disputed close claims stay distinct from actual transactions', () => {
  const island = loaded.evidence.records.find(record => record.categories.includes('kitchen_island_transport'))!;
  assert.equal(island.priceRange?.min, 400);
  assert.equal(island.priceRange?.max, null);
  const bedRange = loaded.evidence.records.find(record => record.scope === 'ITEM_LEVEL' && record.categories.includes('bed_transport'))!;
  assert.equal(bedRange.priceRange?.min, 180);
  assert.equal(bedRange.priceRange?.upperBoundOpen, true);
  assert.ok(loaded.evidence.records.some(record => record.expectedClosePrice === 900 && record.evidenceType === 'HISTORICAL_ESTIMATE'));
  assert.ok(loaded.evidence.records.some(record => record.expectedCloseRange?.min === 600 && record.expectedCloseRange.max === 650));
  assert.ok(!loaded.evidence.records.some(record => [500, 2000].includes(record.closedPrice ?? 0)));
});

test('documentation records the owner learning loop and prevents automatic tariff changes', async () => {
  assert.ok(/owner learning loop/i.test(loaded.documentation), 'Owner learning loop section is required.');
  for (const phrase of [/engine suggested amount/i, /owner approved amount/i, /owner adjustment amount/i,
    /internal adjustment reason/i, /quote sent/i, /accepted\/rejected/i, /closed\/final amount/i,
    /duration\/workers\/vehicles/i, /systematic bias/i, /version pricing rules/i, /run evals/i, /human approval/i]) {
    assert.ok(phrase.test(loaded.documentation), `Missing learning-loop documentation: ${phrase}`);
  }
  assert.ok(/(?:must not|do not|never) automatically (?:change|update) tariffs/i.test(loaded.documentation), 'Documentation must prohibit automatic tariff changes.');
  // Public documentation is loaded and scanned along with JSON, from source and compiled paths.
  const raw = await readFile(new URL('../../data/evals/PRICING_EVIDENCE.md', import.meta.url), 'utf8');
  assert.equal(raw, loaded.documentation);
});
