import { israelReferenceDate } from '../config/referenceDate.js';
import { buildConversationResponse } from '../domain/conversation/buildConversationResponse.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { createLead } from '../domain/createLead.js';
import { evaluateRequirements } from '../domain/requirements/evaluateRequirements.js';
import { processCustomerMessageWithExtractor, type MessageExtractor } from '../domain/conversation/processCustomerMessage.js';
import { extractMessageWithAI } from '../integrations/openai/extractMessageWithAI.js';
import { AIExtractionError } from '../integrations/openai/errors.js';
import type { DemoSnapshot } from './types.js';

const messageBody = z.object({ message: z.string().max(4_000).refine(value => value.trim().length > 0) }).strict();

function freshState(): DemoSnapshot {
  const lead = createLead();
  const requirements = evaluateRequirements(lead);
  return { lead, extraction: {}, unappliedItems: [], requirements, nextQuestion: requirements.nextQuestion, ...buildConversationResponse(lead, requirements) };
}

export function createDemoRouter(extractor: MessageExtractor = extractMessageWithAI) {
  const router = express.Router();
  // One local demo session. Clients send text only; they cannot inject Lead or workflow state.
  let state = freshState();
  let busy = false;
  router.use(express.json({ limit: '32kb' }));
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.get('/', (_request, response) => { response.json(state); });
  router.post('/reset', (_request, response) => {
    if (busy) {
      response.status(409).json({ error: { code: 'BUSY', message: 'הודעה עדיין בעיבוד. נסו שוב בעוד רגע.' } });
      return;
    }
    state = freshState();
    response.json(state);
  });
  router.post('/message', async (request, response) => {
    const parsed = messageBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'יש להזין הודעה באורך של עד 4,000 תווים.' } });
      return;
    }
    if (busy) {
      response.status(409).json({ error: { code: 'BUSY', message: 'הודעה עדיין בעיבוד. נסו שוב בעוד רגע.' } });
      return;
    }
    busy = true;
    try {
      const result = await processCustomerMessageWithExtractor(state.lead, parsed.data.message, {
        extractor, lastQuestion: state.nextQuestion ?? undefined,
        referenceDate: israelReferenceDate(new Date()),
      });
      // Persist the final backend response, including acknowledgements and terminal next steps.
      result.lead.messages.push({
        id: randomUUID(), sender: 'AGENT', text: result.responseText, timestamp: new Date().toISOString(),
      });
      state = result;
      response.json(state);
    } catch (error) {
      const missingKey = error instanceof AIExtractionError && error.code === 'MISSING_API_KEY';
      response.status(missingKey ? 503 : 502).json({ error: {
        code: missingKey ? 'AI_NOT_CONFIGURED' : 'EXTRACTION_FAILED',
        message: missingKey
          ? 'חיבור ה-AI עדיין לא הוגדר. יש להוסיף מפתח OpenAI תקין לקובץ ‎.env של השרת ולהפעיל אותו מחדש.'
          : 'לא הצלחנו לעבד את ההודעה כרגע. המידע הקודם נשמר — אפשר לנסות שוב.',
      } });
    } finally {
      busy = false;
    }
  });
  const bodyError: express.ErrorRequestHandler = (_error, _request, response, _next) => {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'הבקשה אינה תקינה או גדולה מדי. נסו הודעה קצרה יותר.' } });
  };
  router.use(bodyError);
  return router;
}
