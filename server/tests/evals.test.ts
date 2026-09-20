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
  assert.equal(fixtures.conversationCases.length, 15);
  assert.equal(fixtures.pricingCases.length, 3);
  assert.deepEqual(fixtures.pricingCases.map(entry => ({
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
  assert.deepEqual(fixtures.pricingCases.map(entry => [entry.pickup, entry.dropoff]), [
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
  for (const value of [-1, Infinity, NaN, '450']) {
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
