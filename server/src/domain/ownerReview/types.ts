import { z } from 'zod';
import type { MoveDetails } from '../lead.js';

export type OwnerDecision = 'APPROVED' | 'ADJUSTED' | 'REQUEST_MORE_INFO' | 'HUMAN_HANDOFF';
export interface OwnerReview {
  id: string;
  leadId: string;
  pricingEvaluationId: string | null;
  suggestedAmount: number | null;
  approvedAmount: number | null;
  decision: OwnerDecision;
  internalReason: string | null;
  customerQuestion: string | null;
  createdAt: string;
  scopeSnapshot: MoveDetails | null;
  scopeVersion: number | null;
  scopeFingerprint: string | null;
  scopeConfirmed: boolean;
  omittedCostsAcknowledged: boolean;
  reviewedPhotoItemIndices: number[];
}
const token = { leadId: z.string().min(1), revision: z.number().int().nonnegative() };
export const reviewTokenSchema = z.object(token).strict();
const evaluated = { ...token, pricingEvaluationId: z.string().min(1) };
const finalization = {
  scopeConfirmed: z.boolean().optional(),
  omittedCostsAcknowledged: z.boolean().optional(),
  reviewedPhotoItemIndices: z.array(z.number().int().nonnegative()).optional(),
};
export const ownerActionSchema = z.discriminatedUnion('action', [
  z.object({ ...evaluated, ...finalization, action: z.literal('APPROVE') }).strict(),
  z.object({ ...evaluated, ...finalization, action: z.literal('ADJUST_PRICE'),
    amount: z.number().finite().positive().refine(value => Number.isSafeInteger(Math.round(value * 100)) && value === Math.round(value * 100) / 100, 'Use a positive amount with at most two decimals.'),
    internalReason: z.string().trim().max(300).optional(),
  }).strict(),
  z.object({ ...token, action: z.literal('REQUEST_MORE_INFO'), question: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...token, action: z.literal('TAKE_OVER_CONVERSATION') }).strict(),
]);
export type OwnerAction = z.infer<typeof ownerActionSchema>;
export type ReviewToken = z.infer<typeof reviewTokenSchema>;
export class OwnerWorkflowError extends Error {
  constructor(public code: 'STALE_REVIEW' | 'ACTION_UNAVAILABLE', message: string) { super(message); }
}
