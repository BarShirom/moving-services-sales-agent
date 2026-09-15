import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

// Nested anyOf is supported by strict Structured Outputs. No dummy or null values.
function update<T extends z.ZodType>(value: T) {
  return z.union([
    z.object({ action: z.literal('keep') }).strict(),
    z.object({ action: z.enum(['set', 'correct']), value }).strict(),
  ]);
}

const location = z.object({
  city: update(z.string()),
  address: update(z.string()),
  floor: update(z.number()),
  elevator: update(z.boolean()),
}).strict();

// Wire shape is separate from domain validation (calendar dates, positive values, etc.).
export const AIExtractionSchema = z.object({
  items: z.array(z.object({
    type: z.enum(['refrigerator', 'box', 'washing_machine', 'wardrobe', 'bed']),
    quantity: update(z.number()).describe('Explicit positive integer total, including approximate totals such as בערך 15, כ-15, משהו כמו 15. Unknown, incremental or ranged counts use keep.'),
    sizeCategory: update(z.enum(['SMALL', 'REGULAR', 'LARGE', 'FOUR_DOOR'])),
    dimensions: z.object({
      width: update(z.number()), height: update(z.number()), depth: update(z.number()),
    }).strict(),
    requiresDisassembly: update(z.boolean()),
    requiresAssembly: update(z.boolean()),
  }).strict()).describe('All distinctly affirmed supported item types across the entire latest message. One entry per TYPE, not per message. Include refrigerator AND box when both are mentioned, even if quantity is unknown. Exclude negated or hypothetical items.'),
  pickup: location,
  dropoff: location,
  requestedDate: update(z.string()).describe('Copy the customer date token verbatim: YYYY-MM-DD, DD/MM, DD/MM/YYYY, DD.MM, or DD.MM.YYYY. Application code normalizes it and chooses any omitted year using the explicit reference date.'),
  requestedTime: update(z.string()),
  specialAccessNotes: update(z.string()),
}).strict();

export type AIExtraction = z.infer<typeof AIExtractionSchema>;
export type FieldUpdate<T> = { action: 'keep' } | { action: 'set' | 'correct'; value: T };
export const extractionTextFormat = zodTextFormat(AIExtractionSchema, 'moving_extraction');
