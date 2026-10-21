import { isItemType, type ItemType } from '../itemTypes.js';
import type { pricingRules } from './pricingRules.js';
import type { PricingInput } from './types.js';

interface ItemPricingPolicy {
  transport: 'REFRIGERATOR' | 'WASHING_MACHINE' | 'BOXES' | null;
  serviceTariff: keyof typeof pricingRules.services | null;
  countsTowardApplianceLimit: boolean;
  ordinaryStairBandApplies: boolean;
  singularQuantityAssumption: keyof PricingInput['assumptions'] | null;
}

// Transport, service bundles and load limits are independent decisions. A known
// extraction type must not acquire any of them through an implicit fallback.
export const itemPricingPolicies = {
  refrigerator: {
    transport: 'REFRIGERATOR', serviceTariff: null,
    countsTowardApplianceLimit: true, ordinaryStairBandApplies: true,
    singularQuantityAssumption: 'singularRefrigeratorQuantity',
  },
  box: {
    transport: 'BOXES', serviceTariff: null,
    countsTowardApplianceLimit: false, ordinaryStairBandApplies: true,
    singularQuantityAssumption: null,
  },
  washing_machine: {
    transport: 'WASHING_MACHINE', serviceTariff: null,
    countsTowardApplianceLimit: true, ordinaryStairBandApplies: true,
    singularQuantityAssumption: null,
  },
  wardrobe: {
    transport: null, serviceTariff: 'wardrobe',
    countsTowardApplianceLimit: false, ordinaryStairBandApplies: false,
    singularQuantityAssumption: 'singularWardrobeQuantity',
  },
  bed: {
    transport: null, serviceTariff: 'bed',
    countsTowardApplianceLimit: false, ordinaryStairBandApplies: false,
    singularQuantityAssumption: null,
  },
  dresser: {
    transport: null, serviceTariff: null,
    countsTowardApplianceLimit: false, ordinaryStairBandApplies: false,
    singularQuantityAssumption: null,
  },
} satisfies Record<ItemType, ItemPricingPolicy>;

export function getItemPricingPolicy(type: string | null): ItemPricingPolicy | undefined {
  return isItemType(type) ? itemPricingPolicies[type] : undefined;
}

export function hasTransportTariff(type: string | null): boolean {
  return (getItemPricingPolicy(type)?.transport ?? null) !== null;
}

export function usesBoxVolumeBand(type: string | null): boolean {
  return getItemPricingPolicy(type)?.transport === 'BOXES';
}

export function countsTowardApplianceLimit(type: string | null): boolean {
  return getItemPricingPolicy(type)?.countsTowardApplianceLimit === true;
}

export function ordinaryStairBandApplies(type: string | null): boolean {
  return getItemPricingPolicy(type)?.ordinaryStairBandApplies === true;
}
