/** Fixed diagnostic vocabulary. No customer values or error messages belong here. */
export interface ValidationMetadata { readonly validationField: string; readonly validationRule: string }
export const VALIDATION_SCHEMA_CODES = Object.freeze(['invalid_type', 'invalid_value', 'invalid_format', 'too_big',
  'too_small', 'not_multiple_of', 'unrecognized_keys', 'invalid_union', 'invalid_key', 'invalid_element', 'custom'] as const);
const locations = ['pickup', 'dropoff'] as const;
const locationFields = ['city', 'address', 'floor', 'elevator'] as const;
const itemFields = ['quantity', 'sizeCategory', 'photoStatus', 'dimensionsAvailable',
  'requiresDisassembly', 'requiresAssembly'] as const;
const axes = ['width', 'height', 'depth'] as const;
const moveFields = ['requestedDate', 'requestedTime', 'specialAccessNotes'] as const;
const updates = (field: string) => [field, `${field}.action`, `${field}.value`];
export const VALIDATION_SCHEMA_FIELDS: readonly string[] = Object.freeze([
  'schema', ...locations, ...locations.flatMap(side => locationFields.flatMap(key => updates(`${side}.${key}`))),
  'items', 'items[]', 'items[].type', ...itemFields.flatMap(key => updates(`items[].${key}`)), 'items[].dimensions',
  ...axes.flatMap(axis => updates(`items[].dimensions.${axis}`)), ...moveFields.flatMap(updates),
]);
const writeFields = [
  ...locations.flatMap(side => locationFields.map(key => `${side}.${key}`)),
  'items[].quantity', 'items[].sizeCategory', 'items[].dimensionsAvailable',
  ...axes.map(axis => `items[].dimensions.${axis}`), 'items[].requiresDisassembly', 'items[].requiresAssembly', ...moveFields,
];
export const VALIDATION_DOMAIN_PAIRS: readonly (readonly [string, string])[] = Object.freeze([
  ...locations.flatMap(side => ['city', 'address'].map(key => [`${side}.${key}`, 'nonblank_text'] as const)),
  ['specialAccessNotes', 'nonblank_text'], ...locations.map(side => [`${side}.floor`, 'safe_integer'] as const),
  ['items[].quantity', 'positive_integer'],
  ...axes.map(axis => [`items[].dimensions.${axis}`, 'positive_finite_number'] as const),
  ['items[].type', 'unique_item_type'], ['items[].sizeCategory', 'refrigerator_only'],
  ['items[].photoStatus', 'photo_state_editable'], ['requestedDate', 'date_normalization'],
  ['requestedDate', 'normalized_calendar_date'], ['requestedTime', 'time_hh_mm'],
  ...writeFields.map(field => [field, 'explicit_correction_required'] as const),
].map(pair => Object.freeze(pair) as readonly [string, string]));
export const VALIDATION_FIELD_RULE_PAIRS: readonly (readonly [string, string])[] = Object.freeze([
  Object.freeze(['unknown', 'unknown'] as const), ...VALIDATION_DOMAIN_PAIRS,
  ...VALIDATION_SCHEMA_FIELDS.flatMap(field => VALIDATION_SCHEMA_CODES.map(code => Object.freeze([field, `schema_${code}`] as const))),
]);
const pairs = new Set(VALIDATION_FIELD_RULE_PAIRS.map(([field, rule]) => `${field}\n${rule}`));
const unknown: ValidationMetadata = Object.freeze({ validationField: 'unknown', validationRule: 'unknown' });
function own(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
export function sanitizeValidationMetadata(value: unknown): ValidationMetadata {
  const validationField = own(value, 'validationField'), validationRule = own(value, 'validationRule');
  return typeof validationField === 'string' && validationField.length <= 100
    && typeof validationRule === 'string' && validationRule.length <= 64 && pairs.has(`${validationField}\n${validationRule}`)
    ? Object.freeze({ validationField, validationRule }) : unknown;
}
/** Input is the already bounded/normalized issue list, never an arbitrary message. */
export function schemaValidationMetadata(issues: unknown): ValidationMetadata {
  try { if (!Array.isArray(issues)) return unknown; } catch { return unknown; }
  const length = own(issues, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > 8) return unknown;
  const first = own(issues, '0'), path = own(first, 'path'), code = own(first, 'code');
  return typeof code === 'string' ? sanitizeValidationMetadata({ validationField: path, validationRule: `schema_${code}` }) : unknown;
}
