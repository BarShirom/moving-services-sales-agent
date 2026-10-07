import type { Lead } from '../lead.js';
import type { NextQuestion } from '../requirements/types.js';
import type { ExtractionResult } from '../extraction/types.js';
import { normalizeRequestedDate } from '../extraction/normalizeRequestedDate.js';

/** An unambiguous answer to the active date question needs no external extraction. */
export function extractDateReply(
  lead: Lead, text: string, lastQuestion?: NextQuestion, referenceDate?: string,
): ExtractionResult | undefined {
  if (lead.moveDetails.requestedDate !== null || lastQuestion?.requirements.length !== 1
    || lastQuestion.requirements[0].id !== 'requestedDate') return undefined;
  // Leave corrections, relative dates and compound messages to normal extraction.
  if (!/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}([/.])\d{1,2}(?:\1\d{4})?)$/.test(text.trim())) return undefined;
  // Calendar/reference validation errors propagate; do not accept or hide invalid dates.
  const requestedDate = normalizeRequestedDate(text, referenceDate);
  return requestedDate === undefined ? undefined : { moveDetails: { requestedDate } };
}
