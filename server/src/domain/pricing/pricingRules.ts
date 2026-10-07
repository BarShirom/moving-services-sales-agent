import type { PriceRange } from './types.js';

const source = 'data/evals/README.md#historical-pricing-heuristics';
export const pricingRules = Object.freeze({
  version: 'MOVING_PRICING_V0_1_3' as const,
  source,
  assumptionSource: 'README.md#provisional-pricing-assumptions',
  refrigerator: Object.freeze({
    SMALL: Object.freeze({ min: 300, max: 300 }), REGULAR: Object.freeze({ min: 350, max: 350 }),
    LARGE: Object.freeze({ min: 400, max: 450 }), FOUR_DOOR: Object.freeze({ min: 400, max: 450 }),
  }),
  washingMachine: Object.freeze({ min: 280, max: 320 }),
  stairsPerFloor: Object.freeze({ min: 100, max: 150 }),
  // Engineering assumptions: job evidence does not isolate box or route costs.
  boxes: Object.freeze([
    Object.freeze({ upTo: 10, min: 50, max: 100 }),
    Object.freeze({ upTo: 20, min: 100, max: 200 }),
    Object.freeze({ upTo: 30, min: 200, max: 300 }),
  ]),
  distance: Object.freeze({ includedKm: 10, perKm: Object.freeze({ min: 5, max: 10 }) }),
  services: Object.freeze({ bed: Object.freeze({ min: 180, max: 350 }), wardrobe: Object.freeze({ min: 350, max: 600 }) }),
  extraStop: Object.freeze({ min: 200, max: 300 }),
  waiting: Object.freeze({ minutesPerBlock: 30, amountPerBlock: 150 }),
  studentDiscount: 0.1,
  // Engineering review limits; not inferred business tariffs.
  review: Object.freeze({ maxItemTypes: 3, maxAppliances: 2, maxWorkers: 2, maxDurationHours: 2, maxBoxes: 30 }),
  confidence: Object.freeze({ provisional: 10, assumption: 5, missing: 5, missingDistance: 15,
    unsupported: 20, complexity: 20, noRate: 10, manualService: 10, noVisualEvidence: 5 }),
});

/** All arithmetic settles to integer agorot at component boundaries. */
export function money(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError('Pricing exceeds safe monetary arithmetic.');
  return cents / 100;
}
export function midpoint(range: PriceRange): number { return money((range.min + range.max) / 2); }
export function sumRanges(ranges: PriceRange[]): PriceRange {
  return ranges.reduce((sum, range) => ({ min: money(sum.min + range.min), max: money(sum.max + range.max) }), { min: 0, max: 0 });
}
