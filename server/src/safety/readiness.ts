import { z } from 'zod';

export const READINESS_PROJECT_ID = 'proj_0tblXq3MWcYw5VSdCOjx6mBT';
const DAY_MS = 86_400_000;
const WINDOW_MS = 15 * 60_000;
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/).refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value;
});
const label = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._ /:#-]*$/);
const keyId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const money = z.number().finite().nonnegative();
const attestation = { status: z.literal('verified'), verifiedAt: utc, operator: label, sourceReference: label };
const schema = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.literal(READINESS_PROJECT_ID),
  reservationBudgetUsd: money.positive().max(0.50),
  credential: z.strictObject({
    ...attestation, oldKeyId: keyId, reportedOldExpiryDate: z.literal('2026-10-22'),
    oldActualExpiresAt: utc, replacementKeyId: keyId, replacementCreatedAt: utc,
    replacementExpiresAt: utc, installedKeyId: keyId, runtimeKeyId: keyId,
    runtimeClientRecreatedAt: utc, zeroQuotasVerifiedAt: utc,
    dailyCallAllowance: z.literal(0), dailyTokenAllowance: z.literal(0),
    oldKeyRevokedAt: utc, scopeReviewedAt: utc,
  }),
  billing: z.strictObject({
    ...attestation, organizationHardLimitUsd: z.literal(5), organizationHardLimitEnforced: z.literal(true),
    projectHardLimitUsd: z.literal(5), projectHardLimitEnforced: z.literal(true),
    cycleStartsAt: utc, cycleEndsAt: utc, organizationCycleRemainingUsd: money.max(5),
    projectCycleRemainingUsd: money.max(5), creditBalanceUsd: money, creditExpiresAt: utc,
    autoRechargeEnabled: z.literal(false),
  }),
});

export type ReadinessEvidence = z.infer<typeof schema>;
export type ReadinessResult = { ready: boolean; errors: string[] };

/** Offline consistency check only: attestations do not prove account state or credential validity.
 * Never reads secrets, account APIs, env files, or the network; never performs a paid key probe.
 * Callers must supply independently reviewed metadata and must never log the input record.
 */
export function validateReadiness(record: unknown, nowMs: number): ReadinessResult {
  const fail = (error: string): ReadinessResult => ({ ready: false, errors: [error] });
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isFinite(new Date(nowMs).getTime())) return fail('CLOCK_INVALID');
  try {
    const serialized = JSON.stringify(record);
    if (!serialized || serialized.length > 16_384) return fail('EVIDENCE_SCHEMA_INVALID');
    if (/sk-|bearer\s|-----BEGIN[^\n]*PRIVATE KEY/i.test(serialized)) return fail('SECRET_MATERIAL_FORBIDDEN');
  } catch { return fail('EVIDENCE_SCHEMA_INVALID'); }
  const parsed = schema.safeParse(record);
  if (!parsed.success) return fail('EVIDENCE_SCHEMA_INVALID');
  const { credential: c, billing: b, reservationBudgetUsd: budget } = parsed.data;
  const errors: string[] = [];
  const require = (condition: boolean, code: string) => { if (!condition) errors.push(code); };
  const at = (value: string) => Date.parse(value);
  const fresh = (value: string) => at(value) <= nowMs && nowMs - at(value) <= DAY_MS;
  require(fresh(c.verifiedAt) && fresh(b.verifiedAt), 'EVIDENCE_STALE_OR_FUTURE');
  require(c.oldKeyId !== c.replacementKeyId, 'REPLACEMENT_MUST_DIFFER');
  require(c.installedKeyId === c.replacementKeyId && c.runtimeKeyId === c.replacementKeyId, 'REPLACEMENT_NOT_CONFIRMED_IN_RUNTIME');
  require(c.oldActualExpiresAt.slice(0, 10) === c.reportedOldExpiryDate, 'REPORTED_OLD_EXPIRY_MISMATCH');
  require(at(c.replacementCreatedAt) < at(c.oldActualExpiresAt) &&
    at(c.runtimeClientRecreatedAt) < at(c.oldActualExpiresAt) && at(c.oldKeyRevokedAt) < at(c.oldActualExpiresAt), 'ROTATION_AFTER_OLD_EXPIRY');
  require(at(c.replacementCreatedAt) <= at(c.runtimeClientRecreatedAt) &&
    at(c.runtimeClientRecreatedAt) <= at(c.zeroQuotasVerifiedAt) &&
    at(c.runtimeClientRecreatedAt) <= at(c.oldKeyRevokedAt) &&
    [c.replacementCreatedAt, c.runtimeClientRecreatedAt, c.zeroQuotasVerifiedAt, c.oldKeyRevokedAt, c.scopeReviewedAt]
      .every(value => at(value) <= at(c.verifiedAt)), 'CREDENTIAL_TIMELINE_INVALID');
  require(fresh(c.zeroQuotasVerifiedAt) && fresh(c.scopeReviewedAt), 'RUNTIME_OR_SCOPE_EVIDENCE_STALE');
  require(at(c.replacementExpiresAt) > nowMs + WINDOW_MS && at(c.replacementExpiresAt) > at(c.replacementCreatedAt), 'REPLACEMENT_EXPIRY_TOO_SOON');
  require(at(b.cycleStartsAt) <= at(b.verifiedAt) && at(b.cycleEndsAt) > nowMs + WINDOW_MS &&
    at(b.cycleStartsAt) < at(b.cycleEndsAt), 'BILLING_CYCLE_INVALID');
  require(at(b.creditExpiresAt) > nowMs + WINDOW_MS, 'CREDIT_EXPIRY_TOO_SOON');
  require(b.organizationCycleRemainingUsd >= budget && b.projectCycleRemainingUsd >= budget &&
    b.creditBalanceUsd >= budget, 'INSUFFICIENT_VERIFIED_RESERVE');
  return { ready: errors.length === 0, errors };
}
