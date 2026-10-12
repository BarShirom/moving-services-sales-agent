// Local runtime probe; mount disposable CA/certificate/key under /test. No external traffic.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import zlib from 'node:zlib';
const payload = Buffer.from('שלום עולם — בדיקת TLS ודחיסה\n'.repeat(1024));
const ca = readFileSync('/test/ca.crt');
const server = https.createServer({ key: readFileSync('/test/server.key'), cert: readFileSync('/test/server.crt') }, (req, res) => {
  const codec = req.url.slice(1);
  const encoded = codec === 'gzip' ? zlib.gzipSync(payload) : codec === 'deflate' ? zlib.deflateSync(payload) : zlib.brotliCompressSync(payload);
  res.writeHead(200, { 'Content-Encoding': codec, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(encoded);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
try {
  for (const codec of ['gzip', 'deflate', 'br']) {
    const response = await fetch(`https://localhost:${port}/${codec}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  }
  const request = options => new Promise((resolve, reject) => {
    const req = https.get({ hostname: '127.0.0.1', port, path: '/gzip', ...options }, res => {
      res.resume(); res.on('end', () => resolve(true));
    });
    req.on('error', reject);
  });
  await request({ ca });
  await assert.rejects(request({ ca: [] }), /certificate|issuer|self.signed/i);
  await assert.rejects(request({ ca, checkServerIdentity: (_host, cert) => tls.checkServerIdentity('wrong.invalid', cert) }), /Hostname\/IP does not match/);
  assert.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(['he-IL']), ['he-IL']);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' });
  assert.match(zone.format(new Date('2026-01-01T12:00:00Z')), /GMT\+02:00/);
  assert.match(zone.format(new Date('2026-07-01T12:00:00Z')), /GMT\+03:00/);
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
  const libraries = [...new Set(readFileSync('/proc/self/maps', 'utf8').split('\n').map(line => line.split(/\s+/).at(-1)).filter(path => /\/.*(?:libssl|libcrypto|libz\.|libicu|libc\.so)/.test(path)))];
  const native = [];
  function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) walk(file); else if (entry.name.endsWith('.node')) native.push(file);
  } }
  walk('/app/node_modules');
  console.log(JSON.stringify({ result: 'PASS', fixtures: ['TLS trusted CA', 'untrusted CA rejection', 'hostname rejection', 'gzip', 'deflate', 'brotli', 'Hebrew ICU', 'Jerusalem winter/summer offsets', 'Jerusalem midnight'], versions: process.versions, uid: process.getuid(), sharedOpenSSL: process.config.variables.node_shared_openssl, sharedZlib: process.config.variables.node_shared_zlib, libraries, nativeAddons: native, nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'), packages: readFileSync('/lib/apk/db/installed', 'utf8').split('\n\n').map(block => Object.fromEntries(block.split('\n').filter(line => /^[PVoc]:/.test(line)).map(line => [line[0], line.slice(2)]))).filter(p => p.P) }, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
