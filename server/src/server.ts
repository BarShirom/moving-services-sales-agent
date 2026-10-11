import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { DemoProtection } from './demo/protection.js';

// The local demo uses the same root .env as the CLI demo. Existing environment wins.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// Containers need a reachable interface; ordinary local development stays loopback-only.
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
const protection = new DemoProtection();
const server = createApp({ clientOrigin: process.env.CLIENT_ORIGIN, publicOrigin: process.env.DEMO_PUBLIC_ORIGIN,
  trustedProxyIP: process.env.DEMO_TRUSTED_PROXY_IP, protection }).listen(port, host, () => {
  console.log(`Moving Services Sales Agent listening at http://${host}:${port}`);
  console.info(JSON.stringify({ event: 'demo_limits', ...protection.limits }));
});
// Fixed-volume, aggregate-only telemetry: never log peers, cookies, messages or SDK errors.
const usageLog = setInterval(() => console.info(JSON.stringify({ event: 'demo_usage', ...protection.snapshot() })), 60_000);
usageLog.unref();

server.on('error', (error) => {
  console.error('Server failed to start:', error.message);
  process.exitCode = 1;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(usageLog);
  // Finish active requests when possible, before Docker's default 10-second stop timeout.
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 8_000);
  deadline.unref();
  server.close(error => {
    clearTimeout(deadline);
    process.exitCode = error ? 1 : 0;
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
