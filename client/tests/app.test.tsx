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

test('product title, neutral sender labels, exact footer and vertical section order render without pilot branding', async t => {
  const container = await mount(t, async () => Response.json(snapshot(true)));
  assert.equal(element(container, 'h1').textContent, 'Moving Services Sales Agent');
  assert.equal(element(container, 'footer').textContent, '© 2026 Bar Shirom. All rights reserved.');
  assert.doesNotMatch(container.textContent!, /rick\s*(?:&|and|&amp;)\s*go/i);
  assert.deepEqual([...container.querySelectorAll('.message-label')].map(node => node.textContent), ['הלקוח', 'הסוכן']);
  assert.deepEqual([...container.querySelectorAll('h2')].map(node => node.textContent), ['השיחה שלכם', 'מה הבנתי', 'מה עדיין חסר', 'השלב הבא']);
  assert.equal(element(container, 'label').getAttribute('for'), element(container, 'textarea').id);
  assert.equal(element(container, '.app-shell').getAttribute('dir'), 'rtl');
  assert.equal(element<HTMLDetailsElement>(container, 'details').open, false);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>Moving Services Sales Agent<\/title>/);
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
  assert.equal(element(container, '.next-card > p').textContent, response.responseText);
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
  assert.match(element(container, '[role="alert"]').textContent!, /לא ניתן להתחבר/);
  assert.equal(element<HTMLTextAreaElement>(container, 'textarea').value, 'לא לאבד את הטיוטה');
  assert.equal(container.querySelectorAll('.message').length, 2);
  assert.equal(element<HTMLButtonElement>(container, '.reset-button').disabled, false);
});

test('example populates an editable draft, blank drafts cannot send, and the keyboard shortcut submits', async t => {
  let sends = 0;
  const container = await mount(t, async url => {
    if (url.endsWith('/message')) sends++;
    return Response.json(snapshot());
  });
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  await draft(container, '  ');
  assert.equal(element<HTMLButtonElement>(container, '.send-button').disabled, true);
  await click(container, '.example-button');
  const textarea = element<HTMLTextAreaElement>(container, 'textarea');
  assert.match(textarea.value, /מקרר/);
  assert.equal(document.activeElement, textarea);
  assert.equal(sends, 0);
  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  });
  assert.equal(sends, 1);
  assert.equal(textarea.value, '');
});

test('status labels reflect existing backend states and distinguish temporarily pending information', () => {
  const state = snapshot();
  assert.equal(statusLabel(state), 'איסוף מידע');
  state.nextQuestion = null;
  assert.equal(statusLabel(state), 'ממתין למידע נוסף');
  for (const [status, expected] of [
    ['READY_FOR_PRICING', 'מוכן לבדיקה ותמחור'], ['AWAITING_REVIEW', 'ממתין לבדיקה'],
    ['QUOTE_SENT', 'הצעת המחיר נשלחה'], ['WON', 'ההובלה אושרה'], ['LOST', 'הפנייה נסגרה'],
  ] as const) {
    state.lead.status = status;
    assert.equal(statusLabel(state), expected);
    assert.equal(state.lead.status, status);
  }
});
