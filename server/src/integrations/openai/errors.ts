import type { SafeZodIssue } from './diagnostics.js';
import { sanitizeValidationMetadata, schemaValidationMetadata, type ValidationMetadata } from './validationMetadata.js';

export type AIExtractionErrorCode =
  | 'MISSING_API_KEY'
  | 'REQUEST_FAILED'
  | 'NO_STRUCTURED_OUTPUT'
  | 'INVALID_EXTRACTION'
  | 'CONTEXT_TOO_LARGE';

export class AIExtractionError extends Error {
  readonly validationField: string;
  readonly validationRule: string;
  constructor(public readonly code: AIExtractionErrorCode, message: string,
    public readonly diagnosticIssues?: readonly SafeZodIssue[], validation?: ValidationMetadata) {
    super(message);
    this.name = 'AIExtractionError';
    const safe = validation === undefined ? schemaValidationMetadata(diagnosticIssues) : sanitizeValidationMetadata(validation);
    this.validationField = safe.validationField;
    this.validationRule = safe.validationRule;
  }
}
