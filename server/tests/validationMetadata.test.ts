import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { createLead } from '../src/domain/createLead.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import type { Lead } from '../src/domain/lead.js';
import { convertAIExtraction } from '../src/integrations/openai/convertExtraction.js';
import { extractionDiagnostics, safeZodIssues, type AIExtractionDiagnostic } from '../src/integrations/openai/diagnostics.js';
import { AIExtractionError } from '../src/integrations/openai/errors.js';
import { AIExtractionSchema, type AIExtraction } from '../src/integrations/openai/schema.js';
import { sanitizeValidationMetadata, schemaValidationMetadata, VALIDATION_DOMAIN_PAIRS,
  VALIDATION_FIELD_RULE_PAIRS, VALIDATION_SCHEMA_CODES, VALIDATION_SCHEMA_FIELDS } from '../src/integrations/openai/validationMetadata.js';
import { AIWindowError } from '../src/safety/aiWindow.js';

// All values are local fixtures. No SDK dispatch or provider credentials are used.
const keep = () => ({ action: 'keep' as const });
const set = <T>(value: T) => ({ action: 'set' as const, value });
const correct = <T>(value: T) => ({ action: 'correct' as const, value });
const location = () => ({ city: keep(), address: keep(), floor: keep(), elevator: keep() });
function empty(): AIExtraction {
  return { items: [], pickup: location(), dropoff: location(), requestedDate: keep(), requestedTime: keep(), specialAccessNotes: keep() };
}
function item(): AIExtraction['items'][number] {
  return { type: 'refrigerator', quantity: keep(), sizeCategory: keep(), photoStatus: keep(), dimensionsAvailable: keep(),
    dimensions: { width: keep(), height: keep(), depth: keep() }, requiresDisassembly: keep(), requiresAssembly: keep() };
}
const unknown = { validationField: 'unknown', validationRule: 'unknown' };
function pair(event: { validationField: string; validationRule: string }) {
  return { validationField: event.validationField, validationRule: event.validationRule };
}
function eventFor(error: unknown): AIExtractionDiagnostic {
  const events: AIExtractionDiagnostic[] = [];
  const log = extractionDiagnostics(event => { events.push(event); });
  log.capture(error); log.failure(error); log.failure(error);
  assert.equal(events.length, 1);
  assert.equal(Object.keys(events[0]).length, 19);
  return events[0];
}
function rejection(data: AIExtraction, lead: Lead, field: string, rule: string, path: string) {
  assert.equal(AIExtractionSchema.safeParse(data).success, true, 'domain fixture must pass the unchanged wire schema');
  const before = structuredClone(lead);
  let caught: AIExtractionError | undefined;
  assert.throws(() => convertAIExtraction(data, lead, { referenceDate: '2026-10-19' }), error => {
    assert.ok(error instanceof AIExtractionError);
    assert.equal(error.code, 'INVALID_EXTRACTION');
    assert.equal(error.message, `Invalid AI extraction at ${path}.`);
    caught = error; return true;
  });
  assert.deepEqual(lead, before);
  const expected = { validationField: field, validationRule: rule };
  assert.deepEqual(pair(caught!), expected);
  const event = eventFor(caught);
  assert.equal(event.classification, 'domain_validation');
  assert.equal(event.stage, 'domain_validation');
  assert.deepEqual(event.zodIssues, []);
  assert.deepEqual(pair(event), expected);
  assert.equal(JSON.stringify(event).includes(caught!.message), false);
}

for (const side of ['pickup', 'dropoff'] as const) {
  for (const key of ['city', 'address'] as const) {
    for (const value of ['  ', 'x'.repeat(2001)]) {
      test(`domain ${side}.${key} rejects ${value.length > 2000 ? 'oversized' : 'blank'} text with fixed metadata`, () => {
        const data = empty(); data[side][key] = set(value);
        rejection(data, createLead(), `${side}.${key}`, 'nonblank_text', `${side}.${key}`);
      });
    }
  }
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    test(`domain ${side}.floor rejects non-safe integer ${value}`, () => {
      const data = empty(); data[side].floor = set(value);
      rejection(data, createLead(), `${side}.floor`, 'safe_integer', `${side}.floor`);
    });
  }
}
for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`domain quantity rejects ${value} with positive_integer`, () => {
    const data = empty(); data.items = [{ ...item(), quantity: set(value) }];
    rejection(data, createLead(), 'items[].quantity', 'positive_integer', 'refrigerator.quantity');
  });
}
for (const axis of ['width', 'height', 'depth'] as const) {
  test(`domain ${axis} rejects zero with positive_finite_number`, () => {
    const data = empty(), entry = item(); entry.dimensions[axis] = set(0); data.items = [entry];
    rejection(data, createLead(), `items[].dimensions.${axis}`, 'positive_finite_number', `refrigerator.${axis}`);
  });
}
test('domain duplicate item and non-refrigerator size preserve old errors with structural fields', () => {
  const duplicate = empty(); duplicate.items = [item(), item()];
  rejection(duplicate, createLead(), 'items[].type', 'unique_item_type', 'items (duplicate item type)');
  for (const type of ['box', 'washing_machine', 'wardrobe', 'bed', 'dresser'] as const) {
    const data = empty(); data.items = [{ ...item(), type, sizeCategory: set('LARGE') }];
    rejection(data, createLead(), 'items[].sizeCategory', 'refrigerator_only', `${type}.sizeCategory`);
  }
});
for (const status of ['RECEIVED', 'NOT_APPLICABLE'] as const) {
  test(`domain photo ${status} remains application-owned`, () => {
    const data = empty(); data.items = [{ ...item(), photoStatus: set('NOT_AVAILABLE') }];
    const lead = createLead(), known = createMoveItem('refrigerator'); known.photoStatus = status; lead.moveDetails.items = [known];
    rejection(data, lead, 'items[].photoStatus', 'photo_state_editable', 'refrigerator.photoStatus');
  });
}
for (const value of ['8 בנובמבר 2026', '2026-02-30', '31/04/2026']) {
  test(`domain date normalization rejects reconstructed token ${value}`, () => {
    const data = empty(); data.requestedDate = set(value);
    rejection(data, createLead(), 'requestedDate', 'date_normalization', 'requestedDate');
  });
}
test('domain invalid reference date preserves date normalization rule', () => {
  const data = empty(); data.requestedDate = set('08/11');
  assert.throws(() => convertAIExtraction(data, createLead(), { referenceDate: 'invalid' }), error =>
    error instanceof AIExtractionError && error.message === 'Invalid AI extraction at requestedDate.'
    && error.validationField === 'requestedDate' && error.validationRule === 'date_normalization');
});
for (const value of ['29:99', '9:00', '00:60', '24:00']) {
  test(`domain time rejects ${JSON.stringify(value)} with time_hh_mm`, () => {
    const data = empty(); data.requestedTime = set(value);
    rejection(data, createLead(), 'requestedTime', 'time_hh_mm', 'requestedTime');
  });
}
test('domain special access notes reject blank and oversized values', () => {
  for (const value of [' ', 'x'.repeat(2001)]) {
    const data = empty(); data.specialAccessNotes = set(value);
    rejection(data, createLead(), 'specialAccessNotes', 'nonblank_text', 'specialAccessNotes');
  }
});

for (const side of ['pickup', 'dropoff'] as const) {
  for (const key of ['city', 'address', 'floor', 'elevator'] as const) {
    test(`known ${side}.${key} overwrite requires correction`, () => {
      const lead = createLead(), data = empty();
      if (key === 'floor') { lead.moveDetails[side][key] = 1; data[side][key] = set(0); }
      else if (key === 'elevator') { lead.moveDetails[side][key] = true; data[side][key] = set(false); }
      else { lead.moveDetails[side][key] = 'known'; data[side][key] = set('replacement'); }
      rejection(data, lead, `${side}.${key}`, 'explicit_correction_required',
        `${side}.${key} (overwriting a known value requires an explicit correction)`);
    });
  }
}
for (const key of ['quantity', 'sizeCategory', 'dimensionsAvailable', 'requiresDisassembly', 'requiresAssembly'] as const) {
  test(`known item ${key} overwrite requires correction`, () => {
    const lead = createLead(), known = createMoveItem('refrigerator'), entry = item(), data = empty();
    if (key === 'quantity') { known[key] = 1; entry[key] = set(2); }
    else if (key === 'sizeCategory') { known[key] = 'REGULAR'; entry[key] = set('LARGE'); }
    else { known[key] = true; entry[key] = set(false); }
    lead.moveDetails.items = [known]; data.items = [entry];
    rejection(data, lead, `items[].${key}`, 'explicit_correction_required',
      `refrigerator.${key} (overwriting a known value requires an explicit correction)`);
  });
}
for (const axis of ['width', 'height', 'depth'] as const) {
  test(`known item ${axis} overwrite requires correction`, () => {
    const lead = createLead(), known = createMoveItem('refrigerator'), entry = item(), data = empty();
    known.dimensions[axis] = 10; entry.dimensions[axis] = set(20); lead.moveDetails.items = [known]; data.items = [entry];
    rejection(data, lead, `items[].dimensions.${axis}`, 'explicit_correction_required',
      `refrigerator.${axis} (overwriting a known value requires an explicit correction)`);
  });
}
for (const key of ['requestedDate', 'requestedTime', 'specialAccessNotes'] as const) {
  test(`known ${key} overwrite requires correction`, () => {
    const lead = createLead(), data = empty();
    lead.moveDetails[key] = key === 'requestedDate' ? '2026-11-08' : key === 'requestedTime' ? '10:00' : 'known';
    data[key] = set(key === 'requestedDate' ? '2026-11-09' : key === 'requestedTime' ? '11:00' : 'replacement');
    rejection(data, lead, key, 'explicit_correction_required', `${key} (overwriting a known value requires an explicit correction)`);
  });
}
test('valid empty/keep, zero, false, normalized dates and explicit corrections retain acceptance', () => {
  const lead = createLead(), data = empty(); lead.moveDetails.pickup.floor = 2; lead.moveDetails.pickup.elevator = true;
  assert.deepEqual(convertAIExtraction(empty(), lead), {});
  data.pickup.floor = correct(0); data.pickup.elevator = correct(false); data.requestedDate = set('08/11/2026');
  data.requestedTime = set('00:00'); data.items = [{ ...item(), quantity: set(1), dimensionsAvailable: set(false) }];
  assert.deepEqual(convertAIExtraction(data, lead).moveDetails, { pickup: { floor: 0, elevator: false },
    requestedDate: '2026-11-08', requestedTime: '00:00', items: [{ type: 'refrigerator', quantity: 1, dimensionsAvailable: false }] });
  const partialDate = empty(); partialDate.requestedDate = set('08/11');
  assert.deepEqual(convertAIExtraction(partialDate, createLead()), {});
});

test('fixed metadata vocabulary is frozen, structural and has exactly the reviewed pairs', () => {
  assert.equal(VALIDATION_DOMAIN_PAIRS.length, 36); assert.equal(VALIDATION_SCHEMA_FIELDS.length, 67);
  assert.equal(VALIDATION_SCHEMA_CODES.length, 11); assert.equal(VALIDATION_FIELD_RULE_PAIRS.length, 774);
  assert.equal(new Set(VALIDATION_FIELD_RULE_PAIRS.map(pair => pair.join('\n'))).size, 774);
  assert.ok(Object.isFrozen(VALIDATION_FIELD_RULE_PAIRS));
  for (const [field, rule] of VALIDATION_FIELD_RULE_PAIRS) {
    assert.deepEqual(sanitizeValidationMetadata({ validationField: field, validationRule: rule }), { validationField: field, validationRule: rule });
    assert.ok(!field.includes('refrigerator') && !field.includes('box'));
  }
  // normalizeRequestedDate currently returns only valid dates or undefined, or throws.
  // Preserve the converter's defensive normalized_calendar_date contract without
  // pretending an unreachable malformed normalizer return was observed.
  assert.deepEqual(pair(eventFor(new AIExtractionError('INVALID_EXTRACTION', 'fixed diagnostic fixture', undefined,
    { validationField: 'requestedDate', validationRule: 'normalized_calendar_date' }))),
  { validationField: 'requestedDate', validationRule: 'normalized_calendar_date' });
});
test('every supported schema path/code pair derives only from the first bounded normalized issue', () => {
  for (const field of VALIDATION_SCHEMA_FIELDS) for (const code of VALIDATION_SCHEMA_CODES) {
    const issues = [{ path: field, code }, { path: 'requestedTime', code: 'custom' }];
    const error = new AIExtractionError('INVALID_EXTRACTION', 'unchanged public schema message', issues);
    const event = eventFor(error);
    assert.equal(event.classification, 'schema_validation'); assert.equal(event.stage, 'schema_validation');
    assert.deepEqual(pair(event), { validationField: field, validationRule: `schema_${code}` });
  }
});
test('SDK Zod errors normalize array indexes and discard customer field names', () => {
  const raw = new ZodError([{ code: 'custom', path: ['items', 27, 'dimensions', 'width', 'value'], message: 'PRIVATE' },
    { code: 'custom', path: ['PRIVATE'], message: 'PRIVATE' }]);
  const event = eventFor(raw);
  assert.deepEqual(event.zodIssues, [{ path: 'items[].dimensions.width.value', code: 'custom' }, { path: 'schema', code: 'custom' }]);
  assert.deepEqual(pair(event), { validationField: 'items[].dimensions.width.value', validationRule: 'schema_custom' });
  assert.equal(JSON.stringify(event).includes('PRIVATE'), false);
});
test('converter schema rejection retains original code/message and uses first safe issue', () => {
  const data = { ...empty(), items: 'PRIVATE' };
  assert.throws(() => convertAIExtraction(data, createLead()), error => {
    assert.ok(error instanceof AIExtractionError);
    assert.equal(error.code, 'INVALID_EXTRACTION'); assert.equal(error.message, 'Invalid AI extraction at schema.');
    const event = eventFor(error);
    assert.deepEqual(pair(event), { validationField: 'items', validationRule: 'schema_invalid_type' });
    return true;
  });
});
test('schema paths and issue lists remain bounded and unsupported codes become unknown pairs', () => {
  const bounded = safeZodIssues(Array.from({ length: 20 }, () => ({ path: ['items', 1, 'quantity', 'value'], code: 'invalid_type' })));
  assert.equal(bounded.length, 8);
  assert.deepEqual(schemaValidationMetadata(bounded), { validationField: 'items[].quantity.value', validationRule: 'schema_invalid_type' });
  const paths = [[], ['PRIVATE'], Array(9).fill('pickup')];
  for (const path of paths) {
    const event = eventFor(new ZodError([{ code: 'custom', path, message: 'PRIVATE' }]));
    assert.deepEqual(pair(event), { validationField: 'schema', validationRule: 'schema_custom' });
  }
  const malformed = new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE', [{ path: 'requestedTime', code: 'PRIVATE' }]);
  const event = eventFor(malformed);
  assert.deepEqual(pair(event), unknown); assert.deepEqual(event.zodIssues, [{ path: 'requestedTime', code: 'unknown' }]);
  assert.deepEqual(schemaValidationMetadata(Array(9).fill({ path: 'items', code: 'custom' })), unknown);
  assert.deepEqual(schemaValidationMetadata([]), unknown);
});
test('malicious or mismatched field/rule pairs are unknown without reading messages', () => {
  for (const metadata of [
    { validationField: 'box.sizeCategory', validationRule: 'refrigerator_only' },
    { validationField: 'requestedTime', validationRule: 'refrigerator_only' },
    { validationField: 'requestedTime', validationRule: 'schema_unknown' },
    { validationField: 'items[].type.action', validationRule: 'schema_invalid_type' },
    { validationField: 'items[].type.value', validationRule: 'schema_invalid_type' },
    { validationField: 'PRIVATE', validationRule: 'PRIVATE' },
    { validationField: 'requestedTime\nPRIVATE', validationRule: 'time_hh_mm' },
    { validationField: 'unknown', validationRule: 'time_hh_mm' },
  ]) {
    assert.deepEqual(sanitizeValidationMetadata(metadata), unknown);
    assert.deepEqual(pair(eventFor(new AIExtractionError('INVALID_EXTRACTION', 'Invalid AI extraction at requestedTime.', undefined, metadata))), unknown);
  }
  assert.deepEqual(pair(eventFor(new Error('Invalid AI extraction at requestedTime.'))), unknown);
  const schemaPairOnDomain = new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE', undefined,
    { validationField: 'requestedTime', validationRule: 'schema_invalid_type' });
  assert.deepEqual(pair(eventFor(schemaPairOnDomain)), unknown);
  const mismatch = new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE', [{ path: 'items', code: 'invalid_type' }],
    { validationField: 'requestedTime', validationRule: 'schema_invalid_type' });
  assert.deepEqual(pair(eventFor(mismatch)), unknown);
  for (const path of ['items[].type.action', 'items[].type.value']) {
    const unsupported = new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE', [{ path, code: 'invalid_type' }]);
    assert.deepEqual(pair(eventFor(unsupported)), unknown);
  }
});
test('only own data properties may supply metadata; accessors, inheritance, proxies and values are discarded', () => {
  let accesses = 0;
  const accessor = Object.defineProperties({}, {
    validationField: { get() { accesses++; throw new Error('PRIVATE'); } },
    validationRule: { get() { accesses++; throw new Error('PRIVATE'); } },
  });
  assert.deepEqual(sanitizeValidationMetadata(accessor), unknown);
  assert.deepEqual(sanitizeValidationMetadata(Object.create({ validationField: 'requestedTime', validationRule: 'time_hh_mm' })), unknown);
  assert.deepEqual(sanitizeValidationMetadata(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE'); } })), unknown);
  const revoked = Proxy.revocable([], {}); revoked.revoke();
  assert.deepEqual(schemaValidationMetadata(revoked.proxy), unknown);
  const error = new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE');
  Object.defineProperties(error, { validationField: { get() { accesses++; return 'requestedTime'; } },
    validationRule: { get() { accesses++; return 'time_hh_mm'; } } });
  assert.deepEqual(pair(eventFor(error)), unknown); assert.equal(accesses, 0);
  const issues = [{ code: 'custom' }]; Object.defineProperty(issues[0], 'path', { get() { accesses++; throw new Error('PRIVATE'); } });
  const safe = safeZodIssues(issues);
  assert.deepEqual(safe, [{ path: 'schema', code: 'custom' }]); assert.equal(accesses, 0);
});
test('non-validation errors never acquire validation metadata, and unknown legacy failures stay unknown', () => {
  for (const code of ['MISSING_API_KEY', 'REQUEST_FAILED', 'NO_STRUCTURED_OUTPUT', 'CONTEXT_TOO_LARGE'] as const) {
    const error = new AIExtractionError(code, 'PRIVATE', undefined, { validationField: 'requestedTime', validationRule: 'time_hh_mm' });
    assert.deepEqual(pair(eventFor(error)), unknown);
  }
  assert.deepEqual(pair(eventFor(new AIExtractionError('INVALID_EXTRACTION', 'PRIVATE'))), unknown);
  assert.deepEqual(pair(eventFor(new AIWindowError('disabled'))), unknown);
  const spoof = { validationField: 'requestedTime', validationRule: 'time_hh_mm', code: 'INVALID_EXTRACTION' };
  assert.deepEqual(pair(eventFor(spoof)), unknown);
});
