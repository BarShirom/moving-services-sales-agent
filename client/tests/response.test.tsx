import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessages } from '../src/ConversationMessages';
import { AgentState } from '../src/AgentState';
import type { DemoSnapshot } from '../src/api';
import { createLead } from '../../server/src/domain/createLead';
import { evaluateRequirements } from '../../server/src/domain/requirements/evaluateRequirements';
import { createMoveItem } from '../../server/src/domain/createMoveItem';
import { JSDOM } from 'jsdom';

function snapshot(): DemoSnapshot {
  const lead = createLead();
  const requirements = evaluateRequirements(lead);
  const acknowledgement = 'אין בעיה, נמשיך בלי תמונה.';
  const responseText = `${acknowledgement} השלב הבא הוא בדיקה ותמחור על ידי הצוות.`;
  return { lead, requirements, extraction: {}, unappliedItems: [], acknowledgement, responseText,
    nextQuestion: { text: 'שאלה נפרדת שאינה התגובה המלאה', requirements: [] } };
}

test('chat renders the full backend response, including acknowledgement and next step', () => {
  const state = snapshot();
  state.lead.messages.push({ id: 'agent-message', sender: 'AGENT', timestamp: state.lead.createdAt, text: state.responseText });
  const html = renderToStaticMarkup(<ConversationMessages messages={state.lead.messages} />);
  assert.ok(html.includes(state.responseText));
  assert.ok(!html.includes(state.nextQuestion!.text));
});

test('next-step card uses an operational action without duplicating the chat response or question', () => {
  const state = snapshot();
  const html = renderToStaticMarkup(<AgentState state={state} />);
  assert.ok(html.includes('המשך איסוף הפרטים מהלקוח.'));
  assert.ok(!html.includes(state.responseText));
  assert.ok(!html.includes(state.nextQuestion!.text));
});

test('no next question on a review lead displays a concise owner action', () => {
  const state = snapshot();
  state.nextQuestion = null;
  state.lead.status = 'AWAITING_REVIEW';
  const html = renderToStaticMarkup(<AgentState state={state} />);
  assert.ok(html.includes('השלב הבא'));
  assert.ok(html.includes('המשך לבדיקת בעל העסק ולתמחור.'));
  assert.ok(!html.includes(state.responseText));
  assert.ok(!html.includes('אין כרגע שאלה נוספת'));
});

function complexSnapshot(): DemoSnapshot {
  const lead = createLead();
  lead.status = 'AWAITING_REVIEW';
  lead.moveDetails.items = [
    { ...createMoveItem('refrigerator'), sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE' },
    { ...createMoveItem('wardrobe'), dimensionsAvailable: false, requiresDisassembly: true, requiresAssembly: true },
    createMoveItem('dresser'), { ...createMoveItem('box'), quantity: 40 },
  ];
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'רחוב דוגמה 1', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'רחוב דוגמה 2', floor: 3, elevator: false };
  lead.moveDetails.requestedDate = '2026-10-09';
  const requirements = evaluateRequirements(lead);
  return { lead, requirements, extraction: {}, unappliedItems: [], nextQuestion: requirements.nextQuestion,
    responseText: 'אין בעיה, נמשיך בלי תמונה. המידות של הארון נשארו להשלמה, והפרטים יעברו עכשיו לבדיקה ותמחור אצל בעל העסק.' };
}

function renderState(state: DemoSnapshot) {
  return new JSDOM(renderToStaticMarkup(<AgentState state={state} />)).window.document;
}

test('customer review copy uses natural punctuation without em dashes', () => {
  const document = renderState(complexSnapshot());
  assert.doesNotMatch(document.body.textContent!, /\u2014/u);
  assert.match(document.querySelector('.items-list')!.textContent!, /מידות לא זמינות כרגע, ממתינות להשלמה/);
});

test('complex lead separates pending customer dimensions from business review without changing backend state', () => {
  const state = complexSnapshot();
  const before = structuredClone(state);
  const document = renderState(state);
  assert.equal(document.querySelector('.missing-card h2')?.textContent, 'מה עדיין חסר מהלקוח');
  assert.deepEqual([...document.querySelectorAll('.missing-list li')].map(node => node.textContent), ['מידות הארון: לא זמינות כרגע']);
  const review = document.querySelector('.owner-review-card')!;
  assert.equal(review.querySelector('h2')?.textContent, 'נושאים לבדיקה אצל בעל העסק');
  assert.match(review.textContent!, /ארון: דורש בדיקת תמחור/);
  assert.match(review.textContent!, /שידה: דורשת בדיקת תמחור/);
  assert.match(review.textContent!, /נפח גבוה: 40 ארגזים, נדרשת בדיקה/);
  assert.match(review.textContent!, /מקרר: בדיקה ללא תמונה/);
  assert.doesNotMatch(review.textContent!, /מידות הארון/);
  assert.doesNotMatch(document.body.textContent!, /בדיקת תמיכה בסוג הפריט|supported item type/);
  assert.equal(document.querySelector('.next-card > p')?.textContent, 'המשך לבדיקת בעל העסק ולתמחור.');
  assert.ok(!document.querySelector('.next-card')!.textContent!.includes(state.responseText));
  assert.deepEqual(state, before);
  assert.equal(state.requirements.readyForPricing, false);
  assert.ok(state.requirements.missingRequired.some(r => r.id === 'item.size' && r.status === 'MISSING'));
});

for (const [quantities, expected] of [
  [[30], false], [[31], true], [[40], true], [[20, 20], true], [[null], false], [[20, null], false],
] as const) {
  test(`box-volume review label follows existing limit for ${quantities.join('+')}`, () => {
    const state = complexSnapshot();
    state.lead.moveDetails.items = quantities.map(quantity => ({ ...createMoveItem('box'), quantity }));
    state.requirements = evaluateRequirements(state.lead);
    const document = renderState(state);
    assert.equal(document.body.textContent!.includes('נפח גבוה'), expected);
    if (expected) assert.match(document.querySelector('.owner-review-card')!.textContent!, /ארגזים, נדרשת בדיקה/);
  });
}

test('empty customer and owner sections are hidden independently', () => {
  const state = complexSnapshot();
  state.lead.moveDetails.items = [createMoveItem('dresser')];
  state.requirements = evaluateRequirements(state.lead);
  let document = renderState(state);
  assert.equal(document.querySelector('.missing-card'), null);
  assert.ok(document.querySelector('.owner-review-card'));

  state.lead.moveDetails.items = [{ ...createMoveItem('box'), quantity: null }];
  state.requirements = evaluateRequirements(state.lead);
  document = renderState(state);
  assert.ok(document.querySelector('.missing-card'));
  assert.equal(document.querySelector('.owner-review-card'), null);

  state.lead.moveDetails.items[0].quantity = 10;
  state.requirements = evaluateRequirements(state.lead);
  document = renderState(state);
  assert.equal(document.querySelector('.missing-card'), null);
  assert.equal(document.querySelector('.owner-review-card'), null);
});

test('a manual lead needing recalculation points to the owner even when collection status remains', () => {
  const state = complexSnapshot();
  state.lead.status = 'COLLECTING_INFORMATION';
  assert.equal(state.nextQuestion, null);
  assert.equal(renderState(state).querySelector('.next-card > p')?.textContent, 'המשך לבדיקת בעל העסק ולתמחור.');
  state.lead.moveDetails.dropoff.floor = null;
  state.requirements = evaluateRequirements(state.lead);
  state.nextQuestion = null; // A one-turn deferred customer question is still customer information.
  assert.equal(renderState(state).querySelector('.next-card > p')?.textContent, 'ממתינים לעדכון על הפרטים החסרים.');
});

test('quote, handoff and closed statuses retain their distinct next actions', () => {
  const state = complexSnapshot();
  for (const [status, label] of [
    ['QUOTE_SENT', 'ממתינים לתשובת הלקוח להצעה.'], ['HUMAN_HANDOFF', 'המשך טיפול אצל הנציג.'],
    ['WON', 'ממתין לתיאום'], ['LOST', 'הפנייה נסגרה.'],
  ] as const) {
    state.lead.status = status;
    assert.equal(renderState(state).querySelector('.next-card > p')?.textContent, label);
  }
});
