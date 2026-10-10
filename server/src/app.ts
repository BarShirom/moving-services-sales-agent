import express from 'express';
import { createDemoRouter } from './demo/router.js';
import type { MessageExtractor } from './domain/conversation/processCustomerMessage.js';

export function createApp(options: { extractor?: MessageExtractor; now?: () => Date; clientOrigin?: string } = {}) {
  const app = express();
  // Default remains same-origin (including the Vite proxy). Opt in to one exact origin.
  const clientOrigin = options.clientOrigin?.trim();
  if (clientOrigin) {
    app.use((request, response, next) => {
      response.vary('Origin');
      if (request.get('Origin') === clientOrigin) {
        response.set('Access-Control-Allow-Origin', clientOrigin);
        if (request.method === 'OPTIONS') {
          response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          response.set('Access-Control-Allow-Headers', 'Content-Type');
          response.sendStatus(204);
          return;
        }
      }
      next();
    });
  }
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'Moving Services Sales Agent', version: '0.1' });
  });
  app.use('/api/demo', createDemoRouter(options.extractor, options.now));
  return app;
}

export const app = createApp();
