import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READINESS_PROJECT_ID, validateReadiness, type ReadinessEvidence } from '../src/safety/readiness.js';

const now = Date.parse('2026-10-20T12:00:00Z');
function evidence(): ReadinessEvidence {
  return {
    schemaVersion: 1, projectId: READINESS_PROJECT_ID, reservationBudgetUsd: 0.50,
    credential: {
      status: 'verified', verifiedAt: '2026-10-20T11:59:00Z', operator: 'synthetic-test-operator',
      sourceReference: 'synthetic-test-only/credential-review', oldKeyId: 'key_old_synthetic',
      reportedOldExpiryDate: '2026-10-22', oldActualExpiresAt: '2026-10-22T00:00:00Z',
      replacementKeyId: 'key_replacement_synthetic', replacementCreatedAt: '2026-10-20T11:00:00Z',
      replacementExpiresAt: '2026-11-20T00:00:00Z', installedKeyId: 'key_replacement_synthetic',
      runtimeKeyId: 'key_replacement_synthetic', runtimeClientRecreatedAt: '2026-10-20T11:10:00Z',
      zeroQuotasVerifiedAt: '2026-10-20T11:15:00Z', dailyCallAllowance: 0, dailyTokenAllowance: 0,
      oldKeyRevokedAt: '2026-10-20T11:20:00Z', scopeReviewedAt: '2026-10-20T11:25:00Z',
    },
    billing: {
      status: 'verified', verifiedAt: '2026-10-20T11:59:00Z', operator: 'synthetic-test-operator',
      sourceReference: 'synthetic-test-only/read-only-billing', organizationHardLimitUsd: 5,
      organizationHardLimitEnforced: true, projectHardLimitUsd: 5, projectHardLimitEnforced: true,
      cycleStartsAt: '2026-10-01T00:00:00Z', cycleEndsAt: '2026-11-01T00:00:00Z',
      organizationCycleRemainingUsd: 2, projectCycleRemainingUsd: 1,
      creditBalanceUsd: 3, creditExpiresAt: '2026-11-01T00:00:00Z', autoRechargeEnabled: false,
    },
  };
}
const rejects = (record: unknown, code?: string, time = now) => {
  const result = validateReadiness(record, time);
  assert.equal(result.ready, false);
  if (code) assert.ok(result.errors.includes(code), JSON.stringify(result));
};

test('consistent synthetic reviewed metadata passes offline without proving a real account', () => {
  assert.deepEqual(validateReadiness(evidence(), now), { ready: true, errors: [] });
});
test('rejects unknown/unverified, wrong project, extra fields and invalid clock', () => {
  for (const record of [null, {}, { ...evidence(), projectId: 'wrong' }, { ...evidence(), unknown: true },
    { ...evidence(), billing: { ...evidence().billing, status: 'unknown' } }]) rejects(record, 'EVIDENCE_SCHEMA_INVALID');
  rejects(evidence(), 'CLOCK_INVALID', NaN);
});
test('refuses stale/future observations and ambiguous or impossible UTC dates', () => {
  for (const verifiedAt of ['2026-10-19T11:59:59Z', '2026-10-20T12:00:01Z']) {
    const record = evidence(); record.billing.verifiedAt = verifiedAt; rejects(record, 'EVIDENCE_STALE_OR_FUTURE');
  }
  for (const verifiedAt of ['2026-10-20', '2026-10-20T12:00:00+00:00', '2026-02-30T12:00:00Z']) {
    const record = evidence(); record.billing.verifiedAt = verifiedAt; rejects(record, 'EVIDENCE_SCHEMA_INVALID');
  }
});
test('requires separate key identity, installation and recreated cached runtime client', () => {
  const same = evidence(); same.credential.oldKeyId = same.credential.replacementKeyId; rejects(same, 'REPLACEMENT_MUST_DIFFER');
  for (const field of ['installedKeyId', 'runtimeKeyId'] as const) {
    const record = evidence(); record.credential[field] = record.credential.oldKeyId; rejects(record, 'REPLACEMENT_NOT_CONFIRMED_IN_RUNTIME');
  }
  const early = evidence(); early.credential.runtimeClientRecreatedAt = '2026-10-20T10:59:59Z'; rejects(early, 'CREDENTIAL_TIMELINE_INVALID');
});
test('rotation must precede actual verified old expiry and replacement must outlast the window', () => {
  const late = evidence(); late.credential.oldKeyRevokedAt = '2026-10-22T00:00:00Z'; rejects(late, 'ROTATION_AFTER_OLD_EXPIRY');
  const mismatch = evidence(); mismatch.credential.oldActualExpiresAt = '2026-10-21T23:59:59Z'; rejects(mismatch, 'REPORTED_OLD_EXPIRY_MISMATCH');
  const short = evidence(); short.credential.replacementExpiresAt = '2026-10-20T12:15:00Z'; rejects(short, 'REPLACEMENT_EXPIRY_TOO_SOON');
});
test('soft $5 budgets, auto recharge, nonzero quotas and incomplete metadata are denied', () => {
  for (const patch of [{ projectHardLimitEnforced: false }, { organizationHardLimitEnforced: false },
    { autoRechargeEnabled: true }, { projectHardLimitUsd: 6 }]) {
    rejects({ ...evidence(), billing: { ...evidence().billing, ...patch } }, 'EVIDENCE_SCHEMA_INVALID');
  }
  rejects({ ...evidence(), credential: { ...evidence().credential, dailyCallAllowance: 1 } }, 'EVIDENCE_SCHEMA_INVALID');
  rejects({ ...evidence(), credential: { ...evidence().credential, oldKeyRevokedAt: undefined } }, 'EVIDENCE_SCHEMA_INVALID');
});
test('full reserve must fit both hard-limit remainders and unexpired credits', () => {
  for (const field of ['organizationCycleRemainingUsd', 'projectCycleRemainingUsd', 'creditBalanceUsd'] as const) {
    const record = evidence(); record.billing[field] = 0.49; rejects(record, 'INSUFFICIENT_VERIFIED_RESERVE');
  }
  const credits = evidence(); credits.billing.creditExpiresAt = '2026-10-20T12:15:00Z'; rejects(credits, 'CREDIT_EXPIRY_TOO_SOON');
  const cycle = evidence(); cycle.billing.cycleEndsAt = '2026-10-20T12:15:00Z'; rejects(cycle, 'BILLING_CYCLE_INVALID');
  rejects({ ...evidence(), reservationBudgetUsd: 0.51 }, 'EVIDENCE_SCHEMA_INVALID');
});
test('secret-like input is rejected with fixed redacted diagnostics only', () => {
  for (const sourceReference of ['sk-proj-SYNTHETIC_NOT_A_KEY', 'Bearer SYNTHETIC_NOT_A_KEY', '-----BEGIN PRIVATE KEY-----']) {
    const record = evidence(); record.billing.sourceReference = sourceReference;
    const result = validateReadiness(record, now);
    assert.deepEqual(result, { ready: false, errors: ['SECRET_MATERIAL_FORBIDDEN'] });
    assert.equal(JSON.stringify(result).includes(sourceReference), false);
  }
});
