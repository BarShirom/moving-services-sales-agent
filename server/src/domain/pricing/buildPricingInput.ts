import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pricingRules } from './pricingRules.js';
import type { Lead } from '../lead.js';
import type { PricingContext, PricingEvaluation, PricingInput } from './types.js';

const text = z.string().min(1).refine(value => value.trim().length > 0);
const count = z.number().int().positive();
const positive = z.number().finite().positive();
const location = z.object({
  city: text.nullable(), address: text.nullable(),
  floor: z.number().int().nullable(), elevator: z.boolean().nullable(),
}).strict();
export const pricingInputSchema = z.object({
  leadId: text,
  assumptions: z.object({
    singularRefrigeratorQuantity: z.array(z.number().int().nonnegative()).default(() => []),
    singularWardrobeQuantity: z.array(z.number().int().nonnegative()).default(() => []),
  }).strict().default(() => ({ singularRefrigeratorQuantity: [], singularWardrobeQuantity: [] })),
  moveDetails: z.object({
    items: z.array(z.object({
      type: text.nullable(), quantity: count.nullable(), sizeCategory: text.nullable(),
      photoStatus: z.enum(['REQUIRED', 'RECEIVED', 'NOT_APPLICABLE', 'NOT_AVAILABLE']),
      description: text.nullable(),
      dimensions: z.object({ width: positive.nullable(), height: positive.nullable(), depth: positive.nullable() }).strict(),
      dimensionsAvailable: z.boolean().nullable(),
      requiresDisassembly: z.boolean().nullable(), requiresAssembly: z.boolean().nullable(),
    }).strict()),
    pickup: location, dropoff: location,
    requestedDate: z.iso.date().nullable(),
    requestedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
    specialAccessNotes: text.nullable(),
  }).strict(),
  context: z.object({
    distanceKm: z.number().finite().nonnegative().nullable().default(null),
    distanceBand: text.nullable().default(null),
    workers: count.nullable().default(null), estimatedDurationHours: positive.nullable().default(null),
    // The Lead models exactly one pickup and one dropoff; adapters can explicitly add points.
    pickupPoints: count.default(1), dropoffPoints: count.default(1),
    pickupElevatorFits: z.boolean().nullable().default(null),
    dropoffElevatorFits: z.boolean().nullable().default(null),
    pickupElevatorFitRequiredItems: z.array(z.number().int().nonnegative()).default(() => []),
    dropoffElevatorFitRequiredItems: z.array(z.number().int().nonnegative()).default(() => []),
    specialDifficulty: z.array(text).nullable().default(null),
    inventoryComplete: z.boolean().default(true),
    waitingMinutes: z.number().int().nonnegative().default(0),
    studentDiscountEligible: z.boolean().default(false),
    serviceComplexity: z.record(z.string().regex(/^(0|[1-9]\d*)$/), z.enum(['STANDARD', 'COMPLEX'])).default({}),
  }).strict(),
}).strict();

/** Normalize unique singular items for pricing without overwriting customer facts. */
export function buildPricingInput(lead: Lead, context: PricingContext = {}): PricingInput {
  const input = pricingInputSchema.parse({ leadId: lead.id, moveDetails: lead.moveDetails, context });
  const items = input.moveDetails.items;
  // Apply the convention independently by type: unpriced furniture or high box
  // volume does not erase what is known about a unique refrigerator (or wardrobe).
  if (input.context.inventoryComplete && items.every(item => item.type !== null)) {
    for (const [type, key] of [['refrigerator', 'singularRefrigeratorQuantity'], ['wardrobe', 'singularWardrobeQuantity']] as const) {
      const matches = items.filter(item => item.type === type);
      if (matches.length === 1 && matches[0].quantity === null && matches[0].description === null) {
        matches[0].quantity = 1;
        input.assumptions[key].push(items.indexOf(matches[0]));
      }
    }
  }
  for (const index of [...input.context.pickupElevatorFitRequiredItems, ...input.context.dropoffElevatorFitRequiredItems]) {
    if (index >= items.length) throw new RangeError('Elevator-fit requirement refers to an unknown item.');
  }
  return input;
}

export function fingerprintPricingInput(input: PricingInput): string {
  // Parsing gives stable property order and a detached copy. The engine treats all
  // non-received photo statuses equally: no visual evidence. A later refusal alone
  // must not invalidate an otherwise current price; keep the actual status in audit snapshots.
  const relevant = pricingInputSchema.parse(input);
  for (const item of relevant.moveDetails.items) {
    if (item.photoStatus !== 'RECEIVED') item.photoStatus = 'REQUIRED';
  }
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

export function isPricingEvaluationCurrent(evaluation: PricingEvaluation, lead: Lead, context: PricingContext = {}): boolean {
  return evaluation.ruleVersion === pricingRules.version && evaluation.inputFingerprint === fingerprintPricingInput(buildPricingInput(lead, context));
}
