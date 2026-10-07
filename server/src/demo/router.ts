import { israelReferenceDate } from '../config/referenceDate.js';
import express from 'express';
import { z } from 'zod';
import { processCustomerMessageWithExtractor, type MessageExtractor } from '../domain/conversation/processCustomerMessage.js';
import { extractMessageWithAI } from '../integrations/openai/extractMessageWithAI.js';
import { AIExtractionError } from '../integrations/openai/errors.js';
import { ownerActionSchema, reviewTokenSchema, OwnerWorkflowError } from '../domain/ownerReview/types.js';
import { acceptCustomerResult, applyOwnerAction, assertReviewToken, freshOwnerState, generatePricing,
  handleQuoteReply, ownerSnapshot, recordHandoffMessage, sampleOwnerState } from './ownerWorkflow.js';

const messageBody = z.object({
  message: z.string().max(4_000).refine(value => value.trim().length > 0),
  quoteId: z.string().min(1).optional(), quoteVersion: z.number().int().positive().optional(),
}).strict().refine(value => (value.quoteId === undefined) === (value.quoteVersion === undefined), 'Quote identity and version must be supplied together.');
export function createDemoRouter(extractor: MessageExtractor = extractMessageWithAI, now: () => Date = () => new Date()) {
  const router = express.Router();
  // One loopback-only in-memory demo. Views are separated, not authenticated identities.
  let state = freshOwnerState();
  let busy = false;
  router.use(express.json({ limit: '32kb' }));
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const guardBusy: express.RequestHandler = (_request, response, next) => {
    if (busy) { response.status(409).json({ error: { code: 'BUSY', message: 'הודעה עדיין בעיבוד. נסו שוב בעוד רגע.' } }); return; }
    next();
  };
  router.get('/', (_request, response) => { response.json(state.customer); });
  router.get('/owner', (_request, response) => { response.json(ownerSnapshot(state)); });
  router.post('/reset', guardBusy, (_request, response) => {
    state = freshOwnerState(); response.json(state.customer);
  });
  router.post('/owner/action', guardBusy, (request, response, next) => {
    const parsed = ownerActionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_OWNER_ACTION', message: 'יש להזין סכום חיובי עם עד שתי ספרות אחרי הנקודה או שאלה תקינה, ולרענן את הפנייה.' } }); return; }
    try { state = applyOwnerAction(state, parsed.data, now()); response.json(ownerSnapshot(state)); } catch (error) { next(error); }
  });
  for (const path of ['/owner/pricing', '/owner/sample']) router.post(path, guardBusy, (request, response, next) => {
    const parsed = reviewTokenSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_OWNER_ACTION', message: 'פרטי הפנייה אינם תקינים. רעננו את המסך.' } }); return; }
    try {
      assertReviewToken(state, parsed.data);
      state = path === '/owner/sample' ? sampleOwnerState() : generatePricing(state, now());
      response.json(ownerSnapshot(state));
    } catch (error) { next(error); }
  });
  router.post('/message', guardBusy, async (request, response) => {
    const parsed = messageBody.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'יש להזין הודעה באורך של עד 4,000 תווים.' } }); return; }
    if (state.customer.lead.status === 'HUMAN_HANDOFF') {
      state = recordHandoffMessage(state, parsed.data.message);
      response.json(state.customer); return;
    }
    busy = true;
    try {
      const timestamp = now();
      const expectedQuote = parsed.data.quoteId === undefined ? undefined
        : { quoteId: parsed.data.quoteId, quoteVersion: parsed.data.quoteVersion! };
      const quoted = handleQuoteReply(state, parsed.data.message, timestamp, expectedQuote);
      if (quoted) { state = quoted; response.json(state.customer); return; }
      const result = await processCustomerMessageWithExtractor(state.customer.lead, parsed.data.message, {
        extractor, lastQuestion: state.customer.nextQuestion ?? undefined,
        referenceDate: israelReferenceDate(timestamp),
      });
      state = acceptCustomerResult(state, result, timestamp);
      response.json(state.customer);
    } catch (error) {
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
    } finally { busy = false; }
  });
  const bodyError: express.ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof OwnerWorkflowError) { response.status(409).json({ error: { code: error.code, message: error.message } }); return; }
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'הבקשה אינה תקינה או גדולה מדי. נסו הודעה קצרה יותר.' } });
  };
  router.use(bodyError);
  return router;
}
