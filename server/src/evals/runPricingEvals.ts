import { z } from 'zod';
import { parsePricingCases } from './loadEvalCases.js';
import { duplicateIds, rawIdentity } from './runConversationEvals.js';
import type { EvalReport, PricingEvalResult } from './types.js';

export function runPricingEvals(cases: unknown[]): EvalReport['pricing'] {
  const duplicates = duplicateIds(cases);
  const summary: EvalReport['pricing'] = {
    total: cases.length, ready: 0, invalid: 0,
    sourceQuality: { closed_job: 0, quoted_only: 0, historical_estimate: 0 },
    withClosedPrice: 0, withQuotedPrice: 0, requiringHumanApproval: 0, withPriceRange: 0, results: [],
  };
  for (const [index, raw] of cases.entries()) {
    const result: PricingEvalResult = {
      ...rawIdentity(raw, index), scenario: 'pricing evidence', status: 'INVALID',
      reason: '', failedAssertions: [],
    };
    summary.results.push(result);
    try {
      if (duplicates.has(result.id)) throw new Error('Duplicate pricing case ID.');
      const entry = parsePricingCases([raw])[0];
      result.scenario = entry.items.map(item => item.type).join(' + ');
      result.status = 'READY_FOR_PRICING_EVAL';
      result.reason = 'Evidence is internally valid; price accuracy is not scored (no Pricing Engine).';
      summary.ready++;
      summary.sourceQuality[entry.sourceQuality]++;
      if (entry.closedPrice != null) summary.withClosedPrice++;
      if (entry.quotedPrice != null) summary.withQuotedPrice++;
      if (entry.humanApprovalRequired === true) summary.requiringHumanApproval++;
      if (entry.priceRange !== undefined) summary.withPriceRange++;
    } catch (error) {
      summary.invalid++;
      result.reason = 'Pricing evidence validation failed.';
      result.failedAssertions = error instanceof z.ZodError
        ? error.issues.map(issue => issue.path.join('.') + ': ' + issue.message)
        : [error instanceof Error ? error.message : 'Unknown validation error.'];
    }
  }
  return summary;
}
