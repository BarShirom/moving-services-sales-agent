import type { PricingEvaluation } from '../domain/pricing/types.js';

export interface ConversationEvalResult {
  id: string;
  scenario: string;
  status: 'PASS' | 'FAIL' | 'NOT_RUN';
  mode: 'DOMAIN' | 'FIXTURE' | 'NONE';
  reason: string;
  failedAssertions: string[];
  checkedAssertions: string[];
  manualMustNot: string[];
}

export interface PricingEvalResult {
  id: string;
  scenario: string;
  status: 'SCORED' | 'PARTIAL_INPUT' | 'NOT_SUPPORTED' | 'INVALID';
  reason: string;
  failedAssertions: string[];
  evaluation?: PricingEvaluation;
  comparison?: {
    sourceQuality: 'closed_job' | 'quoted_only' | 'historical_estimate';
    informational: boolean;
    scope: PricingEvaluation['amountScope'];
    completeness: PricingEvaluation['completeness'];
    comparableToWholeJob: boolean;
    recommendedAmount: number | null;
    referenceAmount: number | null;
    closedAmount: number | null;
    quotedAmount: number | null;
    absoluteDifference: number | null;
    percentageDifference: number | null;
    referenceRange: { min: number; max: number } | null;
    rangeComparison: 'BELOW' | 'WITHIN' | 'ABOVE' | 'UNAVAILABLE';
  };
}

export interface EvalReport {
  status: 'PASSED' | 'FAILED';
  exitCode: 0 | 1;
  scope: string;
  errors: string[];
  conversation: {
    total: number;
    passed: number;
    failed: number;
    notRun: number;
    results: ConversationEvalResult[];
  };
  pricing: {
    total: number;
    evaluated: number;
    scored: number;
    partialInput: number;
    notSupported: number;
    invalid: number;
    sourceQuality: { closed_job: number; quoted_only: number; historical_estimate: number };
    withClosedPrice: number;
    withQuotedPrice: number;
    requiringHumanApproval: number;
    withPriceRange: number;
    results: PricingEvalResult[];
  };
}
