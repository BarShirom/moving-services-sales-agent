import { israelReferenceDate } from '../config/referenceDate.js';
import express from 'express';
import { DemoSessionError, DemoSessionStore, expiredSession, sessionCookie, type DemoSession } from './sessions.js';
import { z } from 'zod';
import { processCustomerMessageWithExtractor, type MessageExtractor } from '../domain/conversation/processCustomerMessage.js';
import { buildExtractionRequest, extractMessageWithAI } from '../integrations/openai/extractMessageWithAI.js';
import { DemoProtection, ProtectionError, protectionResponse } from './protection.js';
import { admittedClientIP } from './clientIdentity.js';
import { AIExtractionError } from '../integrations/openai/errors.js';
import { ownerActionSchema, reviewTokenSchema, OwnerWorkflowError } from '../domain/ownerReview/types.js';
import { acceptCustomerResult, applyOwnerAction, assertReviewToken, freshOwnerState, generatePricing,
  handleQuoteReply, ownerSnapshot, recordHandoffMessage, sampleOwnerState } from './ownerWorkflow.js';

const messageBody = z.object({
  message: z.string().max(4_000).refine(value => value.trim().length > 0),
  quoteId: z.string().min(1).optional(), quoteVersion: z.number().int().positive().optional(),
}).strict().refine(value => (value.quoteId === undefined) === (value.quoteVersion === undefined), 'Quote identity and version must be supplied together.');
export function createDemoRouter(extractor: MessageExtractor = extractMessageWithAI, now: () => Date = () => new Date(),
  options: { store?: DemoSessionStore; secureCookies?: boolean; clientOrigin?: string; publicOrigin?: string; protection?: DemoProtection } = {}) {
  const router = express.Router();
  const store = options.store ?? new DemoSessionStore();
  const protection = options.protection ?? new DemoProtection();
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const cookieName = secure ? '__Host-moving-demo' : 'moving-demo';
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  // A non-simple header protects even /reset and cookie-issuing GETs against CSRF.
  // CORS grants this header only to an explicitly configured, trusted origin.
  router.use((request, response, next) => {
    const origin = request.get('Origin');
    const ownOrigin = options.publicOrigin ?? `${secure ? 'https' : request.protocol}://${request.get('host')}`;
    if (request.get('X-Demo-Request') !== '1' ||
      (origin !== undefined && origin !== ownOrigin && origin !== options.clientOrigin) ||
      (request.get('Sec-Fetch-Site') === 'cross-site' && (!origin || origin !== options.clientOrigin))) {
      response.status(403).json({ error: { code: 'REQUEST_FORBIDDEN', message: 'הבקשה נחסמה. פתחו את ההדגמה באתר ורעננו את העמוד.' } });
      return;
    }
    next();
  });
  router.use(express.json({ limit: '32kb' }));
  router.use((request, response, next) => {
    // Unknown paths, health checks and preflights must not allocate session slots.
    if (!['/', '/owner', '/reset', '/owner/action', '/owner/pricing', '/owner/sample', '/message'].includes(request.path) ||
      !['GET', 'POST'].includes(request.method)) { next('router'); return; }
    let session = store.get(sessionCookie(request.get('Cookie'), cookieName));
    if (!session) {
      if (request.method !== 'GET' || !['/', '/owner'].includes(request.path)) { next(expiredSession()); return; }
      protection.createSession(admittedClientIP(response));
      const created = store.create();
      session = created.session;
      response.cookie(cookieName, created.id, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: store.ttlMs });
    }
    response.locals.demoSession = session;
    protection.sessionRequest(session);
    next();
  });
  const current = (response: express.Response): DemoSession => response.locals.demoSession as DemoSession;
  const guardBusy: express.RequestHandler = (_request, response, next) => {
    if (current(response).busy) { response.status(409).json({ error: { code: 'BUSY', message: 'הודעה עדיין בעיבוד. נסו שוב בעוד רגע.' } }); return; }
    next();
  };
  router.get('/', (_request, response) => { const session = current(response); response.json(session.state.customer); });
  router.get('/owner', (_request, response) => { const session = current(response); response.json(ownerSnapshot(session.state)); });
  router.post('/reset', guardBusy, (_request, response) => {
    const session = current(response);
    session.state = freshOwnerState(); response.json(session.state.customer);
  });
  router.post('/owner/action', guardBusy, (request, response, next) => {
    const session = current(response);
    const parsed = ownerActionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_OWNER_ACTION', message: 'יש להזין סכום חיובי עם עד שתי ספרות אחרי הנקודה או שאלה תקינה, ולרענן את הפנייה.' } }); return; }
    try { session.state = applyOwnerAction(session.state, parsed.data, now()); response.json(ownerSnapshot(session.state)); } catch (error) { next(error); }
  });
  for (const path of ['/owner/pricing', '/owner/sample']) router.post(path, guardBusy, (request, response, next) => {
    const session = current(response);
    const parsed = reviewTokenSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_OWNER_ACTION', message: 'פרטי הפנייה אינם תקינים. רעננו את המסך.' } }); return; }
    try {
      assertReviewToken(session.state, parsed.data);
      session.state = path === '/owner/sample' ? sampleOwnerState() : generatePricing(session.state, now());
      response.json(ownerSnapshot(session.state));
    } catch (error) { next(error); }
  });
  router.post('/message', guardBusy, async (request, response) => {
    const session = current(response);
    const parsed = messageBody.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'יש להזין הודעה באורך של עד 4,000 תווים.' } }); return; }
    if (session.state.customer.lead.status === 'HUMAN_HANDOFF') {
      session.state = recordHandoffMessage(session.state, parsed.data.message);
      response.json(session.state.customer); return;
    }
    session.busy = true;
    try {
      const timestamp = now();
      const expectedQuote = parsed.data.quoteId === undefined ? undefined
        : { quoteId: parsed.data.quoteId, quoteVersion: parsed.data.quoteVersion! };
      const quoted = handleQuoteReply(session.state, parsed.data.message, timestamp, expectedQuote);
      if (quoted) { session.state = quoted; response.json(session.state.customer); return; }
      const result = await processCustomerMessageWithExtractor(session.state.customer.lead, parsed.data.message, {
        extractor: input => extractor === extractMessageWithAI
          ? extractMessageWithAI(input, (payload, run) => protection.extract(session, admittedClientIP(response), payload, run))
          : protection.extract(session, admittedClientIP(response), buildExtractionRequest(input), () => extractor(input)),
        lastQuestion: session.state.customer.nextQuestion ?? undefined,
        referenceDate: israelReferenceDate(timestamp),
      });
      session.state = acceptCustomerResult(session.state, result, timestamp);
      response.json(session.state.customer);
    } catch (error) {
      if (error instanceof ProtectionError) { protectionResponse(error, response); return; }
      if (error instanceof DemoSessionError) { response.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
      if (error instanceof OwnerWorkflowError) {
        response.status(409).json({ error: { code: error.code, message: error.message } }); return;
      }
      const missingKey = error instanceof AIExtractionError && error.code === 'MISSING_API_KEY';
      response.status(missingKey ? 503 : 502).json({ error: {
        code: missingKey ? 'AI_NOT_CONFIGURED' : 'EXTRACTION_FAILED',
        message: missingKey
          ? 'חיבור ה-AI עדיין לא הוגדר. יש להוסיף מפתח OpenAI תקין לקובץ ‎.env של השרת ולהפעיל אותו מחדש.'
          : 'לא הצלחנו לעבד את ההודעה כרגע. המידע הקודם נשמר. אפשר לנסות שוב.',
      } });
    } finally { store.release(session); }
  });
  const bodyError: express.ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ProtectionError) { protectionResponse(error, response); return; }
    if (error instanceof DemoSessionError) {
      if (error.status === 503) response.set('Retry-After', '60');
      response.status(error.status).json({ error: { code: error.code, message: error.message } }); return;
    }
    if (error instanceof OwnerWorkflowError) { response.status(409).json({ error: { code: error.code, message: error.message } }); return; }
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'הבקשה אינה תקינה או גדולה מדי. נסו הודעה קצרה יותר.' } });
  };
  router.use(bodyError);
  return router;
}
