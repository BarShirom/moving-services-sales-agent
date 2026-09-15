import express from 'express';
import { createDemoRouter } from './demo/router.js';
import type { MessageExtractor } from './domain/conversation/processCustomerMessage.js';

export function createApp(options: { extractor?: MessageExtractor } = {}) {
  const app = express();
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'Rick & GO Sales Agent', version: '0.1' });
  });
  app.use('/api/demo', createDemoRouter(options.extractor));
  return app;
}

export const app = createApp();
