import { z } from 'zod';
import { createLead } from '../domain/createLead.js';
import { createMoveItem } from '../domain/createMoveItem.js';
import type { Lead } from '../domain/lead.js';
import { evaluateRequirements } from '../domain/requirements/evaluateRequirements.js';
import type { NextQuestion } from '../domain/requirements/types.js';
import type { ConversationEvalCase } from './loadEvalCases.js';

// Validate fixture input shape, not business policy. Unsupported snapshot fields fail
// explicitly rather than being silently dropped or copied unsafely onto a Lead.
const location = z.object({
  city: z.string().nullable().optional(), address: z.string().nullable().optional(),
  floor: z.number().int().nullable().optional(), elevator: z.boolean().nullable().optional(),
}).strict();
const measurement = z.number().positive().nullable().optional();
const snapshotSchema = z.object({
  moveDetails: z.object({
    pickup: location.optional(), dropoff: location.optional(),
    items: z.array(z.object({
      type: z.string().nullable().optional(), quantity: z.number().int().positive().nullable().optional(),
      sizeCategory: z.string().nullable().optional(), description: z.string().nullable().optional(),
      photoStatus: z.enum(['REQUIRED', 'RECEIVED', 'NOT_APPLICABLE', 'NOT_AVAILABLE']).optional(),
      dimensions: z.object({ width: measurement, height: measurement, depth: measurement }).strict().optional(),
      dimensionsAvailable: z.boolean().nullable().optional(),
      requiresDisassembly: z.boolean().nullable().optional(), requiresAssembly: z.boolean().nullable().optional(),
    }).strict()).optional(),
    requestedDate: z.iso.date().nullable().optional(),
    requestedTime: z.string().nullable().optional(),
    specialAccessNotes: z.string().nullable().optional(),
  }).strict().optional(),
}).strict();

export function hydrateEvalLead(entry: ConversationEvalCase): Lead {
  const snapshot = snapshotSchema.safeParse(entry.currentLeadState ?? {});
  if (!snapshot.success) throw new Error('Unsupported currentLeadState shape: ' +
    snapshot.error.issues.map(issue => issue.path.join('.')).join(', '));
  const lead = createLead();
  const move = snapshot.data.moveDetails ?? {};
  lead.moveDetails = {
    ...lead.moveDetails, ...move,
    pickup: { ...lead.moveDetails.pickup, ...move.pickup },
    dropoff: { ...lead.moveDetails.dropoff, ...move.dropoff },
    items: (move.items ?? []).map(item => {
      const defaults = createMoveItem(item.type ?? null);
      return { ...defaults, ...item, dimensions: { ...defaults.dimensions, ...item.dimensions } };
    }),
  };
  return lead;
}

export function actualQuestion(entry: ConversationEvalCase, lead: Lead): NextQuestion | undefined {
  if (!entry.previousAgentQuestion) return undefined;
  if (!entry.previousAgentQuestion.requirements?.length) throw new Error('Previous question lacks structured requirement references.');
  const known = evaluateRequirements(lead).requirements;
  return {
    text: entry.previousAgentQuestion.text,
    requirements: entry.previousAgentQuestion.requirements.map(ref => {
      const match = known.find(r => r.id === ref.id && r.itemIndex === ref.itemIndex);
      if (!match) throw new Error('Unsupported question requirement reference: ' + ref.id);
      return { id: match.id, ...(match.itemIndex === undefined ? {} : { itemIndex: match.itemIndex }) };
    }),
  };
}
