import { z } from 'zod';
import { money } from '../domain/pricing/pricingRules.js';
import { buildPricingInput } from '../domain/pricing/buildPricingInput.js';
import { calculatePrice } from '../domain/pricing/calculatePrice.js';
import type { PricingEvaluation } from '../domain/pricing/types.js';
import { parsePricingCases, type PricingEvalCase } from './loadEvalCases.js';
import { hydratePricingLead, pricingEvalTimestamp } from './hydratePricingLead.js';
import { duplicateIds, rawIdentity } from './runConversationEvals.js';
import type { EvalReport, PricingEvalResult } from './types.js';

export function comparePricingEvidence(entry: PricingEvalCase, evaluation: PricingEvaluation): NonNullable<PricingEvalResult['comparison']> {
  const amount = evaluation.suggestedAmount;
  const reference = entry.sourceQuality === 'closed_job' ? entry.closedPrice
    : entry.sourceQuality === 'quoted_only' ? entry.quotedPrice : entry.estimatedPrice;
  const difference = reference != null && amount !== null ? Math.abs(amount - reference) : null;
  return {
    sourceQuality: entry.sourceQuality, informational: entry.sourceQuality !== 'closed_job',
    scope: evaluation.amountScope, completeness: evaluation.completeness, comparableToWholeJob: evaluation.completeness === 'COMPLETE_RECOMMENDATION',
    recommendedAmount: amount, referenceAmount: reference ?? null, closedAmount: entry.closedPrice ?? null, quotedAmount: entry.quotedPrice ?? null,
    absoluteDifference: difference,
    percentageDifference: difference !== null && reference != null ? difference / reference * 100 : null,
    referenceRange: entry.priceRange ?? null,
    rangeComparison: amount === null || !entry.priceRange ? 'UNAVAILABLE'
      : amount < entry.priceRange.min ? 'BELOW' : amount > entry.priceRange.max ? 'ABOVE' : 'WITHIN',
  };
}

export function assertPricingInvariants(evaluation: PricingEvaluation): void {
  const sum = evaluation.breakdown.reduce((total, part) => total + part.amount, 0);
  const amount = evaluation.suggestedAmount;
  const range = evaluation.priceRange;
  if (evaluation.humanApprovalRequired !== true || typeof evaluation.ruleVersion !== 'string' || !evaluation.ruleVersion.trim() || !evaluation.inputSnapshot
    || !['COMPLETE_RECOMMENDATION', 'PARTIAL_RECOMMENDATION', 'CANNOT_PRICE'].includes(evaluation.completeness)
    || ((amount === null) !== (evaluation.completeness === 'CANNOT_PRICE'))
    || (amount !== null && evaluation.status === 'CANNOT_PRICE')
    || (evaluation.completeness === 'COMPLETE_RECOMMENDATION' && (evaluation.omittedComponents.length > 0 || evaluation.amountScope !== 'FULL_JOB'))
    || evaluation.breakdown.some(part => !Number.isFinite(part.amount) || (part.code !== 'DISCOUNT' && part.amount < 0)
      || !Number.isFinite(part.range.min) || !Number.isFinite(part.range.max) || part.range.min > part.amount || part.range.max < part.amount)
    || !Number.isFinite(evaluation.confidence) || evaluation.confidence < 0 || evaluation.confidence > 100
    || (amount === null ? sum !== 0 || range !== null || evaluation.status !== 'CANNOT_PRICE'
      : !Number.isFinite(amount) || amount <= 0 || money(sum) !== amount || range === null
        || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min <= 0 || range.min > amount || range.max < amount)) {
    throw new Error('Pricing structural invariant failed.');
  }
}

export function runPricingEvals(cases: unknown[]): EvalReport['pricing'] {
  const duplicates = duplicateIds(cases);
  const summary: EvalReport['pricing'] = {
    total: cases.length, evaluated: 0, scored: 0, partialInput: 0, notSupported: 0, invalid: 0,
    sourceQuality: { closed_job: 0, quoted_only: 0, historical_estimate: 0 },
    withClosedPrice: 0, withQuotedPrice: 0, requiringHumanApproval: 0, withPriceRange: 0, results: [],
  };
  for (const [index, raw] of cases.entries()) {
    const result: PricingEvalResult = {
      ...rawIdentity(raw, index), scenario: 'pricing evidence', status: 'INVALID', reason: '', failedAssertions: [],
    };
    summary.results.push(result);
    try {
      if (duplicates.has(result.id)) throw new Error('Duplicate pricing case ID.');
      const entry = parsePricingCases([raw])[0];
      const { lead, context } = hydratePricingLead(entry);
      const evaluation = calculatePrice(buildPricingInput(lead, context), { id: 'eval-' + entry.id, createdAt: pricingEvalTimestamp });
      assertPricingInvariants(evaluation);
      result.evaluation = evaluation;
      result.comparison = comparePricingEvidence(entry, evaluation);
      result.scenario = entry.items.map(item => item.type).join(' + ');
      result.status = evaluation.completeness === 'COMPLETE_RECOMMENDATION' ? 'SCORED'
        : evaluation.suggestedAmount !== null ? 'PARTIAL_INPUT' : 'NOT_SUPPORTED';
      result.reason = (entry.sourceQuality === 'historical_estimate' ? 'Informational historical estimate. ' : '')
        + (evaluation.completeness === 'COMPLETE_RECOMMENDATION' ? 'Complete provisional recommendation. ' : 'Incomplete subtotal; not a whole-job accuracy comparison. ')
        + evaluation.reviewReasons.map(reason => reason.code).join(', ');
      summary.evaluated++;
      if (result.status === 'SCORED') summary.scored++;
      else if (result.status === 'PARTIAL_INPUT') summary.partialInput++;
      else summary.notSupported++;
      summary.sourceQuality[entry.sourceQuality]++;
      if (entry.closedPrice != null) summary.withClosedPrice++;
      if (entry.quotedPrice != null) summary.withQuotedPrice++;
      if (evaluation.humanApprovalRequired) summary.requiringHumanApproval++;
      if (entry.priceRange !== undefined) summary.withPriceRange++;
    } catch (error) {
      summary.invalid++;
      result.status = 'INVALID';
      result.reason = 'Pricing evidence validation or structural invariant failed.';
      result.failedAssertions = error instanceof z.ZodError
        ? error.issues.map(issue => issue.path.join('.') + ': ' + issue.message)
        : [error instanceof Error ? error.message : 'Unknown validation error.'];
    }
  }
  return summary;
}
