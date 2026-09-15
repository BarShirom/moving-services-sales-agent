import { isNormalizedDate, normalizeRequestedDate } from '../../domain/extraction/normalizeRequestedDate.js';
export { isNormalizedDate } from '../../domain/extraction/normalizeRequestedDate.js';
import type { Lead } from '../../domain/lead.js';
import type { ExtractionResult, ItemPatch, LocationPatch } from '../../domain/extraction/types.js';
import { AIExtractionError } from './errors.js';
import { AIExtractionSchema, type FieldUpdate } from './schema.js';

function invalid(path: string): never {
  // Paths only: do not expose customer text or raw provider output in errors.
  throw new AIExtractionError('INVALID_EXTRACTION', `Invalid AI extraction at ${path}.`);
}

function write<T>(
  target: object, key: string, update: FieldUpdate<T>, known: unknown,
  path: string, valid: (value: T) => boolean = () => true,
): void {
  if (update.action === 'keep') return;
  if (!valid(update.value)) invalid(path);
  if (known !== null && known !== undefined && known !== update.value && update.action !== 'correct') {
    invalid(`${path} (overwriting a known value requires an explicit correction)`);
  }
  Object.assign(target, { [key]: update.value });
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const quantity = (value: number) => Number.isSafeInteger(value) && value > 0;
const nonblank = (value: string) => value.trim().length > 0 && value.length <= 2_000;

export function convertAIExtraction(output: unknown, lead: Lead, context: { referenceDate?: string } = {}): ExtractionResult {
  const parsed = AIExtractionSchema.safeParse(output);
  if (!parsed.success) invalid('schema');
  const data = parsed.data;
  const moveDetails: NonNullable<ExtractionResult['moveDetails']> = {};
  for (const side of ['pickup', 'dropoff'] as const) {
    const patch: LocationPatch = {};
    const known = lead.moveDetails[side];
    write(patch, 'city', data[side].city, known.city, `${side}.city`, nonblank);
    write(patch, 'address', data[side].address, known.address, `${side}.address`, nonblank);
    write(patch, 'floor', data[side].floor, known.floor, `${side}.floor`, Number.isSafeInteger);
    write(patch, 'elevator', data[side].elevator, known.elevator, `${side}.elevator`);
    if (Object.keys(patch).length) moveDetails[side] = patch;
  }
  const items: ItemPatch[] = [];
  const seen = new Set<string>();
  for (const update of data.items) {
    if (seen.has(update.type)) invalid('items (duplicate item type)');
    seen.add(update.type);
    const matches = lead.moveDetails.items.filter(item => item.type === update.type);
    // Multiple matches remain unapplied by mergeExtraction; never select an arbitrary item.
    const known = matches.length === 1 ? matches[0] : undefined;
    const patch: ItemPatch = { type: update.type };
    write(patch, 'quantity', update.quantity, known?.quantity, `${update.type}.quantity`, quantity);
    if (update.type !== 'refrigerator' && update.sizeCategory.action !== 'keep') {
      invalid(`${update.type}.sizeCategory`);
    }
    write(patch, 'sizeCategory', update.sizeCategory, known?.sizeCategory, `${update.type}.sizeCategory`);
    const dimensions: NonNullable<ItemPatch['dimensions']> = {};
    for (const axis of ['width', 'height', 'depth'] as const) {
      write(dimensions, axis, update.dimensions[axis], known?.dimensions[axis], `${update.type}.${axis}`, positive);
    }
    if (Object.keys(dimensions).length) patch.dimensions = dimensions;
    for (const field of ['requiresDisassembly', 'requiresAssembly'] as const) {
      write(patch, field, update[field], known?.[field], `${update.type}.${field}`);
    }
    items.push(patch);
  }
  if (items.length) moveDetails.items = items;
  if (data.requestedDate.action !== 'keep') {
    let date: string | undefined;
    try { date = normalizeRequestedDate(data.requestedDate.value, context.referenceDate); }
    catch { invalid('requestedDate'); }
    if (date !== undefined) {
      write(moveDetails, 'requestedDate', { action: data.requestedDate.action, value: date },
        lead.moveDetails.requestedDate, 'requestedDate', isNormalizedDate);
    }
  }
  write(moveDetails, 'requestedTime', data.requestedTime, lead.moveDetails.requestedTime,
    'requestedTime', value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  write(moveDetails, 'specialAccessNotes', data.specialAccessNotes, lead.moveDetails.specialAccessNotes,
    'specialAccessNotes', nonblank);
  return Object.keys(moveDetails).length ? { moveDetails } : {};
}
