export type RequirementId =
  | 'items'
  | `${'pickup' | 'dropoff'}.${'city' | 'address' | 'floor' | 'elevator'}`
  | 'requestedDate'
  | 'specialAccessNotes'
  | `item.${'type' | 'support' | 'quantity' | 'size' | 'width' | 'height' | 'depth' | 'disassembly' | 'assembly' | 'photo'}`;

export interface RequirementResult {
  id: RequirementId;
  // Index in the evaluated items array, not a persistent item identity.
  itemIndex?: number;
  stage: 'PRICING' | 'REVIEW';
  status: 'MISSING' | 'SATISFIED' | 'NOT_APPLICABLE';
  conditional: boolean;
  question: string | null;
}

export interface ItemRequirementContext {
  quantityRequired?: boolean;
  dimensionsRequired?: boolean;
  disassemblyRelevant?: boolean;
  assemblyRelevant?: boolean;
}

export interface RequirementContext {
  items?: Partial<Record<number, ItemRequirementContext>>;
  specialAccessDetailsRequired?: boolean;
}

export interface NextQuestion {
  text: string;
  requirements: Pick<RequirementResult, 'id' | 'itemIndex'>[];
}

export interface RequirementEvaluation {
  requirements: RequirementResult[];
  missingRequired: RequirementResult[];
  pendingReview: RequirementResult[];
  readyForPricing: boolean;
  nextQuestion: NextQuestion | null;
}
