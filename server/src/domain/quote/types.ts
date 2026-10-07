import type { MoveDetails } from '../lead.js';

export interface QuoteAcceptance {
  quoteId: string;
  quoteVersion: number;
  amount: number;
  acceptedAt: string;
  coordinationStatus: 'PENDING';
}

/** Only this projection may be placed in the customer response. */
export interface CustomerQuoteSafe {
  id: string;
  version: number;
  leadId: string;
  approvedAmount: number;
  currency: 'ILS';
  scope: MoveDetails;
  sentAt: string;
  status: 'SENT' | 'ACCEPTED' | 'INVALIDATED' | 'SUPERSEDED';
  acceptance: QuoteAcceptance | null;
}

export interface CustomerQuoteRecord extends CustomerQuoteSafe {
  pricingEvaluationId: string;
  ownerReviewId: string;
  scopeFingerprint: string;
  scopeConfirmed: boolean;
  omittedCostsAcknowledged: boolean;
  reviewedPhotoItemIndices: number[];
  unresolvedDetails: string[];
  acceptanceQuestionMessageId: string;
}

export interface CoordinationSummary {
  quoteId: string;
  quoteVersion: number;
  acceptedAmount: number;
  currency: 'ILS';
  acceptedAt: string;
  status: 'PENDING' | 'REVIEW_REQUIRED';
  scope: MoveDetails;
  unresolvedDetails: string[];
  reviewedPhotoItemIndices: number[];
  omittedCostsAcknowledged: boolean;
}

export interface QuoteToken { quoteId: string; quoteVersion: number }
