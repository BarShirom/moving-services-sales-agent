// Calendar-only values: this module never reads the wall clock or chooses a time zone.
export function isNormalizedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeRequestedDate(value: string, referenceDate?: string): string | undefined {
  if (referenceDate !== undefined && !isNormalizedDate(referenceDate)) {
    throw new RangeError('Reference date must be a real YYYY-MM-DD calendar date.');
  }
  const text = value.trim();
  if (isNormalizedDate(text)) return text;
  const match = /^(\d{1,2})([/.])(\d{1,2})(?:\2(\d{4}))?$/.exec(text);
  if (!match) throw new RangeError('Unsupported requested date.');
  const dayMonth = `${match[3].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  // Validate the month/day independently, using a leap year so 29/02 remains possible.
  if (!isNormalizedDate(`2000-${dayMonth}`)) throw new RangeError('Invalid day or month.');
  let year = match[4];
  if (!year) {
    if (!referenceDate) return undefined; // An incomplete year needs explicit application context.
    const referenceYear = Number(referenceDate.slice(0, 4));
    year = String(referenceYear + (dayMonth < referenceDate.slice(5) ? 1 : 0)).padStart(4, '0');
  }
  const normalized = `${year}-${dayMonth}`;
  if (!isNormalizedDate(normalized)) throw new RangeError('Invalid date in the selected year.');
  return normalized;
}
