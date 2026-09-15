export type AIExtractionErrorCode =
  | 'MISSING_API_KEY'
  | 'REQUEST_FAILED'
  | 'NO_STRUCTURED_OUTPUT'
  | 'INVALID_EXTRACTION'
  | 'CONTEXT_TOO_LARGE';

export class AIExtractionError extends Error {
  constructor(public readonly code: AIExtractionErrorCode, message: string) {
    super(message);
    this.name = 'AIExtractionError';
  }
}
