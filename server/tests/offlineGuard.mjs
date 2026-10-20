// Test preloader. No credentials are inherited; only loopback HTTP is available.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

for (const name of Object.keys(process.env)) {
  if (/^(OPENAI_|AI_WINDOW_|AWS_|AZURE_|ANTHROPIC_|DEMO_AI_)/.test(name)) delete process.env[name];
}
const loopback = host => ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host);
const deny = () => { throw new Error('OFFLINE_TEST_NETWORK_BLOCKED'); };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || !loopback(url.hostname)) return Promise.reject(new Error('OFFLINE_TEST_NETWORK_BLOCKED'));
  return originalFetch(input, options);
};
for (const method of ['request', 'get']) {
  const original = http[method];
  http[method] = function(input, ...args) {
    const host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input.hostname ?? input.host;
    if (!loopback(host)) return deny();
    return original.call(this, input, ...args);
  };
  https[method] = deny;
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : args[1];
  if (!loopback(host)) return deny();
  return connect.apply(this, args);
};
tls.connect = deny;
syncBuiltinESMExports();
