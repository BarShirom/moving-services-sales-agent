import express from 'express';

export const app = express();

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'Rick & GO Sales Agent',
    version: '0.1',
  });
});
