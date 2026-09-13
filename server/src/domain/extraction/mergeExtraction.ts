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
      unappliedItems.push({ ...update });
      continue;
    }
    const item = matches[0] ?? createMoveItem(update.type);
    if (matches.length === 0) items.push(item);
    if (update.quantity !== undefined) item.quantity = update.quantity;
    if (update.sizeCategory !== undefined) item.sizeCategory = update.sizeCategory;
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
      },
    },
    unappliedItems,
  };
}
