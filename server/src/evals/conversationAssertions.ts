import { isDeepStrictEqual } from 'node:util';
import type { Lead } from '../domain/lead.js';
import type { ProcessCustomerMessageResult } from '../domain/conversation/processCustomerMessage.js';
import type { ConversationEvalCase } from './loadEvalCases.js';
import type { OfflineFixture } from './conversationFixtures.js';

type Result = ProcessCustomerMessageResult;
export const intentChecks: Readonly<Record<string, (result: Result) => boolean>> = {
  collect_missing_dropoff_address_and_floor: r => questions(r, ['dropoff.address', 'dropoff.floor']),
  ask_dropoff_elevator: r => questions(r, ['dropoff.elevator']),
  ask_dropoff_floor: r => questions(r, ['dropoff.floor']),
  ask_requested_date: r => questions(r, ['requestedDate']),
  request_refrigerator_photo: r => questions(r, ['item.photo']) && r.nextQuestion?.requirements[0].itemIndex ===
    r.lead.moveDetails.items.findIndex(item => item.type === 'refrigerator'),
  ask_missing_width_height_depth: r => questions(r, ['item.width', 'item.height', 'item.depth']),
  acknowledge_photo_unavailable: r => /בלי תמונה|תמונה.*לא זמינה/u.test(r.responseText),
  acknowledge_dimensions_alternative: r => /מידות/u.test(r.responseText) && /יעזרו|עוזרות|יעזרו לנו/u.test(r.responseText),
  acknowledge_measurements_received: r => /מידות.*(?:התקבל|נשמר)|(?:קיבל|רשמ|שמר).*מידות/u.test(r.responseText),
  acknowledge_floor_correction: r => /(?:עודכ|עדכנ|תיקנ|תוקנ|רשמ|נשמר).*(?:קומה|איסוף|פריקה)|(?:קומה|איסוף|פריקה).*(?:עודכ|עדכנ|תיקנ|תוקנ|רשמ|נשמר)/u.test(r.responseText),
  acknowledge_measurements_and_correction: r =>
    intentChecks.acknowledge_measurements_received(r) && intentChecks.acknowledge_floor_correction(r),
  acknowledge_extra_move_facts: r => /קיבל|רשמ|עודכ|נשמר|התקבל/u.test(r.responseText),
  acknowledge_stair_carry_requirement: r => /מדרגות/u.test(r.responseText) && /נשיא|נעלה|נרים|העלא|העבר/u.test(r.responseText),
  acknowledge_customer_will_check: r => /כשתדע|כשתבד|כשתעדכ|נמתין|ממתין|תעדכ|עדכון.*קומה/u.test(r.responseText),
  keep_dropoff_floor_requirement_pending: r => r.lead.moveDetails.dropoff.floor === null &&
    r.requirements.missingRequired.some(ref => ref.id === 'dropoff.floor'),
  retain_access_difficulty_for_human_review: r => Boolean(r.lead.moveDetails.specialAccessNotes) &&
    !['QUOTE_SENT', 'WON', 'LOST'].includes(r.lead.status),
  continue_collecting_missing_information: r => r.nextQuestion !== null,
  explain_human_review_and_pricing_next_step: r => r.requirements.readyForPricing && r.nextQuestion === null &&
    /בדיקה/u.test(r.responseText) && /תמחור/u.test(r.responseText) && /צוות/u.test(r.responseText),
};

function questions(result: Result, expected: string[]): boolean {
  const actual = result.nextQuestion?.requirements.map(ref => ref.id) ?? [];
  return isDeepStrictEqual([...actual].sort(), [...expected].sort());
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function atPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) =>
    current !== null && typeof current === 'object' && Object.hasOwn(current, key)
      ? (current as Record<string, unknown>)[key] : undefined, value);
}
const display = (value: unknown) => value === undefined ? 'undefined' : JSON.stringify(value);

export function compareProjection(
  expected: unknown, actual: unknown, path: string, failures: string[], fixture?: OfflineFixture,
): void {
  if (path.endsWith('specialAccessNotes') && typeof expected === 'string' && fixture?.accessNoteMeaning) {
    if (typeof actual !== 'string' || !fixture.accessNoteMeaning.every(pattern => pattern.test(actual))) {
      failures.push(path + ': required access-note meaning is missing.');
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { failures.push(path + ': expected an array.'); return; }
    expected.forEach((entry, index) => {
      if (path.endsWith('.items') && object(entry) && typeof entry.type === 'string') {
        const matches = actual.filter(item => object(item) && item.type === entry.type);
        if (matches.length !== 1) failures.push(path + ': expected one unambiguous item of type ' + entry.type);
        else compareProjection(entry, matches[0], path + '.' + entry.type, failures, fixture);
      } else compareProjection(entry, actual[index], path + '.' + index, failures, fixture);
    });
  } else if (object(expected)) {
    if (!object(actual)) { failures.push(path + ': expected an object.'); return; }
    for (const [key, value] of Object.entries(expected)) compareProjection(value, actual[key], path + '.' + key, failures, fixture);
  } else if (!isDeepStrictEqual(expected, actual)) {
    failures.push(path + ': expected ' + display(expected) + ', got ' + display(actual));
  }
}

function leaves(value: unknown, prefix: string): [string, unknown][] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix + '.' + key));
  }
  return [[prefix, value]];
}

// Only declared expected updates may change the initial state. Fixtures themselves do
// not authorize changes, so an erroneous mock cannot bless its own unrelated overwrite.
function permittedChanges(entry: ConversationEvalCase, lead: Lead): string[] {
  const paths = Object.keys(entry.expectedStateChanges ?? {});
  const expected = structuredClone(entry.expectedExtraction ?? {}) as Record<string, unknown>;
  const move = expected.moveDetails;
  if (object(move) && Array.isArray(move.items)) {
    const items = move.items;
    delete move.items;
    for (const item of items) {
      if (!object(item)) continue;
      const index = lead.moveDetails.items.findIndex(existing => existing.type === item.type);
      if (index >= 0) paths.push(...leaves(item, 'moveDetails.items.' + index).map(([path]) => path));
    }
  }
  paths.push(...leaves(expected, '').map(([path]) => path.slice(1)));
  return paths;
}

export function automatedMustNot(constraint: string): boolean {
  // A few explicit wording families map to the invariants below. Everything else is
  // listed for manual review; this is intentionally not a natural-language policy engine.
  return constraint.startsWith('Do not erase unrelated known Lead ')
    || constraint.startsWith('Do not ask again for ')
    || [
      'Do not treat false as an unanswered field.',
      'Do not repeat the photo request.',
      'Do not repeat the unavailable photo request.',
      'Do not repeat the photo request after the customer declines.',
      'Do not repeat the photo request once the photo is unavailable.',
      'Do not repeat photo or dimension questions.',
      'Do not repeat photo or dimension requests.',
      'Do not invent promised-but-not-provided measurements.',
      'Do not invent dimensions from a promise to supply them.',
      'Do not invent an unanswered floor.',
      'Do not invent the unanswered floor.',
    ].includes(constraint);
}

export function checkConversation(
  entry: ConversationEvalCase, before: Lead, result: Result, fixture: OfflineFixture,
): { failures: string[]; checked: string[] } {
  const failures: string[] = [];
  const checked = ['declared state changes', 'undeclared state preservation (including null/false/zero)',
    'known requirements not re-requested', 'unavailable photos not re-requested', 'no automatic quote/close'];
  if (entry.expectedExtraction !== undefined) {
    checked.push(fixture.mode === 'FIXTURE' ? 'extraction fixture contract (not AI accuracy)' : 'domain extraction');
    if (Object.keys(entry.expectedExtraction).length === 0 && Object.keys(result.extraction).length > 0) {
      failures.push('extraction: expected no updates.');
    }
    compareProjection(entry.expectedExtraction, result.extraction, 'extraction', failures, fixture);
  }
  for (const [path, expected] of Object.entries(entry.expectedStateChanges ?? {})) {
    compareProjection(expected, atPath(result.lead, path), path, failures, fixture);
  }
  const permitted = permittedChanges(entry, before);
  for (const [path, previous] of leaves(before.moveDetails, 'moveDetails')) {
    if (permitted.some(allowed => path === allowed || path.startsWith(allowed + '.'))) continue;
    if (!isDeepStrictEqual(previous, atPath(result.lead, path))) {
      failures.push(path + ': unrelated state changed from ' + display(previous) + ' to ' + display(atPath(result.lead, path)));
    }
  }
  if (result.lead.moveDetails.items.length < before.moveDetails.items.length) failures.push('Existing items were removed.');
  for (const ref of result.nextQuestion?.requirements ?? []) {
    const evaluated = result.requirements.requirements.find(r => r.id === ref.id && r.itemIndex === ref.itemIndex);
    if (!evaluated || evaluated.status !== 'MISSING') failures.push('Already-known or inapplicable requirement asked again: ' + ref.id);
    if (ref.id === 'item.photo' && ref.itemIndex !== undefined &&
      result.lead.moveDetails.items[ref.itemIndex]?.photoStatus === 'NOT_AVAILABLE') {
      failures.push('Unavailable photo requested again.');
    }
  }
  if (result.lead.moveDetails.items.some(item => item.photoStatus === 'NOT_AVAILABLE') &&
    !result.lead.moveDetails.items.some(item => item.photoStatus === 'REQUIRED') &&
    /(?:אפשר|נא|תוכל|תוכלו).{0,24}(?:לצרף|לשלוח).{0,20}תמונה/u.test(result.responseText)) {
    failures.push('Response text repeats an unavailable photo request.');
  }
  if (['AWAITING_REVIEW', 'QUOTE_SENT', 'WON', 'LOST'].includes(result.lead.status)) {
    failures.push('Collection unexpectedly advanced to an external review/quote/outcome status.');
  }
  if (result.unappliedItems.length) failures.push('Unapplied ambiguous item updates remain.');
  for (const intent of entry.expectedAgentIntent) {
    checked.push('intent: ' + intent);
    if (!intentChecks[intent](result)) failures.push('Expected intent not observed: ' + intent);
  }
  return { failures, checked };
}
