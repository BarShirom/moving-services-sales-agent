import { randomUUID } from 'node:crypto';
import type { Lead } from '../lead.js';
import { extractMessage } from '../extraction/extractMessage.js';
import { mergeExtraction } from '../extraction/mergeExtraction.js';
import type { ExtractionResult, ItemPatch } from '../extraction/types.js';
import { evaluateRequirements, updateLeadReadiness } from '../requirements/evaluateRequirements.js';
import type { NextQuestion, RequirementContext, RequirementEvaluation } from '../requirements/types.js';

export interface ProcessCustomerMessageResult {
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
  };
}
