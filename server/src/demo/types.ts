import type { ConversationResponse } from '../domain/conversation/buildConversationResponse.js';
import type { Lead } from '../domain/lead.js';
import type { ExtractionResult, ItemPatch } from '../domain/extraction/types.js';
import type { NextQuestion, RequirementEvaluation } from '../domain/requirements/types.js';

// HTTP response contract only; the client imports these types, never domain runtime code.
export interface DemoSnapshot extends ConversationResponse {
  lead: Lead;
  extraction: ExtractionResult;
  unappliedItems: ItemPatch[];
  requirements: RequirementEvaluation;
  nextQuestion: NextQuestion | null;
}
