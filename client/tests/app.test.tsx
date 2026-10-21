import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createLead } from '../../server/src/domain/createLead';
import { evaluateRequirements } from '../../server/src/domain/requirements/evaluateRequirements';
import type { DemoSnapshot } from '../src/api';

// Set up a real DOM before importing ReactDOM, so native input events exercise React handlers.
const dom = new JSDOM('<!doctype html><html lang="he" dir="rtl"><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: false }) });
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App');
const { statusLabel } = await import('../src/AgentState');

function snapshot(withMessages = false): DemoSnapshot {
  const lead = createLead();
  const requirements = evaluateRequirements(lead);
  const responseText = 'הבנתי, עדכנתי את הפרטים. מה כתובת הפריקה?';
  if (withMessages) lead.messages.push(
    { id: 'customer', sender: 'CUSTOMER', timestamp: lead.createdAt, text: 'צריך להעביר מקרר' },
    { id: 'agent', sender: 'AGENT', timestamp: lead.createdAt, text: responseText },
  );
  return { lead, requirements, extraction: {}, unappliedItems: [], responseText, nextQuestion: requirements.nextQuestion };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(t: TestContext, fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  t.mock.method(globalThis, 'fetch', fetcher);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  await act(async () => root.render(<App />));
  return container;
}
function element<T extends Element>(container: Element, selector: string): T {
  const found = container.querySelector<T>(selector);
  assert.ok(found, `Missing element: ${selector}`);
  return found;
}
async function draft(container: Element, value: string) {
  const textarea = element<HTMLTextAreaElement>(container, 'textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function click(container: Element, selector: string) {
  await act(async () => element<HTMLButtonElement>(container, selector).click());
}

test('Hebrew value proposition, role labels and verified project links render with RTL and collapsed developer data', async t => {
  const container = await mount(t, async () => Response.json(snapshot(true)));
  assert.match(element(container, 'h1').textContent!, /מפניית לקוח להצעת מחיר באישור בעל העסק/);
  assert.ok(container.querySelector('footer a[href="https://github.com/BarShirom/moving-services-sales-agent"]'));
  assert.ok(container.querySelector('footer a[href="https://barshirom.com/"]'));
  assert.doesNotMatch(container.textContent!, /rick\s*(?:&|and|&amp;)\s*go/i);
  assert.deepEqual([...container.querySelectorAll('.message-label')].map(node => node.textContent), ['הלקוח', 'הסוכן']);
  for (const title of ['השיחה שלכם', 'מה הבנתי', 'מה עדיין חסר מהלקוח', 'השלב הבא']) assert.ok([...container.querySelectorAll('h2')].some(node => node.textContent === title));
  assert.equal(element(container, 'label').getAttribute('for'), element(container, 'textarea').id);
  assert.equal(element(container, '.app-shell').getAttribute('dir'), 'rtl');
  assert.equal(element<HTMLDetailsElement>(container, 'details').open, false);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>סוכן מכירות להובלות/);
  assert.doesNotMatch(html, /Rick/i);
});

test('initial loading disables controls, failed connection is announced, and reconnect restores the demo', async t => {
  const request = deferred();
  let calls = 0;
  const container = await mount(t, async () => ++calls === 1 ? request.promise : Response.json(snapshot()));
  assert.match(container.textContent!, /טוענים את השיחה/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').disabled, true);
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, true);
  await act(async () => request.resolve(new Response('', { status: 503 })));
  assert.match(element(container, '[role="alert"]').textContent!, /השרת אינו זמין/);
  assert.doesNotMatch(container.textContent!, /טוענים את השיחה/);
  await click(container, '.error-banner button');
  assert.equal(calls, 2);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').disabled, false);
});

test('opening and updating a conversation never scrolls the whole page past the introduction', async t => {
  const pageScroll = t.mock.method(dom.window.HTMLElement.prototype, 'scrollIntoView', () => {});
  const container = await mount(t, async () => Response.json(snapshot(true)));
  assert.equal(pageScroll.mock.callCount(), 0);
  await draft(container, 'דוגמה סינתטית');
  await click(container, '.send-button');
  assert.equal(pageScroll.mock.callCount(), 0, 'Conversation updates must scroll its own transcript rather than the page');
});

test('sending shows pending feedback and renders the full backend response before clearing the draft', async t => {
  const request = deferred();
  const sent: Array<{ url: string; init?: RequestInit }> = [];
  const container = await mount(t, async (url, init) => {
    sent.push({ url, init });
    return url.endsWith('/message') ? request.promise : Response.json(snapshot());
  });
  await draft(container, 'צריך להעביר מקרר');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, false);
  await click(container, '.send-button');
  assert.equal(sent[1].url, '/api/demo/message');
  assert.equal(sent[1].init?.method, 'POST');
  assert.deepEqual(JSON.parse(sent[1].init!.body as string), { message: 'צריך להעביר מקרר' });
  assert.match(container.textContent!, /הסוכן מעבד את ההודעה/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, 'צריך להעביר מקרר');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, true);
  const response = snapshot(true);
  await act(async () => request.resolve(Response.json(response)));
  assert.equal(element(container, '.agent .bubble').textContent, response.responseText);
  assert.equal(element(container, '.next-card > p').textContent, 'המשך איסוף הפרטים מהלקוח.');
  assert.notEqual(element(container, '.next-card > p').textContent, response.responseText);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, '');
  assert.equal(container.querySelector('.processing'), null);
});

test('send errors retain both the draft and conversation, and allow retry', async t => {
  let attempts = 0;
  const initial = snapshot(true);
  const container = await mount(t, async url => {
    if (!url.endsWith('/message')) return Response.json(initial);
    if (++attempts === 1) return Response.json({ error: { code: 'EXTRACTION_FAILED', message: 'לא הצלחנו לעבד את ההודעה כרגע.' } }, { status: 502 });
    return Response.json(initial);
  });
  await draft(container, 'טיוטה שמורה');
  await click(container, '.send-button');
  assert.match(element(container, '[role="alert"]').textContent!, /לא הצלחנו לעבד/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, 'טיוטה שמורה');
  assert.equal(element(container, '.agent .bubble').textContent, initial.responseText);
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, false);
  await click(container, '.send-button');
  assert.equal(attempts, 2);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, '');
});

test('reset keeps the existing draft while pending, then clears chat and draft on success', async t => {
  const request = deferred();
  const container = await mount(t, async (url, init) => {
    if (url.endsWith('/reset')) {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body, undefined);
      return request.promise;
    }
    return Response.json(snapshot(true));
  });
  await draft(container, 'טיוטה לפני איפוס');
  await click(container, '.reset-button');
  assert.ok(container.querySelector('[role="alertdialog"]'));
  await click(container, '.confirm-replace');
  assert.match(element(container, '.reset-button').textContent!, /מאפסים/);
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, true);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, 'טיוטה לפני איפוס');
  await act(async () => request.resolve(Response.json(snapshot())));
  assert.equal(container.querySelector('.message'), null);
  assert.match(container.textContent!, /מה צריך להעביר/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, '');
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, false);
});

test('failed reset preserves the current conversation and draft', async t => {
  const container = await mount(t, async url => {
    if (url.endsWith('/reset')) throw new Error('offline');
    return Response.json(snapshot(true));
  });
  await draft(container, 'לא לאבד את הטיוטה');
  await click(container, '.reset-button');
  await click(container, '.confirm-replace');
  assert.match(element(container, '[role="alert"]').textContent!, /לא ניתן להתחבר/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, 'לא לאבד את הטיוטה');
  assert.equal(container.querySelectorAll('.message').length, 2);
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, false);
});

test('example populates an editable draft, blank drafts cannot send, and the keyboard shortcut submits', async t => {
  const initial = snapshot();
  const before = structuredClone(initial);
  const requests: Array<{ url: string; body?: unknown }> = [];
  const container = await mount(t, async (url, init) => {
    requests.push({ url, ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
    return Response.json(initial);
  });
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  await draft(container, '  ');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  await click(container, '.example-button');
  const textarea = element<HTMLTextAreaElement>(container, 'textarea');
  assert.match(textarea.value, /מקרר/);
  assert.equal(document.activeElement, textarea);
  assert.deepEqual(requests, [{ url: '/api/demo' }], 'The editable example cannot load a structured lead or call an API');
  assert.deepEqual(initial, before);
  assert.equal(container.querySelector('.message'), null);
  await draft(container, 'צריך להעביר שולחן קטן');
  assert.deepEqual(requests, [{ url: '/api/demo' }], 'Editing the example still does not submit it');
  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  });
  assert.deepEqual(requests, [{ url: '/api/demo' }, { url: '/api/demo/message', body: { message: 'צריך להעביר שולחן קטן' } }]);
  assert.equal(textarea.value, '');
});

test('status labels reflect existing backend states and distinguish temporarily pending information', () => {
  const state = snapshot();
  assert.equal(statusLabel(state), 'איסוף מידע');
  state.nextQuestion = null;
  assert.equal(statusLabel(state), 'ממתין למידע נוסף');
  for (const [status, expected] of [
    ['READY_FOR_PRICING', 'מוכן לבדיקה ותמחור'], ['AWAITING_REVIEW', 'ממתין לבדיקה'],
    ['QUOTE_SENT', 'הצעת המחיר נשלחה'], ['WON', 'הלקוח אישר את המחיר'], ['LOST', 'הפנייה נסגרה'],
  ] as const) {
    state.lead.status = status;
    assert.equal(statusLabel(state), expected);
    assert.equal(state.lead.status, status);
  }
});

// Owner view exercises actual workflow functions behind a local fake HTTP transport.
const { sampleOwnerState, freshOwnerState, ownerSnapshot, applyOwnerAction } = await import('../../server/src/demo/ownerWorkflow');
function ownerTransport(initial = sampleOwnerState()) {
  let current = initial;
  const messages: Array<Record<string, unknown>> = [];
  return {
    get current() { return current; },
    messages,
    fetch: async (url: string, init?: RequestInit) => {
      if (url === '/api/demo/owner') return Response.json(ownerSnapshot(current));
      if (url === '/api/demo') return Response.json(current.customer);
      if (url === '/api/demo/reset') { current = freshOwnerState(); return Response.json(current.customer); }
      if (url === '/api/demo/message') {
        const body = JSON.parse(init!.body as string);
        messages.push(body);
        const { handleQuoteReply } = await import('../../server/src/demo/ownerWorkflow');
        const result = handleQuoteReply(current, body.message, new Date('2026-10-07T10:00:00Z'),
          body.quoteId ? { quoteId: body.quoteId, quoteVersion: body.quoteVersion } : undefined);
        assert.ok(result, 'The test transport only handles contextual quote replies');
        current = result;
        return Response.json(current.customer);
      }
      if (url === '/api/demo/owner/action') {
        try { current = applyOwnerAction(current, JSON.parse(init!.body as string)); return Response.json(ownerSnapshot(current)); }
        catch { return Response.json({ error: { code: 'INVALID_OWNER_ACTION', message: 'הסכום חייב להיות חיובי.' } }, { status: 400 }); }
      }
      throw new Error('Unexpected request: ' + url);
    },
  };
}
async function fill(container: Element, selector: string, value: string) {
  const field = element<HTMLInputElement | HTMLTextAreaElement>(container, selector);
  const prototype = field.tagName === 'INPUT' ? dom.window.HTMLInputElement.prototype : dom.window.HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function buttonNamed(container: Element, label: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === label);
  assert.ok(button, label);
  await act(async () => button.click());
}

async function partialQuoteTransport() {
  const { createMoveItem } = await import('../../server/src/domain/createMoveItem');
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = ownerTransport();
  const state = freshOwnerState();
  const lead = state.customer.lead;
  lead.createdAt = lead.updatedAt = '2026-10-07T09:00:00.000Z';
  lead.moveDetails = {
    items: [
      { ...createMoveItem('refrigerator'), quantity: 1, sizeCategory: 'LARGE' },
      { ...createMoveItem('dresser'), quantity: 1, sizeCategory: 'SMALL' },
      { ...createMoveItem('box'), quantity: 15 },
    ],
    pickup: { city: 'עיר הדגמה א', address: 'רחוב סינתטי 10', floor: 2, elevator: false },
    dropoff: { city: 'עיר הדגמה ב', address: 'רחוב סינתטי 20', floor: 1, elevator: false },
    requestedDate: '2026-11-08', requestedTime: null, specialAccessNotes: null,
  };
  state.customer.requirements = evaluateRequirements(lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  state.customer.responseText = state.customer.nextQuestion!.text;
  lead.messages = [{ id: 'synthetic-photo-question', sender: 'AGENT', timestamp: lead.createdAt, text: state.customer.responseText }];
  Object.assign(transport.current, generatePricing(state, new Date('2026-10-07T09:00:00Z')));
  return transport;
}

for (const finalAmount of [950, 1234]) {
  test(`partial subtotal requires explicit finalization before sending ${finalAmount}, contextual acceptance and coordination`, async t => {
    const transport = await partialQuoteTransport();
    const evaluation = structuredClone(transport.current.pricingEvaluation!);
    assert.equal(evaluation.suggestedAmount, 950);
    assert.equal(evaluation.completeness, 'PARTIAL_RECOMMENDATION');
    const container = await mount(t, transport.fetch);
    assert.match(element(container, '.message-area').textContent!, /תמונה/);
    assert.doesNotMatch(container.textContent!, /\u2014/u);
    await draft(container, 'טיוטה לפני בדיקת הבעלים');
    await buttonNamed(container, 'בעל העסק');
    assert.equal([...container.querySelectorAll('button')].some(button => button.textContent === 'אשר ושלח הצעת מחיר'), false);
    await buttonNamed(container, 'השלם ואשר מחיר סופי');
    assert.doesNotMatch(container.textContent!, /\u2014/u);
    assert.match(element(container, '.calculated-subtotal').textContent!, /סכום הרכיבים שתומחרו.*950/);
    assert.match(element(container, '.finalization-omissions').textContent!, /שידה.*הובלה דורשת תמחור ידני/);
    assert.match(element(container, '.finalization-omissions').textContent!, /מרחק/);
    assert.doesNotMatch(element(container, '.finalization-omissions').textContent!, /פירוק|הרכבה/);
    assert.equal(element<HTMLInputElement>(container, '#scope-confirmation').checked, false);
    assert.equal(element<HTMLInputElement>(container, '#photo-confirmation-0').checked, false);
    assert.equal(element<HTMLButtonElement>(container, '.finalization-form button[type="submit"]').disabled, true);
    assert.equal(transport.current.quotes.length, 0);
    await fill(container, '#approved-amount', String(finalAmount));
    await fill(container, '#internal-reason', 'החלטה פרטית לדוגמה');
    await click(container, '#scope-confirmation');
    assert.equal(element<HTMLButtonElement>(container, '.finalization-form button[type="submit"]').disabled, true);
    await click(container, '#photo-confirmation-0');
    assert.equal(element<HTMLButtonElement>(container, '.finalization-form button[type="submit"]').disabled, false);
    await buttonNamed(container, 'אשר ושלח את המחיר הסופי');

    const sent = transport.current.customer.quote!;
    assert.equal(sent.approvedAmount, finalAmount);
    assert.equal(sent.status, 'SENT');
    assert.equal(transport.current.quotes.length, 1);
    assert.equal(transport.current.reviews[0].omittedCostsAcknowledged, true);
    assert.deepEqual(transport.current.reviews[0].reviewedPhotoItemIndices, [0]);
    assert.deepEqual(transport.current.pricingEvaluation, evaluation);
    assert.equal(transport.current.customer.lead.moveDetails.items[0].photoStatus, 'REQUIRED');
    assert.equal(transport.current.customer.requirements.pendingReview.find(requirement => requirement.id === 'item.photo')!.status, 'MISSING');
    assert.match(element(container, '.final-quote-amount').textContent!, new RegExp(finalAmount.toLocaleString('he-IL')));
    assert.match(element(container, '.pricing-card h2').textContent!, /חישוב המנוע/);
    assert.match(element(container, '.suggested-price').textContent!, /950/);
    assert.doesNotMatch(element(container, '.pricing-card').textContent!, /בעל העסק נדרש לקבוע ולאשר מחיר סופי/);
    assert.match(element(container, '.pricing-card').textContent!, /המחיר הסופי נקבע ואושר בנפרד/);
    assert.equal(element(container, '.review-badge').textContent, 'הצעת המחיר נשלחה');
    assert.match(element(container, '.photo-decisions').textContent!, /אישר להמשיך ללא תמונה.*התמונה לא התקבלה/);
    assert.doesNotMatch(container.textContent!, /\u2014/u);
    await buttonNamed(container, 'לקוח');
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה לפני בדיקת הבעלים');
    assert.match(element(container, '.next-card > p').textContent!, /ממתינים לתשובת הלקוח/);
    assert.match(element(container, '.message-area').textContent!, new RegExp(`${finalAmount.toLocaleString('he-IL')} ₪`));
    assert.doesNotMatch(container.textContent!, /החלטה פרטית לדוגמה|confidence|omittedCostsAcknowledged|scopeFingerprint|pricingEvaluationId/);
    await draft(container, 'כן');
    await click(container, '.send-button');

    assert.deepEqual(transport.messages.at(-1), { message: 'כן', quoteId: sent.id, quoteVersion: sent.version });
    assert.equal(transport.current.customer.lead.status, 'WON');
    assert.equal(transport.current.customer.quote!.acceptance!.amount, finalAmount);
    assert.equal(transport.current.customer.quote!.acceptance!.quoteId, sent.id);
    assert.equal(element(container, '.next-card > p').textContent, 'ממתין לתיאום');
    assert.doesNotMatch(element(container, '.next-card').textContent!, /ממתינים לתשובת הלקוח/);
    assert.match(element(container, '.conversation-header .status-label').textContent!, /הלקוח אישר את המחיר/);
    assert.match(element(container, '.message-area').textContent!, /עדיין לא שוריין/);
    assert.doesNotMatch(container.textContent!, /\u2014/u);
    const accepted = structuredClone(transport.current.customer.quote!.acceptance);
    await draft(container, 'מאשר');
    await click(container, '.send-button');
    assert.deepEqual(transport.current.customer.quote!.acceptance, accepted);
    await buttonNamed(container, 'בעל העסק');
    assert.equal(element(container, '.review-badge').textContent, 'הלקוח אישר את המחיר');
    const summary = element(container, '.coordination-summary');
    assert.match(summary.textContent!, /ממתין לתיאום/);
    assert.match(summary.textContent!, new RegExp(finalAmount.toLocaleString('he-IL')));
    assert.match(summary.textContent!, /מקרר.*שידה.*ארגזים/);
    assert.match(summary.textContent!, /רחוב סינתטי 10.*קומה: 2.*מעלית: לא/);
    assert.match(summary.textContent!, /רחוב סינתטי 20.*קומה: 1.*מעלית: לא/);
    assert.match(summary.textContent!, /2026-11-08.*נדרש תיאום סופי/);
    assert.match(summary.textContent!, /לא נמסרו שירותי פירוק או הרכבה שנדרשים במפורש/);
    assert.match(summary.textContent!, /התמונה עדיין חסרה/);
    assert.doesNotMatch(container.textContent!, /\u2014/u);
    assert.equal(container.querySelectorAll('.coordination-summary').length, 1);
    assert.equal(element<HTMLButtonElement>(container, '.approve-button').disabled, true);
    await buttonNamed(container, 'איפוס הדגמה');
    await click(container, '.confirm-replace');
    assert.equal(transport.current.customer.quote, undefined);
    assert.equal(transport.current.coordinationSummary, null);
    assert.equal(transport.current.quotes.length, 0);
    assert.equal(transport.current.reviews.length, 0);
    await buttonNamed(container, 'בעל העסק');
    assert.equal(container.querySelector('.coordination-summary'), null);
    assert.equal(container.querySelector('.final-quote-card'), null);
    assert.match(element(container, 'footer').textContent!, /בר שירום/);
  });
}

test('manual pricing starts empty and invalid final totals cannot be submitted', async t => {
  const { createMoveItem } = await import('../../server/src/domain/createMoveItem');
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = await partialQuoteTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items = [{ ...createMoveItem('dresser'), quantity: 1 }];
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  Object.assign(state, generatePricing(state, new Date('2026-10-07T09:00:00Z')));
  assert.equal(state.pricingEvaluation!.suggestedAmount, null);
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'הזן ואשר מחיר סופי');
  assert.equal(element<HTMLInputElement>(container, '#approved-amount').value, '');
  assert.match(element(container, '.calculated-subtotal').textContent!, /המחיר ייקבע על ידי בעל העסק/);
  assert.doesNotMatch(container.textContent!, /\u2014/u);
  assert.match(element(container, '.price-metrics').textContent!, /לא זמין/);
  await click(container, '#scope-confirmation');
  for (const invalid of ['', '0', '-10', '1.234', 'Infinity']) {
    await fill(container, '#approved-amount', invalid);
    assert.equal(element<HTMLButtonElement>(container, '.finalization-form button[type="submit"]').disabled, true);
    await act(async () => element(container, '.finalization-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(element(container, '[role="alert"]').textContent!, /מחיר סופי חיובי/);
    assert.equal(transport.current.quotes.length, 0);
  }
  await fill(container, '#approved-amount', '777');
  await buttonNamed(container, 'אשר ושלח את המחיר הסופי');
  assert.equal(transport.current.customer.quote!.approvedAmount, 777);
  assert.equal(transport.current.pricingEvaluation!.suggestedAmount, null);
});

test('failed finalization preserves the entered total and explicit acknowledgements without creating a quote', async t => {
  const transport = await partialQuoteTransport();
  const container = await mount(t, async (url, init) => url === '/api/demo/owner/action'
    ? Response.json({ error: { code: 'STALE_REVIEW', message: 'הפנייה השתנתה. יש לרענן לפני אישור.' } }, { status: 409 })
    : transport.fetch(url, init));
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'השלם ואשר מחיר סופי');
  await fill(container, '#approved-amount', '1200');
  await fill(container, '#internal-reason', 'הערה פרטית שנשמרת');
  await click(container, '#scope-confirmation');
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר ושלח את המחיר הסופי');
  assert.match(element(container, '[role="alert"]').textContent!, /הפנייה השתנתה/);
  assert.equal(element<HTMLInputElement>(container, '#approved-amount').value, '1200');
  assert.equal(element<HTMLInputElement>(container, '#internal-reason').value, 'הערה פרטית שנשמרת');
  assert.equal(element<HTMLInputElement>(container, '#scope-confirmation').checked, true);
  assert.equal(element<HTMLInputElement>(container, '#photo-confirmation-0').checked, true);
  assert.equal(transport.current.quotes.length, 0);
  assert.equal(transport.current.reviews.length, 0);
});

test('explicit dresser disassembly is shown without claiming unknown assembly is required', async t => {
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = await partialQuoteTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items[1].requiresDisassembly = true;
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  Object.assign(state, generatePricing(state, new Date('2026-10-07T09:00:00Z')));
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  assert.match(element(container, '.omitted-list').textContent!, /פירוק של השידה: נדרש תמחור ידני/);
  assert.doesNotMatch(element(container, '.omitted-list').textContent!, /הרכבה/);
  assert.match(element(container, '.review-reasons').textContent!, /שידה: נדרש תמחור ידני עבור פירוק/);
  assert.equal(state.customer.lead.moveDetails.items[1].requiresAssembly, null);
});

test('unknown relevant wardrobe services remain a clarification rather than a declared requirement', async t => {
  const { createMoveItem } = await import('../../server/src/domain/createMoveItem');
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = await partialQuoteTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items[1] = { ...createMoveItem('wardrobe'), quantity: 1, sizeCategory: 'LARGE' };
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  Object.assign(state, generatePricing(state, new Date('2026-10-07T09:00:00Z')));
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  assert.match(element(container, '.omitted-list').textContent!, /צורך בפירוק \/ הרכבה של הארון: נדרש בירור/);
  assert.doesNotMatch(element(container, '.omitted-list').textContent!, /פירוק והרכבה של הארון: נדרש תמחור ידני/);
  assert.match(element(container, '.review-reasons').textContent!, /ארון: צורך בפירוק או בהרכבה טרם הובהר/);
});

test('complete recommendation with its photo received is sent only after the explicit owner click', async t => {
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = ownerTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items[0].photoStatus = 'RECEIVED';
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  Object.assign(state, generatePricing(state, new Date('2026-10-07T09:00:00Z')));
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  assert.equal(transport.current.quotes.length, 0);
  assert.equal(container.querySelector('.finalization-form'), null);
  await buttonNamed(container, 'אשר ושלח הצעת מחיר');
  assert.equal(transport.current.quotes.length, 1);
  assert.equal(transport.current.customer.quote!.status, 'SENT');
  assert.equal(element(container, '.review-badge').textContent, 'הצעת המחיר נשלחה');
});

test('customer cannot see recommendation; owner renders breakdown, omissions and review reasons', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  assert.equal(container.querySelector('.pricing-card'), null);
  assert.doesNotMatch(container.textContent!, /suggestedAmount|internalReason|מחיר מומלץ/);
  await buttonNamed(container, 'בעל העסק');
  assert.ok(container.querySelector('.pricing-card'));
  assert.match(element(container, '.suggested-price').textContent!, /900/);
  assert.match(element(container, '.price-metrics').textContent!, /75%/);
  assert.equal(container.querySelectorAll('.price-breakdown > li').length, 4);
  assert.equal(container.querySelectorAll('.omitted-list > li').length, 0);
  assert.match(container.textContent!, /המלצה מלאה/);
  assert.match(element(container, '.review-reasons').textContent!, /תעריף המרחק הוא הנחת עבודה זמנית/);
  assert.match(container.textContent!, /נדרש אישור בעל העסק/);
  assert.match(element(container, 'footer').textContent!, /בר שירום/);
  await buttonNamed(container, 'לקוח');
  assert.equal(container.querySelector('.pricing-card'), null);
  assert.doesNotMatch(container.textContent!, /suggestedAmount|מחיר מומלץ/);
});

test('reported large refrigerator and 15 boxes show a current full recommendation with synthetic distance and enabled owner actions', async t => {
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = ownerTransport();
  const state = transport.current;
  const lead = state.customer.lead;
  const [refrigerator, boxes] = lead.moveDetails.items;
  refrigerator.quantity = null;
  refrigerator.dimensions = { width: null, height: null, depth: null };
  refrigerator.requiresDisassembly = refrigerator.requiresAssembly = null;
  boxes.requiresDisassembly = boxes.requiresAssembly = null;
  lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
  lead.moveDetails.dropoff = { city: 'תל אביב', address: 'סלמה 37', floor: 2, elevator: false };
  lead.moveDetails.requestedDate = '2026-11-08';
  lead.messages = [
    { id: 'customer-inventory', sender: 'CUSTOMER', timestamp: lead.createdAt,
      text: 'צריך להעביר מקרר גדול מרמת גן לתל אביב. האיסוף מביאליק 20, קומה 2 בלי מעלית. יש גם בערך 15 ארגזים.' },
    { id: 'customer-photo', sender: 'CUSTOMER', timestamp: lead.createdAt, text: 'אין לי כרגע' },
    { id: 'agent-review', sender: 'AGENT', timestamp: lead.createdAt, text: 'הפרטים ממתינים לבדיקה ותמחור אצל בעל העסק.' },
  ];
  state.customer.requirements = evaluateRequirements(lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  state.customer.responseText = lead.messages.at(-1)!.text;
  state.pricingContext = {};
  Object.assign(state, generatePricing(state));

  assert.equal(state.customer.lead.moveDetails.items[0].quantity, null);
  assert.equal(state.pricingEvaluation!.inputSnapshot.moveDetails.items[0].quantity, 1);
  assert.equal(state.pricingEvaluation!.suggestedAmount, 1150);
  assert.deepEqual(state.pricingEvaluation!.priceRange, { min: 950, max: 1350 });
  assert.equal(state.pricingEvaluation!.confidence, 60);
  assert.equal(state.pricingEvaluation!.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(state.pricingEvaluation!.humanApprovalRequired, true);
  assert.equal(state.pricingEvaluation!.completeness, 'COMPLETE_RECOMMENDATION');

  const container = await mount(t, transport.fetch);
  assert.match(element(container, '.message-area').textContent!, /אין לי כרגע/);
  assert.doesNotMatch(element(container, '.message-area').textContent!, /₪|מחיר ההובלה הוא/);
  assert.equal(container.querySelector('.pricing-card'), null);
  await buttonNamed(container, 'בעל העסק');
  assert.match(element(container, '.suggested-price').textContent!, /1,150/);
  assert.match(element(container, '.price-metrics').textContent!, /950.*1,350.*60%/);
  assert.equal(container.querySelector('.stale-banner'), null);
  assert.match(element(container, '.pricing-card').textContent!, /המלצה מלאה/);
  assert.match(element(container, '.pricing-card').textContent!, /מרחק הדגמה סינתטי: 20 ק״מ \(נתון זמני, לא מדידת מפה\)/);
  const rows = [...container.querySelectorAll('.price-breakdown > li')];
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.querySelector('strong')!.textContent), [
    'מקרר גדול', '15 ארגזים', 'מרחק המסלול', 'קומות ללא מעלית באיסוף', 'קומות ללא מעלית בפריקה',
  ]);
  assert.deepEqual(rows.map(row => row.querySelector('b')!.textContent!.replace(/[^\d]/g, '')), ['425', '150', '75', '250', '250']);
  assert.equal(container.querySelectorAll('.omitted-list > li').length, 0);
  const reviewText = element(container, '.review-reasons').textContent!;
  assert.match(reviewText, /התמחור מניח מקרר אחד/);
  assert.match(reviewText, /מקרר: חסרים צילום או מידות מלאות/);
  assert.doesNotMatch(reviewText, /כמות הפריט חסרה|כמות המקררים חסרה|צורך בפירוק או בהרכבה טרם הובהר/);
  const actionButtons = [...container.querySelectorAll<HTMLButtonElement>('.action-grid button')];
  assert.equal(actionButtons.length, 4);
  assert.ok(actionButtons.every(button => !button.disabled));
  assert.equal(element<HTMLButtonElement>(container, '.recalculate-button').disabled, false);
  assert.deepEqual(state.reviews, []);
  assert.ok(state.customer.lead.messages.every(message => message.sender !== 'HUMAN'));
  await buttonNamed(container, 'לקוח');
  assert.doesNotMatch(container.textContent!, /1,150|suggestedAmount|מרחק הדגמה סינתטי/);
  assert.doesNotMatch(element(container, '.message-area').textContent!, /₪|מחיר ההובלה הוא/);
});

test('owner review wording merges equivalent notes but preserves distinct item issues and all confidence deductions', async t => {
  const transport = ownerTransport();
  const evaluation = transport.current.pricingEvaluation!;
  // Rendering-only fixture: equivalent adapter notes can have different internal codes.
  evaluation.reviewReasons = [
    { code: 'ADAPTER_REVIEW_A', message: 'נדרש אישור לתנאי ההובלה', confidenceDeduction: 2 },
    { code: 'ADAPTER_REVIEW_B', message: 'נדרש אישור לתנאי ההובלה', confidenceDeduction: 3 },
    { code: 'ITEM_0_VISUAL_EVIDENCE', message: 'Missing visual evidence', confidenceDeduction: 4 },
    { code: 'ITEM_1_VISUAL_EVIDENCE', message: 'Missing visual evidence', confidenceDeduction: 6 },
  ];
  evaluation.confidence = 85;
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  const notes = [...container.querySelectorAll('.review-reasons li')];
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map(note => note.textContent), [
    'נדרש אישור לתנאי ההובלה',
    'מקרר: חסרים צילום או מידות מלאות',
    'ארגזים: חסרים צילום או מידות מלאות',
  ]);
  const confidence = element<HTMLDetailsElement>(container, '.confidence-details');
  assert.equal(confidence.open, false);
  assert.deepEqual([...confidence.querySelectorAll('small')].map(note => note.textContent), [
    'הפחתה בציון: 5', 'הפחתה בציון: 4', 'הפחתה בציון: 6',
  ]);
  assert.match(element(container, '.price-metrics').textContent!, /85%/);
  assert.equal(evaluation.reviewReasons.length, 4);
  assert.deepEqual(evaluation.reviewReasons.map(reason => reason.confidenceDeduction), [2, 3, 4, 6]);
});

for (const assembly of [null, true]) {
  test(`mixed refrigerator, wardrobe and boxes separate supported pricing from manual work with assembly ${assembly}`, async t => {
    const { createMoveItem } = await import('../../server/src/domain/createMoveItem');
    const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
    const transport = ownerTransport();
    const state = transport.current;
    const lead = state.customer.lead;
    lead.moveDetails.items = [
      { ...createMoveItem('refrigerator'), sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE' },
      { ...createMoveItem('wardrobe'), sizeCategory: 'די גדול', dimensionsAvailable: false,
        requiresDisassembly: true, requiresAssembly: assembly },
      { ...createMoveItem('box'), quantity: 15 },
    ];
    lead.moveDetails.pickup = { city: 'רמת גן', address: 'ביאליק 20', floor: 2, elevator: false };
    lead.moveDetails.dropoff = { city: 'תל אביב', address: 'סלמה 37', floor: 3, elevator: true };
    lead.moveDetails.requestedDate = '2026-11-08';
    lead.messages = [
      { id: 'customer-mixed-inventory', sender: 'CUSTOMER', timestamp: lead.createdAt,
        text: 'מקרר גדול, ארון די גדול לפירוק ו-15 ארגזים. אין לי מידות או תמונה כרגע.' },
      { id: 'agent-review', sender: 'AGENT', timestamp: lead.createdAt,
        text: 'הפרטים יעברו לבדיקה ותמחור אצל בעל העסק.' },
    ];
    state.customer.requirements = evaluateRequirements(lead);
    state.customer.nextQuestion = state.customer.requirements.nextQuestion;
    state.customer.responseText = lead.messages.at(-1)!.text;
    state.pricingContext = {};
    Object.assign(state, generatePricing(state));

    const evaluation = state.pricingEvaluation!;
    assert.equal(evaluation.suggestedAmount, 900);
    assert.deepEqual(evaluation.priceRange, { min: 750, max: 1050 });
    assert.equal(evaluation.completeness, 'PARTIAL_RECOMMENDATION');
    assert.equal(evaluation.status, 'MANUAL_REVIEW_REQUIRED');
    assert.equal(evaluation.humanApprovalRequired, true);
    assert.ok(evaluation.confidence > 0);
    if (assembly === null) {
      assert.equal(state.customer.requirements.readyForPricing, false);
      assert.match(state.customer.nextQuestion!.text, /האם נדרשת הרכבה/);
    }
    assert.deepEqual(state.customer.lead.moveDetails.items.map(item => item.quantity), [null, null, 15]);
    assert.deepEqual(evaluation.inputSnapshot.moveDetails.items.map(item => item.quantity), [1, 1, 15]);
    assert.equal(new Set(evaluation.reviewReasons.map(reason => reason.code)).size, evaluation.reviewReasons.length);

    const container = await mount(t, transport.fetch);
    assert.match(element(container, '.message-area').textContent!, /ארון די גדול לפירוק/);
    assert.doesNotMatch(element(container, '.message-area').textContent!, /₪|מחיר ההובלה הוא/);
    await buttonNamed(container, 'בעל העסק');
    const pricing = element(container, '.pricing-card');
    assert.match(element(container, '.suggested-price').textContent!, /900/);
    assert.match(element(container, '.price-metrics').textContent!, /750.*1,050/);
    assert.match(pricing.textContent!, /המלצה חלקית/);
    assert.match(pricing.textContent!, /נדרש אישור בעל העסק/);
    assert.equal(container.querySelector('.stale-banner'), null);
    assert.deepEqual([...pricing.querySelectorAll('h3')].map(heading => heading.textContent), [
      'תומחר', 'דורש תמחור ידני', 'מה דורש בדיקה',
    ]);
    const rows = [...container.querySelectorAll('.price-breakdown > li')];
    assert.deepEqual(rows.map(row => row.querySelector('strong')!.textContent), [
      'מקרר גדול', '15 ארגזים', 'מרחק המסלול', 'קומות ללא מעלית באיסוף',
    ]);
    assert.deepEqual(rows.map(row => row.querySelector('b')!.textContent!.replace(/[^\d]/g, '')), ['425', '150', '75', '250']);
    assert.match(element(container, '.pricing-scope').textContent!, /תמחור המדרגות כולל את הפריטים שתומחרו בלבד/);
    assert.match(pricing.textContent!, /מרחק הדגמה סינתטי: 20 ק״מ/);
    const omitted = element(container, '.omitted-list').textContent!;
    assert.match(omitted, /ארון: הובלה דורשת תמחור ידני/);
    assert.match(omitted, assembly ? /פירוק והרכבה של הארון: נדרש תמחור ידני/ : /פירוק של הארון: נדרש תמחור ידני/);
    assert.match(omitted, /מידות הארון: נדרשת השלמה או בדיקה/);
    assert.match(omitted, /נשיאה וגישה עבור הארון: דורשות בדיקה ותמחור ידני/);
    assert.doesNotMatch(pricing.textContent!, /REFRIGERATOR|UNSUPPORTED_ITEM|ASSEMBLY_DISASSEMBLY|ITEM_DIMENSIONS/);
    const review = element(container, '.review-reasons').textContent!;
    assert.match(review, /התמחור מניח מקרר אחד וארון אחד/);
    assert.doesNotMatch(review, /כמות הפריט חסרה|כמות המקררים חסרה|לא ידוע אם הפריט נכנס במעלית/);
    const wardrobeNotes = [...container.querySelectorAll('.review-reasons li')]
      .map(note => note.firstChild!.textContent).filter(label => label?.startsWith('ארון:'));
    assert.equal(wardrobeNotes.length, 3);
    assert.equal(new Set(wardrobeNotes).size, 3);
    assert.deepEqual(state.reviews, []);
    assert.ok(state.customer.lead.messages.every(message => message.sender !== 'HUMAN'));
    await buttonNamed(container, 'לקוח');
    assert.equal(container.querySelector('.pricing-card'), null);
    assert.doesNotMatch(element(container, '.message-area').textContent!, /₪|מחיר ההובלה הוא/);
  });
}

test('omitted refrigerator uses a Hebrew label even when no appliance price can be recommended', async t => {
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = ownerTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items[0].quantity = null;
  state.pricingContext.inventoryComplete = false;
  Object.assign(state, generatePricing(state));
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  const omitted = element(container, '.omitted-list').textContent!;
  assert.match(omitted, /מקרר: נדרש בירור לתמחור/);
  assert.doesNotMatch(omitted, /REFRIGERATOR/);
});

test('owner sees unavailable wardrobe dimensions as unresolved alongside both requested services', async t => {
  const { createMoveItem } = await import('../../server/src/domain/createMoveItem');
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const transport = ownerTransport();
  const state = transport.current;
  state.customer.lead.moveDetails.items.push({ ...createMoveItem('wardrobe'), quantity: 1,
    dimensionsAvailable: false, requiresDisassembly: true, requiresAssembly: true });
  state.customer.requirements = evaluateRequirements(state.customer.lead);
  state.customer.nextQuestion = state.customer.requirements.nextQuestion;
  Object.assign(state, generatePricing(state));
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  assert.match(element(container, '.items-list').textContent!, /מידות לא זמינות כרגע.*ממתינות להשלמה/);
  assert.match(element(container, '.items-list').textContent!, /פירוק: כן.*הרכבה: כן/);
  assert.match(element(container, '.missing-list').textContent!, /מידות הארון: לא זמינות כרגע/);
  assert.doesNotMatch(element(container, '.missing-card').textContent!, /בדיקת תמחור/);
  assert.match(element(container, '.owner-review-card').textContent!, /ארון: דורש בדיקת תמחור/);
  assert.doesNotMatch(container.textContent!, /בדיקת תמיכה בסוג הפריט/);
  assert.match(element(container, '.review-reasons').textContent!, /הלקוח אינו יכול למסור את כל המידות כרגע/);
  assert.match(element(container, '.pricing-card').textContent!, /המלצה חלקית/);
  assert.equal(state.customer.requirements.readyForPricing, false);
  assert.deepEqual(state.reviews, []);
});

test('approve updates backend state, survives view switches and exposes only approved customer quote', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  await draft(container, 'טיוטה נשמרת');
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'אשר ושלח הצעת מחיר');
  assert.equal(transport.current.quotes.length, 0);
  assert.equal(element<HTMLInputElement>(container, '#photo-confirmation-0').checked, false);
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר תנאים ושלח הצעת מחיר');
  assert.equal(transport.current.reviews[0].decision, 'APPROVED');
  assert.equal(transport.current.customer.lead.status, 'QUOTE_SENT');
  assert.match(element(container, '.owner-history').textContent!, /900/);
  await buttonNamed(container, 'לקוח');
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה נשמרת');
  assert.match(element(container, '.message-area').textContent!, /900 ₪/);
  assert.doesNotMatch(container.textContent!, /suggestedAmount|internalReason|pricingEvaluationId|confidence/);
  assert.equal(transport.current.customer.quote!.approvedAmount, 900);
  await buttonNamed(container, 'בעל העסק');
  assert.equal(element<HTMLButtonElement>(container, '.approve-button').disabled, true);
  assert.equal(transport.current.reviews.length, 1);
});

test('adjust form submits positive price and private reason while preserving suggestion', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'שנה מחיר');
  await fill(container, '#approved-amount', '950');
  await fill(container, '#internal-reason', 'תוספת פנימית לבדיקה');
  await click(container, '#scope-confirmation');
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר ושלח את המחיר הסופי');
  assert.equal(transport.current.reviews[0].suggestedAmount, 900);
  assert.equal(transport.current.reviews[0].approvedAmount, 950);
  assert.match(element(container, '.owner-history').textContent!, /תוספת פנימית/);
  await buttonNamed(container, 'לקוח');
  assert.match(element(container, '.message-area').textContent!, /950 ₪/);
  assert.doesNotMatch(container.textContent!, /תוספת פנימית|suggestedAmount/);
});

test('invalid adjustment is blocked by form and handler validation while preserving the draft', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'שנה מחיר');
  await fill(container, '#approved-amount', '-1');
  assert.equal(element<HTMLInputElement>(container, '#approved-amount').checkValidity(), false);
  await act(async () => element(container, '.owner-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.match(element(container, '[role="alert"]').textContent!, /חיובי/);
  assert.equal(element<HTMLInputElement>(container, '#approved-amount').value, '-1');
  assert.equal(transport.current.reviews.length, 0);
});

test('owner information request reaches customer; stale recommendation cannot be approved', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'בקש מידע נוסף');
  await fill(container, '#owner-question', 'האם יש קושי בחניה?');
  await buttonNamed(container, 'שלח שאלה ללקוח');
  assert.equal(transport.current.reviews[0].decision, 'REQUEST_MORE_INFO');
  assert.match(element(container, '.owner-history').textContent!, /אושר: טרם אושר/);
  assert.doesNotMatch(container.textContent!, /\u2014/u);
  assert.match(element(container, '.stale-banner').textContent!, /אינה עדכנית/);
  assert.equal(element<HTMLButtonElement>(container, '.approve-button').disabled, true);
  await buttonNamed(container, 'לקוח');
  assert.match(element(container, '.message-area').textContent!, /האם יש קושי בחניה/);
});

test('human takeover and reset are reflected across owner and customer views', async t => {
  const transport = ownerTransport();
  const container = await mount(t, transport.fetch);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'עצור אוטומציה לטיפול ידני');
  assert.notEqual(transport.current.customer.lead.status, 'HUMAN_HANDOFF');
  await buttonNamed(container, 'אשר עצירה והמשך ידני');
  assert.equal(transport.current.customer.lead.status, 'HUMAN_HANDOFF');
  await buttonNamed(container, 'לקוח');
  assert.match(container.textContent!, /האוטומציה נעצרה/);
  assert.match(element(container, '.message-area').textContent!, /האוטומציה בהדגמה נעצרה/);
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'איפוס הדגמה');
  await click(container, '.confirm-replace');
  assert.equal(transport.current.pricingEvaluation, null);
  assert.equal(transport.current.reviews.length, 0);
  assert.equal(container.querySelector('.owner-history'), null);
  await buttonNamed(container, 'בעל העסק');
  assert.match(container.textContent!, /ההמלצה תופיע לאחר השלמת/);
});

for (const acceptingQuote of [false, true]) {
  test(`expired ${acceptingQuote ? 'quote acceptance' : 'customer message'} clears stale bindings and recovers by explicit GET without replay`, async t => {
    let initial = sampleOwnerState();
    if (acceptingQuote) {
      const owner = ownerSnapshot(initial);
      initial = applyOwnerAction(initial, { action: 'APPROVE', leadId: owner.customer.lead.id,
        revision: owner.revision, pricingEvaluationId: owner.pricingEvaluation!.id,
        scopeConfirmed: true, reviewedPhotoItemIndices: owner.pendingPhotoItemIndices });
    }
    const oldQuote = initial.customer.quote;
    const fresh = freshOwnerState();
    const recovery = deferred();
    let expired = false;
    let recovered = false;
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const container = await mount(t, async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
      if (url === '/api/demo/message') {
        if (!expired) {
          expired = true;
          return Response.json({ error: { code: 'SESSION_EXPIRED', message: 'תוקף ההדגמה הסתיים.' } }, { status: 401 });
        }
        assert.equal(recovered, true, 'A second mutation requires completed explicit recovery');
        return Response.json(fresh.customer);
      }
      if (url === '/api/demo/owner') return Response.json(ownerSnapshot(recovered ? fresh : initial));
      assert.equal(url, '/api/demo', 'No reset or other mutation may be used to recover');
      if (expired && !recovered) return recovery.promise;
      return Response.json((recovered ? fresh : initial).customer);
    });
    // Populate owner context as well as customer context before expiry.
    await buttonNamed(container, 'בעל העסק');
    assert.ok(container.querySelector('.pricing-card'));
    await buttonNamed(container, 'לקוח');
    const savedDraft = acceptingQuote ? 'מאשר' : 'טיוטה שצריך לשמור';
    await draft(container, savedDraft);
    await click(container, '.send-button');
    const submissions = () => requests.filter(request => request.url === '/api/demo/message');
    assert.equal(submissions().length, 1);
    assert.deepEqual(submissions()[0].body, { message: savedDraft,
      ...(oldQuote ? { quoteId: oldQuote.id, quoteVersion: oldQuote.version } : {}) });
    assert.match(element(container, '.session-recovery').textContent!, /תוקף ההדגמה הסתיים/);
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, savedDraft);
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').disabled, true);
    assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
    assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, true);
    assert.equal(container.querySelector('.message'), null);
    assert.equal(container.querySelector('.debug-panel'), null);
    assert.equal(container.querySelector('.pricing-card'), null);
    const beforeRecovery = requests.length;
    await click(container, '.reset-button');
    await click(container, '.send-button');
    assert.equal(requests.length, beforeRecovery);
    await buttonNamed(container, 'התחלת הדגמה חדשה');
    assert.equal(requests.length, beforeRecovery + 1);
    assert.deepEqual(requests.at(-1), { url: '/api/demo', method: 'GET' });
    assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
    recovered = true;
    await act(async () => recovery.resolve(Response.json(fresh.customer)));
    assert.equal(container.querySelector('.session-recovery'), null);
    assert.equal(submissions().length, 1, 'Recovery cannot replay a message or acceptance');
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, savedDraft);
    assert.equal(document.activeElement, element(container, '#customer-message'), 'Recovery restores keyboard focus to the retained draft');
    await buttonNamed(container, 'בעל העסק');
    assert.equal(container.querySelector('.final-quote-card'), null);
    assert.equal(container.querySelector('.coordination-summary'), null);
    assert.equal(container.querySelector('.owner-history'), null);
    assert.match(element(container, '.owner-price-summary').textContent!, /טרם נקבע מחיר/);
    await buttonNamed(container, 'לקוח');
    assert.equal(submissions().length, 1);
    await click(container, '.send-button');
    assert.equal(submissions().length, 2);
    assert.deepEqual(submissions()[1].body, { message: savedDraft }, 'New manual submission has no stale quote ID or version');
  });
}

test('an expired owner mutation clears finalization and is never replayed after explicit session recovery', async t => {
  const initial = sampleOwnerState();
  const fresh = freshOwnerState();
  const before = structuredClone(initial);
  let expired = false;
  let recovered = false;
  const actions: Array<Record<string, unknown>> = [];
  const requests: string[] = [];
  const container = await mount(t, async (url, init) => {
    requests.push(url);
    if (url === '/api/demo/owner/action') {
      actions.push(JSON.parse(init!.body as string));
      expired = true;
      return Response.json({ error: { code: 'SESSION_EXPIRED', message: 'תוקף ההדגמה הסתיים.' } }, { status: 401 });
    }
    if (url === '/api/demo/owner') return Response.json(ownerSnapshot(recovered ? fresh : initial));
    assert.equal(url, '/api/demo');
    if (expired) recovered = true;
    return Response.json((recovered ? fresh : initial).customer);
  });
  await draft(container, 'טיוטת לקוח שלא נשלחה');
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'שנה מחיר');
  await fill(container, '#approved-amount', '1234');
  await click(container, '#scope-confirmation');
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר ושלח את המחיר הסופי');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'ADJUST_PRICE');
  assert.ok(container.querySelector('.session-recovery'));
  assert.equal(container.querySelector('.finalization-form'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטת לקוח שלא נשלחה');
  assert.deepEqual(initial, before, 'Rejected owner request cannot create a quote or review');
  const beforeRecovery = requests.length;
  await buttonNamed(container, 'התחלת הדגמה חדשה');
  assert.equal(requests.length, beforeRecovery + 1);
  assert.equal(requests.at(-1), '/api/demo');
  assert.equal(actions.length, 1);
  await buttonNamed(container, 'בעל העסק');
  assert.equal(container.querySelector('.finalization-form'), null);
  assert.equal(container.querySelector('.owner-history'), null);
  assert.equal(container.querySelector('.final-quote-card'), null);
  assert.equal(actions.length, 1, 'Neither reconnect nor view switching can replay the owner mutation');
  assert.equal(fresh.reviews.length, 0);
});

test('the public entry flow starts with an empty customer conversation and offers no prepared-lead action in either role', async t => {
  const transport = ownerTransport(freshOwnerState());
  const initial = structuredClone(transport.current);
  const calls: Array<{ url: string; method: string }> = [];
  const container = await mount(t, async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return transport.fetch(url, init);
  });
  assert.equal(element(container, '.view-switch button[aria-pressed="true"]').textContent, 'לקוח');
  assert.match(element(container, '.conversation-empty').textContent!, /מה צריך להעביר\?/);
  assert.equal(container.querySelector('.demo-start'), null);
  assert.equal(container.querySelector('.sample-button'), null);
  assert.doesNotMatch(container.textContent!, /פנייה מוכנה|רוצים להכיר את התהליך בלי לכתוב הודעות/);
  assert.equal(container.querySelector('.accept-quote-button'), null);
  await buttonNamed(container, 'בעל העסק');
  assert.doesNotMatch(element(container, '.owner-toolbar').textContent!, /פנייה מוכנה|טעינת/);
  await buttonNamed(container, 'לקוח');
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, '');
  assert.deepEqual(transport.current, initial);
  assert.ok(calls.every(call => call.method === 'GET'), 'Opening and switching roles cannot load a fixture or submit a message');
});

test('resetting a progressed conversation requires confirmation; cancellation preserves facts, quote and draft', async t => {
  const sample = sampleOwnerState();
  const owner = ownerSnapshot(sample);
  const approved = applyOwnerAction(sample, { action: 'APPROVE', leadId: owner.customer.lead.id,
    revision: owner.revision, pricingEvaluationId: owner.pricingEvaluation!.id,
    scopeConfirmed: true, reviewedPhotoItemIndices: owner.pendingPhotoItemIndices });
  const transport = ownerTransport(approved);
  const before = structuredClone(transport.current);
  const posts: Array<{ url: string; body: unknown }> = [];
  const container = await mount(t, async (url, init) => {
    if (init?.method === 'POST') posts.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
    return transport.fetch(url, init);
  });
  await draft(container, 'טיוטה שלא לאבד');
  await click(container, '.reset-button');
  assert.ok(container.querySelector('[role="alertdialog"]'));
  assert.match(element(container, '.confirmation-panel').textContent!, /למחוק את השיחה הנוכחית.*הטיוטה תימחק.*שיחה ריקה/s);
  assert.doesNotMatch(element(container, '.confirmation-panel').textContent!, /פנייה מוכנה/);
  assert.equal(posts.length, 0);
  await buttonNamed(container, 'ביטול והמשך השיחה');
  assert.equal(container.querySelector('[role="alertdialog"]'), null);
  assert.equal(posts.length, 0);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה שלא לאבד');
  assert.deepEqual(transport.current, before);
  assert.match(element(container, '.message-area').textContent!, /900 ₪/);
  await click(container, '.reset-button');
  await click(container, '.confirm-replace');
  assert.deepEqual(posts, [{ url: '/api/demo/reset', body: undefined }]);
  assert.equal(transport.messages.length, 0);
  assert.notEqual(transport.current.customer.lead.id, before.customer.lead.id);
  assert.equal(transport.current.customer.quote, undefined);
});

test('exhausted shared AI budget preserves progress and permits existing deterministic review and contextual approval', async t => {
  const transport = ownerTransport();
  const before = structuredClone(transport.current);
  const posts: string[] = [];
  let messages = 0;
  const container = await mount(t, async (url, init) => {
    if (init?.method === 'POST') posts.push(url);
    if (url === '/api/demo/message' && !transport.current.customer.quote) {
      messages++;
      return Response.json({ error: { code: 'AI_BUDGET_EXHAUSTED', message: 'not forwarded' } }, { status: 503, headers: { 'Retry-After': '86400' } });
    }
    return transport.fetch(url, init);
  });
  await draft(container, 'מידע שלא נשלח בהצלחה');
  await click(container, '.send-button');
  assert.equal(messages, 1);
  assert.match(element(container, '.error-banner').textContent!, /אינו מתחדש אוטומטית/);
  assert.match(element(container, '.error-banner').textContent!, /איסוף פרטים מהודעות חדשות דורש עיבוד AI זמין/);
  assert.match(element(container, '.error-banner').textContent!, /איפוס ההדגמה אינו מחדש את התקציב המשותף/);
  assert.doesNotMatch(element(container, '.error-banner').textContent!, /מחר|86400|not forwarded|פנייה מוכנה/);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'מידע שלא נשלח בהצלחה');
  assert.deepEqual(transport.current, before);
  await buttonNamed(container, 'לבדיקת הפנייה הקיימת');
  assert.ok(container.querySelector('.owner-view'));
  assert.equal(messages, 1, 'Reviewing existing information cannot retry the failed message');
  await buttonNamed(container, 'אשר ושלח הצעת מחיר');
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר תנאים ושלח הצעת מחיר');
  const quote = transport.current.customer.quote!;
  await buttonNamed(container, 'לתצוגת הלקוח ואישור ההצעה');
  await buttonNamed(container, 'אישור ההצעה');
  assert.equal(transport.current.customer.lead.status, 'WON');
  assert.equal(transport.current.customer.quote!.acceptance!.quoteId, quote.id);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'מידע שלא נשלח בהצלחה');
  assert.deepEqual(transport.messages, [{ message: 'מאשר', quoteId: quote.id, quoteVersion: quote.version }]);
  assert.deepEqual(posts, ['/api/demo/message', '/api/demo/owner/action', '/api/demo/message']);
});

for (const code of ['AI_NOT_CONFIGURED', 'AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED']) {
  test(`an empty conversation with ${code} retains its draft without promising information collection or a prepared shortcut`, async t => {
    const transport = ownerTransport(freshOwnerState());
    const before = structuredClone(transport.current);
    const calls: Array<{ url: string; method: string }> = [];
    const container = await mount(t, async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/demo/message') return Response.json({ error: { code, message: 'private provider detail' } }, { status: 503 });
      return transport.fetch(url, init);
    });
    await draft(container, 'טיוטה שנשמרת');
    await click(container, '.send-button');
    const assertNoCollectionPromise = () => {
      assert.match(element(container, '.conversation-empty').textContent!, /אפשר לערוך טיוטה.*איסוף פרטים חדשים דורש עיבוד AI זמין/s);
      assert.doesNotMatch(element(container, '.conversation-empty').textContent!, /הסוכן יאסוף את המידע/);
    };
    assertNoCollectionPromise();
    assert.doesNotMatch(container.textContent!, /פנייה מוכנה|private provider detail/);
    assert.ok(![...container.querySelectorAll('button')].some(button => button.textContent === 'לבדיקת הפנייה הקיימת'));
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה שנשמרת');
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').disabled, false);
    assert.deepEqual(transport.current, before);
    await draft(container, 'אפשר עדיין לערוך');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'An unavailable response or draft edit cannot dispatch another provider request');
    await buttonNamed(container, 'בעל העסק');
    await buttonNamed(container, 'לקוח');
    assertNoCollectionPromise();
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'אפשר עדיין לערוך');
    await click(container, '.reset-button');
    assert.match(element(container, '.confirmation-panel').textContent!, /איפוס ההדגמה אינו מחדש את תקציב ה-AI המשותף/);
    await click(container, '.confirm-replace');
    assertNoCollectionPromise();
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, '');
    assert.deepEqual(calls.filter(call => call.method === 'POST'), [
      { url: '/api/demo/message', method: 'POST' }, { url: '/api/demo/reset', method: 'POST' },
    ], 'Switching roles and confirming reset cannot retry the failed message or restore known AI availability');
  });
}

test('photo unavailability quick reply only fills an editable draft and never marks a photo received', async t => {
  const transport = await partialQuoteTransport();
  assert.ok(transport.current.customer.nextQuestion?.requirements.some(requirement => requirement.id === 'item.photo'));
  const originalPhotos = transport.current.customer.lead.moveDetails.items.map(item => item.photoStatus);
  const sent: Array<Record<string, unknown>> = [];
  const container = await mount(t, async (url, init) => {
    if (url === '/api/demo/message') {
      sent.push(JSON.parse(init!.body as string));
      return Response.json(transport.current.customer);
    }
    return transport.fetch(url, init);
  });
  assert.match(element(container, '.photo-help').textContent!, /אין אפשרות להעלות תמונות.*בעל העסק יצטרך לאשר/);
  await buttonNamed(container, 'הכנסת תשובה: אין לי תמונה כרגע');
  assert.equal(sent.length, 0);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'אין לי כרגע');
  assert.equal(document.activeElement, element(container, '#customer-message'));
  assert.deepEqual(transport.current.customer.lead.moveDetails.items.map(item => item.photoStatus), originalPhotos);
  await draft(container, 'אין לי כרגע');
  await click(container, '.send-button');
  assert.deepEqual(sent, [{ message: 'אין לי כרגע' }]);
  assert.deepEqual(transport.current.customer.lead.moveDetails.items.map(item => item.photoStatus), originalPhotos);
});

test('resetting an empty conversation with no draft needs no destructive-action confirmation', async t => {
  const transport = ownerTransport(freshOwnerState());
  const requests: Array<{ url: string; method: string }> = [];
  const container = await mount(t, async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET' });
    return transport.fetch(url, init);
  });
  await click(container, '.reset-button');
  assert.equal(container.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(requests.filter(request => request.method === 'POST'), [{ url: '/api/demo/reset', method: 'POST' }]);
  assert.equal(transport.messages.length, 0);
});

for (const replacementSource of ['expired session', 'another tab'] as const) {
  test(`owner refresh HTTP 200 replacing the lead after ${replacementSource} clears quote bindings and preserves the unsent draft`, async t => {
    const sample = sampleOwnerState();
    const owner = ownerSnapshot(sample);
    const previous = applyOwnerAction(sample, { action: 'APPROVE', leadId: owner.customer.lead.id,
      revision: owner.revision, pricingEvaluationId: owner.pricingEvaluation!.id,
      scopeConfirmed: true, reviewedPhotoItemIndices: owner.pendingPhotoItemIndices });
    const replacement = replacementSource === 'expired session' ? freshOwnerState() : sampleOwnerState();
    const recovery = deferred();
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    let ownerGets = 0;
    let customerGets = 0;
    const container = await mount(t, async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
      if (url === '/api/demo/owner') return Response.json(ownerSnapshot(++ownerGets === 1 ? previous : replacement));
      if (url === '/api/demo') {
        customerGets++;
        if (customerGets === 2) return recovery.promise;
        return Response.json((customerGets === 1 ? previous : replacement).customer);
      }
      assert.equal(url, '/api/demo/message', 'No reset, acceptance or owner mutation can recover the session');
      return Response.json(replacement.customer);
    });
    const savedDraft = 'טיוטת לקוח שלא נשלחה';
    await draft(container, savedDraft);
    await buttonNamed(container, 'בעל העסק');
    assert.ok(container.querySelector('.final-quote-card'));
    assert.ok(container.querySelector('.owner-history'));
    await buttonNamed(container, 'רענון הפנייה');
    assert.ok(container.querySelector('.session-recovery'));
    for (const selector of ['.owner-view', '.final-quote-card', '.owner-history', '.coordination-summary', '.pricing-card', '.message', '.debug-panel']) {
      assert.equal(container.querySelector(selector), null, `Stale session data must be removed: ${selector}`);
    }
    assert.equal(container.querySelector('.owner-notice'), null, 'An unexpected replacement cannot report ordinary refresh success');
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, savedDraft);
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').disabled, true);
    assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
    assert.deepEqual(requests, [
      { url: '/api/demo', method: 'GET' },
      { url: '/api/demo/owner', method: 'GET' },
      { url: '/api/demo/owner', method: 'GET' },
    ]);
    await buttonNamed(container, 'התחלת הדגמה חדשה');
    assert.deepEqual(requests.at(-1), { url: '/api/demo', method: 'GET' });
    assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
    await act(async () => recovery.resolve(Response.json(replacement.customer)));
    assert.equal(container.querySelector('.session-recovery'), null);
    assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, savedDraft);
    assert.equal(document.activeElement, element(container, '#customer-message'));
    await buttonNamed(container, 'בעל העסק');
    assert.equal(container.querySelector('.final-quote-card'), null);
    assert.equal(container.querySelector('.owner-history'), null);
    await buttonNamed(container, 'לקוח');
    assert.ok(requests.every(request => request.method === 'GET'), 'Neither recovery nor view switching may replay a mutation');
    await click(container, '.send-button');
    assert.deepEqual(requests.filter(request => request.method === 'POST'), [
      { url: '/api/demo/message', method: 'POST', body: { message: savedDraft } },
    ], 'Only a new manual submission is sent, without the previous quote ID or version');
  });
}

test('same-lead owner refresh updates the displayed pricing and shows the ordinary success notice without mutation', async t => {
  const initial = sampleOwnerState();
  const changed = structuredClone(initial);
  changed.customer.lead.moveDetails.items[1].quantity = 25;
  const { generatePricing } = await import('../../server/src/demo/ownerWorkflow');
  const refreshed = generatePricing(changed);
  assert.equal(refreshed.customer.lead.id, initial.customer.lead.id);
  assert.notEqual(refreshed.pricingEvaluation!.suggestedAmount, initial.pricingEvaluation!.suggestedAmount);
  const requests: Array<{ url: string; method: string }> = [];
  let ownerGets = 0;
  const container = await mount(t, async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url === '/api/demo/owner') return Response.json(ownerSnapshot(++ownerGets === 1 ? initial : refreshed));
    assert.equal(url, '/api/demo');
    return Response.json(initial.customer);
  });
  await draft(container, 'טיוטה שנשארת גם אחרי רענון');
  await buttonNamed(container, 'בעל העסק');
  const originalPricing = element(container, '.suggested-price').textContent;
  await buttonNamed(container, 'רענון הפנייה');
  assert.equal(container.querySelector('.session-recovery'), null);
  assert.notEqual(element(container, '.suggested-price').textContent, originalPricing);
  assert.match(element(container, '.suggested-price').textContent!, new RegExp(refreshed.pricingEvaluation!.suggestedAmount!.toLocaleString('he-IL')));
  assert.equal(element(container, '.owner-view .owner-notice').textContent, 'המידע מעודכן.');
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.equal(ownerGets, 2);
});

test('a cookie-issuing view GET that replaces a session requires explicit recovery and cannot retain old owner context', async t => {
  const previous = sampleOwnerState();
  const fresh = freshOwnerState();
  const requests: Array<{ url: string; method: string }> = [];
  let refreshed = false;
  const container = await mount(t, async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url === '/api/demo/owner') { refreshed = true; return Response.json(ownerSnapshot(fresh)); }
    assert.equal(url, '/api/demo');
    return Response.json((refreshed ? fresh : previous).customer);
  });
  await draft(container, 'טיוטה שמורה');
  await buttonNamed(container, 'בעל העסק');
  assert.ok(container.querySelector('.session-recovery'));
  assert.equal(container.querySelector('.owner-view'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה שמורה');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  await buttonNamed(container, 'התחלת הדגמה חדשה');
  assert.equal(container.querySelector('.session-recovery'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה שמורה');
  assert.equal(document.activeElement, element(container, '#customer-message'));
  assert.ok(requests.every(request => request.method === 'GET'), 'View replacement and recovery cannot replay any mutation');
});

test('a draft-only conversation requires deliberate reset and Escape preserves the unsent example without mutation', async t => {
  const transport = ownerTransport(freshOwnerState());
  const initial = structuredClone(transport.current);
  const requests: Array<{ url: string; method: string }> = [];
  const container = await mount(t, async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET' });
    return transport.fetch(url, init);
  });
  await click(container, '.example-button');
  const savedDraft = element<HTMLTextAreaElement>(container, '#customer-message').value;
  await click(container, '.reset-button');
  const panel = element<HTMLElement>(container, '[role="alertdialog"]');
  assert.equal(document.activeElement, panel);
  await act(async () => panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(container.querySelector('[role="alertdialog"]'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, savedDraft);
  assert.deepEqual(transport.current, initial);
  assert.ok(requests.every(request => request.method === 'GET'), 'Loading an editable draft and cancelling reset cannot change structured information');
});

test('responsibilities are visible once, synthetic guidance is contextual and metadata has no em dash', async t => {
  const container = await mount(t, async () => Response.json(snapshot()));
  assert.equal(container.querySelectorAll('.how-it-works').length, 1);
  assert.equal(container.querySelector('.engineering-note'), null);
  assert.equal(container.querySelector('.demo-notes'), null);
  assert.equal(element(container, '.how-it-works h2').textContent, 'איך זה עובד?');
  assert.deepEqual([...container.querySelectorAll('.how-it-works li')].map(item => item.textContent), [
    'ה-AI מחלץ את פרטי ההובלה מהשיחה.',
    'מנוע התמחור מחשב המלצת מחיר לפי כללים מוגדרים.',
    'בעל העסק בודק ומאשר את המחיר לפני שליחת ההצעה.',
  ]);
  assert.equal(container.querySelector('.how-it-works')!.closest('details'), null);
  assert.equal(container.querySelector('.demo-start'), null);
  assert.equal(container.querySelector('.sample-button'), null);
  assert.match(element(container, '.hero-copy').textContent!, /שיח/);
  assert.match(element(container, '.composer-guidance').textContent!, /סינתטיים בלבד.*מצטבר שאינו מתחדש/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const head = new JSDOM(html).window.document.head;
  const sharingDescription = head.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';
  assert.match(sharingDescription, /שיחת לקוח.*אשרו מחיר.*אשרו את ההצעה.*תיאום ידני/);
  assert.doesNotMatch(html + container.textContent, /פנייה מוכנה|רוצים להכיר את התהליך בלי לכתוב הודעות/);
  assert.equal(head.querySelector('link[rel="canonical"]')?.getAttribute('href'), 'https://sales.barshirom.com/');
  assert.doesNotMatch(html + container.textContent, /ללא AI|ללא שיחת AI|ללא שימוש ב-AI/u);
  assert.doesNotMatch(html + container.textContent, /\u2014/u);
});

test('an injected collected lead completes review with deliberate customer quote approval and preserves a separate draft', async t => {
  const transport = ownerTransport();
  const posts: Array<{ url: string; body: unknown }> = [];
  const container = await mount(t, async (url, init) => {
    if (init?.method === 'POST') posts.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
    return transport.fetch(url, init);
  });
  assert.equal(container.querySelector('.accept-quote-button'), null, 'No approval exists before owner review');
  await buttonNamed(container, 'בעל העסק');
  assert.equal(transport.messages.length, 0);
  await buttonNamed(container, 'אשר ושלח הצעת מחיר');
  assert.equal(container.querySelector('.to-customer-button'), null, 'Missing-photo acknowledgement still blocks sending');
  await click(container, '#photo-confirmation-0');
  await buttonNamed(container, 'אשר תנאים ושלח הצעת מחיר');
  const quote = structuredClone(transport.current.customer.quote!);
  assert.equal(quote.status, 'SENT');
  assert.deepEqual(transport.current.quotes[0].reviewedPhotoItemIndices, [0]);
  await buttonNamed(container, 'לתצוגת הלקוח ואישור ההצעה');
  assert.match(element(container, '.customer-quote-summary').textContent!, /900 ₪.*מקרר.*ארגזים.*איסוף.*פריקה.*לא שוריינו מועד או צוות/s);
  assert.equal(transport.messages.length, 0, 'Rendering and switching roles cannot approve');
  await draft(container, 'טיוטה נפרדת שלא נשלחת עם האישור');
  await buttonNamed(container, 'אישור ההצעה');
  assert.deepEqual(transport.messages, [{ message: 'מאשר', quoteId: quote.id, quoteVersion: quote.version }]);
  assert.equal(transport.current.customer.lead.status, 'WON');
  assert.equal(transport.current.customer.quote!.acceptance!.quoteId, quote.id);
  assert.equal(transport.current.customer.quote!.acceptance!.quoteVersion, quote.version);
  assert.equal(container.querySelector('.accept-quote-button'), null);
  assert.match(element(container, '.customer-quote-summary').textContent!, /ממתין לתיאום.*תיאום ידני מחוץ להדגמה.*לא שוריינו מועד או צוות/s);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה נפרדת שלא נשלחת עם האישור');
  await buttonNamed(container, 'בעל העסק');
  await buttonNamed(container, 'לקוח');
  assert.equal(transport.messages.length, 1, 'Accepted state and repeated role switches do not replay acceptance');
  assert.deepEqual(posts.map(post => post.url), ['/api/demo/owner/action', '/api/demo/message']);
});

test('explicit approval uses the displayed current token and stale server rejection cannot become acceptance or retry', async t => {
  const sample = sampleOwnerState();
  const snapshot = ownerSnapshot(sample);
  const approved = applyOwnerAction(sample, { action: 'APPROVE', leadId: snapshot.customer.lead.id, revision: snapshot.revision,
    pricingEvaluationId: snapshot.pricingEvaluation!.id, scopeConfirmed: true, reviewedPhotoItemIndices: snapshot.pendingPhotoItemIndices });
  const original = structuredClone(approved);
  const submissions: Array<Record<string, unknown>> = [];
  const container = await mount(t, async (url, init) => {
    if (url === '/api/demo/message') {
      submissions.push(JSON.parse(init!.body as string));
      return Response.json({ error: { code: 'STALE_REVIEW', message: 'הצעת המחיר השתנתה. יש לבדוק את ההצעה העדכנית לפני האישור.' } }, { status: 409 });
    }
    return Response.json(approved.customer);
  });
  await buttonNamed(container, 'אישור ההצעה');
  assert.deepEqual(submissions, [{ message: 'מאשר', quoteId: approved.customer.quote!.id, quoteVersion: approved.customer.quote!.version }]);
  assert.match(element(container, '.error-banner').textContent!, /הצעת המחיר השתנתה/);
  assert.equal(approved.customer.quote!.status, 'SENT');
  assert.deepEqual(approved, original);
  assert.equal(submissions.length, 1);
});

test('expired explicit approval clears quote context and recovery never replays it or sends the saved draft', async t => {
  const sample = sampleOwnerState();
  const snapshot = ownerSnapshot(sample);
  const approved = applyOwnerAction(sample, { action: 'APPROVE', leadId: snapshot.customer.lead.id, revision: snapshot.revision,
    pricingEvaluationId: snapshot.pricingEvaluation!.id, scopeConfirmed: true, reviewedPhotoItemIndices: snapshot.pendingPhotoItemIndices });
  const fresh = freshOwnerState();
  const calls: Array<{ url: string; method: string }> = [];
  let expired = false;
  const container = await mount(t, async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url === '/api/demo/message') { expired = true; return Response.json({ error: { code: 'SESSION_EXPIRED', message: 'תוקף ההדגמה הסתיים.' } }, { status: 401 }); }
    return Response.json((expired ? fresh : approved).customer);
  });
  await draft(container, 'טיוטה חשובה');
  await buttonNamed(container, 'אישור ההצעה');
  assert.ok(container.querySelector('.session-recovery'));
  assert.equal(container.querySelector('.customer-quote-summary'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה חשובה');
  await buttonNamed(container, 'התחלת הדגמה חדשה');
  assert.equal(container.querySelector('.accept-quote-button'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה חשובה');
  assert.deepEqual(calls, [{ url: '/api/demo', method: 'GET' }, { url: '/api/demo/message', method: 'POST' }, { url: '/api/demo', method: 'GET' }]);
});

test('handoff explains temporary storage and reset remains deliberate and cancellable', async t => {
  const sample = sampleOwnerState();
  const initial = ownerSnapshot(sample);
  const stopped = applyOwnerAction(sample, { action: 'TAKE_OVER_CONVERSATION', leadId: initial.customer.lead.id, revision: initial.revision });
  const transport = ownerTransport(stopped);
  const before = structuredClone(transport.current);
  const container = await mount(t, transport.fetch);
  assert.match(element(container, '.handoff-help').textContent!, /האוטומציה נעצרה.*מחוץ להדגמה.*אין כאן תיבת נציג.*שיחת ההדגמה הזמנית/s);
  await draft(container, 'טיוטה לפני איפוס');
  assert.doesNotMatch(element(container, '.handoff-help').textContent!, /פנייה מוכנה/);
  await buttonNamed(container, 'איפוס והתחלת שיחה חדשה');
  assert.ok(container.querySelector('[role="alertdialog"]'));
  await buttonNamed(container, 'ביטול והמשך השיחה');
  assert.deepEqual(transport.current, before);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה לפני איפוס');
  assert.equal(transport.messages.length, 0);
  await buttonNamed(container, 'איפוס והתחלת שיחה חדשה');
  await click(container, '.confirm-replace');
  assert.equal(transport.current.customer.lead.status, 'COLLECTING_INFORMATION');
});

test('session-creation Retry-After blocks reconnect without automatic requests or prepared shortcuts', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let tick!: () => void;
  t.mock.method(dom.window, 'setInterval', (callback: TimerHandler) => { tick = callback as () => void; return 101; });
  t.mock.method(dom.window, 'clearInterval', () => {});
  let calls = 0;
  const container = await mount(t, async () => {
    calls++;
    return calls === 1 ? Response.json({ error: { code: 'SESSION_RATE_LIMITED', message: 'legacy copy' } }, { status: 429, headers: { 'Retry-After': '5' } }) : Response.json(snapshot());
  });
  assert.match(element(container, '.error-banner').textContent!, /מגבלת יצירת שיחות.*5 שניות/s);
  assert.doesNotMatch(element(container, '.error-banner').textContent!, /פנייה מוכנה/);
  assert.equal(container.querySelector('.sample-button'), null);
  assert.equal(element<HTMLButtonElement>(container, '.error-banner button').disabled, true);
  assert.equal(container.querySelector('.error-actions'), null, 'No unavailable-session promise or AI fallback CTA');
  await buttonNamed(container, 'ניסיון חיבור נוסף');
  assert.equal(calls, 1);
  clock += 6000;
  await act(async () => tick());
  assert.equal(calls, 1, 'Expiry changes availability only; it cannot create an automatic request');
  await buttonNamed(container, 'ניסיון חיבור נוסף');
  assert.equal(calls, 2);
  assert.equal(container.querySelector('.sample-button'), null);
});

test('AI Retry-After preserves the draft and prevents another dispatch or automatic retry', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let tick!: () => void;
  t.mock.method(dom.window, 'setInterval', (callback: TimerHandler) => { tick = callback as () => void; return 102; });
  t.mock.method(dom.window, 'clearInterval', () => {});
  const transport = ownerTransport(freshOwnerState());
  let messages = 0;
  const container = await mount(t, async (url, init) => {
    if (url === '/api/demo/message') { messages++; return Response.json({ error: { code: 'AI_RATE_LIMITED', message: 'יש להמתין לפני עיבוד AI נוסף.' } }, { status: 429, headers: { 'Retry-After': '5' } }); }
    return transport.fetch(url, init);
  });
  await draft(container, 'טיוטה');
  await click(container, '.send-button');
  assert.equal(messages, 1);
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  assert.equal(container.querySelector('.sample-button'), null);
  assert.equal(element<HTMLTextAreaElement>(container, '#customer-message').value, 'טיוטה');
  assert.doesNotMatch(container.textContent!, /פנייה מוכנה/);
  await click(container, '.send-button');
  assert.equal(messages, 1);
  clock += 6000;
  await act(async () => tick());
  assert.equal(messages, 1, 'Cooldown expiry cannot resubmit the failed draft');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, false);
});
