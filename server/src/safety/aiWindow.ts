import {
  accessSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, unlinkSync, writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import type { ResponseParseParams } from 'openai/resources/responses/responses';
import { sanitizeValidationMetadata } from '../integrations/openai/validationMetadata.js';

export const AI_WINDOW_PROJECT_ID = 'proj_0tblXq3MWcYw5VSdCOjx6mBT';
export const AI_WINDOW_LIMITS = Object.freeze({
  durationMs: 15 * 60_000, attempts: 10, requestBytes: 196_608,
  requestTimeoutMs: 30_000,
  outputTokens: 4_000, inputAllowance: 4_096,
  reservedUnits: 400_000, reservedMicros: 500_000,
});
export const PUBLIC_BETA_RELEASE_ID = 'moving-public-beta-20261020-r1';
/** Fixed reviewed container target; the host binds only this release's immutable source. */
export const PUBLIC_BETA_STATE_DIR = '/var/lib/moving-ai-window';
export const PUBLIC_BETA_LIMITS = Object.freeze({ attempts: 25, reservedMicros: 500_000,
  reservedUnits: 5_120_000, attemptsPerMinute: 3 });

/** Metadata only: the separately authorized operator must verify it against provider records. */
export interface AIWindowPermit {
  version: 1;
  windowId: string;
  startsAt: string;
  expiresAt: string;
  maxAttempts: number;
  maxReservedUnits: number;
  maxReservedMicros: number;
  projectId: typeof AI_WINDOW_PROJECT_ID;
  operatorApprovalRef: string;
  credentialKeyId: string;
  rotatedFromKeyId: string;
  credentialExpiresAt: string;
  rotationVerifiedAt: string;
}

/** Separate release policy; never reopens or changes a version-one trial. */
export interface PublicBetaPermit extends Omit<AIWindowPermit, 'version'> {
  version: 2;
  mode: 'public_beta';
  imageDigest: string;
}
type AdmissionPermit = AIWindowPermit | PublicBetaPermit;

export type AIWindowReason = 'disabled' | 'invalid_configuration' | 'invalid_permit'
  | 'state_unavailable' | 'already_consumed' | 'not_started' | 'expired' | 'clock_rollback'
  | 'journal_failed' | 'invalid_request' | 'budget_exhausted' | 'busy' | 'request_failed'
  | 'extraction_failed' | 'operator_stop' | 'shutdown' | 'rate_limited';

export class AIWindowError extends Error {
  readonly code = 'AI_WINDOW_CLOSED';
  constructor(readonly reason: AIWindowReason) {
    super('The limited AI window is unavailable.');
    this.name = 'AIWindowError';
  }
}

export interface AIWindowSnapshot {
  state: 'open' | 'closed';
  reason: AIWindowReason | null;
  windowId: string | null;
  expiresAt: string | null;
  attempts: number;
  reservedUnits: number;
  reservedMicros: number;
  active: boolean;
}

export interface AIWindow {
  run<T>(request: ResponseParseParams, dispatch: (signal: AbortSignal) => Promise<T>): Promise<T>;
  snapshot(): AIWindowSnapshot;
  close(reason?: AIWindowReason): void;
  /** Optional durable operator diagnostics; absent on legacy trial/test gates. */
  recordDiagnostic?(value: unknown): void;
  recordProviderReceipt?(value: { providerHttpStatus: number | null; providerRequestId: string | null }): void;
}

/** Injectable clocks and durability hooks are for offline fault tests, never environment options. */
export interface AIWindowOptions {
  stateDir: string;
  permitPath: string;
  wallNow?: () => number;
  monotonicNow?: () => number;
  syncFile?: (fd: number) => void;
  syncDirectory?: (directory: string) => void;
  scheduleWatchdog?: (check: () => void) => () => void;
  scheduleRequestTimeout?: (expire: () => void) => () => void;
}

function utc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) && new Date(result).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
    ? result : NaN;
}

function label(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@ -]{0,159}$/.test(value)
    && !/\bsk-/i.test(value);
}

function integer(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

export function validateAIWindowPermit(value: unknown): AIWindowPermit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIWindowError('invalid_permit');
  const permit = value as AIWindowPermit;
  const keys = new Set(['version', 'windowId', 'startsAt', 'expiresAt', 'maxAttempts', 'maxReservedUnits',
    'maxReservedMicros', 'projectId', 'operatorApprovalRef', 'credentialKeyId', 'rotatedFromKeyId',
    'credentialExpiresAt', 'rotationVerifiedAt']);
  const start = utc(permit.startsAt), end = utc(permit.expiresAt);
  const verified = utc(permit.rotationVerifiedAt), credentialEnd = utc(permit.credentialExpiresAt);
  if (Object.keys(permit).some(key => !keys.has(key)) || permit.version !== 1
    || typeof permit.windowId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(permit.windowId)
    || /sk-/i.test(permit.windowId)
    || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > AI_WINDOW_LIMITS.durationMs
    || !integer(permit.maxAttempts, AI_WINDOW_LIMITS.attempts)
    || !integer(permit.maxReservedUnits, AI_WINDOW_LIMITS.reservedUnits)
    || !integer(permit.maxReservedMicros, AI_WINDOW_LIMITS.reservedMicros)
    || permit.projectId !== AI_WINDOW_PROJECT_ID || !label(permit.operatorApprovalRef)
    || !label(permit.credentialKeyId) || !label(permit.rotatedFromKeyId)
    || permit.credentialKeyId === permit.rotatedFromKeyId
    || !Number.isFinite(verified) || verified > start || verified < start - 7 * 86_400_000
    || !Number.isFinite(credentialEnd) || credentialEnd < end + 86_400_000) {
    throw new AIWindowError('invalid_permit');
  }
  return Object.freeze({ ...permit });
}

export function validatePublicBetaPermit(value: unknown): PublicBetaPermit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIWindowError('invalid_permit');
  const permit = value as PublicBetaPermit;
  const keys = new Set(['version', 'mode', 'imageDigest', 'windowId', 'startsAt', 'expiresAt', 'maxAttempts',
    'maxReservedUnits', 'maxReservedMicros', 'projectId', 'operatorApprovalRef', 'credentialKeyId',
    'rotatedFromKeyId', 'credentialExpiresAt', 'rotationVerifiedAt']);
  const start = utc(permit.startsAt), end = utc(permit.expiresAt);
  const verified = utc(permit.rotationVerifiedAt), credentialEnd = utc(permit.credentialExpiresAt);
  if (Object.keys(permit).some(key => !keys.has(key)) || permit.version !== 2 || permit.mode !== 'public_beta'
    || permit.windowId !== PUBLIC_BETA_RELEASE_ID || !/^sha256:[a-f0-9]{64}$/.test(permit.imageDigest)
    || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > credentialEnd
    || !integer(permit.maxAttempts, PUBLIC_BETA_LIMITS.attempts)
    || !integer(permit.maxReservedUnits, PUBLIC_BETA_LIMITS.reservedUnits)
    || !integer(permit.maxReservedMicros, PUBLIC_BETA_LIMITS.reservedMicros)
    || permit.projectId !== AI_WINDOW_PROJECT_ID || !label(permit.operatorApprovalRef)
    || !label(permit.credentialKeyId) || !label(permit.rotatedFromKeyId)
    || permit.credentialKeyId === permit.rotatedFromKeyId
    || !Number.isFinite(verified) || verified > start || verified < start - 7 * 86_400_000
    || !Number.isFinite(credentialEnd)) throw new AIWindowError('invalid_permit');
  return Object.freeze({ ...permit });
}

/** Operator provisioning input only. Runtime admission requires this to exist already. */
export function publicBetaJournalHeader(permitValue: unknown): Record<string, unknown> {
  const permit = validatePublicBetaPermit(permitValue);
  return { event: 'release_authorized', version: 2, mode: 'public_beta', releaseId: permit.windowId,
    startsAt: permit.startsAt, expiresAt: permit.expiresAt, maxAttempts: permit.maxAttempts,
    maxReservedUnits: permit.maxReservedUnits, maxReservedMicros: permit.maxReservedMicros,
    projectId: permit.projectId, operatorApprovalRef: permit.operatorApprovalRef,
    credentialKeyId: permit.credentialKeyId, rotatedFromKeyId: permit.rotatedFromKeyId,
    credentialExpiresAt: permit.credentialExpiresAt, rotationVerifiedAt: permit.rotationVerifiedAt };
}

const betaStages = new Set(['configuration', 'request_construction', 'admission', 'transport',
  'structured_parsing', 'response_validation', 'schema_validation', 'domain_validation']);
const betaClassifications = new Set(['http_error', 'network', 'tls', 'timeout', 'aborted', 'invalid_json',
  'schema_validation', 'domain_validation', 'refusal', 'incomplete_response', 'failed_response',
  'missing_output', 'missing_credential', 'admission', 'unknown']);
const betaSDKTypes = new Set(['APIError', 'APIConnectionTimeoutError', 'APIUserAbortError', 'APIConnectionError',
  'AuthenticationError', 'PermissionDeniedError', 'BadRequestError', 'NotFoundError', 'RateLimitError',
  'InternalServerError', 'UnprocessableEntityError', 'ConflictError']);
const betaProviderCodes = new Set(['invalid_api_key', 'insufficient_permissions', 'permission_denied', 'model_not_found',
  'invalid_request_error', 'unsupported_parameter', 'invalid_value', 'insufficient_quota', 'rate_limit_exceeded',
  'server_error', 'internal_server_error', 'service_unavailable', 'context_length_exceeded']);
function betaDiagnostic(value: unknown): Record<string, unknown> {
  const own = (key: string): unknown => {
    try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; }
    catch { return undefined; }
  };
  const safe = (key: string, values: Set<string>) => {
    const raw = own(key); return typeof raw === 'string' && values.has(raw) ? raw : null;
  };
  const status = own('providerHttpStatus'), id = own('providerRequestId');
  return { event: 'ai_extraction_failure', stage: safe('stage', betaStages) ?? 'admission',
    classification: safe('classification', betaClassifications) ?? 'unknown',
    sdkErrorType: safe('sdkErrorType', betaSDKTypes), providerErrorCode: safe('providerErrorCode', betaProviderCodes),
    providerHttpStatus: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    providerRequestId: typeof id === 'string' && id.length === 36 && /^req_[a-f0-9]{32}$/.test(id) ? id : null,
    dispatchStarted: own('dispatchStarted') === true, ...sanitizeValidationMetadata(value) };
}

function directorySync(directory: string): void {
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function watchdog(check: () => void): () => void {
  const timer = setInterval(check, 100);
  timer.unref();
  return () => clearInterval(timer);
}

function requestTimeout(expire: () => void): () => void {
  const timer = setTimeout(expire, AI_WINDOW_LIMITS.requestTimeoutMs);
  timer.unref();
  return () => clearTimeout(timer);
}

function blocked(reason: AIWindowReason): AIWindow {
  return {
    run: async () => { throw new AIWindowError(reason); },
    snapshot: () => ({ state: 'closed', reason, windowId: null, expiresAt: null,
      attempts: 0, reservedUnits: 0, reservedMicros: 0, active: false }),
    close: () => {},
  };
}

/** Conservative accounting: no cache discounts, cache-write surcharge, 2x margin and 10% regional uplift. */
export function reserveAIWindowRequest(request: ResponseParseParams): { units: number; micros: number } {
  const allowed = new Set(['model', 'instructions', 'reasoning', 'service_tier', 'input', 'text', 'store', 'max_output_tokens']);
  const input = request.input;
  const first = Array.isArray(input) ? input[0] as { role?: unknown; content?: unknown } | undefined : undefined;
  const format = request.text?.format;
  if (Object.keys(request).some(key => !allowed.has(key))
    || request.model !== 'gpt-6-luna' || request.reasoning?.effort !== 'none'
    || Object.keys(request.reasoning ?? {}).some(key => key !== 'effort')
    || request.service_tier !== 'default' || request.store !== false
    || request.max_output_tokens !== AI_WINDOW_LIMITS.outputTokens
    || typeof request.instructions !== 'string' || !request.instructions
    || !Array.isArray(input) || input.length !== 1 || first?.role !== 'user'
    || typeof first.content !== 'string'
    || Object.keys(first).some(key => key !== 'role' && key !== 'content')
    || Object.keys(request.text ?? {}).some(key => key !== 'format')
    || format?.type !== 'json_schema' || format.strict !== true || !format.schema) {
    throw new AIWindowError('invalid_request');
  }
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
  if (bytes > AI_WINDOW_LIMITS.requestBytes) throw new AIWindowError('invalid_request');
  const inputReserve = bytes + AI_WINDOW_LIMITS.inputAllowance;
  return {
    units: inputReserve + AI_WINDOW_LIMITS.outputTokens,
    micros: Math.ceil((inputReserve * 225 + AI_WINDOW_LIMITS.outputTokens * 500) * 22 / 10_000),
  };
}

class DurableAIWindow implements AIWindow {
  private reason: AIWindowReason | null = null;
  private attempts = 0;
  private reservedUnits = 0;
  private reservedMicros = 0;
  private active: AbortController | null = null;
  private requestDeadline: number | null = null;
  private cancelWatchdog: () => void = () => {};
  private lastWall: number;
  private lastMonotonic: number;
  private readonly monotonicDeadline: number;
  private fd: number | null;
  private recentAttempts: number[] = [];

  constructor(private readonly permit: AdmissionPermit, fd: number, private readonly options: AIWindowOptions,
    initialWall: number, initialMonotonic: number,
    private readonly beta?: { attempts: number; units: number; micros: number; recentAttempts: number[];
      releaseOwner: () => void }) {
    this.fd = fd;
    if (beta) {
      this.attempts = beta.attempts; this.reservedUnits = beta.units; this.reservedMicros = beta.micros;
      this.recentAttempts = [...beta.recentAttempts];
    }
    this.lastWall = initialWall;
    this.lastMonotonic = initialMonotonic;
    this.monotonicDeadline = this.lastMonotonic + (utc(permit.expiresAt) - this.lastWall);
    this.cancelWatchdog = (options.scheduleWatchdog ?? watchdog)(() => this.check());
    this.check();
  }

  private wallNow(): number { return (this.options.wallNow ?? Date.now)(); }
  private monotonicNow(): number { return (this.options.monotonicNow ?? (() => performance.now()))(); }

  private append(event: Record<string, unknown>): boolean {
    if (this.fd === null) return false;
    try {
      const bytes = Buffer.from(JSON.stringify(event) + '\n', 'utf8');
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(this.fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('Incomplete journal write');
        offset += written;
      }
      (this.options.syncFile ?? fsyncSync)(this.fd);
      return true;
    } catch { this.stop('journal_failed', false); return false; }
  }

  private stop(reason: AIWindowReason, journal: boolean): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.cancelWatchdog();
    this.active?.abort();
    if (journal && !this.append({ event: 'closed', reason, at: this.wallNow() })) this.reason = 'journal_failed';
    if (this.fd !== null && (!this.beta || this.reason === 'shutdown')) {
      try { closeSync(this.fd); } catch { this.reason = 'journal_failed'; }
      this.fd = null;
    }
    // A successful graceful shutdown relinquishes only the ephemeral process lease.
    // Every ambiguous failure keeps it as evidence; no application stale-lock recovery exists.
    if (this.beta && this.reason === 'shutdown') {
      try { this.beta.releaseOwner(); } catch { this.reason = 'journal_failed'; }
    }
  }

  close(reason: AIWindowReason = 'operator_stop'): void {
    if (this.beta && this.reason !== null && reason === 'shutdown' && this.fd !== null) {
      try { closeSync(this.fd); } finally { this.fd = null; }
      return; // A latched/uncertain owner lease is deliberately retained.
    }
    this.stop(reason, true);
  }

  recordDiagnostic(value: unknown): void {
    if (!this.beta) return;
    const diagnostic = betaDiagnostic(value);
    if (!diagnostic.dispatchStarted || this.attempts === 0) return;
    if (this.fd === null || !this.append({ event: 'diagnostic', attempt: this.attempts,
      at: this.wallNow(), diagnostic })) throw new AIWindowError('journal_failed');
  }

  recordProviderReceipt(value: { providerHttpStatus: number | null; providerRequestId: string | null }): void {
    if (!this.beta || !this.active || this.attempts === 0) return;
    const safe = betaDiagnostic(value);
    if (safe.providerHttpStatus === null) return; // An injected fixture cannot invent an HTTP receipt.
    if (this.fd === null || !this.append({ event: 'provider_receipt', attempt: this.attempts, at: this.wallNow(),
      providerHttpStatus: safe.providerHttpStatus, providerRequestId: safe.providerRequestId })) {
      throw new AIWindowError('journal_failed');
    }
  }

  private check(): boolean {
    if (this.reason !== null) return false;
    const wall = this.wallNow(), monotonic = this.monotonicNow();
    if (!Number.isFinite(wall) || !Number.isFinite(monotonic) || wall < this.lastWall || monotonic < this.lastMonotonic) {
      this.stop('clock_rollback', true); return false;
    }
    this.lastWall = wall; this.lastMonotonic = monotonic;
    if (wall >= utc(this.permit.expiresAt) || monotonic >= this.monotonicDeadline) {
      this.stop('expired', true); return false;
    }
    if (this.active && this.requestDeadline !== null && monotonic >= this.requestDeadline) {
      this.stop('request_failed', true); return false;
    }
    return true;
  }

  snapshot(): AIWindowSnapshot {
    this.check();
    return { state: this.reason === null ? 'open' : 'closed', reason: this.reason,
      windowId: this.permit.windowId, expiresAt: this.permit.expiresAt,
      attempts: this.attempts, reservedUnits: this.reservedUnits, reservedMicros: this.reservedMicros,
      active: this.active !== null };
  }

  async run<T>(request: ResponseParseParams, dispatch: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.check()) throw new AIWindowError(this.reason!);
    if (this.active) throw new AIWindowError('busy');
    if (this.beta) {
      this.recentAttempts = this.recentAttempts.filter(at => at > this.wallNow() - 60_000);
      if (this.recentAttempts.length >= PUBLIC_BETA_LIMITS.attemptsPerMinute) throw new AIWindowError('rate_limited');
    }
    let reservation: ReturnType<typeof reserveAIWindowRequest>;
    try { reservation = reserveAIWindowRequest(request); }
    catch { this.close('invalid_request'); throw new AIWindowError('invalid_request'); }
    if (this.attempts >= this.permit.maxAttempts
      || this.reservedUnits + reservation.units > this.permit.maxReservedUnits
      || this.reservedMicros + reservation.micros > this.permit.maxReservedMicros) {
      this.close('budget_exhausted'); throw new AIWindowError('budget_exhausted');
    }
    const controller = new AbortController();
    this.active = controller;
    this.requestDeadline = this.monotonicNow() + AI_WINDOW_LIMITS.requestTimeoutMs;
    const attempt = ++this.attempts;
    if (this.beta) this.recentAttempts.push(this.wallNow());
    this.reservedUnits += reservation.units;
    this.reservedMicros += reservation.micros;
    const persisted = this.append({ event: 'attempt', attempt, at: this.wallNow(),
      reservedUnits: reservation.units, reservedMicros: reservation.micros,
      totalReservedUnits: this.reservedUnits, totalReservedMicros: this.reservedMicros });
    // Reservation is durable before dispatch; expiry/I/O/clock failure consumes it without dispatching.
    if (!persisted || !this.check()) {
      this.active = null;
      this.requestDeadline = null;
      throw new AIWindowError(this.reason ?? 'journal_failed');
    }
    let removeAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const listener = () => reject(new AIWindowError(this.reason ?? 'shutdown'));
      controller.signal.addEventListener('abort', listener, { once: true });
      removeAbort = () => controller.signal.removeEventListener('abort', listener);
    });
    let cancelRequestTimeout: () => void = () => {};
    try {
      // Subscribe to both promises before invoking user code: even a synchronous dispatch throw
      // must not leave an orphan rejection when closing the gate aborts the other branch.
      const completed = Promise.race([Promise.resolve().then(() => {
        if (!this.check() || controller.signal.aborted) throw new AIWindowError(this.reason ?? 'shutdown');
        return dispatch(controller.signal);
      }), aborted]);
      cancelRequestTimeout = (this.options.scheduleRequestTimeout ?? requestTimeout)(() => this.close('request_failed'));
      const result = await completed;
      if (!this.check()) throw new AIWindowError(this.reason!);
      if (!this.append({ event: 'outcome', attempt, at: this.wallNow(), outcome: 'returned' })) {
        throw new AIWindowError('journal_failed');
      }
      this.active = null;
      this.requestDeadline = null;
      if (this.attempts >= this.permit.maxAttempts || this.reservedUnits >= this.permit.maxReservedUnits
        || this.reservedMicros >= this.permit.maxReservedMicros) this.close('budget_exhausted');
      return result;
    } catch (error) {
      if (this.reason === null) {
        this.append({ event: 'outcome', attempt, at: this.wallNow(), outcome: 'failed' });
        // A separately initiated later beta request may use remaining allowance. There is
        // no retry in this call and no refund; legacy attended trials still latch closed.
        if (!this.beta) this.close('request_failed');
      }
      throw error instanceof AIWindowError ? error : new AIWindowError(this.reason ?? 'request_failed');
    } finally { cancelRequestTimeout(); removeAbort(); this.active = null; this.requestDeadline = null; }
  }
}

/** No mkdir, reset, resume, key reads or network. One state directory is consumed permanently. */
export function createAIWindow(options: AIWindowOptions): AIWindow {
  let fd: number | null = null;
  try {
    if (!isAbsolute(options.stateDir) || !isAbsolute(options.permitPath)) return blocked('invalid_configuration');
    const stateDir = resolve(options.stateDir), permitPath = resolve(options.permitPath);
    const relation = relative(stateDir, permitPath);
    if (!relation.startsWith('..') && !isAbsolute(relation)) return blocked('invalid_configuration');
    if (!lstatSync(stateDir).isDirectory() || realpathSync(stateDir) !== stateDir) return blocked('state_unavailable');
    if (!lstatSync(permitPath).isFile() || realpathSync(permitPath) !== permitPath) return blocked('invalid_permit');
    const permitFd = openSync(permitPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let permit: AIWindowPermit;
    try {
      const metadata = fstatSync(permitFd);
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16_384 || (metadata.mode & 0o222) !== 0) {
        return blocked('invalid_permit');
      }
      permit = validateAIWindowPermit(JSON.parse(readFileSync(permitFd, 'utf8')));
    } finally { closeSync(permitFd); }
    const now = (options.wallNow ?? Date.now)();
    const monotonic = (options.monotonicNow ?? (() => performance.now()))();
    if (!Number.isFinite(now) || !Number.isFinite(monotonic)) return blocked('invalid_configuration');
    if (now < utc(permit.startsAt)) return blocked('not_started');
    if (now >= utc(permit.expiresAt)) return blocked('expired');
    try { fd = openSync(resolve(stateDir, 'window.claim.jsonl'), 'wx', 0o600); }
    catch (error) { return blocked((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'already_consumed' : 'state_unavailable'); }
    const header = Buffer.from(JSON.stringify({ event: 'claimed', version: 1, windowId: permit.windowId,
      startsAt: permit.startsAt, expiresAt: permit.expiresAt, maxAttempts: permit.maxAttempts,
      maxReservedUnits: permit.maxReservedUnits, maxReservedMicros: permit.maxReservedMicros }) + '\n');
    let written = 0;
    while (written < header.length) {
      const count = writeSync(fd, header, written, header.length - written);
      if (count <= 0) throw new Error('Incomplete claim write');
      written += count;
    }
    (options.syncFile ?? fsyncSync)(fd);
    (options.syncDirectory ?? directorySync)(stateDir);
    const window = new DurableAIWindow(permit, fd, options, now, monotonic);
    fd = null; // DurableAIWindow owns it now, including when the deadline elapsed while syncing.
    return window;
  } catch (error) {
    if (fd !== null) { try { closeSync(fd); } catch { /* Claim remains consumed. */ } }
    return blocked(error instanceof AIWindowError ? error.reason : 'state_unavailable');
  }
}

interface BetaHistory { attempts: number; units: number; micros: number; lastAt: number;
  recentAttempts: number[]; terminal: AIWindowReason | null }

function betaHistory(bytes: string, permit: PublicBetaPermit): BetaHistory {
  if (!bytes.endsWith('\n') || Buffer.byteLength(bytes) > 262_144) throw new AIWindowError('state_unavailable');
  const lines = bytes.slice(0, -1).split('\n');
  if (lines.length < 1 || lines.length > 512 || !isDeepStrictEqual(JSON.parse(lines[0]), publicBetaJournalHeader(permit))) {
    throw new AIWindowError('state_unavailable');
  }
  const history: BetaHistory = { attempts: 0, units: 0, micros: 0, lastAt: utc(permit.startsAt),
    recentAttempts: [], terminal: null };
  let outcomeRecorded = false;
  const exact = (row: Record<string, unknown>, keys: string[]) =>
    Object.keys(row).sort().join(',') === keys.sort().join(',');
  for (const line of lines.slice(1)) {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.at)
      || (row.at as number) < history.lastAt || (history.terminal !== null && row.event !== 'diagnostic')) {
      throw new AIWindowError('state_unavailable');
    }
    history.lastAt = row.at as number;
    if (row.event === 'opened' && exact(row, ['event', 'at', 'imageDigest'])
      && typeof row.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(row.imageDigest)) continue;
    if (row.event === 'attempt' && exact(row, ['event', 'attempt', 'at', 'reservedUnits', 'reservedMicros',
      'totalReservedUnits', 'totalReservedMicros']) && row.attempt === history.attempts + 1
      && integer(row.reservedUnits, AI_WINDOW_LIMITS.requestBytes + AI_WINDOW_LIMITS.inputAllowance + AI_WINDOW_LIMITS.outputTokens)
      && row.reservedUnits > AI_WINDOW_LIMITS.outputTokens
      && row.reservedMicros === Math.ceil(((row.reservedUnits - AI_WINDOW_LIMITS.outputTokens) * 225
        + AI_WINDOW_LIMITS.outputTokens * 500) * 22 / 10_000)
      && row.totalReservedUnits === history.units + row.reservedUnits
      && row.totalReservedMicros === history.micros + row.reservedMicros) {
      history.attempts++; history.units = row.totalReservedUnits as number; history.micros = row.totalReservedMicros as number;
      if (history.attempts > permit.maxAttempts || history.units > permit.maxReservedUnits
        || history.micros > permit.maxReservedMicros) throw new AIWindowError('state_unavailable');
      history.recentAttempts.push(history.lastAt); outcomeRecorded = false; continue;
    }
    if (row.event === 'outcome' && exact(row, ['event', 'attempt', 'at', 'outcome']) && history.attempts > 0
      && row.attempt === history.attempts && !outcomeRecorded && ['returned', 'failed'].includes(String(row.outcome))) {
      outcomeRecorded = true; continue;
    }
    if (row.event === 'diagnostic' && exact(row, ['event', 'attempt', 'at', 'diagnostic'])
      && history.attempts > 0 && row.attempt === history.attempts
      && isDeepStrictEqual(row.diagnostic, betaDiagnostic(row.diagnostic))) continue;
    if (row.event === 'provider_receipt' && exact(row, ['event', 'attempt', 'at', 'providerHttpStatus', 'providerRequestId'])
      && history.attempts > 0 && row.attempt === history.attempts && Number.isInteger(row.providerHttpStatus)
      && (row.providerHttpStatus as number) >= 100 && (row.providerHttpStatus as number) <= 599
      && (row.providerRequestId === null || (typeof row.providerRequestId === 'string'
        && row.providerRequestId.length === 36 && /^req_[a-f0-9]{32}$/.test(row.providerRequestId)))) continue;
    if (row.event === 'closed' && exact(row, ['event', 'reason', 'at']) && typeof row.reason === 'string'
      && ['shutdown', 'operator_stop', 'budget_exhausted', 'clock_rollback', 'journal_failed', 'invalid_request',
        'expired', 'request_failed', 'extraction_failed'].includes(row.reason)) {
      if (row.reason !== 'shutdown') history.terminal = row.reason as AIWindowReason;
      continue;
    }
    throw new AIWindowError('state_unavailable');
  }
  return history;
}

/** Resume one explicitly provisioned release; never creates a journal, authorization or allowance. */
export function createPublicBeta(options: AIWindowOptions, expectedImageDigest: string): AIWindow {
  let fd: number | null = null, ownerFd: number | null = null;
  try {
    if (!isAbsolute(options.stateDir) || !isAbsolute(options.permitPath)) return blocked('invalid_configuration');
    const stateDir = resolve(options.stateDir), permitPath = resolve(options.permitPath);
    const relation = relative(stateDir, permitPath);
    if (!relation.startsWith('..') && !isAbsolute(relation)) return blocked('invalid_configuration');
    if (!lstatSync(stateDir).isDirectory() || realpathSync(stateDir) !== stateDir) return blocked('state_unavailable');
    if (!lstatSync(permitPath).isFile() || realpathSync(permitPath) !== permitPath) return blocked('invalid_permit');
    const permitFd = openSync(permitPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let permit: PublicBetaPermit;
    try {
      const metadata = fstatSync(permitFd);
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16_384 || (metadata.mode & 0o222) !== 0) {
        return blocked('invalid_permit');
      }
      permit = validatePublicBetaPermit(JSON.parse(readFileSync(permitFd, 'utf8')));
    } finally { closeSync(permitFd); }
    if (permit.imageDigest !== expectedImageDigest) return blocked('invalid_permit');
    const now = (options.wallNow ?? Date.now)(), monotonic = (options.monotonicNow ?? (() => performance.now()))();
    if (!Number.isFinite(now) || !Number.isFinite(monotonic)) return blocked('invalid_configuration');
    if (now < utc(permit.startsAt)) return blocked('not_started');
    if (now >= utc(permit.expiresAt)) return blocked('expired');
    const journalPath = resolve(stateDir, 'release.claim.jsonl'), ownerPath = resolve(stateDir, 'release.owner.json');
    if (!lstatSync(journalPath).isFile() || realpathSync(journalPath) !== journalPath) return blocked('state_unavailable');
    accessSync(journalPath, constants.W_OK);
    fd = openSync(journalPath, constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
    const journalStat = fstatSync(fd);
    if (!journalStat.isFile() || journalStat.nlink !== 1 || (journalStat.mode & 0o222) === 0
      || journalStat.size > 262_144) throw new AIWindowError('state_unavailable');
    // Acquire a permanent-on-uncertainty lease before replay, so no second writer can
    // race the audited totals. Only a successfully fsynced graceful shutdown removes it.
    try { ownerFd = openSync(ownerPath, 'wx', 0o600); }
    catch (error) { throw new AIWindowError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'already_consumed' : 'state_unavailable'); }
    const owner = Buffer.from(JSON.stringify({ version: 1, releaseId: permit.windowId, pid: process.pid,
      at: now, journalHeaderSha256: createHash('sha256').update(JSON.stringify(publicBetaJournalHeader(permit))).digest('hex') }) + '\n');
    let offset = 0;
    while (offset < owner.length) {
      const count = writeSync(ownerFd, owner, offset, owner.length - offset);
      if (count <= 0) throw new AIWindowError('journal_failed'); offset += count;
    }
    (options.syncFile ?? fsyncSync)(ownerFd);
    (options.syncDirectory ?? directorySync)(stateDir);
    const ownerIdentity = fstatSync(ownerFd); closeSync(ownerFd); ownerFd = null;
    const history = betaHistory(readFileSync(fd, 'utf8'), permit);
    if (now < history.lastAt) throw new AIWindowError('clock_rollback');
    if (history.terminal) throw new AIWindowError(history.terminal);
    if (history.attempts >= permit.maxAttempts || history.units >= permit.maxReservedUnits
      || history.micros >= permit.maxReservedMicros) throw new AIWindowError('budget_exhausted');
    const opening = Buffer.from(JSON.stringify({ event: 'opened', at: now, imageDigest: permit.imageDigest }) + '\n');
    let written = 0;
    while (written < opening.length) {
      const count = writeSync(fd, opening, written, opening.length - written);
      if (count <= 0) throw new AIWindowError('journal_failed'); written += count;
    }
    (options.syncFile ?? fsyncSync)(fd);
    const beta = new DurableAIWindow(permit, fd, options, now, monotonic, { ...history,
      releaseOwner: () => {
        const current = lstatSync(ownerPath);
        if (!current.isFile() || current.dev !== ownerIdentity.dev || current.ino !== ownerIdentity.ino
          || current.nlink !== 1) throw new AIWindowError('journal_failed');
        unlinkSync(ownerPath); (options.syncDirectory ?? directorySync)(stateDir);
      } });
    fd = null;
    return beta;
  } catch (error) {
    if (fd !== null) { try { closeSync(fd); } catch { /* Evidence remains. */ } }
    if (ownerFd !== null) { try { closeSync(ownerFd); } catch { /* Evidence remains. */ } }
    return blocked(error instanceof AIWindowError ? error.reason : 'state_unavailable');
  }
}

export function createAIWindowFromEnv(env: NodeJS.ProcessEnv = process.env): AIWindow {
  if (env.AI_WINDOW_MODE === 'public_beta') {
    if (env.DEMO_AI_REQUESTS_PER_DAY === '0' || env.DEMO_AI_RESERVED_TOKENS_PER_DAY === '0') return blocked('disabled');
    if (env.AI_WINDOW_STATE_DIR !== PUBLIC_BETA_STATE_DIR || !env.AI_WINDOW_PERMIT_PATH || env.AI_PUBLIC_BETA_RELEASE_ID !== PUBLIC_BETA_RELEASE_ID
      || !env.AI_PUBLIC_BETA_IMAGE_DIGEST || env.OPENAI_PROJECT_ID !== AI_WINDOW_PROJECT_ID
      || env.OPENAI_MODEL !== 'gpt-6-luna' || !!env.OPENAI_BASE_URL || env.DEMO_AI_CONCURRENCY !== '1'
      || env.DEMO_AI_REQUESTS_PER_MINUTE !== '3' || env.DEMO_AI_REQUESTS_PER_DAY !== '25'
      || env.DEMO_AI_RESERVED_TOKENS_PER_DAY !== String(PUBLIC_BETA_LIMITS.reservedUnits)) return blocked('invalid_configuration');
    return createPublicBeta({ stateDir: env.AI_WINDOW_STATE_DIR, permitPath: env.AI_WINDOW_PERMIT_PATH }, env.AI_PUBLIC_BETA_IMAGE_DIGEST);
  }
  if (env.AI_WINDOW_MODE !== 'armed') return blocked('disabled');
  if (env.DEMO_AI_REQUESTS_PER_DAY === '0' || env.DEMO_AI_RESERVED_TOKENS_PER_DAY === '0') return blocked('disabled');
  const dailyAttempts = env.DEMO_AI_REQUESTS_PER_DAY ?? '';
  const dailyUnits = env.DEMO_AI_RESERVED_TOKENS_PER_DAY ?? '';
  if (!env.AI_WINDOW_STATE_DIR || !env.AI_WINDOW_PERMIT_PATH
    || env.OPENAI_PROJECT_ID !== AI_WINDOW_PROJECT_ID || env.OPENAI_MODEL !== 'gpt-6-luna'
    || !/^\d+$/.test(dailyAttempts) || !integer(Number(dailyAttempts), AI_WINDOW_LIMITS.attempts)
    || !/^\d+$/.test(dailyUnits) || !integer(Number(dailyUnits), AI_WINDOW_LIMITS.reservedUnits)
    || !!env.OPENAI_BASE_URL) {
    return blocked('invalid_configuration');
  }
  return createAIWindow({ stateDir: env.AI_WINDOW_STATE_DIR, permitPath: env.AI_WINDOW_PERMIT_PATH });
}
