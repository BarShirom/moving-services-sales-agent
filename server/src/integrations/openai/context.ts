import { isNormalizedDate } from '../../domain/extraction/normalizeRequestedDate.js';
import type { MessageExtractionInput } from '../../domain/conversation/processCustomerMessage.js';
import { AIExtractionError } from './errors.js';

export const EXTRACTION_CONTEXT_LIMITS = {
  latestMessageChars: 4_000,
  recentMessages: 6,
  historyMessageChars: 2_000,
  structuredStateChars: 24_000,
  questionChars: 1_000,
  totalChars: 48_000,
} as const;

export function buildExtractionContext({ lead, text, lastQuestion, referenceDate }: MessageExtractionInput) {
  if (referenceDate !== undefined && !isNormalizedDate(referenceDate)) {
    throw new AIExtractionError('INVALID_EXTRACTION', 'Reference date must be a real YYYY-MM-DD calendar date.');
  }
  const limits = EXTRACTION_CONTEXT_LIMITS;
  if (text.length > limits.latestMessageChars
    || JSON.stringify(lead.moveDetails).length > limits.structuredStateChars
    || (lastQuestion && (lastQuestion.text.length > limits.questionChars || lastQuestion.requirements.length > 3))) {
    throw new AIExtractionError('CONTEXT_TOO_LARGE', 'Extraction input exceeds the bounded context limits.');
  }
  // Keep whole messages. Truncating a sentence could remove a correction or negation.
  const window = lead.messages.slice(-limits.recentMessages);
  const recentMessages = window
    .filter(message => message.text.length <= limits.historyMessageChars)
    .map(({ sender, text: messageText }) => ({ sender, text: messageText }));
  const result = {
    currentLead: { moveDetails: structuredClone(lead.moveDetails) },
    recentMessages,
    historyOmitted: lead.messages.length !== recentMessages.length,
    lastQuestion: lastQuestion ? structuredClone(lastQuestion) : null,
    latestCustomerMessage: text,
    // No implicit clock or record timestamps. Only the application-supplied calendar reference.
    referenceDate: referenceDate ?? null,
    relativeDatesSupported: false,
  };
  if (JSON.stringify(result).length > limits.totalChars) {
    throw new AIExtractionError('CONTEXT_TOO_LARGE', 'Extraction context exceeds the total size limit.');
  }
  return result;
}
