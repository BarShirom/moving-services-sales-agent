import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';

// The local demo uses the same root .env as the CLI demo. Existing environment wins.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Moving Services Sales Agent for Rick & GO listening at http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('Server failed to start:', error.message);
  process.exitCode = 1;
});
