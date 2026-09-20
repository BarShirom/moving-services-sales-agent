import { createMoveItem } from '../createMoveItem.js';
import type { Lead, Location } from '../lead.js';
import type { ExtractionResult, LocationPatch, MergeResult } from './types.js';

function mergeLocation(location: Location, patch?: LocationPatch): Location {
  const result = { ...location };
  if (patch?.city !== undefined) result.city = patch.city;
  if (patch?.address !== undefined) result.address = patch.address;
  if (patch?.floor !== undefined) result.floor = patch.floor;
  if (patch?.elevator !== undefined) result.elevator = patch.elevator;
  return result;
}

export function mergeExtraction(lead: Lead, extraction: ExtractionResult): MergeResult {
  const patch = extraction.moveDetails;
  const items = lead.moveDetails.items.map(item => ({ ...item, dimensions: { ...item.dimensions } }));
  const unappliedItems: MergeResult['unappliedItems'] = [];
  for (const update of patch?.items ?? []) {
    const matches = items.filter(item => item.type === update.type);
    if (matches.length > 1) {
      unappliedItems.push({ ...update, ...(update.dimensions ? { dimensions: { ...update.dimensions } } : {}) });
      continue;
    }
    const item = matches[0] ?? createMoveItem(update.type);
    if (matches.length === 0) items.push(item);
    if (update.quantity !== undefined) item.quantity = update.quantity;
    if (update.sizeCategory !== undefined) item.sizeCategory = update.sizeCategory;
    if (update.dimensionsAvailable !== undefined) item.dimensionsAvailable = update.dimensionsAvailable;
    if (update.photoStatus !== undefined) item.photoStatus = update.photoStatus;
    for (const axis of ['width', 'height', 'depth'] as const) {
      const value = update.dimensions?.[axis];
      if (value !== undefined) item.dimensions[axis] = value;
    }
    if (update.requiresDisassembly !== undefined) item.requiresDisassembly = update.requiresDisassembly;
    if (update.requiresAssembly !== undefined) item.requiresAssembly = update.requiresAssembly;
  }
  return {
    lead: {
      ...lead,
      messages: lead.messages.map(message => ({ ...message })),
      moveDetails: {
        ...lead.moveDetails,
        pickup: mergeLocation(lead.moveDetails.pickup, patch?.pickup),
        dropoff: mergeLocation(lead.moveDetails.dropoff, patch?.dropoff),
        items,
        ...(patch?.requestedDate === undefined ? {} : { requestedDate: patch.requestedDate }),
        ...(patch?.requestedTime === undefined ? {} : { requestedTime: patch.requestedTime }),
        ...(patch?.specialAccessNotes === undefined ? {} : { specialAccessNotes: patch.specialAccessNotes }),
      },
    },
    unappliedItems,
  };
}
