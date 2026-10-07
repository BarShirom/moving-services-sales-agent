import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { assertPublicEvalText } from './loadEvalCases.js';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z][a-z0-9-]*$/);
const money = z.number().finite().positive();
const count = z.number().int().positive();
export const evidenceCategories = [
  'refrigerator_transport', 'washing_machine_transport', 'dresser_transport', 'wardrobe_transport',
  'wardrobe_assembly_disassembly', 'bed_transport', 'bed_assembly_disassembly', 'sofa_transport',
  'table_desk_transport', 'tv_transport', 'dishwasher_transport', 'oven_transport', 'dryer_transport',
  'armchair_transport', 'electric_piano_transport', 'boxes', 'stairs', 'distance', 'additional_stop',
  'waiting', 'student_discount', 'kitchen_island_transport', 'general_appliance_transport',
] as const;
const category = z.enum(evidenceCategories);
const scope = z.enum(['ITEM_LEVEL', 'SERVICE_LEVEL', 'JOB_LEVEL', 'RULE_LEVEL']);
const range = z.object({
  min: money, max: money.nullable(), upperBoundOpen: z.boolean().optional(),
}).strict().refine(value => value.max === null || value.min <= value.max, {
  message: 'Range minimum must not exceed its maximum.',
});
const location = z.object({
  floor: z.number().int().nullable().optional(), elevator: z.boolean().nullable().optional(),
  // Area-level context only: raw street addresses and identity fields are deliberately unsupported.
  area: text.optional(),
}).strict();

export const pricingEvidenceRecordSchema = z.object({
  id,
  evidenceType: z.enum(['ITEM_REFERENCE', 'SERVICE_REFERENCE', 'JOB_LEVEL_CASE', 'BUSINESS_RULE',
    'CLOSED_JOB', 'QUOTED_JOB', 'HISTORICAL_ESTIMATE']),
  sourceQuality: z.enum(['STRONG', 'MEDIUM', 'WEAK']), scope,
  categories: z.array(category).min(1),
  sourceBasis: z.enum(['REPOSITORY_JOB', 'HISTORICAL_REFERENCE', 'TASK_HISTORICAL_CASE', 'ENGINEERING_ASSUMPTION']),
  items: z.array(z.object({
    type: text, quantity: count.nullable().optional(), quantityApproximate: z.boolean().optional(),
    sizeCategory: text.optional(), description: text.optional(),
  }).strict()).optional(),
  pickup: location.optional(), dropoff: location.optional(),
  services: z.array(z.object({
    type: text, required: z.boolean().nullable().optional(), quantity: count.nullable().optional(),
    quantityApproximate: z.boolean().optional(), notes: text.optional(),
  }).strict()).optional(),
  workers: count.nullable().optional(), vehicles: count.nullable().optional(),
  quotedPrice: money.nullable().optional(), closedPrice: money.nullable().optional(),
  estimatedPrice: money.nullable().optional(), referencePrice: money.nullable().optional(),
  expectedClosePrice: money.nullable().optional(), priceRange: range.optional(), expectedCloseRange: range.optional(),
  currency: z.literal('ILS'), outcome: z.enum(['WON', 'LOST', 'OPEN', 'UNKNOWN']).optional(),
  humanApprovalRequired: z.literal(true), evidenceNote: text, limitations: z.array(text).min(1),
  sourceReference: z.array(text).min(1),
  originalSourceQuality: z.enum(['closed_job', 'quoted_only', 'historical_estimate']).optional(),
  rule: z.object({
    unit: text.optional(), percentage: z.number().finite().positive().max(100).optional(),
    minutesPerBlock: count.optional(), includedKm: z.number().finite().nonnegative().optional(),
    upToBoxes: count.optional(),
  }).strict().optional(),
}).strict().superRefine((entry, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const jobTypes = ['JOB_LEVEL_CASE', 'CLOSED_JOB', 'QUOTED_JOB', 'HISTORICAL_ESTIMATE'];
  if (jobTypes.includes(entry.evidenceType) !== (entry.scope === 'JOB_LEVEL')) issue('Job evidence must remain JOB_LEVEL.');
  if (entry.evidenceType === 'ITEM_REFERENCE' && entry.scope !== 'ITEM_LEVEL') issue('Item references require ITEM_LEVEL scope.');
  if (entry.evidenceType === 'SERVICE_REFERENCE' && !['SERVICE_LEVEL', 'RULE_LEVEL'].includes(entry.scope)) issue('Service references require service or rule scope.');
  if (entry.evidenceType === 'BUSINESS_RULE' && entry.scope !== 'RULE_LEVEL') issue('Business rules require RULE_LEVEL scope.');
  if (entry.evidenceType === 'CLOSED_JOB') {
    if (entry.closedPrice == null || entry.outcome !== 'WON') issue('A confirmed closed job requires closedPrice and WON outcome.');
  } else if (entry.closedPrice != null || entry.outcome === 'WON') issue('Only confirmed CLOSED_JOB evidence can claim a closed price or WON outcome.');
  if (entry.evidenceType === 'QUOTED_JOB' && entry.quotedPrice == null) issue('A quoted job requires the actual sent quotedPrice.');
  if (entry.quotedPrice != null && !['QUOTED_JOB', 'CLOSED_JOB'].includes(entry.evidenceType)) issue('Estimates/references are not sent quotes.');
  if (entry.evidenceType === 'HISTORICAL_ESTIMATE' && entry.estimatedPrice == null && !entry.priceRange) issue('Historical estimates require an estimated amount or range.');
  if ((entry.estimatedPrice != null || entry.expectedClosePrice != null || entry.expectedCloseRange) && entry.evidenceType !== 'HISTORICAL_ESTIMATE') issue('Expected and estimated amounts belong to historical estimates, never actual transactions.');
  if (entry.originalSourceQuality) {
    const expected = { closed_job: 'CLOSED_JOB', quoted_only: 'QUOTED_JOB', historical_estimate: 'HISTORICAL_ESTIMATE' };
    if (expected[entry.originalSourceQuality] !== entry.evidenceType) issue('Original job classification must be preserved.');
  }
  if (entry.sourceBasis === 'ENGINEERING_ASSUMPTION' && (entry.sourceQuality !== 'WEAK' || entry.scope !== 'RULE_LEVEL')) issue('Engineering assumptions must remain WEAK RULE_LEVEL evidence.');
  if (['REPOSITORY_JOB', 'TASK_HISTORICAL_CASE'].includes(entry.sourceBasis) && entry.scope !== 'JOB_LEVEL') issue('Job provenance cannot be relabeled as isolated tariff evidence.');
  if (entry.sourceBasis === 'REPOSITORY_JOB' && !entry.originalSourceQuality) issue('Repository jobs must retain their original source classification.');
  if (new Set(entry.categories).size !== entry.categories.length) issue('Evidence categories must be unique.');
});

export const pricingEvidenceSchema = z.object({
  schemaVersion: z.literal(1), records: z.array(pricingEvidenceRecordSchema).min(1),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.records.map(entry => entry.id)).size !== value.records.length) ctx.addIssue({ code: 'custom', message: 'Evidence IDs must be unique.' });
});

export const pricingTariffReadinessSchema = z.object({
  schemaVersion: z.literal(1), pricingRuleVersion: text,
  categories: z.array(z.object({
    category, scope, status: z.enum(['READY', 'PROVISIONAL', 'INSUFFICIENT_EVIDENCE', 'MANUAL_REVIEW_ONLY']),
    evidenceIds: z.array(id), tariffEvidenceIds: z.array(id), reason: text, currentDecision: text,
    engineRule: z.object({
      implemented: z.boolean(), reference: text.nullable(),
      provenance: z.enum(['HISTORICAL_WITH_PROVISIONAL_COMPOSITION', 'ENGINEERING_ASSUMPTION', 'NOT_IMPLEMENTED']),
    }).strict(),
  }).strict()).min(1),
}).strict().superRefine((value, ctx) => {
  const categories = value.categories.map(entry => entry.category);
  if (new Set(categories).size !== categories.length) ctx.addIssue({ code: 'custom', message: 'Readiness categories must be unique.' });
  if (evidenceCategories.some(entry => !categories.includes(entry))) ctx.addIssue({ code: 'custom', message: 'Every known evidence category requires a readiness decision.' });
});

export type PricingEvidenceRecord = z.infer<typeof pricingEvidenceRecordSchema>;
export type PricingEvidence = z.infer<typeof pricingEvidenceSchema>;
export type PricingTariffReadiness = z.infer<typeof pricingTariffReadinessSchema>;

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

/** Offline governance data only. Neither the pricing engine nor quote workflow reads this layer. */
export function parsePricingEvidence(evidenceValue: unknown, readinessValue: unknown) {
  assertPublicJson(evidenceValue);
  assertPublicJson(readinessValue);
  const evidence = pricingEvidenceSchema.parse(evidenceValue);
  const readiness = pricingTariffReadinessSchema.parse(readinessValue);
  const records = new Map(evidence.records.map(record => [record.id, record]));
  for (const row of readiness.categories) {
    const expectedScope = ['boxes', 'stairs', 'distance', 'additional_stop', 'waiting', 'student_discount'].includes(row.category)
      ? 'RULE_LEVEL' : row.category.endsWith('_assembly_disassembly') ? 'SERVICE_LEVEL' : 'ITEM_LEVEL';
    if (row.scope !== expectedScope) throw new Error('Readiness category scope must match its item, service, or business-rule meaning.');
    if (new Set(row.evidenceIds).size !== row.evidenceIds.length || new Set(row.tariffEvidenceIds).size !== row.tariffEvidenceIds.length) throw new Error('Evidence references must be unique within each readiness category.');
    for (const evidenceId of row.evidenceIds) {
      const record = records.get(evidenceId);
      if (!record || !record.categories.includes(row.category)) throw new Error('Readiness references an unknown evidence ID or mismatched category.');
    }
    const tariffRecords = row.tariffEvidenceIds.map(evidenceId => {
      const record = records.get(evidenceId);
      if (!row.evidenceIds.includes(evidenceId) || !record || record.scope === 'JOB_LEVEL' || record.scope !== row.scope) throw new Error('A tariff basis must reference matching isolated item/service/rule evidence; job totals cannot be decomposed.');
      return record;
    });
    if (['READY', 'PROVISIONAL'].includes(row.status) && tariffRecords.length === 0) throw new Error('Ready/provisional tariffs require direct evidence or an explicitly labeled rule assumption.');
    if (row.status === 'READY' && !tariffRecords.some(record => record.sourceQuality === 'STRONG' && record.sourceBasis !== 'ENGINEERING_ASSUMPTION')) throw new Error('READY requires strong direct evidence, not an engineering assumption or bundle.');
    if (row.engineRule.implemented !== (row.engineRule.provenance !== 'NOT_IMPLEMENTED') || (row.engineRule.implemented && row.engineRule.reference === null)) throw new Error('Engine implementation and provenance must agree.');
  }
  return { evidence, readiness };
}

/** Works from src and compiled dist; no provider, runtime state, or engine mutation. */
export async function loadPricingEvidence(directory = new URL('../../../data/evals/', import.meta.url)) {
  const [evidenceText, readinessText, documentation] = await Promise.all([
    readFile(new URL('pricing-evidence.json', directory), 'utf8'),
    readFile(new URL('pricing-tariff-readiness.json', directory), 'utf8'),
    readFile(new URL('PRICING_EVIDENCE.md', directory), 'utf8'),
  ]);
  [evidenceText, readinessText, documentation].forEach(assertPublicEvalText);
  return { ...parsePricingEvidence(JSON.parse(evidenceText) as unknown, JSON.parse(readinessText) as unknown), documentation };
}
