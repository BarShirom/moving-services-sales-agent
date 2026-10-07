import type { PricingContext, PricingEvaluation } from '../domain/pricing/types.js';
import type { OwnerReview } from '../domain/ownerReview/types.js';
import type { DemoSnapshot } from './types.js';
import type { CoordinationSummary, CustomerQuoteRecord } from '../domain/quote/types.js';

export interface OwnerDemoState {
  customer: DemoSnapshot;
  revision: number;
  pricingContext: PricingContext;
  pricingEvaluation: PricingEvaluation | null;
  pricingHistory: PricingEvaluation[];
  reviews: OwnerReview[];
  pricingStale: boolean;
  pendingOwnerQuestion: string | null;
  quotes: CustomerQuoteRecord[];
  currentQuoteId: string | null;
  activeQuoteQuestionId: string | null;
  coordinationSummary: CoordinationSummary | null;
}
export interface OwnerSnapshot {
  customer: DemoSnapshot;
  revision: number;
  pricingEvaluation: PricingEvaluation | null;
  demoDistanceKm: number | null;
  pricingStale: boolean;
  pricingHistory: PricingEvaluation[];
  reviews: OwnerReview[];
  pendingOwnerQuestion: string | null;
  quotes: CustomerQuoteRecord[];
  currentQuote: CustomerQuoteRecord | null;
  coordinationSummary: CoordinationSummary | null;
  pendingPhotoItemIndices: number[];
  actions: { approve: boolean; adjust: boolean; requestMoreInfo: boolean; takeOver: boolean; recalculate: boolean };
}
