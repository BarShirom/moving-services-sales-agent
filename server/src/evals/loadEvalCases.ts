import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z][a-z0-9-]*$/);
const jsonObject = z.record(text, z.json());
const date = z.iso.date();
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const money = z.number().finite().nonnegative();

// Expectations are partial semantic projections, not full production Lead objects.
// Keep these extensible for future capabilities without expanding the production domain.
export const conversationCaseSchema = z.object({
  id,
  scenario: text,
  description: text.optional(),
  status: z.enum(['regression', 'future']).optional(),
  previousAgentQuestion: z.object({
    text,
    requirements: z.array(z.object({
      id: text,
      itemIndex: count.optional(),
    }).strict()).optional(),
  }).strict().optional(),
  currentLeadState: jsonObject.optional(),
  customerMessage: text,
  referenceDate: date.optional(),
  expectedExtraction: jsonObject.optional(),
  // Dot paths into the resulting Lead; numeric path components identify item indices.
  expectedStateChanges: z.record(text, z.json()).optional(),
  expectedAgentIntent: z.array(text).min(1),
  mustNot: z.array(text).optional(),
}).strict();

const location = z.object({
  city: text.nullable().optional(),
  address: text.nullable().optional(),
  floor: z.number().int().nullable().optional(),
  elevator: z.boolean().nullable().optional(),
}).strict();

export const pricingCaseSchema = z.object({
  id,
  sourceQuality: z.enum(['closed_job', 'quoted_only', 'historical_estimate']),
  items: z.array(z.object({ type: text, quantity: positiveCount }).strict()).min(1),
  boxCount: count.nullable().optional(),
  pickup: location.optional(),
  dropoff: location.optional(),
  requestedDate: date.nullable().optional(),
  workers: positiveCount.nullable().optional(),
  vehicles: positiveCount.nullable().optional(),
  specialDifficulty: z.array(text).nullable().optional(),
  disassemblyAssembly: z.object({
    disassembly: z.boolean().nullable(),
    assembly: z.boolean().nullable(),
    notes: text.optional(),
  }).strict().nullable().optional(),
  quotedPrice: money.nullable().optional(),
  closedPrice: money.nullable().optional(),
  // Internal estimates must not be mislabeled as a sent quote or a closed price.
  estimatedPrice: money.nullable().optional(),
  currency: z.enum(['ILS']),
  outcome: z.enum(['WON', 'LOST', 'OPEN', 'UNKNOWN']),
  notes: text.optional(),
}).strict().superRefine((entry, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (entry.sourceQuality === 'closed_job' && entry.closedPrice == null) {
    issue('closedPrice', 'A closed job requires its actual closed price.');
  }
  if (entry.sourceQuality !== 'closed_job' && entry.closedPrice != null) {
    issue('closedPrice', 'Only closed_job can supply an actual closed price.');
  }
  if (entry.sourceQuality === 'quoted_only' && entry.quotedPrice == null) {
    issue('quotedPrice', 'quoted_only requires the quote that was sent.');
  }
  if (entry.sourceQuality === 'historical_estimate') {
    if (entry.estimatedPrice == null) issue('estimatedPrice', 'A historical estimate requires an estimated price.');
    if (entry.quotedPrice != null) issue('quotedPrice', 'An estimate is not a sent quote.');
  } else if (entry.estimatedPrice != null) {
    issue('estimatedPrice', 'Keep historical estimates in separate historical_estimate cases.');
  }
});

function dataset<T extends { id: string }>(schema: z.ZodType<T>) {
  return z.array(schema).min(1).superRefine((cases, ctx) => {
    const seen = new Set<string>();
    cases.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({
        code: 'custom', path: [index, 'id'], message: 'Duplicate case ID within this dataset.',
      });
      seen.add(entry.id);
    });
  });
}

export const conversationDatasetSchema = dataset(conversationCaseSchema);
export const pricingDatasetSchema = dataset(pricingCaseSchema);
export type ConversationEvalCase = z.infer<typeof conversationCaseSchema>;
export type PricingEvalCase = z.infer<typeof pricingCaseSchema>;

const privatePatterns: [string, RegExp][] = [
  ['email address', /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u],
  ['phone number', /(?<!\d)(?:\+?972[\s().-]*|00972[\s().-]*|0)(?:5\d(?:[\s().-]*\d){7}|[23489](?:[\s().-]*\d){7})(?!\d)/u],
  ['phone number', /(?<![\p{L}\p{N}])\+?(?:\d[ ().-]*){9,14}\d(?!\d)/u],
  ['raw WhatsApp metadata', /(?:\[?\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^\r\n:]{1,80}:|(?:Messages and calls are end-to-end encrypted|ההודעות והשיחות מוצפנות מקצה לקצה|<Media omitted>|<המדיה הושמטה>))/iu],
];

// Heuristics are an extra tripwire, never proof that arbitrary customer data is anonymous.
// Error messages identify only the category, not potentially private matched content.
export function assertPublicEvalText(contents: string): void {
  const normalized = contents.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
  for (const [category, pattern] of privatePatterns) {
    if (pattern.test(normalized)) throw new Error('Public eval content contains a possible ' + category + '.');
  }
}

function assertPublicJson(value: unknown): void {
  if (typeof value === 'string') assertPublicEvalText(value);
  else if (Array.isArray(value)) value.forEach(assertPublicJson);
  else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertPublicEvalText(key);
      assertPublicJson(entry);
    }
  }
}

export function parseConversationCases(value: unknown): ConversationEvalCase[] {
  assertPublicJson(value);
  return conversationDatasetSchema.parse(value);
}

export function parsePricingCases(value: unknown): PricingEvalCase[] {
  assertPublicJson(value);
  return pricingDatasetSchema.parse(value);
}

// This relative path works from server/src/evals and compiled server/dist/evals,
// independently of the process working directory. Keep data beside server when deploying.
export async function loadEvalCases(directory = new URL('../../../data/evals/', import.meta.url)) {
  const [conversationText, pricingText, readme] = await Promise.all([
    readFile(new URL('conversation-cases.json', directory), 'utf8'),
    readFile(new URL('pricing-cases.json', directory), 'utf8'),
    readFile(new URL('README.md', directory), 'utf8'),
  ]);
  for (const contents of [conversationText, pricingText, readme]) assertPublicEvalText(contents);
  return {
    conversationCases: parseConversationCases(JSON.parse(conversationText)),
    pricingCases: parsePricingCases(JSON.parse(pricingText)),
  };
}
