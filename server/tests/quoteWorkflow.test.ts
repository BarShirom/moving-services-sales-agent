import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptCustomerResult, applyOwnerAction, freshOwnerState, generatePricing, handleQuoteReply,
  ownerSnapshot, sampleOwnerState } from '../src/demo/ownerWorkflow.js';
import { createMoveItem } from '../src/domain/createMoveItem.js';
import { evaluateRequirements } from '../src/domain/requirements/evaluateRequirements.js';
import { processCustomerMessageWithExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import { quoteAcceptanceQuestion } from '../src/domain/quote/quoteScope.js';
import type { OwnerDemoState } from '../src/demo/ownerTypes.js';

const now = new Date('2026-10-07T10:00:00.000Z');
const acceptedAt = new Date('2026-10-07T11:00:00.000Z');
const token = (state: OwnerDemoState) => ({ leadId: state.customer.lead.id, revision: state.revision });
const approve = (state: OwnerDemoState) => ({ ...token(state), action: 'APPROVE' as const,
  pricingEvaluationId: state.pricingEvaluation!.id, reviewedPhotoItemIndices: ownerSnapshot(state).pendingPhotoItemIndices });
const finalize = (state: OwnerDemoState, amount: number) => ({ ...token(state), action: 'ADJUST_PRICE' as const,
  pricingEvaluationId: state.pricingEvaluation!.id, amount, scopeConfirmed: true, omittedCostsAcknowledged: true,
  reviewedPhotoItemIndices: ownerSnapshot(state).pendingPhotoItemIndices });
function partialFixture() {
  const state = sampleOwnerState();
  state.customer.lead.moveDetails.items.push(createMoveItem('dresser'));
  state.customer.lead.moveDetails.pickup.address = 'כתובת הדגמה לא רשומה 10';
  state.customer.lead.moveDetails.dropoff.floor = 1;
  state.customer.lead.moveDetails.dropoff.elevator = false;
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  return generatePricing(state, now);
}

test('complete quote approval records scope and explicit missing-photo decision without changing evidence', () => {
  const state = sampleOwnerState();
  const before = structuredClone(state);
  const action = approve(state);
  assert.deepEqual(ownerSnapshot(state).pendingPhotoItemIndices, [0]);
  assert.throws(() => applyOwnerAction(state, { ...action, reviewedPhotoItemIndices: [] }, now), /תמונה/);
  const sent = applyOwnerAction(state, action, now);
  assert.deepEqual(state, before);
  assert.deepEqual(sent.pricingEvaluation, before.pricingEvaluation);
  assert.equal(sent.customer.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(sent.customer.requirements.pendingReview.some(requirement => requirement.id === 'item.photo'), true);
  assert.equal(sent.quotes.length, 1);
  assert.equal(sent.quotes[0].approvedAmount, 900);
  assert.equal(sent.quotes[0].sentAt, now.toISOString());
  assert.equal(sent.quotes[0].scopeFingerprint, sent.reviews[0].scopeFingerprint);
  assert.deepEqual(sent.quotes[0].scope, state.customer.lead.moveDetails);
  assert.equal(sent.reviews[0].scopeVersion, 1);
  assert.deepEqual(sent.reviews[0].reviewedPhotoItemIndices, [0]);
  assert.equal(sent.customer.nextQuestion?.text, quoteAcceptanceQuestion);
  assert.equal(sent.customer.lead.status, 'QUOTE_SENT');
  assert.equal(ownerSnapshot(sent).actions.approve, false);
  assert.match(sent.customer.responseText, /900 ₪/);
  assert.match(sent.customer.responseText, /עדיין לא שוריין/);
  assert.doesNotMatch(JSON.stringify(sent.customer), /pricingEvaluationId|ownerReviewId|scopeFingerprint|confidence|internalReason|unresolvedDetails/);
});

test('partial subtotal requires explicit finalization even when owner deliberately chooses the same amount', () => {
  const state = partialFixture();
  assert.equal(state.pricingEvaluation!.suggestedAmount, 950);
  assert.equal(state.pricingEvaluation!.completeness, 'PARTIAL_RECOMMENDATION');
  assert.equal(ownerSnapshot(state).actions.approve, false);
  assert.equal(ownerSnapshot(state).actions.adjust, true);
  assert.throws(() => applyOwnerAction(state, approve(state), now));
  const action = finalize(state, 950);
  assert.throws(() => applyOwnerAction(state, { ...action, omittedCostsAcknowledged: false }, now));
  assert.throws(() => applyOwnerAction(state, { ...action, scopeConfirmed: false }, now));
  for (const amount of [950, 1300]) {
    const sent = applyOwnerAction(state, { ...action, amount, internalReason: 'PRIVATE owner calculation' }, now);
    assert.equal(sent.reviews[0].suggestedAmount, 950);
    assert.equal(sent.reviews[0].approvedAmount, amount);
    assert.equal(sent.reviews[0].omittedCostsAcknowledged, true);
    assert.equal(sent.reviews[0].scopeConfirmed, true);
    assert.equal(sent.pricingEvaluation!.completeness, 'PARTIAL_RECOMMENDATION');
    assert.equal(sent.customer.quote!.approvedAmount, amount);
    assert.doesNotMatch(JSON.stringify(sent.customer), /PRIVATE|omittedComponents|reviewReasons|confidence/);
  }
});

test('manual quote with no engine amount requires a valid entered total and omitted-cost acknowledgement', () => {
  const state = partialFixture();
  state.customer.lead.moveDetails.items = [createMoveItem('dresser')];
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  const manual = generatePricing(state, now);
  assert.equal(manual.pricingEvaluation!.suggestedAmount, null);
  assert.equal(manual.pricingEvaluation!.completeness, 'CANNOT_PRICE');
  assert.throws(() => applyOwnerAction(manual, approve(manual), now));
  for (const amount of [0, -1, NaN, Infinity, 12.345]) assert.throws(() => applyOwnerAction(manual, finalize(manual, amount), now));
  const sent = applyOwnerAction(manual, finalize(manual, 700), now);
  assert.equal(sent.reviews[0].suggestedAmount, null);
  assert.equal(sent.quotes[0].approvedAmount, 700);
});

test('duplicate clicks and stale evaluation/scope reject without creating quote records', () => {
  const state = partialFixture();
  const action = finalize(state, 1100);
  const sent = applyOwnerAction(state, action, now);
  assert.throws(() => applyOwnerAction(sent, action, now), /השתנתה/);
  assert.equal(sent.quotes.length, 1);
  assert.equal(sent.reviews.length, 1);
  const changed = structuredClone(state);
  changed.customer.lead.moveDetails.pickup.floor = 3;
  assert.throws(() => applyOwnerAction(changed, action, now));
  assert.equal(changed.quotes.length, 0);
  assert.throws(() => applyOwnerAction(state, { ...action, pricingEvaluationId: 'old-evaluation' }, now));
});

for (const reply of ['כן', 'מאשר', 'סגור']) {
  test(`contextual ${reply} accepts one current quote and creates one pending-coordination summary`, () => {
    const state = partialFixture();
    const sent = applyOwnerAction(state, finalize(state, 1100), now);
    const accepted = handleQuoteReply(sent, reply, acceptedAt)!;
    assert.equal(sent.customer.lead.status, 'QUOTE_SENT');
    assert.equal(accepted.customer.lead.status, 'WON');
    assert.equal(accepted.quotes[0].acceptance!.amount, 1100);
    assert.equal(accepted.quotes[0].acceptance!.quoteId, accepted.currentQuoteId);
    assert.equal(accepted.quotes[0].acceptance!.quoteVersion, 1);
    assert.equal(accepted.quotes[0].acceptance!.acceptedAt, acceptedAt.toISOString());
    assert.equal(accepted.coordinationSummary!.status, 'PENDING');
    assert.equal(accepted.coordinationSummary!.acceptedAmount, 1100);
    assert.deepEqual(accepted.coordinationSummary!.scope, sent.quotes[0].scope);
    assert.ok(accepted.coordinationSummary!.unresolvedDetails.some(detail => detail.includes('תמונה')));
    assert.equal(accepted.customer.nextQuestion, null);
    assert.match(accepted.customer.responseText, /1,100 ₪/);
    assert.match(accepted.customer.responseText, /מועד ההובלה עדיין לא שוריין/);
    const again = handleQuoteReply(accepted, reply, new Date('2026-10-08T10:00:00Z'));
    assert.strictEqual(again, accepted);
  });
}

test('affirmatives to another active question cannot accept a quote even with an old displayed quote token', () => {
  assert.equal(handleQuoteReply(freshOwnerState(), 'כן', acceptedAt), null);
  const state = sampleOwnerState();
  const sent = applyOwnerAction(state, approve(state), now);
  const requested = applyOwnerAction(sent, { ...token(sent), action: 'REQUEST_MORE_INFO', question: 'האם יש מעלית בפריקה?' }, now);
  const quoted = requested.customer.quote!;
  assert.equal(quoted.status, 'INVALIDATED');
  assert.equal(handleQuoteReply(requested, 'כן', acceptedAt, { quoteId: quoted.id, quoteVersion: quoted.version }), null);
  assert.equal(requested.quotes[0].acceptance, null);
  const anotherQuestion = structuredClone(sent);
  anotherQuestion.customer.nextQuestion = { text: 'האם יש מעלית?', requirements: [{ id: 'dropoff.elevator' }] };
  assert.equal(handleQuoteReply(anotherQuestion, 'כן', acceptedAt), null);
});

test('questions, negation and objections never accept or automatically mark the lead lost', () => {
  for (const message of ['זה כולל פירוק?', 'כן?', 'יקר לי', 'לא']) {
    const state = sampleOwnerState();
    const sent = applyOwnerAction(state, approve(state), now);
    const result = handleQuoteReply(sent, message, acceptedAt)!;
    assert.equal(result.customer.lead.status, 'HUMAN_HANDOFF');
    assert.equal(result.quotes[0].acceptance, null);
    assert.equal(result.coordinationSummary, null);
    assert.equal(result.activeQuoteQuestionId, null);
  }
});

test('conditional acceptance falls through extraction and unextracted conditions invalidate rather than silently close', async () => {
  for (const text of ['כן, אבל יש גם עוד ארון', 'כן, אבל רק אחרי 18:00', 'סגור, רק שהפריקה עכשיו בקומה 4',
    'כן. אבל רק בתנאי שנציג יבדוק את התנאי החדש', 'סגור! רק אחרי 18:00', 'מאשרת; בתנאי שהשינוי אושר',
    'אפשר רק אחרי 18:00?', 'זה כולל פריקה בקומה 4?']) {
    const state = sampleOwnerState();
    const sent = applyOwnerAction(state, approve(state), now);
    assert.equal(handleQuoteReply(sent, text, acceptedAt), null);
    const result = await processCustomerMessageWithExtractor(sent.customer.lead, text, {
      lastQuestion: sent.customer.nextQuestion!, referenceDate: '2026-10-07', extractor: () => ({}),
    });
    const changed = acceptCustomerResult(sent, result, acceptedAt);
    assert.equal(changed.quotes[0].status, 'INVALIDATED');
    assert.equal(changed.quotes[0].acceptance, null);
    assert.equal(changed.customer.lead.status, 'HUMAN_HANDOFF');
  }
});

test('later accepted-scope changes preserve the accepted record and hand off coordination for review', async () => {
  const state = sampleOwnerState();
  const accepted = handleQuoteReply(applyOwnerAction(state, approve(state), now), 'כן', acceptedAt)!;
  const originalQuote = structuredClone(accepted.quotes[0]);
  const result = await processCustomerMessageWithExtractor(accepted.customer.lead, 'הפריקה בקומה 4', {
    referenceDate: '2026-10-07', extractor: () => ({ moveDetails: { dropoff: { floor: 4 } } }),
  });
  const changed = acceptCustomerResult(accepted, result, acceptedAt);
  assert.deepEqual(changed.quotes[0], originalQuote);
  assert.equal(changed.customer.lead.moveDetails.dropoff.floor, 4);
  assert.equal(changed.coordinationSummary!.scope.dropoff.floor, originalQuote.scope.dropoff.floor);
  assert.equal(changed.coordinationSummary!.status, 'REVIEW_REQUIRED');
  assert.equal(changed.customer.lead.status, 'HUMAN_HANDOFF');
  assert.equal(changed.customer.nextQuestion, null);
  const conditionText = 'אפשר רק אחרי 18:00?';
  assert.equal(handleQuoteReply(accepted, conditionText, acceptedAt), null);
  const unresolved = await processCustomerMessageWithExtractor(accepted.customer.lead, conditionText, {
    referenceDate: '2026-10-07', extractor: () => ({}),
  });
  const pendingReview = acceptCustomerResult(accepted, unresolved, acceptedAt);
  assert.deepEqual(pendingReview.quotes[0], originalQuote);
  assert.equal(pendingReview.coordinationSummary!.status, 'REVIEW_REQUIRED');
  assert.equal(pendingReview.customer.lead.status, 'HUMAN_HANDOFF');
});

test('outdated quote tokens and incompatible scope cannot be accepted', () => {
  const state = sampleOwnerState();
  const sent = applyOwnerAction(state, approve(state), now);
  assert.throws(() => handleQuoteReply(sent, 'כן', acceptedAt, { quoteId: 'superseded-id', quoteVersion: 1 }), /השתנתה/);
  assert.throws(() => handleQuoteReply(sent, 'כן', acceptedAt, { quoteId: sent.currentQuoteId!, quoteVersion: 0 }), /השתנתה/);
  const changed = structuredClone(sent);
  changed.customer.lead.moveDetails.requestedDate = '2026-11-08';
  const refused = handleQuoteReply(changed, 'כן', acceptedAt)!;
  assert.equal(refused.quotes[0].status, 'INVALIDATED');
  assert.equal(refused.quotes[0].acceptance, null);
  const unapproved = structuredClone(sent);
  unapproved.reviews = [];
  const refusedUnapproved = handleQuoteReply(unapproved, 'כן', acceptedAt)!;
  assert.equal(refusedUnapproved.quotes[0].status, 'INVALIDATED');
  assert.equal(refusedUnapproved.quotes[0].acceptance, null);
});

test('new session clears quote, acceptance, owner review and coordination state', () => {
  const fresh = freshOwnerState();
  assert.deepEqual(fresh.quotes, []);
  assert.deepEqual(fresh.reviews, []);
  assert.equal(fresh.currentQuoteId, null);
  assert.equal(fresh.activeQuoteQuestionId, null);
  assert.equal(fresh.coordinationSummary, null);
  assert.equal(fresh.customer.quote, undefined);
});
