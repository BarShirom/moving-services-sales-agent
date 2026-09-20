import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertPublicEvalText, loadEvalCases, parseConversationCases, parsePricingCases,
} from '../src/evals/loadEvalCases.js';

const directory = new URL('../../data/evals/', import.meta.url);
const fixtures = await loadEvalCases();
const conversation = {
  id: 'minimal-conversation', scenario: 'minimal', customerMessage: 'שלום',
  expectedAgentIntent: ['ask_for_move_details'],
};
const pricing = {
  id: 'minimal-pricing', sourceQuality: 'closed_job', items: [{ type: 'sofa', quantity: 1 }],
  closedPrice: 450, currency: 'ILS', outcome: 'WON',
};

test('the reusable loader parses both datasets and preserves the supplied closed-job facts', () => {
  assert.equal(fixtures.conversationCases.length, 25);
  assert.equal(fixtures.pricingCases.length, 6);
  const closedJobs = fixtures.pricingCases.filter(entry => entry.sourceQuality === 'closed_job');
  assert.equal(closedJobs.length, 3);
  assert.deepEqual(closedJobs.map(entry => ({
    quote: entry.quotedPrice, close: entry.closedPrice, workers: entry.workers, vehicles: entry.vehicles,
    boxes: entry.boxCount, source: entry.sourceQuality, currency: entry.currency, outcome: entry.outcome,
  })), [
    { quote: 450, close: 450, workers: 2, vehicles: null, boxes: null, source: 'closed_job', currency: 'ILS', outcome: 'WON' },
    { quote: 1200, close: 1200, workers: 3, vehicles: 2, boxes: 8, source: 'closed_job', currency: 'ILS', outcome: 'WON' },
    { quote: 2990, close: 2990, workers: 3, vehicles: 2, boxes: 25, source: 'closed_job', currency: 'ILS', outcome: 'WON' },
  ]);
  assert.deepEqual(fixtures.pricingCases[0].items, [{ type: 'dishwasher', quantity: 1 }, { type: 'oven', quantity: 1 }]);
  assert.deepEqual(fixtures.pricingCases[1].items, [
    { type: 'sofa', quantity: 1 }, { type: 'bed_base', quantity: 1 }, { type: 'mattress', quantity: 1 },
    { type: 'refrigerator', quantity: 1 }, { type: 'television', quantity: 2 }, { type: 'coffee_table', quantity: 1 },
  ]);
  assert.deepEqual(fixtures.pricingCases[2].items.map(item => item.type),
    ['bed', 'television', 'washing_machine', 'dryer', 'cabinet', 'armchair', 'electric_piano']);
  assert.deepEqual(closedJobs.map(entry => [entry.pickup, entry.dropoff]), [
    [{ floor: 3, elevator: true }, { floor: 1, elevator: false }],
    [{ floor: 2, elevator: false }, { floor: 0, elevator: true }],
    [{ floor: 3, elevator: false }, { floor: 2, elevator: false }],
  ]);
  assert.ok(fixtures.conversationCases.every(entry => entry.scenario && entry.customerMessage));
  assert.equal(fixtures.conversationCases.find(entry => entry.id === 'conv-011')?.status, 'future');
});

test('optional conversation and pricing fields can be omitted', () => {
  assert.deepEqual(parseConversationCases([conversation]), [conversation]);
  assert.deepEqual(parsePricingCases([pricing]), [pricing]);
});

test('conversation required fields and nonempty intents are enforced', () => {
  for (const field of ['id', 'scenario', 'customerMessage', 'expectedAgentIntent']) {
    const candidate: Record<string, unknown> = { ...conversation };
    delete candidate[field];
    assert.throws(() => parseConversationCases([candidate]), field);
  }
  for (const field of ['id', 'scenario', 'customerMessage']) {
    assert.throws(() => parseConversationCases([{ ...conversation, [field]: '   ' }]));
  }
  assert.throws(() => parseConversationCases([{ ...conversation, expectedAgentIntent: [] }]));
  assert.throws(() => parseConversationCases([]));
  assert.throws(() => parseConversationCases({ cases: [conversation] }));
});

test('pricing required fields are enforced', () => {
  for (const field of ['id', 'sourceQuality', 'items', 'currency', 'outcome']) {
    const candidate: Record<string, unknown> = { ...pricing };
    delete candidate[field];
    assert.throws(() => parsePricingCases([candidate]), field);
  }
  assert.throws(() => parsePricingCases([]));
  assert.throws(() => parsePricingCases([{ ...pricing, items: [] }]));
});

test('duplicate conversation IDs are rejected instead of silently replacing a case', () => {
  assert.throws(() => parseConversationCases([conversation, { ...conversation, scenario: 'different' }]), /Duplicate case ID/);
});

test('duplicate pricing IDs are rejected even when their prices differ', () => {
  assert.throws(() => parsePricingCases([pricing, { ...pricing, closedPrice: 500 }]), /Duplicate case ID/);
});

test('source quality and supported currency values are validated', () => {
  for (const sourceQuality of ['estimate', 'CLOSED_JOB', '', null]) {
    assert.throws(() => parsePricingCases([{ ...pricing, sourceQuality }]));
  }
  for (const currency of ['NIS', 'ils', 'AAA', '$', '', null]) {
    assert.throws(() => parsePricingCases([{ ...pricing, currency }]));
  }
});

test('closed jobs require a closed price and keep quote and closed amounts distinct', () => {
  for (const closedPrice of [undefined, null]) {
    assert.throws(() => parsePricingCases([{ ...pricing, closedPrice }]), /actual closed price/);
  }
  const [result] = parsePricingCases([{ ...pricing, quotedPrice: 500, closedPrice: 450 }]);
  assert.equal(result.quotedPrice, 500);
  assert.equal(result.closedPrice, 450);
});

test('quoted-only and historical estimates cannot masquerade as closed-job evidence', () => {
  const quoted = { ...pricing, sourceQuality: 'quoted_only', quotedPrice: 500, closedPrice: null, outcome: 'OPEN' };
  const estimated = { ...quoted, sourceQuality: 'historical_estimate', quotedPrice: null, estimatedPrice: 600, outcome: 'UNKNOWN' };
  assert.equal(parsePricingCases([quoted])[0].sourceQuality, 'quoted_only');
  assert.equal(parsePricingCases([estimated])[0].estimatedPrice, 600);
  assert.throws(() => parsePricingCases([{ ...quoted, quotedPrice: null }]));
  assert.throws(() => parsePricingCases([{ ...quoted, closedPrice: 450 }]));
  assert.throws(() => parsePricingCases([{ ...estimated, estimatedPrice: null }]));
  assert.throws(() => parsePricingCases([{ ...estimated, quotedPrice: 500 }]));
  assert.throws(() => parsePricingCases([{ ...estimated, closedPrice: 450 }]));
  assert.throws(() => parsePricingCases([{ ...pricing, estimatedPrice: 600 }]));
});

test('invalid numeric values and calendar dates are rejected while unknowns stay unknown', () => {
  for (const value of [0, -1, Infinity, NaN, '450']) {
    assert.throws(() => parsePricingCases([{ ...pricing, closedPrice: value }]));
  }
  for (const workers of [0, -2, 1.5]) assert.throws(() => parsePricingCases([{ ...pricing, workers }]));
  for (const boxCount of [-1, 2.5]) assert.throws(() => parsePricingCases([{ ...pricing, boxCount }]));
  assert.throws(() => parsePricingCases([{ ...pricing, items: [{ type: 'sofa', quantity: 0 }] }]));
  assert.throws(() => parsePricingCases([{ ...pricing, requestedDate: '2026-02-30' }]));
  assert.throws(() => parseConversationCases([{ ...conversation, referenceDate: '25/09' }]));
  const [unknown] = parsePricingCases([{ ...pricing, workers: null, vehicles: null, boxCount: null }]);
  assert.equal(unknown.workers, null);
  assert.equal(unknown.vehicles, null);
  assert.equal(unknown.boxCount, null);
  assert.equal(parsePricingCases([{ ...pricing, boxCount: 0 }])[0].boxCount, 0);
});

test('all files in the public eval directory pass the privacy tripwire', async () => {
  async function inspect(folder: URL): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''), folder);
      if (entry.isDirectory()) await inspect(path);
      else assertPublicEvalText(await readFile(path, 'utf8'));
    }
  }
  await inspect(directory);
});

test('privacy checks reject obvious phone formats without echoing private matches', () => {
  for (const phone of ['050-123-4567', '+972 50 123 4567', '03-1234567', '+1 (202) 555-0123', '0501234567']) {
    assert.throws(() => assertPublicEvalText('contact: ' + phone), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /phone number/);
      assert.ok(!error.message.includes(phone));
      return true;
    });
  }
});

test('privacy checks reject email addresses including in nested decoded JSON', () => {
  assert.throws(() => assertPublicEvalText('contact: synthetic@example.test'), /email address/);
  assert.throws(() => parseConversationCases([{ ...conversation,
    currentLeadState: { notes: { email: 'synthetic@example.test' } },
  }]), /email address/);
  const escaped = JSON.parse('{"note":"synthetic\\u0040example.test"}'.replace('\\\\', '\\'));
  assert.throws(() => parsePricingCases([{ ...pricing, notes: escaped.note }]), /email address/);
});

test('privacy checks reject obvious raw chat export metadata', () => {
  for (const line of [
    '20/09/2026, 14:32 - Synthetic sender: hello',
    '[20/09/2026, 14:32:08] Synthetic sender: hello',
    'Messages and calls are end-to-end encrypted.',
    'ההודעות והשיחות מוצפנות מקצה לקצה',
    '<Media omitted>',
  ]) assert.throws(() => assertPublicEvalText(line), /raw WhatsApp metadata/);
});

test('privacy checks accept synthetic dates, measurements, house numbers and prices', () => {
  for (const text of [
    '2026-09-25', '25/09/2026', 'גובה 180 רוחב 70 עומק 68',
    'רחוב דוגמה א 20', 'quotedPrice: 2990', 'conv-015', '15 ארגזים',
  ]) assert.doesNotThrow(() => assertPublicEvalText(text));
});

test('loader rejects malformed JSON and scans documentation from a supplied directory', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'moving-evals-'));
  const names = ['conversation-cases.json', 'pricing-cases.json', 'README.md'];
  t.after(async () => {
    await Promise.all(names.map(name => unlink(join(folder, name))));
    await rmdir(folder);
  });
  await Promise.all([
    writeFile(join(folder, names[0]), '{', 'utf8'),
    writeFile(join(folder, names[1]), JSON.stringify([pricing]), 'utf8'),
    writeFile(join(folder, names[2]), 'Synthetic fixture documentation.', 'utf8'),
  ]);
  const url = pathToFileURL(folder + sep);
  await assert.rejects(loadEvalCases(url), SyntaxError);
  await writeFile(join(folder, names[0]), JSON.stringify([conversation]), 'utf8');
  await writeFile(join(folder, names[2]), 'contact: synthetic@example.test', 'utf8');
  await assert.rejects(loadEvalCases(url), /email address/);
});

test('historical job additions retain evidence limits instead of inventing quotes or outcomes', () => {
  const historical = fixtures.pricingCases.filter(entry => entry.sourceQuality === 'historical_estimate');
  assert.deepEqual(historical.map(entry => entry.id), ['pricing-004', 'pricing-005', 'pricing-006']);
  assert.equal(fixtures.pricingCases.filter(entry => entry.sourceQuality === 'quoted_only').length, 0);
  assert.deepEqual(historical.map(entry => entry.estimatedPrice), [750, 2200, 4500]);
  for (const entry of historical) {
    assert.equal(entry.outcome, 'UNKNOWN');
    assert.equal(entry.quotedPrice, null);
    assert.equal(entry.closedPrice, null);
    assert.equal(entry.workers, null);
    assert.equal(entry.vehicles, null);
    assert.equal(entry.requestedDate, null);
    assert.ok(entry.evidenceNote);
    assert.equal(entry.pickup?.address, undefined);
    assert.equal(entry.dropoff?.address, undefined);
  }
  assert.deepEqual(historical[0].items, [
    { type: 'refrigerator', sizeCategory: 'SMALL', quantity: 1 },
    { type: 'washing_machine', quantity: 1 },
  ]);
  assert.deepEqual(historical[0].pickup, { floor: 3, elevator: false });
  assert.deepEqual(historical[0].dropoff, { floor: 1, elevator: null });
  assert.deepEqual(historical[1].priceRange, { min: 1900, max: 2400 });
  assert.equal(historical[1].boxCount, 30);
  assert.equal(historical[1].items.find(item => item.type === 'television')?.quantity, null);
  assert.match(historical[1].notes!, /approximately 30/);
  assert.equal(historical[2].humanApprovalRequired, true);
  assert.equal(historical[2].items.find(item => item.type === 'wardrobe')?.quantity, null);
  assert.equal(historical[2].items.find(item => item.type === 'plant')?.quantity, 44);
  assert.equal(historical[2].items.find(item => item.type === 'suitcase')?.quantity, 5);
  assert.equal(historical[2].boxCount, 25);
  for (const entry of historical.slice(1)) {
    assert.deepEqual(entry.pickup, { floor: null, elevator: null });
    assert.deepEqual(entry.dropoff, { floor: null, elevator: null });
  }
});

test('optional historical price ranges preserve bounds without requiring an invented point estimate', () => {
  const rangeOnly = {
    ...pricing, sourceQuality: 'historical_estimate', closedPrice: null,
    outcome: 'UNKNOWN', priceRange: { min: 1900, max: 2400 },
  };
  const [result] = parsePricingCases([rangeOnly]);
  assert.equal(result.estimatedPrice, undefined);
  assert.equal(result.pickup, undefined);
  assert.equal(result.dropoff, undefined);
  assert.deepEqual(result.priceRange, { min: 1900, max: 2400 });
  assert.equal(parsePricingCases([{ ...rangeOnly, estimatedPrice: 2200 }])[0].estimatedPrice, 2200);
  assert.deepEqual(parsePricingCases([{ ...rangeOnly, priceRange: { min: 750, max: 750 } }])[0].priceRange,
    { min: 750, max: 750 });
  for (const priceRange of [
    { min: 2400, max: 1900 }, { min: 0, max: 2400 }, { min: -1, max: 2400 },
    { min: 1900, max: 0 }, { min: 1900, max: Infinity }, { min: '1900', max: 2400 },
    { min: 1900 }, { max: 2400 },
  ]) assert.throws(() => parsePricingCases([{ ...rangeOnly, priceRange }]));
  for (const estimatedPrice of [1800, 2500]) {
    assert.throws(() => parsePricingCases([{ ...rangeOnly, estimatedPrice }]), /within its supplied range/);
  }
  assert.throws(() => parsePricingCases([{ ...rangeOnly, priceRange: undefined }]), /estimated price or range/);
});

test('reference ranges cannot substitute for actual quoted or closed prices', () => {
  const priceRange = { min: 400, max: 450 };
  assert.throws(() => parsePricingCases([{ ...pricing, priceRange }]), /only to historical_estimate/);
  assert.throws(() => parsePricingCases([{
    ...pricing, sourceQuality: 'quoted_only', quotedPrice: 450, closedPrice: null, priceRange,
  }]), /only to historical_estimate/);
  assert.throws(() => parsePricingCases([{ ...pricing, closedPrice: undefined, priceRange }]), /actual closed price/);
  assert.throws(() => parsePricingCases([{
    ...pricing, sourceQuality: 'quoted_only', closedPrice: null, priceRange,
  }]), /quote that was sent/);
});

test('all pricing amount fields are strictly positive and unknown quantities remain explicit', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => parsePricingCases([{ ...pricing, quotedPrice: value }]));
    assert.throws(() => parsePricingCases([{
      ...pricing, sourceQuality: 'historical_estimate', closedPrice: null, outcome: 'UNKNOWN', estimatedPrice: value,
    }]));
  }
  const unknownItem = { type: 'wardrobe', quantity: null };
  const [result] = parsePricingCases([{ ...pricing, items: [unknownItem] }]);
  assert.deepEqual(result.items, [unknownItem]);
  for (const quantity of [0, -1, 1.5]) {
    assert.throws(() => parsePricingCases([{ ...pricing, items: [{ ...unknownItem, quantity }] }]));
  }
  assert.throws(() => parsePricingCases([{ ...pricing, humanApprovalRequired: 'yes' }]));
  assert.throws(() => parsePricingCases([{ ...pricing, evidenceNote: ' ' }]));
});

test('historical heuristic references stay in documentation rather than masquerading as closed jobs', async () => {
  const readme = await readFile(new URL('README.md', directory), 'utf8');
  for (const reference of [
    'small refrigerator', 'regular refrigerator', 'large / four-door refrigerator', 'washing machine',
    'additional pickup/dropoff point', 'floors without elevator', 'bed disassembly/assembly',
    'wardrobe disassembly/assembly', 'waiting time', 'student discount',
  ]) assert.ok(readme.includes(reference), reference);
  const closed = fixtures.pricingCases.filter(entry => entry.sourceQuality === 'closed_job');
  assert.deepEqual(closed.map(entry => entry.id), ['pricing-001', 'pricing-002', 'pricing-003']);
  assert.deepEqual(closed.map(entry => entry.closedPrice), [450, 1200, 2990]);
  assert.ok(!fixtures.pricingCases.some(entry => entry.closedPrice === 2000 || entry.quotedPrice === 2200));
});
