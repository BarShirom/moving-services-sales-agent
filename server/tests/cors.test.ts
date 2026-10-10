import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

async function api(t: TestContext, clientOrigin?: string) {
  const server = createApp({ clientOrigin, extractor: () => {
    assert.fail('CORS checks must not invoke a provider');
  } }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('default same-origin API behavior adds no CORS permissions', async t => {
  const root = await api(t);
  const response = await fetch(`${root}/api/demo`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('configured exact origin supports JSON preflight and API responses', async t => {
  const origin = 'http://localhost:5173';
  const root = await api(t, origin);
  const response = await fetch(`${root}/api/demo/message`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  const actual = await fetch(`${root}/api/demo/reset`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(actual.status, 200);
  assert.equal(actual.headers.get('access-control-allow-origin'), origin);
});

test('other origins receive no CORS permission and same-origin calls still work', async t => {
  const root = await api(t, 'http://localhost:5173');
  for (const origin of ['http://localhost:5173.evil.example', 'http://localhost:5174', 'null']) {
    const response = await fetch(`${root}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('vary'), 'Origin');
  }
  const response = await fetch(`${root}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
