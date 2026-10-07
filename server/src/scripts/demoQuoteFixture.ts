import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { quoteDemoMessages, quoteFixtureExtractor } from '../demo/quoteFixture.js';

// Explicitly separate from the ordinary demo: no provider call or API key is used.
const app = createApp({ extractor: quoteFixtureExtractor, now: () => new Date('2026-10-07T10:00:00Z') });
app.use(express.static(fileURLToPath(new URL('../../../client/dist/', import.meta.url))));
app.listen(3101, '127.0.0.1', () => {
  console.log('Offline quote fixture: http://127.0.0.1:3101 — run npm run build first.');
  console.log('Synthetic messages, in order:', Object.values(quoteDemoMessages));
  console.log('Finalize in Owner View, then reply כן in Customer View. No availability or appointment is reserved.');
});
