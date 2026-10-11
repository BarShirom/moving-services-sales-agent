import express from 'express';
import { createDemoRouter } from './demo/router.js';
import type { MessageExtractor } from './domain/conversation/processCustomerMessage.js';
import type { DemoSessionStore } from './demo/sessions.js';
import { DemoProtection, ProtectionError, protectionResponse } from './demo/protection.js';
import { createClientIdentity } from './demo/clientIdentity.js';

export function createApp(options: { extractor?: MessageExtractor; now?: () => Date; clientOrigin?: string;
  publicOrigin?: string; secureCookies?: boolean; sessionStore?: DemoSessionStore; protection?: DemoProtection;
  trustedProxyIP?: string } = {}) {
  const app = express();
  app.set('trust proxy', false);
  const clientIdentity = createClientIdentity(options.trustedProxyIP);
  const protection = options.protection ?? new DemoProtection();
  // Default remains same-origin (including the Vite proxy). Opt in to one exact origin.
  const clientOrigin = options.clientOrigin?.trim();
  const publicOrigin = options.publicOrigin?.trim();
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  if (options.trustedProxyIP?.trim() && (!secureCookies || !publicOrigin || clientOrigin)) {
    throw new Error('Trusted Caddy mode requires secure cookies, DEMO_PUBLIC_ORIGIN and same-origin access (CLIENT_ORIGIN unset)');
  }
  for (const origin of [clientOrigin, publicOrigin]) {
    if (origin && (!/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) {
      throw new Error('Demo origins must be exact HTTP(S) origins without paths or credentials');
    }
    if (origin && secureCookies && !origin.startsWith('https://')) throw new Error('Production demo origins require HTTPS');
  }
  if (clientOrigin) {
    app.use((request, response, next) => {
      response.vary('Origin');
      if (request.get('Origin') === clientOrigin) {
        response.set('Access-Control-Allow-Origin', clientOrigin);
        response.set('Access-Control-Allow-Credentials', 'true');
        response.set('Access-Control-Expose-Headers', 'Retry-After');
        if (request.method === 'OPTIONS') {
          response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          response.set('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Request');
        }
      }
      next();
    });
  }
  // Admit before preflight completion, cookie creation, JSON parsing or expensive work.
  app.use('/api/demo', (request, response, next) => {
    const identity = clientIdentity(request);
    if (!identity) {
      response.set('Cache-Control', 'no-store').status(403).json({ error: {
        code: 'REQUEST_FORBIDDEN', message: 'הבקשה נחסמה. פתחו את ההדגמה באתר ורעננו את העמוד.',
      } });
      return;
    }
    response.locals.demoClientIP = identity;
    try { protection.request(identity); next(); }
    catch (error) {
      if (error instanceof ProtectionError) { protectionResponse(error, response); return; }
      next(error);
    }
  });
  app.use('/api/demo', (request, response, next) => {
    if (clientOrigin && request.get('Origin') === clientOrigin && request.method === 'OPTIONS') {
      response.sendStatus(204); return;
    }
    next();
  });
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'Moving Services Sales Agent', version: '0.1' });
  });
  app.use('/api/demo', createDemoRouter(options.extractor, options.now, {
    store: options.sessionStore, secureCookies, clientOrigin, publicOrigin, protection,
  }));
  return app;
}

export const app = createApp();
