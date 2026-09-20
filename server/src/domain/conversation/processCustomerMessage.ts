import { applyUnavailablePhotoReply } from './photoReply.js';
import { buildConversationResponse, type ConversationResponse } from './buildConversationResponse.js';
import { randomUUID } from 'node:crypto';
import type { Lead } from '../lead.js';
import { extractMessage } from '../extraction/extractMessage.js';
import { mergeExtraction } from '../extraction/mergeExtraction.js';
import type { ExtractionResult, ItemPatch } from '../extraction/types.js';
import { evaluateRequirements, updateLeadReadiness } from '../requirements/evaluateRequirements.js';
import type { NextQuestion, RequirementContext, RequirementEvaluation } from '../requirements/types.js';

export interface ProcessCustomerMessageResult extends ConversationResponse {
  lead: Lead;
  extraction: ExtractionResult;
  unappliedItems: ItemPatch[];
  requirements: RequirementEvaluation;
  nextQuestion: NextQuestion | null;
}

export function processCustomerMessage(
  lead: Lead, text: string, context: RequirementContext = {},
): ProcessCustomerMessageResult {
  const extraction = extractMessage(text);
  return applyCustomerExtraction(lead, text, extraction, context);
}

// Shared orchestration for synchronous and asynchronous extractors.
function applyCustomerExtraction(
  lead: Lead, text: string, extraction: ExtractionResult, context: RequirementContext, acknowledgement?: string,
): ProcessCustomerMessageResult {
  const merged = mergeExtraction(lead, extraction);
  const timestamp = new Date().toISOString();
  const withMessage: Lead = {
    ...merged.lead,
    updatedAt: timestamp,
    messages: [...merged.lead.messages, { id: randomUUID(), sender: 'CUSTOMER', text, timestamp }],
  };
  const updatedLead = updateLeadReadiness(withMessage, context);
  const requirements = evaluateRequirements(updatedLead, context);
  return {
    lead: updatedLead, extraction, unappliedItems: merged.unappliedItems,
    requirements, nextQuestion: requirements.nextQuestion,
    ...buildConversationResponse(updatedLead, requirements, acknowledgement, lead),
  };
}

export interface MessageExtractionInput {
  lead: Lead;
  text: string;
  // The question actually presented to the customer, not a newly computed question.
  lastQuestion?: NextQuestion;
  // Local YYYY-MM-DD calendar date, supplied explicitly by the application.
  referenceDate?: string;
}

export type MessageExtractor = (input: MessageExtractionInput) => ExtractionResult | Promise<ExtractionResult>;

export async function processCustomerMessageWithExtractor(
  lead: Lead, text: string,
  options: { extractor: MessageExtractor; lastQuestion?: NextQuestion; referenceDate?: string; requirementsContext?: RequirementContext },
): Promise<ProcessCustomerMessageResult> {
  // Snapshot before awaiting; an extractor cannot mutate the caller's lead or merge target.
  const snapshot = structuredClone(lead);
  const context = structuredClone(options.requirementsContext ?? {});
  const photoReply = applyUnavailablePhotoReply(snapshot, text, options.lastQuestion);
  if (photoReply) {
    return applyCustomerExtraction(photoReply.lead, text, {}, context, photoReply.acknowledgement);
  }
  const extraction = await options.extractor({
    lead: structuredClone(snapshot), text, referenceDate: options.referenceDate,
    lastQuestion: options.lastQuestion ? structuredClone(options.lastQuestion) : undefined,
  });
  return applyCustomerExtraction(snapshot, text, extraction, context);
}
