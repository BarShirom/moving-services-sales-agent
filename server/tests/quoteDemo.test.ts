import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { quoteDemoMessages, quoteFixtureExtractor } from '../src/demo/quoteFixture.js';
import type { MessageExtractor } from '../src/domain/conversation/processCustomerMessage.js';
import type { OwnerSnapshot } from '../src/demo/ownerTypes.js';
import type { DemoSnapshot } from '../src/demo/types.js';

const fixedTime = new Date('2026-10-07T10:00:00Z');
async function api(t: TestContext, extractor: MessageExtractor = quoteFixtureExtractor) {
  const server = createApp({ extractor, now: () => fixedTime }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`;
  const post = (path: string, body: unknown = {}) => fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const owner = async () => await (await fetch(root + '/owner')).json() as OwnerSnapshot;
  const customer = async () => await (await fetch(root)).json() as DemoSnapshot;
  return { post, owner, customer };
}
type Api = Awaited<ReturnType<typeof api>>;
const token = (owner: OwnerSnapshot) => ({ leadId: owner.customer.lead.id, revision: owner.revision });
const finalize = (owner: OwnerSnapshot, amount = 1200) => ({
  ...token(owner), action: 'ADJUST_PRICE', pricingEvaluationId: owner.pricingEvaluation!.id, amount,
  scopeConfirmed: true, omittedCostsAcknowledged: true, reviewedPhotoItemIndices: owner.pendingPhotoItemIndices,
  internalReason: 'החלטה פנימית סינתטית',
});
async function collect(app: Api, declinePhoto = true) {
  for (const message of [quoteDemoMessages.inventory, quoteDemoMessages.dropoff, quoteDemoMessages.date]) {
    assert.equal((await app.post('/message', { message })).status, 200);
  }
  const customer = await app.customer();
  assert.equal(customer.lead.moveDetails.requestedDate, '2026-11-08');
  assert.equal(customer.nextQuestion?.requirements[0].id, 'item.photo', 'Unsupported dresser pricing must not skip collection');
  assert.equal(customer.lead.moveDetails.pickup.floor, 2);
  assert.equal(customer.lead.moveDetails.pickup.elevator, false);
  assert.equal(customer.lead.moveDetails.dropoff.floor, 1);
  assert.equal(customer.lead.moveDetails.dropoff.elevator, false);
  if (declinePhoto) assert.equal((await app.post('/message', { message: quoteDemoMessages.photo })).status, 200);
  let owner = await app.owner();
  if (!owner.pricingEvaluation) {
    assert.equal((await app.post('/owner/pricing', token(owner))).status, 200);
    owner = await app.owner();
  }
  assert.equal(owner.pricingEvaluation?.suggestedAmount, 950);
  assert.equal(owner.pricingEvaluation?.completeness, 'PARTIAL_RECOMMENDATION');
  return owner;
}
async function sendQuote(app: Api, amount = 1200) {
  const owner = await collect(app);
  assert.equal((await app.post('/owner/action', finalize(owner, amount))).status, 200);
  return app.owner();
}

test('HTTP full flow preserves the engine subtotal, finalizes the commercial total and accepts for manual coordination', async t => {
  let providerCalls = 0;
  const app = await api(t, input => { providerCalls++; return quoteFixtureExtractor(input); });
  const initial = await collect(app);
  assert.equal(providerCalls, 2, 'Date/photo handlers and quote acceptance do not require model calls');
  assert.equal(initial.currentQuote, null);
  assert.equal(initial.actions.approve, false);
  assert.equal(initial.actions.adjust, true);
  assert.equal(initial.customer.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.equal(initial.customer.nextQuestion, null);
  assert.ok(!initial.pricingEvaluation!.reviewReasons.some(r => r.code === 'ITEM_1_SERVICES_MANUAL' || r.code === 'ITEM_1_SERVICES_UNKNOWN'));
  const response = await app.post('/owner/action', finalize(initial));
  assert.equal(response.status, 200);
  const sent = await response.json() as OwnerSnapshot;
  const quote = sent.currentQuote!;
  assert.equal(quote.approvedAmount, 1200);
  assert.equal(quote.status, 'SENT');
  assert.equal(quote.sentAt, fixedTime.toISOString());
  assert.equal(quote.scope.requestedDate, '2026-11-08');
  assert.deepEqual(sent.pricingEvaluation, initial.pricingEvaluation);
  assert.deepEqual([sent.reviews[0].suggestedAmount, sent.reviews[0].approvedAmount], [950, 1200]);
  assert.equal(sent.reviews[0].scopeVersion, quote.version);
  assert.equal(sent.reviews[0].omittedCostsAcknowledged, true);
  assert.equal(sent.reviews[0].scopeConfirmed, true);
  assert.equal(quote.ownerReviewId, sent.reviews[0].id);
  assert.equal(quote.pricingEvaluationId, initial.pricingEvaluation!.id);
  assert.deepEqual(quote.reviewedPhotoItemIndices, [0]);
  const customer = await app.customer();
  assert.equal(customer.quote?.approvedAmount, 1200);
  assert.match(customer.responseText, /1,200 ₪/);
  assert.match(customer.responseText, /לא שוריין/);
  assert.doesNotMatch(JSON.stringify(customer), /החלטה פנימית|internalReason|confidence|suggestedAmount|reviewReasons|ownerReviewId|pricingEvaluationId/);
  assert.equal(customer.lead.moveDetails.items[0].photoStatus, 'NOT_AVAILABLE');
  assert.ok(customer.requirements.pendingReview.some(r => r.id === 'item.photo' && r.status === 'MISSING'));
  assert.equal((await app.post('/message', { message: 'כן', quoteId: quote.id, quoteVersion: quote.version })).status, 200);
  const accepted = await app.owner();
  assert.equal(accepted.customer.lead.status, 'WON');
  assert.equal(accepted.currentQuote?.status, 'ACCEPTED');
  assert.deepEqual(accepted.currentQuote?.acceptance, { quoteId: quote.id, quoteVersion: quote.version, amount: 1200,
    acceptedAt: fixedTime.toISOString(), coordinationStatus: 'PENDING' });
  assert.equal(accepted.coordinationSummary?.acceptedAmount, 1200);
  assert.equal(accepted.coordinationSummary?.status, 'PENDING');
  assert.deepEqual(accepted.coordinationSummary?.scope, quote.scope);
  assert.equal(accepted.customer.nextQuestion, null);
  assert.match(accepted.customer.responseText, /1,200 ₪.*לא שוריין/);
  assert.equal(providerCalls, 2);
  const summary = structuredClone(accepted.coordinationSummary);
  for (const message of ['כן', 'מאשר', 'סגור']) {
    assert.equal((await app.post('/message', { message, quoteId: quote.id, quoteVersion: quote.version })).status, 200);
  }
  const duplicate = await app.owner();
  assert.equal(duplicate.quotes.length, 1);
  assert.equal(duplicate.reviews.length, 1);
  assert.deepEqual(duplicate.coordinationSummary, summary);
  assert.deepEqual(duplicate.currentQuote?.acceptance, accepted.currentQuote?.acceptance);
  assert.equal((await app.post('/owner/action', finalize(initial))).status, 409);
  assert.equal((await app.post('/reset')).status, 200);
  const reset = await app.owner();
  assert.equal(reset.currentQuote, null);
  assert.equal(reset.coordinationSummary, null);
  assert.deepEqual(reset.quotes, []);
  assert.deepEqual(reset.reviews, []);
  assert.equal((await app.customer()).quote, undefined);
});

test('HTTP partial subtotal cannot bypass omitted-cost, scope, photo or amount guards', async t => {
  const app = await api(t);
  const owner = await collect(app, false);
  const base = finalize(owner, 950);
  const { internalReason: _reason, amount: _amount, ...approve } = base;
  assert.equal((await app.post('/owner/action', { ...approve, action: 'APPROVE' })).status, 409);
  for (const patch of [{ scopeConfirmed: false }, { omittedCostsAcknowledged: false }, { reviewedPhotoItemIndices: [] }]) {
    assert.equal((await app.post('/owner/action', { ...base, ...patch })).status, 409);
  }
  for (const amount of [null, 0, -1, '950', 1.001, Number.MAX_VALUE]) {
    assert.equal((await app.post('/owner/action', { ...base, amount })).status, 400);
  }
  assert.deepEqual(await app.owner(), owner, 'Every rejected request leaves all business state unchanged');
  assert.equal((await app.post('/owner/action', base)).status, 200, 'The owner may intentionally finalize the same numeric subtotal');
  const sent = await app.owner();
  assert.equal(sent.currentQuote?.approvedAmount, 950);
  assert.equal(sent.customer.lead.moveDetails.items[0].photoStatus, 'REQUIRED', 'Owner acknowledgement is not photo receipt');
  assert.ok(sent.customer.requirements.pendingReview.some(r => r.id === 'item.photo' && r.status === 'MISSING'));
  assert.deepEqual(sent.currentQuote?.reviewedPhotoItemIndices, [0]);
});

test('conditional acceptance changes the scope and invalidates the offer even if the extractor cannot represent the condition', async t => {
  for (const message of ['כן, אבל יש גם עוד ארון', 'כן, אבל רק אחרי 18:00', 'סגור, רק שהפריקה עכשיו בקומה 4', 'כן, בתנאי שנדבר קודם']) {
    await t.test(message, async t => {
      const app = await api(t, input => input.text === 'כן' ? {} : quoteFixtureExtractor(input));
      const sent = await sendQuote(app);
      const quote = sent.currentQuote!;
      assert.equal((await app.post('/message', { message, quoteId: quote.id, quoteVersion: quote.version })).status, 200);
      const changed = await app.owner();
      assert.notEqual(changed.customer.lead.status, 'WON');
      assert.equal(changed.currentQuote?.status, 'INVALIDATED');
      assert.equal(changed.currentQuote?.acceptance, null);
      assert.equal(changed.coordinationSummary, null);
      assert.equal(changed.pricingStale, true);
      assert.equal((await app.post('/owner/action', finalize(sent))).status, 409);
      const retry = await app.post('/message', { message: 'כן', quoteId: quote.id, quoteVersion: quote.version });
      assert.equal(retry.status, changed.customer.lead.status === 'HUMAN_HANDOFF' || changed.customer.nextQuestion !== null ? 200 : 409);
      assert.equal((await app.owner()).currentQuote?.acceptance, null, 'An answer to a new collection question or a handoff message cannot accept the invalidated quote');
    });
  }
});

test('clarification, negation and objections cannot accept a quote or silently close the lead', async t => {
  for (const message of ['זה כולל פירוק?', 'יקר לי', 'לא', 'כן?']) await t.test(message, async t => {
    const app = await api(t);
    await sendQuote(app);
    assert.equal((await app.post('/message', { message })).status, 200);
    const current = await app.owner();
    assert.notEqual(current.customer.lead.status, 'WON');
    assert.notEqual(current.customer.lead.status, 'LOST');
    assert.equal(current.currentQuote?.acceptance, null);
    assert.equal(current.coordinationSummary, null);
    assert.ok(current.customer.responseText.length > 0);
  });
});

test('yes without a quote or answering a different active question is handled as ordinary customer information', async t => {
  let calls = 0;
  const app = await api(t, () => { calls++; return { moveDetails: { pickup: { elevator: true } } }; });
  assert.equal((await app.post('/message', { message: 'כן' })).status, 200);
  assert.equal((await app.owner()).currentQuote, null);
  assert.equal((await app.customer()).lead.moveDetails.pickup.elevator, true);
  let owner = await app.owner();
  assert.equal((await app.post('/owner/sample', token(owner))).status, 200);
  owner = await app.owner();
  assert.equal((await app.post('/owner/action', { ...token(owner), action: 'APPROVE', pricingEvaluationId: owner.pricingEvaluation!.id,
    reviewedPhotoItemIndices: owner.pendingPhotoItemIndices })).status, 200);
  owner = await app.owner();
  assert.equal((await app.post('/owner/action', { ...token(owner), action: 'REQUEST_MORE_INFO', question: 'האם יש מעלית באיסוף?' })).status, 200);
  const asked = await app.owner();
  assert.equal((await app.post('/message', { message: 'כן', quoteId: asked.currentQuote!.id, quoteVersion: asked.currentQuote!.version })).status, 200);
  assert.equal(calls, 2);
  assert.notEqual((await app.customer()).lead.status, 'WON');
  assert.equal((await app.owner()).currentQuote?.acceptance, null);
});

test('failed extraction after a sent quote is atomic; later accepted scope changes go to coordination review', async t => {
  const app = await api(t, input => { if (input.text === 'תקלה סינתטית') throw new Error('Injected offline failure'); return quoteFixtureExtractor(input); });
  const sent = await sendQuote(app);
  assert.equal((await app.post('/message', { message: 'תקלה סינתטית' })).status, 502);
  assert.deepEqual(await app.owner(), sent);
  assert.equal((await app.post('/message', { message: 'מאשר' })).status, 200);
  const accepted = await app.owner();
  assert.equal((await app.post('/message', { message: 'סגור, רק שהפריקה עכשיו בקומה 4' })).status, 200);
  const changed = await app.owner();
  assert.equal(changed.customer.lead.status, 'HUMAN_HANDOFF');
  assert.equal(changed.coordinationSummary?.status, 'REVIEW_REQUIRED');
  assert.deepEqual(changed.currentQuote?.scope, accepted.currentQuote?.scope);
  assert.deepEqual(changed.currentQuote?.acceptance, accepted.currentQuote?.acceptance);
  assert.equal(changed.customer.nextQuestion, null);
});

test('a stale customer screen cannot accept a superseded quote', async t => {
  const app = await api(t);
  const first = await sendQuote(app);
  assert.equal((await app.post('/message', { message: 'סגור, רק שהפריקה עכשיו בקומה 4' })).status, 200);
  const changed = await app.owner();
  assert.equal((await app.post('/owner/pricing', token(changed))).status, 200);
  const fresh = await app.owner();
  assert.equal((await app.post('/owner/action', finalize(fresh, 1500))).status, 200);
  const second = await app.owner();
  assert.equal(second.currentQuote?.version, first.currentQuote!.version + 1);
  assert.equal(second.quotes[0].status, 'SUPERSEDED');
  const staleResponse = await app.post('/message', { message: 'כן', quoteId: first.currentQuote!.id, quoteVersion: first.currentQuote!.version });
  assert.equal(staleResponse.status, 409);
  assert.deepEqual(await app.owner(), second);
  assert.equal((await app.post('/message', { message: 'סגור', quoteId: second.currentQuote!.id, quoteVersion: second.currentQuote!.version })).status, 200);
  assert.equal((await app.owner()).coordinationSummary?.acceptedAmount, 1500);
});
