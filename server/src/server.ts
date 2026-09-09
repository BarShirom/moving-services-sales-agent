import { app } from './app.js';

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Rick & GO Sales Agent listening at http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('Server failed to start:', error.message);
  process.exitCode = 1;
});
