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
  status: 'READY_FOR_PRICING_EVAL' | 'INVALID';
  reason: string;
  failedAssertions: string[];
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
    ready: number;
    invalid: number;
    sourceQuality: { closed_job: number; quoted_only: number; historical_estimate: number };
    withClosedPrice: number;
    withQuotedPrice: number;
    requiringHumanApproval: number;
    withPriceRange: number;
    results: PricingEvalResult[];
  };
}
