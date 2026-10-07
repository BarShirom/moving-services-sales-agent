import type { MoveDetails } from '../lead.js';

/** External facts only: never prices, inferred kilometers, or customer messages. */
export interface PricingContext {
  distanceKm?: number | null;
  distanceBand?: string | null;
  workers?: number | null;
  estimatedDurationHours?: number | null;
  pickupPoints?: number;
  dropoffPoints?: number;
  pickupElevatorFits?: boolean | null;
  dropoffElevatorFits?: boolean | null;
  pickupElevatorFitRequiredItems?: number[];
  dropoffElevatorFitRequiredItems?: number[];
  specialDifficulty?: string[] | null;
  inventoryComplete?: boolean;
  waitingMinutes?: number;
  studentDiscountEligible?: boolean;
  serviceComplexity?: Record<string, 'STANDARD' | 'COMPLEX'>;
}

export interface PricingInput {
  leadId: string;
  moveDetails: MoveDetails;
  context: Required<PricingContext>;
  /** Auditable adapter assumptions; these never overwrite customer Lead facts. */
  assumptions: { singularRefrigeratorQuantity: number[]; singularWardrobeQuantity: number[] };
}

export interface PriceRange { min: number; max: number }
export interface PricingComponent {
  code: 'REFRIGERATOR' | 'WASHING_MACHINE' | 'BOXES' | 'FLOORS' | 'DISTANCE' | 'ASSEMBLY_DISASSEMBLY' | 'EXTRA_STOP' | 'WAITING' | 'DISCOUNT';
  label: string;
  amount: number;
  range: PriceRange;
  basis: string;
  source: string;
}
export interface ReviewReason {
  code: string;
  message: string;
  confidenceDeduction: number;
}
export interface OmittedComponent {
  code: string;
  itemIndex?: number;
  quantity: number | null;
  reason: string;
}
export interface EvaluationMetadata { id: string; createdAt: string }
export interface PricingEvaluation extends EvaluationMetadata {
  leadId: string;
  status: 'RECOMMENDATION_READY' | 'MANUAL_REVIEW_REQUIRED' | 'CANNOT_PRICE';
  ruleVersion: string;
  provisional: true;
  currency: 'ILS';
  suggestedAmount: number | null;
  priceRange: PriceRange | null;
  completeness: 'COMPLETE_RECOMMENDATION' | 'PARTIAL_RECOMMENDATION' | 'CANNOT_PRICE';
  amountScope: 'FULL_JOB' | 'SUPPORTED_COMPONENTS_ONLY';
  confidence: number;
  humanApprovalRequired: true;
  breakdown: PricingComponent[];
  omittedComponents: OmittedComponent[];
  reviewReasons: ReviewReason[];
  inputSnapshot: PricingInput;
  inputFingerprint: string;
}
