import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEvalCases } from '../src/evals/loadEvalCases.js';
import { offlineFixtures } from '../src/evals/conversationFixtures.js';
import { runConversationEvals } from '../src/evals/runConversationEvals.js';
import { runPricingEvals } from '../src/evals/runPricingEvals.js';
import { evaluateDatasets, runEvals, runEvalCli } from '../src/evals/runEvals.js';
import { formatEvalReport } from '../src/evals/formatEvalReport.js';
import { checkConversation, compareProjection } from '../src/evals/conversationAssertions.js';
import { actualQuestion, hydrateEvalLead } from '../src/evals/hydrateEvalLead.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';

const datasets = await loadEvalCases();
const find = (id: string) => structuredClone(datasets.conversationCases.find(entry => entry.id === id)!);
const validPricing = datasets.pricingCases[0];

test('runner loads every public case and reports evidence readiness without scoring price accuracy', async () => {
  const report = await runEvals();
  assert.equal(report.conversation.total, 25);
  assert.ok(report.conversation.results.every(entry => entry.status === 'PASS' || ['conv-011', 'conv-025'].includes(entry.id)));
  assert.equal(report.conversation.notRun, 2);
  assert.equal(report.pricing.total, 6);
  assert.deepEqual(report.pricing.sourceQuality, { closed_job: 3, quoted_only: 0, historical_estimate: 3 });
  assert.equal(report.pricing.withClosedPrice, 3);
  assert.equal(report.pricing.withQuotedPrice, 3);
  assert.equal(report.pricing.requiringHumanApproval, 1);
  assert.equal(report.pricing.withPriceRange, 1);
  assert.equal(report.pricing.ready, 6);
  assert.equal(report.pricing.invalid, 0);
  assert.ok(report.pricing.results.every(entry => entry.status === 'READY_FOR_PRICING_EVAL'));
});

test('an executable domain photo case passes without an extraction mock being consumed', async () => {
  const [result] = await runConversationEvals([find('conv-005')]);
  assert.equal(result.status, 'PASS');
  assert.equal(result.mode, 'DOMAIN');
  assert.deepEqual(result.failedAssertions, []);
  assert.ok(result.checkedAssertions.includes('unavailable photos not re-requested'));
  assert.ok(result.manualMustNot.length > 0, 'unscored policy text remains explicit');
});

test('fixture-based PASS is explicitly scoped and a wrong expected state produces FAIL', async () => {
  const entry = find('conv-003');
  const [passed] = await runConversationEvals([entry]);
  assert.equal(passed.status, 'PASS');
  assert.equal(passed.mode, 'FIXTURE');
  assert.match(passed.reason, /AI extraction accuracy was not evaluated/);
  entry.expectedStateChanges!['moveDetails.dropoff.elevator'] = true;
  const [failed] = await runConversationEvals([entry]);
  assert.equal(failed.status, 'FAIL');
  assert.ok(failed.failedAssertions.some(message => message.includes('expected true, got false')));
});

test('expected extraction is an assertion, not a source of mock execution output', async () => {
  const entry = find('conv-003');
  entry.expectedExtraction = { moveDetails: { dropoff: { elevator: true } } };
  const [result] = await runConversationEvals([entry]);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failedAssertions.some(message => message.includes('extraction.moveDetails.dropoff.elevator')));
});

test('future, missing-fixture, stale, unsupported-intent and unsupported-state cases are NOT_RUN', async () => {
  const missing = { ...find('conv-003'), id: 'no-fixture' };
  const stale = { ...find('conv-003'), customerMessage: 'changed message' };
  const intent = { ...find('conv-003'), expectedAgentIntent: ['unknown_intent'] };
  const snapshot = { ...find('conv-003'), currentLeadState: { unsupported: true } };
  for (const entry of [find('conv-011'), find('conv-025'), missing, stale, intent, snapshot]) {
    const [result] = await runConversationEvals([entry]);
    assert.equal(result.status, 'NOT_RUN');
    assert.ok(result.reason.length > 0);
    assert.deepEqual(result.checkedAssertions, []);
  }
});

test('a corrupt fixture cannot authorize overwriting unrelated known false or inventing dimensions', async () => {
  const entry = find('conv-006');
  const fixtures = structuredClone(offlineFixtures);
  fixtures[entry.id].extraction!.moveDetails!.pickup = { elevator: true };
  fixtures[entry.id].extraction!.moveDetails!.items![0].dimensions = { width: 999 };
  const [result] = await runConversationEvals([entry], fixtures);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failedAssertions.some(message => message.includes('unrelated state changed from false to true')));
  assert.ok(result.failedAssertions.some(message => message.includes('expected null, got 999')));
});

test('mustNot checks detect repeated unavailable photos and already-known requirements', async () => {
  const entry = find('conv-005');
  const lead = hydrateEvalLead(entry);
  const output = await processCustomerMessageWithExtractor(lead, entry.customerMessage, {
    lastQuestion: actualQuestion(entry, lead),
    extractor: () => { assert.fail('No extraction should be needed'); },
  });
  output.nextQuestion = { text: 'באיזו קומה האיסוף?', requirements: [{ id: 'pickup.floor' }] };
  output.responseText = 'אפשר לצרף תמונה של המקרר?';
  const checked = checkConversation(entry, lead, output, offlineFixtures[entry.id]);
  assert.ok(checked.failures.some(message => message.includes('Already-known')));
  assert.ok(checked.failures.some(message => message.includes('repeats an unavailable photo')));
});

test('extraction comparisons match unique item types rather than incidental array ordering', () => {
  const failures: string[] = [];
  compareProjection({ items: [{ type: 'box', quantity: 15 }, { type: 'refrigerator', sizeCategory: 'LARGE' }] },
    { items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box', quantity: 15 }] }, 'extraction', failures);
  assert.deepEqual(failures, []);
  compareProjection({ items: [{ type: 'box', quantity: 15 }] },
    { items: [{ type: 'box', quantity: 15 }, { type: 'box', quantity: 15 }] }, 'extraction', failures);
  assert.equal(failures.length, 1);
});

test('access-note assertions accept meaning-preserving phrasing and reject missing facts', () => {
  const failures: string[] = [];
  const fixture = offlineFixtures['conv-010'];
  compareProjection('חדר מדרגות צר עם פנייה חדה באיסוף', 'באיסוף מדרגות צרות ופנייה חדה',
    'moveDetails.specialAccessNotes', failures, fixture);
  assert.deepEqual(failures, []);
  compareProjection('חדר מדרגות צר עם פנייה חדה באיסוף', 'מדרגות בפריקה',
    'moveDetails.specialAccessNotes', failures, fixture);
  assert.equal(failures.length, 1);
});

test('invalid pricing evidence is INVALID and duplicate IDs are rejected in each runner', async () => {
  const invalid = runPricingEvals([{ ...validPricing, closedPrice: null }]);
  assert.equal(invalid.invalid, 1);
  assert.equal(invalid.results[0].status, 'INVALID');
  assert.equal(invalid.ready, 0);
  const duplicatePricing = runPricingEvals([validPricing, validPricing]);
  assert.equal(duplicatePricing.invalid, 2);
  assert.equal(duplicatePricing.ready, 0);
  const duplicateConversation = await runConversationEvals([find('conv-005'), find('conv-005')]);
  assert.ok(duplicateConversation.every(entry => entry.status === 'FAIL'));
  assert.ok(duplicateConversation.every(entry => entry.failedAssertions.some(message => /Duplicate/.test(message))));
});

test('overall status and exit code distinguish passing, failing, invalid and empty runs', async () => {
  const passed = await evaluateDatasets({ conversationCases: [find('conv-005')], pricingCases: [validPricing] });
  assert.equal(passed.status, 'PASSED');
  assert.equal(passed.exitCode, 0);
  const bad = find('conv-003');
  bad.expectedStateChanges!['moveDetails.dropoff.elevator'] = true;
  const failed = await evaluateDatasets({ conversationCases: [bad], pricingCases: [validPricing] });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.exitCode, 1);
  const invalid = await evaluateDatasets({ conversationCases: [find('conv-005')], pricingCases: [{ ...validPricing, currency: 'NIS' }] });
  assert.equal(invalid.exitCode, 1);
  assert.equal((await evaluateDatasets({ conversationCases: [], pricingCases: [] })).exitCode, 1);
  const loadError = await runEvals(async () => { throw new Error('Synthetic load failure'); });
  assert.equal(loadError.exitCode, 1);
  assert.match(loadError.errors[0], /Synthetic load failure/);
});

test('report ordering and contents remain deterministic despite runtime Lead IDs and timestamps', async () => {
  const first = await evaluateDatasets(datasets);
  const second = await evaluateDatasets(datasets);
  assert.deepEqual(first, second);
  assert.equal(formatEvalReport(first), formatEvalReport(second));
  assert.deepEqual(first.conversation.results.map(entry => entry.id), datasets.conversationCases.map(entry => entry.id));
  assert.deepEqual(first.pricing.results.map(entry => entry.id), datasets.pricingCases.map(entry => entry.id));
  assert.match(formatEvalReport(first), /Manual mustNot review/);
});

test('CLI JSON is machine-readable and returns nonzero for required failures', async () => {
  let output = '';
  const entry = find('conv-003');
  entry.expectedStateChanges!['moveDetails.dropoff.elevator'] = true;
  const code = await runEvalCli(['--json'], async () => ({ conversationCases: [entry], pricingCases: [validPricing] }),
    text => { output += text; });
  assert.equal(code, 1);
  assert.equal(JSON.parse(output).status, 'FAILED');
  assert.equal(await runEvalCli(['--unknown'], undefined, () => {}), 1);
});

test('actual node CLI process propagates a failing report as exit status 1', () => {
  const url = new URL('../src/evals/runEvals.ts', import.meta.url).href;
  const source = 'const { runEvalCli } = await import(' + JSON.stringify(url) + ');' +
    'process.exitCode = await runEvalCli(["--json"], async () => ({ conversationCases: [], pricingCases: [] }));';
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stderr);
  assert.equal(JSON.parse(child.stdout).exitCode, 1);
});

test('root npm eval:json propagates the report exit code for CI and emits clean JSON with --silent', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const child = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run --silent eval:json'], { cwd: root, encoding: 'utf8' })
    : spawnSync('npm', ['run', '--silent', 'eval:json'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.error, undefined);
  const report = JSON.parse(child.stdout);
  assert.equal(child.status, report.exitCode, child.stderr);
  assert.ok(child.status === 0 || child.status === 1);
});

test('offline runner performs no live fetch even with all extraction fixtures exercised', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Network forbidden in offline evals'); };
  try {
    const report = await runEvals();
    assert.equal(calls, 0);
    assert.equal(report.conversation.notRun, 2);
    assert.ok(report.conversation.results.every(entry => entry.reason !== 'Invalid case or offline execution error.'));
    assert.equal(report.pricing.ready, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
