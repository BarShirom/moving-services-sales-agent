// Runs only inside disposable test clients; all inputs are synthetic, no AI key.
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
const agent = new https.Agent({ ca: readFileSync('/test/root.crt') });
const origin = 'https://demo.localhost';
let cookie;
async function visit(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(origin + path, { agent, method, headers: {
      'X-Demo-Request': '1', Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
    } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw ? text : JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
const spoof = {
  'X-Demo-Client-IP': ['203.0.113.1', '203.0.113.2'],
  'X-Forwarded-For': '203.0.113.3, 203.0.113.4', Forwarded: 'for=203.0.113.5',
  'X-Real-IP': '203.0.113.6', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http',
};
const mode = process.argv[2];
async function withHTTP2(run) {
  const connection = http2.connect(origin, { ca: readFileSync('/test/root.crt') });
  connection.setTimeout(10000, () => connection.destroy(new Error('HTTP/2 test timed out')));
  try {
    await new Promise((resolve, reject) => { connection.once('connect', resolve); connection.once('error', reject); });
    assert.equal(connection.alpnProtocol, 'h2');
    const request = (path, headers = {}) => new Promise((resolve, reject) => {
      const stream = connection.request({ ':path': path, ...headers });
      const chunks = []; let responseHeaders;
      stream.on('response', value => { responseHeaders = value; });
      stream.on('data', value => chunks.push(value)); stream.on('error', reject);
      stream.on('end', () => resolve({ headers: responseHeaders, bytes: Buffer.concat(chunks) }));
      stream.end();
    });
    await run(request, connection);
  } finally { connection.destroy(); }
}
if (mode === 'protocols') {
  const redirect = await new Promise((resolve, reject) => {
    http.get('http://demo.localhost/api/health', res => { res.resume(); resolve(res); }).on('error', reject);
  });
  assert.equal(redirect.statusCode, 308);
  assert.equal(redirect.headers.location, origin + '/api/health');
  await withHTTP2(async (request, connection) => {
    const home = await request('/');
    assert.equal(home.headers[':status'], 200);
    assert.match(home.bytes.toString(), /<html[^>]*dir="rtl"/);
    const asset = home.bytes.toString().match(/src="(\/assets\/[^\"]+\.js)"/)[1];
    const range = await request(asset, { range: 'bytes=0-15' });
    assert.equal(range.headers[':status'], 206); assert.equal(range.bytes.length, 16);
    assert.match(range.headers['content-range'], /^bytes 0-15\//);
    // Bounded protocol regression coverage; not an exploit or stress benchmark.
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      connection.settings({ headerTableSize: i % 2 ? 4096 : 1024 });
      const health = await request('/api/health', { trailer: 'x-synthetic-trailer' });
      assert.equal(health.headers[':status'], 200);
      assert.equal(JSON.parse(health.bytes).status, 'ok');
    }));
  });
} else if (mode === 'upstream-error') {
  const response = await visit('/api/health?synthetic-private-marker', {
    raw: true, headers: { 'X-Demo-Client-IP': 'synthetic-private-marker' },
  });
  assert.equal(response.status, 502);
} else if (mode === 'direct') {
  // A third, untrusted container on the backend bridge must fail even with spoofing.
  const status = await new Promise((resolve, reject) => {
    const req = http.get('http://backend:3001/api/demo', { headers: { ...spoof, 'X-Demo-Request': '1' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
} else {
  assert.equal((await visit('/api/health')).status, 200);
  const home = await visit('/', { raw: true });
  assert.equal(home.status, 200); assert.match(home.body, /<html[^>]*dir="rtl"/);
  const first = await visit('/api/demo', { headers: spoof });
  assert.equal(first.status, 200);
  const setCookie = first.headers['set-cookie'][0];
  assert.match(setCookie, /^__Host-moving-demo=/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes('Domain='));
  cookie = setCookie.split(';')[0]; // Explicit test jar; TLS certificate verification remains enabled.
  assert.equal((await visit('/api/demo/reset', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  let owner = (await visit('/api/demo/owner')).body;
  assert.equal(owner.pricingEvaluation, null, 'new visitors never inherit the other visitor state');
  const token = o => ({ leadId: o.customer.lead.id, revision: o.revision });
  owner = (await visit('/api/demo/owner/sample', { method: 'POST', body: token(owner) })).body;
  assert.equal(owner.pricingEvaluation.suggestedAmount, 900);
  owner = (await visit('/api/demo/owner/action', { method: 'POST', body: {
    ...token(owner), action: 'APPROVE', pricingEvaluationId: owner.pricingEvaluation.id,
    reviewedPhotoItemIndices: owner.pendingPhotoItemIndices,
  } })).body;
  assert.equal(owner.currentQuote.status, 'SENT');
  const quote = owner.currentQuote;
  const accepted = await visit('/api/demo/message', { method: 'POST', body: { message: '\u05db\u05df', quoteId: quote.id, quoteVersion: quote.version } });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.lead.status, 'WON');
  if (mode === 'a') {
    // Rotating arbitrary headers cannot avoid the same client request budget.
    let blocked = false;
    for (let i = 0; i < 31; i++) {
      const response = await visit('/api/demo', { headers: { ...spoof, 'X-Demo-Client-IP': `192.0.2.${i + 1}` } });
      if (response.status === 429) { assert.ok(Number(response.headers['retry-after']) > 0); blocked = true; break; }
      assert.equal(response.status, 200);
    }
    assert.ok(blocked, 'actual socket identity must exhaust a single quota');
    await withHTTP2(async request => {
      const blockedH2 = await request('/api/demo', { cookie, 'x-demo-request': '1', 'x-demo-client-ip': '192.0.2.99', origin });
      assert.equal(blockedH2.headers[':status'], 429, 'HTTP/2 and HTTP/1 share the client quota');
    });
  } else {
    // This client succeeds even after A exhausted its quota; cookie churn is limited.
    cookie = undefined;
    const response = await visit('/api/demo', { headers: { 'X-Demo-Client-IP': '192.0.2.250' } });
    assert.equal(response.status, 429); assert.equal(response.body.error.code, 'SESSION_RATE_LIMITED');
  }
  // A client on the edge bridge cannot bypass Caddy by connecting to the backend IP.
  await assert.rejects(fetch('http://172.30.30.3:3001/api/health', { signal: AbortSignal.timeout(1500) }));
}
agent.destroy();
console.log(`PASS ${mode}: private Caddy topology and admission assertions`);
