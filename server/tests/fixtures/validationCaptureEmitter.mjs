// Explicitly invoked offline emitter. No work, credentials or network on import.
// A parent collector holds stdout/stderr only in memory and persists its own
// allowlisted diagnostic record. These are reconstructed fixtures, never a
// recovered provider response or an explanation of the original failed request.
import assert from 'node:assert/strict';
import {
  chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CASES = Object.freeze([
  'box_size_category', 'invalid_requested_time', 'hebrew_month_date',
  'schema_invalid', 'valid_success',
]);
export const EXPECTED_VALIDATION = Object.freeze({
  box_size_category: Object.freeze(['items[].sizeCategory', 'refrigerator_only']),
  invalid_requested_time: Object.freeze(['requestedTime', 'time_hh_mm']),
  hebrew_month_date: Object.freeze(['requestedDate', 'date_normalization']),
  schema_invalid: Object.freeze(['items', 'schema_invalid_type']),
  valid_success: null,
});

export async function loadValidationContract(sourceRoot) {
  const url = new URL('integrations/openai/validationMetadata.js', sourceRoot);
  // The historical baseline has no metadata module. Current compiled trees do.
  if (!existsSync(fileURLToPath(url))) return null;
  const module = await import(url.href);
  const pairs = module.VALIDATION_FIELD_RULE_PAIRS;
  assert.ok(Array.isArray(pairs) && pairs.length > 0 && pairs.length <= 2048);
  assert.ok(pairs.every(pair => Array.isArray(pair) && pair.length === 2
    && typeof pair[0] === 'string' && pair[0].length <= 100
    && typeof pair[1] === 'string' && pair[1].length <= 64));
  return pairs;
}

const MESSAGE = 'אני צריך להעביר מקרר גדול אחד ו-15 ארגזים. האיסוף ברחוב הדגמה 11 ברמת גן, קומה 2 בלי מעלית. הפריקה ברחוב הדגמה 22 בתל אביב, קומה 1 בלי מעלית. ההובלה ב-8 בנובמבר 2026. אין צורך בפירוק או בהרכבה. אין לי תמונה כרגע.';
const REFERENCE_DATE = '2026-10-19';
const START = Date.parse('2026-10-21T23:59:00Z');
const FAKE_REQUEST_ID = `req_${'c7'.repeat(16)}`;
const keep = () => ({ action: 'keep' });
const set = value => ({ action: 'set', value });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
const empty = () => ({ items: [], pickup: location(), dropoff: location(),
  requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep() });
const item = type => ({ type, quantity: keep(), sizeCategory: keep(), photoStatus: keep(),
  dimensionsAvailable: keep(), dimensions: { width: keep(), height: keep(), depth: keep() },
  requiresDisassembly: keep(), requiresAssembly: keep() });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Exact scenario and three mutations copied from recordedDomainFailure.test.ts.
export function reconstructedScenario() {
  return { ...empty(), items: [
    { ...item('refrigerator'), quantity: set(1), sizeCategory: set('LARGE'),
      photoStatus: set('NOT_AVAILABLE'), requiresDisassembly: set(false), requiresAssembly: set(false) },
    { ...item('box'), quantity: set(15), requiresDisassembly: set(false), requiresAssembly: set(false) },
  ], pickup: { city: set('רמת גן'), address: set('הדגמה 11'), floor: set(2), elevator: set(false) },
  dropoff: { city: set('תל אביב'), address: set('הדגמה 22'), floor: set(1), elevator: set(false) },
  requestedDate: set('2026-11-08') };
}

export function fixtureFor(name) {
  assert.ok(CASES.includes(name), 'KNOWN_OFFLINE_CASE_REQUIRED');
  const data = reconstructedScenario();
  if (name === 'box_size_category') data.items[1].sizeCategory = set('LARGE');
  if (name === 'invalid_requested_time') data.requestedTime = set('29:99');
  if (name === 'hebrew_month_date') data.requestedDate = set('8 בנובמבר 2026');
  if (name === 'schema_invalid') data.items = 'SYNTHETIC_VALUE_NEVER_PERSIST';
  return data;
}

function options(argv) {
  if (argv.length === 0) return null;
  assert.equal(argv.length, 6, 'EXPLICIT_SOURCE_FIXTURE_AND_CASE_REQUIRED');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert.ok(['--source-root', '--fixture', '--case'].includes(key) && !(key in values), 'INVALID_OPTION');
    values[key] = argv[index + 1];
  }
  const source = new URL(values['--source-root']);
  assert.equal(source.protocol, 'file:', 'LOCAL_FILE_SOURCE_REQUIRED');
  assert.ok(source.pathname.endsWith('/'), 'SOURCE_ROOT_TRAILING_SLASH_REQUIRED');
  assert.equal(source.search + source.hash, '', 'LOCAL_FILE_SOURCE_REQUIRED');
  assert.ok(isAbsolute(values['--fixture']), 'ABSOLUTE_SYNTHETIC_FIXTURE_REQUIRED');
  assert.ok(CASES.includes(values['--case']), 'KNOWN_OFFLINE_CASE_REQUIRED');
  return { source, fixture: resolve(values['--fixture']), name: values['--case'] };
}

export async function emitCase({ source, fixture, name }) {
  let phase = 'load_source';
  let actualWindow;
  let originalFetch;
  try {
    const load = path => import(new URL(path, source).href);
    const [{ createAIExtractor }, { createAIWindow, AI_WINDOW_PROJECT_ID, AIWindowError },
      { AIExtractionSchema, extractionTextFormat }, { freshOwnerState },
      { processCustomerMessageWithExtractor }, { AIExtractionError }] = await Promise.all([
      load('integrations/openai/extractMessageWithAI.js'), load('safety/aiWindow.js'),
      load('integrations/openai/schema.js'), load('demo/ownerWorkflow.js'),
      load('domain/conversation/processCustomerMessage.js'), load('integrations/openai/errors.js'),
    ]);
    const validationContract = await loadValidationContract(source);
    const sortedContract = validationContract === null ? null : [...validationContract]
      .map(pair => [...pair]).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1
        : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0);
    phase = 'prepare_synthetic_state';
    assert.ok(CASES.includes(name), 'KNOWN_OFFLINE_CASE_REQUIRED');
    assert.equal(realpathSync(fixture), fixture, 'REAL_SYNTHETIC_FIXTURE_REQUIRED');
    const metadata = lstatSync(fixture);
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), 'PRIVATE_FIXTURE_DIRECTORY_REQUIRED');
    if (process.platform !== 'win32') assert.equal(metadata.mode & 0o077, 0, 'PRIVATE_FIXTURE_DIRECTORY_REQUIRED');
    const app = join(fixture, 'app');
    // Exclusive single-child creation: no existing fixture/history is reused.
    mkdirSync(app, { mode: 0o700 });
    const stateDir = join(app, 'state');
    mkdirSync(stateDir, { mode: 0o700 });
    const permitPath = join(app, 'permit.json');
    writeFileSync(permitPath, JSON.stringify({ version: 1, windowId: `offline-emitter-${name}`,
      startsAt: new Date(START).toISOString(), expiresAt: new Date(START + 300000).toISOString(),
      maxAttempts: 1, maxReservedUnits: 400000, maxReservedMicros: 500000,
      projectId: AI_WINDOW_PROJECT_ID, operatorApprovalRef: 'offline-fixture-only',
      credentialKeyId: 'key_offline_new', rotatedFromKeyId: 'key_offline_old',
      credentialExpiresAt: '2026-11-01T00:00:00Z', rotationVerifiedAt: '2026-10-21T22:00:00Z',
    }), { flag: 'wx', mode: 0o444 });
    chmodSync(permitPath, 0o444);
    const journalPath = join(stateDir, 'window.claim.jsonl');
    const syncs = [];
    let lastSyncedBytes = 0;
    const syncFile = fd => {
      fsyncSync(fd);
      lastSyncedBytes = fstatSync(fd).size;
      syncs.push({ kind: 'file', bytes: lastSyncedBytes });
    };
    const syncDirectory = path => {
      if (process.platform === 'win32') {
        // Windows cannot supply the Linux directory-fsync guarantee. This mode
        // is explicitly marked; the full durability assertion requires Linux.
        syncs.push({ kind: 'windows_directory_substitute' });
        return;
      }
      const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(fd); syncs.push({ kind: 'directory' }); }
      finally { closeSync(fd); }
    };
    actualWindow = createAIWindow({ stateDir, permitPath, wallNow: () => START,
      monotonicNow: () => 0, syncFile, syncDirectory });
    assert.equal(actualWindow.snapshot().state, 'open', 'SYNTHETIC_WINDOW_DID_NOT_OPEN');
    const rows = () => readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    let originalFailure = null;
    // Observe the original error without bypassing or replacing durable run().
    const observedWindow = {
      run: (request, dispatch) => actualWindow.run(request, async signal => {
        try { return await dispatch(signal); }
        catch (error) {
          originalFailure = error;
          throw error;
        }
      }),
      close: reason => actualWindow.close(reason), snapshot: () => actualWindow.snapshot(),
    };
    const data = fixtureFor(name);
    assert.equal(AIExtractionSchema.safeParse(data).success, name !== 'schema_invalid', 'FIXTURE_SCHEMA_BOUNDARY_CHANGED');
    let dispatches = 0;
    let journalSyncedBeforeDispatch = false;
    let contextChecked = false;
    const owner = freshOwnerState();
    const before = structuredClone(owner);
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      dispatches += 1;
      assert.equal(dispatches, 1, 'OFFLINE_FIXTURE_RETRY_FORBIDDEN');
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('x-stainless-retry-count'), '0');
      const ledger = readFileSync(journalPath);
      assert.equal(rows().filter(row => row.event === 'attempt').length, 1);
      assert.ok(lastSyncedBytes >= ledger.length && syncs.filter(entry => entry.kind === 'file').length >= 2,
        'ATTEMPT_NOT_FSYNCED_BEFORE_SYNTHETIC_DISPATCH');
      assert.ok(syncs.some(entry => entry.kind === (process.platform === 'win32' ? 'windows_directory_substitute' : 'directory')));
      journalSyncedBeforeDispatch = true;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.text.format.strict, true);
      assert.deepEqual(request.text.format.schema, extractionTextFormat.schema);
      const context = JSON.parse(request.input[0].content);
      assert.equal(context.latestCustomerMessage, MESSAGE);
      assert.equal(context.referenceDate, REFERENCE_DATE);
      assert.deepEqual(context.lastQuestion, owner.customer.nextQuestion);
      assert.deepEqual(context.currentLead, { moveDetails: owner.customer.lead.moveDetails });
      contextChecked = true;
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant',
        status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(data), annotations: [] }] }] }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': FAKE_REQUEST_ID } });
    };
    // The string is invented test data, never read from an env file or inherited
    // provider configuration. The real installed SDK sees only intercepted fetch.
    const extractor = createAIExtractor({ env: { OPENAI_API_KEY: 'synthetic-offline-only',
      OPENAI_MODEL: 'gpt-6-luna', OPENAI_PROJECT_ID: AI_WINDOW_PROJECT_ID }, window: observedWindow });
    phase = 'execute_one_synthetic_case';
    let result;
    let outerFailure = null;
    try {
      result = await processCustomerMessageWithExtractor(owner.customer.lead, MESSAGE, { extractor,
        lastQuestion: owner.customer.nextQuestion ?? undefined, referenceDate: REFERENCE_DATE });
    } catch (error) { outerFailure = error; }
    assert.deepEqual(owner, before, 'CALLER_OWNER_STATE_MUTATED');
    assert.equal(dispatches, 1);
    assert.equal(contextChecked, true);
    assert.equal(journalSyncedBeforeDispatch, true);
    const success = name === 'valid_success';
    if (success) {
      assert.equal(outerFailure, null);
      assert.equal(originalFailure, null);
      assert.equal(result.lead.moveDetails.requestedDate, '2026-11-08');
      assert.deepEqual(result.lead.moveDetails.items.map(entry => [entry.type, entry.quantity]),
        [['refrigerator', 1], ['box', 15]]);
      assert.equal(result.lead.moveDetails.pickup.floor, 2);
      assert.equal(result.lead.moveDetails.pickup.elevator, false);
      assert.equal(result.lead.moveDetails.dropoff.floor, 1);
      assert.equal(result.lead.moveDetails.dropoff.elevator, false);
    } else {
      assert.ok(outerFailure instanceof AIWindowError);
      assert.equal(outerFailure.code, 'AI_WINDOW_CLOSED');
      assert.equal(outerFailure.reason, 'request_failed');
      assert.ok(originalFailure instanceof AIExtractionError);
      assert.equal(originalFailure.code, 'INVALID_EXTRACTION');
    }
    const ledger = readFileSync(journalPath);
    const entries = rows();
    const attempts = entries.filter(row => row.event === 'attempt');
    const outcomes = entries.filter(row => row.event === 'outcome');
    assert.equal(attempts.length, 1);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome, success ? 'returned' : 'failed');
    const snapshot = actualWindow.snapshot();
    assert.equal(snapshot.state, 'closed');
    assert.equal(snapshot.attempts, 1);
    assert.equal(snapshot.reason, success ? 'budget_exhausted' : 'request_failed');
    assert.equal(snapshot.reservedUnits, attempts[0].reservedUnits);
    assert.equal(snapshot.reservedMicros, attempts[0].reservedMicros);
    assert.ok(snapshot.reservedUnits > 0 && snapshot.reservedMicros > 0);
    assert.ok(entries.every(row => !['refund', 'released', 'reset'].includes(row.event)));
    assert.equal(lastSyncedBytes, ledger.length);
    phase = 'complete';
    return { result: 'PASS', case: name, reconstructed: true, originalProviderOutputUsed: false,
      fakeSdkDispatchCount: dispatches, actualProviderRequests: 0, nativeLinuxDirectoryFsync: process.platform !== 'win32',
      windowsDirectorySyncSubstitute: process.platform === 'win32', actualDurableAIWindow: true,
      journalSyncedBeforeDispatch, sdkContextChecked: contextChecked, callerOwnerUnchanged: true,
      originalErrorCode: originalFailure?.code ?? null, wrappedErrorCode: outerFailure?.code ?? null,
      wrappedReason: outerFailure?.reason ?? null, actualPublicHttpEnvelopeObserved: false,
      journalSha256: hash(ledger), journalBytes: ledger.length, attempts: 1,
      returned: success ? 1 : 0, failed: success ? 0 : 1,
      reservedUnits: snapshot.reservedUnits, reservedMicros: snapshot.reservedMicros,
      closedReason: snapshot.reason, noRefund: true, fileFsyncs: syncs.filter(entry => entry.kind === 'file').length,
      directoryFsyncs: syncs.filter(entry => entry.kind === 'directory').length,
      syntheticMessageUtf8Sha256: hash(Buffer.from(MESSAGE, 'utf8')),
      expectedValidationPair: EXPECTED_VALIDATION[name],
      validationContractPairCount: sortedContract?.length ?? 0,
      validationContractCompactSortedUtf8Sha256: sortedContract === null ? null
        : hash(Buffer.from(JSON.stringify(sortedContract), 'utf8')),
      fakeProviderRequestId: FAKE_REQUEST_ID };
  } catch (error) {
    // Never print an SDK error/message/stack, request, response or assertion value.
    const known = new Set(['AssertionError', 'Error', 'TypeError', 'RangeError', 'SyntaxError']);
    return { result: 'FAIL', case: name, phase, errorType: known.has(error?.name) ? error.name : 'UnknownError',
      actualProviderRequests: 0 };
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    actualWindow?.close('operator_stop');
    // The parent collector owns cleanup. Keep every synthetic ledger and permit.
  }
}

async function main() {
  const parsed = options(process.argv.slice(2));
  if (parsed === null) { process.stdout.write('{"result":"INERT","providerRequests":0}\n'); return; }
  const result = await emitCase(parsed);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    process.stdout.write('{"result":"FAIL","phase":"arguments","actualProviderRequests":0}\n');
    process.exitCode = 1;
  });
}
