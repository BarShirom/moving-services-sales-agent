import type { Lead } from '../lead.js';
import { evaluateRequirements } from '../requirements/evaluateRequirements.js';
import { buildPricingInput } from './buildPricingInput.js';
import { calculatePrice } from './calculatePrice.js';
import type { EvaluationMetadata, PricingContext, PricingEvaluation } from './types.js';

/** Explicit application entry point. No persistence, approval or customer quote sending. */
export function evaluateLeadPricing(lead: Lead, context: PricingContext, metadata: EvaluationMetadata): { lead: Lead; evaluation: PricingEvaluation } {
  const evaluation = calculatePrice(buildPricingInput(lead, context), metadata);
  const next = structuredClone(lead);
  if (lead.status === 'READY_FOR_PRICING' && evaluateRequirements(lead).readyForPricing && evaluation.suggestedAmount !== null) {
    next.status = 'AWAITING_REVIEW';
    next.updatedAt = evaluation.createdAt;
  }
  return { lead: next, evaluation };
}
