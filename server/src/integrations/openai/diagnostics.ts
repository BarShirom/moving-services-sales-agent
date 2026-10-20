import OpenAI from 'openai';
import { ZodError } from 'zod';
import { performance } from 'node:perf_hooks';
import { AIExtractionError } from './errors.js';
import { AIWindowError } from '../../safety/aiWindow.js';
import { ProtectionError } from '../../demo/protection.js';
import { sanitizeValidationMetadata, schemaValidationMetadata, VALIDATION_DOMAIN_PAIRS,
  type ValidationMetadata } from './validationMetadata.js';

export type FailureStage = 'configuration' | 'request_construction' | 'admission' | 'transport'
  | 'structured_parsing' | 'response_validation' | 'schema_validation' | 'domain_validation';
type Classification = 'http_error' | 'network' | 'tls' | 'timeout' | 'aborted' | 'invalid_json'
  | 'schema_validation' | 'domain_validation' | 'refusal' | 'incomplete_response' | 'failed_response'
  | 'missing_output' | 'missing_credential' | 'admission' | 'unknown';
export interface SafeZodIssue { readonly path: string; readonly code: string }
interface SafeError extends ValidationMetadata {
  classification: Classification;
  sdkErrorType: string | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  networkCode: string | null;
  zodIssues: readonly SafeZodIssue[];
}
export interface AIExtractionDiagnostic extends SafeError {
  readonly event: 'ai_extraction_failure';
  readonly stage: FailureStage;
  /** Current demo router mapping, not an observed wire status. */
  readonly localHttpStatus: number;
  readonly localHttpStatusSource: 'router_mapping';
  readonly providerHttpStatus: number | null;
  readonly providerRequestId: string | null;
  readonly elapsedMs: number;
  /** The SDK callback was invoked; this does not prove HTTP transmission. */
  readonly dispatchStarted: boolean;
  readonly providerResponseObserved: boolean;
  readonly providerOutcome: 'not_dispatched' | 'unknown' | 'http_rejected' | 'response_received';
  readonly windowReason: AIWindowError['reason'] | null;
}

const codes = new Set(['invalid_api_key', 'insufficient_permissions', 'permission_denied', 'model_not_found',
  'invalid_request_error', 'unsupported_parameter', 'invalid_value', 'insufficient_quota',
  'rate_limit_exceeded', 'server_error', 'internal_server_error', 'service_unavailable', 'context_length_exceeded']);
const types = new Set(['invalid_request_error', 'authentication_error', 'permission_error',
  'insufficient_quota', 'rate_limit_error', 'server_error', 'api_error']);
const networkCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_SSL_WRONG_VERSION_NUMBER']);
const issueCodes = new Set(['invalid_type', 'invalid_value', 'invalid_format', 'too_big', 'too_small',
  'not_multiple_of', 'unrecognized_keys', 'invalid_union', 'invalid_key', 'invalid_element', 'custom']);
const windowReasons = new Set(['disabled', 'invalid_configuration', 'invalid_permit', 'state_unavailable',
  'already_consumed', 'not_started', 'expired', 'clock_rollback', 'journal_failed', 'invalid_request',
  'budget_exhausted', 'busy', 'request_failed', 'extraction_failed', 'operator_stop', 'shutdown']);
const pathPatterns = [
  /^(pickup|dropoff)(\.(city|address|floor|elevator)(\.(action|value))?)?$/,
  /^items(\[\](\.(type|quantity|sizeCategory|photoStatus|dimensionsAvailable|requiresDisassembly|requiresAssembly)(\.(action|value))?|\.dimensions(\.(width|height|depth)(\.(action|value))?)?)?)?$/,
  /^(requestedDate|requestedTime|specialAccessNotes)(\.(action|value))?$/,
];
const domainPairs = new Set(VALIDATION_DOMAIN_PAIRS.map(([path, rule]) => `${path}\n${rule}`));
const unknownValidation = { validationField: 'unknown', validationRule: 'unknown' } as const;

// Read only own data properties. Never invoke arbitrary getters on an SDK error.
function field(value: unknown, name: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, name)?.value; } catch { return undefined; }
}
function allowed(value: unknown, values: Set<string>): string | null {
  return typeof value === 'string' && values.has(value) ? value : null;
}
function httpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function requestId(value: unknown): string | null {
  // Retain the observed provider format only; unknown formats remain unavailable.
  return typeof value === 'string' && value.length === 36 && /^req_[a-f0-9]{32}$/.test(value) ? value : null;
}
function schemaPath(value: unknown): string {
  return typeof value === 'string' && value.length <= 100
    && pathPatterns.some(pattern => pattern.exec(value)?.[0] === value) ? value : 'schema';
}
function issueList(value: unknown, rawPaths: boolean): readonly SafeZodIssue[] {
  const result: SafeZodIssue[] = [];
  if (!Array.isArray(value)) return Object.freeze(result);
  const length = field(value, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return Object.freeze(result);
  for (let i = 0; i < Math.min(length, 8); i++) {
    const issue = field(value, String(i)), raw = field(issue, 'path');
    let path: unknown = raw;
    if (rawPaths) {
      path = undefined;
      const size = Array.isArray(raw) ? field(raw, 'length') : undefined;
      if (typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 && size <= 8) {
        let normalized = '';
        for (let n = 0; n < size; n++) {
          const segment = field(raw, String(n));
          if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) normalized += '[]';
          else if (typeof segment === 'string' && segment.length <= 32) normalized += (normalized ? '.' : '') + segment;
          else { normalized = '?'; break; }
        }
        path = normalized;
      }
    }
    result.push(Object.freeze({ path: schemaPath(path), code: allowed(field(issue, 'code'), issueCodes) ?? 'unknown' }));
  }
  return Object.freeze(result);
}
export const safeZodIssues = (issues: readonly unknown[]): readonly SafeZodIssue[] => issueList(issues, true);

function errorMetadata(error: unknown): SafeError {
  const safe: SafeError = { classification: 'unknown', sdkErrorType: null, providerErrorCode: null,
    providerErrorType: null, networkCode: null, zodIssues: [], ...unknownValidation };
  if (error instanceof OpenAI.APIError) {
    const classes = [OpenAI.APIConnectionTimeoutError, OpenAI.APIUserAbortError, OpenAI.APIConnectionError,
      OpenAI.AuthenticationError, OpenAI.PermissionDeniedError, OpenAI.BadRequestError, OpenAI.NotFoundError,
      OpenAI.RateLimitError, OpenAI.InternalServerError, OpenAI.UnprocessableEntityError, OpenAI.ConflictError];
    const names = ['APIConnectionTimeoutError', 'APIUserAbortError', 'APIConnectionError', 'AuthenticationError',
      'PermissionDeniedError', 'BadRequestError', 'NotFoundError', 'RateLimitError', 'InternalServerError',
      'UnprocessableEntityError', 'ConflictError'];
    const index = classes.findIndex(type => error instanceof type);
    safe.sdkErrorType = index < 0 ? 'APIError' : names[index];
    safe.providerErrorCode = allowed(field(error, 'code'), codes);
    safe.providerErrorType = allowed(field(error, 'type'), types);
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause; depth++) {
      safe.networkCode ??= allowed(field(cause, 'code'), networkCodes);
      cause = field(cause, 'cause');
    }
    safe.classification = error instanceof OpenAI.APIConnectionTimeoutError ? 'timeout'
      : error instanceof OpenAI.APIUserAbortError ? 'aborted'
      : safe.networkCode && /TLS|CERT|SSL|VERIFY|SELF_SIGNED/.test(safe.networkCode) ? 'tls'
      : safe.networkCode && /TIMEOUT|TIMEDOUT/.test(safe.networkCode) ? 'timeout'
      : error instanceof OpenAI.APIConnectionError ? 'network'
      : httpStatus(field(error, 'status')) !== null ? 'http_error' : 'unknown';
  } else if (error instanceof ZodError) {
    safe.classification = 'schema_validation'; safe.zodIssues = issueList(field(error, 'issues'), true);
    Object.assign(safe, schemaValidationMetadata(safe.zodIssues));
  } else if (error instanceof SyntaxError) safe.classification = 'invalid_json';
  else if (error instanceof AIExtractionError) {
    const code = field(error, 'code'), issues = field(error, 'diagnosticIssues');
    safe.classification = code === 'MISSING_API_KEY' ? 'missing_credential'
      : code === 'INVALID_EXTRACTION' ? Array.isArray(issues) ? 'schema_validation' : 'domain_validation'
      : code === 'NO_STRUCTURED_OUTPUT' ? 'missing_output' : 'unknown';
    safe.zodIssues = issueList(issues, false);
    const validation = sanitizeValidationMetadata(error);
    if (safe.classification === 'domain_validation'
      && domainPairs.has(`${validation.validationField}\n${validation.validationRule}`)) Object.assign(safe, validation);
    if (safe.classification === 'schema_validation') {
      const expected = schemaValidationMetadata(safe.zodIssues);
      if (validation.validationField === expected.validationField && validation.validationRule === expected.validationRule) {
        Object.assign(safe, expected);
      }
    }
  } else if (error instanceof AIWindowError || error instanceof ProtectionError) safe.classification = 'admission';
  return safe;
}

/** Per-call metadata only; no prompt, response, error object or credential is retained. */
export function extractionDiagnostics(sink: (value: AIExtractionDiagnostic) => void = value => {
  console.warn(JSON.stringify(value)); // Server operator logs only, never an HTTP response.
}) {
  const started = performance.now();
  let stage: FailureStage = 'request_construction';
  let dispatchStarted = false, emitted = false;
  let providerHttpStatus: number | null = null, providerRequestId: string | null = null;
  let captured: SafeError | undefined;
  const capture = (error: unknown) => {
    if (captured || emitted) return;
    try {
      captured = errorMetadata(error);
      if (error instanceof OpenAI.APIError) {
        providerHttpStatus ??= httpStatus(field(error, 'status'));
        providerRequestId ??= requestId(field(error, 'requestID'));
      }
      if (captured.classification === 'schema_validation') stage = 'schema_validation';
      if (captured.classification === 'domain_validation') stage = 'domain_validation';
    } catch { /* Metadata cannot affect extraction or fail-closed behavior. */ }
  };
  return {
    stage(value: FailureStage) { if (!emitted) stage = value; },
    dispatch() { dispatchStarted = true; },
    response(status: unknown, id: unknown) {
      if (!emitted) { providerHttpStatus = httpStatus(status); providerRequestId = requestId(id); }
    },
    receipt() { return Object.freeze({ providerHttpStatus, providerRequestId }); },
    capture,
    classified(value: Classification) {
      if (!emitted) captured = { classification: value, sdkErrorType: null, providerErrorCode: null,
        providerErrorType: null, networkCode: null, zodIssues: [], ...unknownValidation };
    },
    failure(error: unknown) {
      if (emitted) return;
      try {
        capture(error); emitted = true;
        const localHttpStatus = error instanceof AIWindowError ? 503
          : error instanceof ProtectionError ? field(error, 'status') === 429 ? 429 : 503
          : error instanceof AIExtractionError && field(error, 'code') === 'MISSING_API_KEY' ? 503 : 502;
        const elapsed = performance.now() - started;
        const value: AIExtractionDiagnostic = Object.freeze({ event: 'ai_extraction_failure', stage,
          ...(captured ?? { classification: 'unknown', sdkErrorType: null, providerErrorCode: null,
            providerErrorType: null, networkCode: null, zodIssues: [], ...unknownValidation }),
          ...(dispatchStarted && captured?.classification === 'admission' ? { classification: 'aborted' as const } : {}),
          localHttpStatus, localHttpStatusSource: 'router_mapping', providerHttpStatus, providerRequestId,
          elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.min(600_000, Math.round(elapsed))) : 0,
          dispatchStarted, providerResponseObserved: providerHttpStatus !== null,
          providerOutcome: !dispatchStarted ? 'not_dispatched' : providerHttpStatus === null ? 'unknown'
            : providerHttpStatus >= 400 ? 'http_rejected' : 'response_received',
          windowReason: error instanceof AIWindowError
            ? allowed(field(error, 'reason'), windowReasons) as AIWindowError['reason'] | null : null });
        try { sink(value); } catch { /* Logging must never admit, retry, refund or alter a result. */ }
      } catch { emitted = true; /* Malformed metadata must not replace the original failure. */ }
    },
  };
}
