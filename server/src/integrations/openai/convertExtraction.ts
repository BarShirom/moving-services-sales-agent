import { isNormalizedDate, normalizeRequestedDate } from '../../domain/extraction/normalizeRequestedDate.js';
export { isNormalizedDate } from '../../domain/extraction/normalizeRequestedDate.js';
import type { Lead } from '../../domain/lead.js';
import type { ExtractionResult, ItemPatch, LocationPatch } from '../../domain/extraction/types.js';
import { AIExtractionError } from './errors.js';
import { AIExtractionSchema, type FieldUpdate } from './schema.js';
import { safeZodIssues } from './diagnostics.js';

function invalid(path: string, validationField: string, validationRule: string): never {
  // Paths only: do not expose customer text or raw provider output in errors.
  throw new AIExtractionError('INVALID_EXTRACTION', `Invalid AI extraction at ${path}.`, undefined,
    { validationField, validationRule });
}

function write<T>(
  target: object, key: string, update: FieldUpdate<T>, known: unknown,
  path: string, validationField: string, valid: (value: T) => boolean = () => true, validationRule = 'unknown',
): void {
  if (update.action === 'keep') return;
  if (!valid(update.value)) invalid(path, validationField, validationRule);
  if (known !== null && known !== undefined && known !== update.value && update.action !== 'correct') {
    invalid(`${path} (overwriting a known value requires an explicit correction)`, validationField, 'explicit_correction_required');
  }
  Object.assign(target, { [key]: update.value });
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const quantity = (value: number) => Number.isSafeInteger(value) && value > 0;
const nonblank = (value: string) => value.trim().length > 0 && value.length <= 2_000;

export function convertAIExtraction(output: unknown, lead: Lead, context: { referenceDate?: string } = {}): ExtractionResult {
  const parsed = AIExtractionSchema.safeParse(output);
  if (!parsed.success) throw new AIExtractionError('INVALID_EXTRACTION', 'Invalid AI extraction at schema.', safeZodIssues(parsed.error.issues));
  const data = parsed.data;
  const moveDetails: NonNullable<ExtractionResult['moveDetails']> = {};
  for (const side of ['pickup', 'dropoff'] as const) {
    const patch: LocationPatch = {};
    const known = lead.moveDetails[side];
    write(patch, 'city', data[side].city, known.city, `${side}.city`, `${side}.city`, nonblank, 'nonblank_text');
    write(patch, 'address', data[side].address, known.address, `${side}.address`, `${side}.address`, nonblank, 'nonblank_text');
    write(patch, 'floor', data[side].floor, known.floor, `${side}.floor`, `${side}.floor`, Number.isSafeInteger, 'safe_integer');
    write(patch, 'elevator', data[side].elevator, known.elevator, `${side}.elevator`, `${side}.elevator`);
    if (Object.keys(patch).length) moveDetails[side] = patch;
  }
  const items: ItemPatch[] = [];
  const seen = new Set<string>();
  for (const update of data.items) {
    if (seen.has(update.type)) invalid('items (duplicate item type)', 'items[].type', 'unique_item_type');
    seen.add(update.type);
    const matches = lead.moveDetails.items.filter(item => item.type === update.type);
    // Multiple matches remain unapplied by mergeExtraction; never select an arbitrary item.
    const known = matches.length === 1 ? matches[0] : undefined;
    const patch: ItemPatch = { type: update.type };
    write(patch, 'quantity', update.quantity, known?.quantity, `${update.type}.quantity`, 'items[].quantity', quantity, 'positive_integer');
    if (update.type !== 'refrigerator' && update.sizeCategory.action !== 'keep') {
      invalid(`${update.type}.sizeCategory`, 'items[].sizeCategory', 'refrigerator_only');
    }
    write(patch, 'sizeCategory', update.sizeCategory, known?.sizeCategory, `${update.type}.sizeCategory`, 'items[].sizeCategory');
    write(patch, 'dimensionsAvailable', update.dimensionsAvailable, known?.dimensionsAvailable, `${update.type}.dimensionsAvailable`, 'items[].dimensionsAvailable');
    // REQUIRED is a request, not a customer-provided availability fact. Receipt and
    // non-applicability remain application-owned; text cannot undo them.
    if (update.photoStatus.action !== 'keep') {
      if (known && !['REQUIRED', 'NOT_AVAILABLE'].includes(known.photoStatus)) invalid(`${update.type}.photoStatus`, 'items[].photoStatus', 'photo_state_editable');
      patch.photoStatus = update.photoStatus.value;
    }
    const dimensions: NonNullable<ItemPatch['dimensions']> = {};
    for (const axis of ['width', 'height', 'depth'] as const) {
      write(dimensions, axis, update.dimensions[axis], known?.dimensions[axis], `${update.type}.${axis}`,
        `items[].dimensions.${axis}`, positive, 'positive_finite_number');
    }
    if (Object.keys(dimensions).length) patch.dimensions = dimensions;
    for (const field of ['requiresDisassembly', 'requiresAssembly'] as const) {
      write(patch, field, update[field], known?.[field], `${update.type}.${field}`, `items[].${field}`);
    }
    items.push(patch);
  }
  if (items.length) moveDetails.items = items;
  if (data.requestedDate.action !== 'keep') {
    let date: string | undefined;
    try { date = normalizeRequestedDate(data.requestedDate.value, context.referenceDate); }
    catch { invalid('requestedDate', 'requestedDate', 'date_normalization'); }
    if (date !== undefined) {
      write(moveDetails, 'requestedDate', { action: data.requestedDate.action, value: date },
        lead.moveDetails.requestedDate, 'requestedDate', 'requestedDate', isNormalizedDate, 'normalized_calendar_date');
    }
  }
  write(moveDetails, 'requestedTime', data.requestedTime, lead.moveDetails.requestedTime,
    'requestedTime', 'requestedTime', value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'time_hh_mm');
  write(moveDetails, 'specialAccessNotes', data.specialAccessNotes, lead.moveDetails.specialAccessNotes,
    'specialAccessNotes', 'specialAccessNotes', nonblank, 'nonblank_text');
  return Object.keys(moveDetails).length ? { moveDetails } : {};
}
