import type { Lead } from '../lead.js';

export type SupportedItemType = 'refrigerator' | 'box' | 'washing_machine' | 'wardrobe' | 'bed';
export type RefrigeratorSize = 'SMALL' | 'REGULAR' | 'LARGE' | 'FOUR_DOOR';

// Omitted properties mean no update. Null is never an extracted value.
export interface LocationPatch {
  city?: string;
  address?: string;
  floor?: number;
  elevator?: boolean;
}

export interface ItemPatch {
  type: SupportedItemType;
  quantity?: number;
  sizeCategory?: RefrigeratorSize;
  dimensions?: { width?: number; height?: number; depth?: number };
  requiresDisassembly?: boolean;
  requiresAssembly?: boolean;
}

export interface ExtractionResult {
  moveDetails?: {
    items?: ItemPatch[];
    pickup?: LocationPatch;
    dropoff?: LocationPatch;
    requestedDate?: string;
    requestedTime?: string;
    specialAccessNotes?: string;
  };
}

export interface MergeResult {
  lead: Lead;
  // Multiple existing items of this type make the update ambiguous.
  unappliedItems: ItemPatch[];
}
