import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoApiError, demoRequest, ownerRequest, ownerAction, ownerPricing, ownerSample } from '../src/api';

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
  await assert.rejects(demoRequest('/message', 'כן'), error => {
    assert.ok(error instanceof DemoApiError);
    assert.equal(error.code, 'SESSION_EXPIRED');
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('unavailable AI offers a visitor-safe explanation and unknown error identities remain generic', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: { code: 'AI_NOT_CONFIGURED', message: 'Do not expose server configuration instructions.' },
  }, { status: 503 }));
  await assert.rejects(demoRequest('/message', 'דוגמה'), error => {
    assert.ok(error instanceof DemoApiError);
    assert.equal(error.code, 'AI_NOT_CONFIGURED');
    assert.match(error.message, /פנייה המוכנה ללא AI/);
    assert.doesNotMatch(error.message, /configuration|\.env|מפתח/);
    return true;
  });
  fetchMock.mock.mockImplementation(async () => Response.json({
    error: { code: 'untrusted text', message: 'untrusted body' },
  }, { status: 500 }));
  await assert.rejects(demoRequest('/message', 'דוגמה'), error => {
    assert.ok(error instanceof DemoApiError);
    assert.equal(error.code, 'UNKNOWN');
    assert.doesNotMatch(error.message, /untrusted/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 2);
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

test('cumulative beta budget closure never promises tomorrow or uses Retry-After', async t => {
  for (const [status, code] of [[429, 'AI_BUDGET_EXHAUSTED'], [503, 'AI_WINDOW_CLOSED']] as const) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
      error: { code, message: 'נסו שוב מחר כשהתקציב היומי יתחדש.' },
    }, { status, headers: { 'Retry-After': '86400' } }));
    await assert.rejects(demoRequest('/message', 'טיוטה'), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /עיבוד ה-AI בהדגמה זו סגור/);
      assert.match(error.message, /משותף ומצטבר ואינו מתחדש אוטומטית/);
      assert.match(error.message, /המידע הקיים נשמר/);
      assert.doesNotMatch(error.message, /מחר|86400|שניות|נסו שוב/);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test('session creation limits explain the actual blocked action, expose bounded Retry-After and never retry', async t => {
  for (const code of ['SESSION_RATE_LIMITED', 'SESSION_CAPACITY']) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'opaque legacy copy' } },
      { status: code === 'SESSION_RATE_LIMITED' ? 429 : 503, headers: { 'Retry-After': '60' } }));
    await assert.rejects(demoRequest(), error => {
      assert.ok(error instanceof DemoApiError);
      assert.equal(error.code, code);
      assert.equal(error.retryAfterSeconds, 60);
      assert.match(error.message, /(?:מגבלת יצירת שיחות|אין מקום לשיחה נוספת).*הפנייה המוכנה דורשת שיחה זמינה.*60 שניות/);
      assert.doesNotMatch(error.message, /AI|opaque/);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test('Retry-After dates are honored and invalid headers cannot introduce retry instructions', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-20T12:00:00Z'));
  for (const [header, expected] of [['Tue, 20 Oct 2026 12:00:30 GMT', 30], ['untrusted input', undefined], ['-1', undefined], ['999999999', undefined]] as const) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'SESSION_RATE_LIMITED', message: 'blocked' } },
      { status: 429, headers: { 'Retry-After': header } }));
    await assert.rejects(demoRequest(), error => {
      assert.ok(error instanceof DemoApiError);
      assert.equal(error.retryAfterSeconds, expected);
      assert.doesNotMatch(error.message, /untrusted|999999999/);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});
