import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoRequest, ownerRequest, ownerAction, ownerPricing, ownerSample } from '../src/api';

test('every demo request sends credentials and the CSRF header, including bodyless reset', async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init); return Response.json({});
  });
  await demoRequest();
  await demoRequest('/reset');
  await demoRequest('/message', 'שלום');
  await ownerRequest();
  await ownerPricing({ leadId: 'lead', revision: 0 });
  await ownerSample({ leadId: 'lead', revision: 0 });
  await ownerAction({ action: 'TAKE_OVER_CONVERSATION', leadId: 'lead', revision: 0 });
  assert.equal(calls.length, 7);
  for (const init of calls) {
    assert.equal(init.credentials, 'include');
    assert.equal(new Headers(init.headers).get('X-Demo-Request'), '1');
    assert.equal(new Headers(init.headers).get('Cookie'), null, 'HttpOnly cookie is owned by browser');
  }
});

test('concurrent initial reads share one bootstrap request and later reads refresh normally', async t => {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const fetchMock = t.mock.method(globalThis, 'fetch', () => response);
  const first = demoRequest(), second = demoRequest();
  assert.equal(first, second);
  assert.equal(fetchMock.mock.callCount(), 1);
  resolve(Response.json({ lead: { id: 'one' } }));
  assert.deepEqual(await first, await second);
  fetchMock.mock.mockImplementation(async () => Response.json({ lead: { id: 'two' } }));
  await demoRequest();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('expired mutation shows recovery guidance and is never automatically replayed', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: { code: 'SESSION_EXPIRED', message: 'רעננו את העמוד כדי להתחיל הדגמה חדשה.' },
  }, { status: 409 }));
  await assert.rejects(demoRequest('/message', 'כן'), /רעננו את העמוד/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('throttling and concurrency errors show safe Hebrew retry guidance without automatic retries', async t => {
  for (const [status, code] of [[429, 'RATE_LIMITED'], [503, 'AI_BUSY']] as const) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
      error: { code, message: 'ההדגמה עמוסה כרגע.' },
    }, { status, headers: { 'Retry-After': '5' } }));
    await assert.rejects(demoRequest('/message', 'טיוטה'), /ההדגמה עמוסה כרגע.*5 שניות/);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});
