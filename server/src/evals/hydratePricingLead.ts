import { createMoveItem } from '../domain/createMoveItem.js';
import type { Lead } from '../domain/lead.js';
import type { PricingContext } from '../domain/pricing/types.js';
import type { PricingEvalCase } from './loadEvalCases.js';

// Fixed offline audit time, NOT an inferred job/request date.
export const pricingEvalTimestamp = '1970-01-01T00:00:00.000Z';

export function hydratePricingLead(entry: PricingEvalCase): { lead: Lead; context: PricingContext } {
  if (entry.boxCount != null && entry.items.some(item => item.type === 'box')) {
    throw new Error('Boxes must be supplied in items or boxCount, not both.');
  }
  const items = entry.items.map(item => ({
    ...createMoveItem(item.type), quantity: item.quantity, sizeCategory: item.sizeCategory ?? null,
    requiresAssembly: entry.disassemblyAssembly?.assembly ?? null,
    requiresDisassembly: entry.disassemblyAssembly?.disassembly ?? null,
  }));
  if (entry.boxCount != null && entry.boxCount > 0) items.push({
    ...createMoveItem('box'), quantity: entry.boxCount,
    requiresAssembly: entry.disassemblyAssembly?.assembly ?? null,
    requiresDisassembly: entry.disassemblyAssembly?.disassembly ?? null,
  });
  const emptyLocation = { city: null, address: null, floor: null, elevator: null };
  return {
    lead: {
      id: entry.id, status: 'COLLECTING_INFORMATION', messages: [],
      createdAt: pricingEvalTimestamp, updatedAt: pricingEvalTimestamp,
      moveDetails: {
        items, pickup: { ...emptyLocation, ...entry.pickup }, dropoff: { ...emptyLocation, ...entry.dropoff },
        requestedDate: entry.requestedDate ?? null, requestedTime: null, specialAccessNotes: null,
      },
    },
    context: {
      ...entry.pricingContext, workers: entry.workers ?? null,
      specialDifficulty: entry.specialDifficulty ?? null,
      // Current historical fixtures do not establish complete/exact inventory. No notes are parsed.
      inventoryComplete: entry.pricingContext?.inventoryComplete ?? false,
    },
  };
}
