import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { processCustomerMessageWithExtractor } from '../domain/conversation/processCustomerMessage.js';
import { parseConversationCases } from './loadEvalCases.js';
import { offlineFixtures, type OfflineFixture } from './conversationFixtures.js';
import { actualQuestion, hydrateEvalLead } from './hydrateEvalLead.js';
import { automatedMustNot, checkConversation, intentChecks } from './conversationAssertions.js';
import type { ConversationEvalResult } from './types.js';

export function rawIdentity(value: unknown, index: number): { id: string; scenario: string } {
  const entry = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { id: typeof entry.id === 'string' ? entry.id : 'invalid-case-' + (index + 1),
    scenario: typeof entry.scenario === 'string' ? entry.scenario : 'unspecified' };
}
export function duplicateIds(cases: unknown[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  cases.forEach((entry, index) => {
    const { id } = rawIdentity(entry, index);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  return duplicates;
}

export async function runConversationEvals(
  cases: unknown[], fixtures: Readonly<Record<string, OfflineFixture>> = offlineFixtures,
): Promise<ConversationEvalResult[]> {
  const duplicates = duplicateIds(cases);
  const results: ConversationEvalResult[] = [];
  for (const [index, raw] of cases.entries()) {
    const result: ConversationEvalResult = {
      ...rawIdentity(raw, index), status: 'NOT_RUN', mode: 'NONE', reason: '',
      failedAssertions: [], checkedAssertions: [], manualMustNot: [],
    };
    results.push(result);
    try {
      if (duplicates.has(result.id)) throw new Error('Duplicate conversation case ID.');
      const entry = parseConversationCases([raw])[0];
      result.manualMustNot = (entry.mustNot ?? []).filter(constraint => !automatedMustNot(constraint));
      if (entry.status === 'future') { result.reason = 'Future service capability has no offline execution adapter.'; continue; }
      const fixture = Object.hasOwn(fixtures, entry.id) ? fixtures[entry.id] : undefined;
      if (!fixture) { result.reason = 'No explicit offline extraction fixture or domain adapter.'; continue; }
      if (fixture.message !== entry.customerMessage) { result.reason = 'Offline fixture is stale: customer message changed.'; continue; }
      const unsupported = entry.expectedAgentIntent.filter(intent => !Object.hasOwn(intentChecks, intent));
      if (unsupported.length) { result.reason = 'Unsupported intent checks: ' + unsupported.join(', '); continue; }
      if (fixture.mode === 'FIXTURE' && fixture.extraction === undefined) { result.reason = 'Offline extraction fixture is missing.'; continue; }
      if (JSON.stringify([entry.expectedExtraction, entry.expectedStateChanges]).includes('specialAccessNotes') &&
        !fixture.accessNoteMeaning) { result.reason = 'Access-note meaning needs an explicit semantic assertion.'; continue; }
      let before;
      let question;
      try {
        before = hydrateEvalLead(entry);
        question = actualQuestion(entry, before);
      } catch (error) {
        result.reason = error instanceof Error ? error.message : 'Unsupported snapshot/question.';
        continue;
      }
      result.mode = fixture.mode;
      const original = structuredClone(before);
      const output = await processCustomerMessageWithExtractor(before, entry.customerMessage, {
        lastQuestion: question, referenceDate: entry.referenceDate,
        extractor: () => {
          if (fixture.mode === 'DOMAIN') throw new Error('Domain shortcut did not handle this message; AI fallback is forbidden.');
          return structuredClone(fixture.extraction!);
        },
      });
      const checked = checkConversation(entry, original, output, fixture);
      result.checkedAssertions = checked.checked;
      result.failedAssertions = checked.failures;
      if (!isDeepStrictEqual(before, original)) result.failedAssertions.push('Workflow mutated its input Lead.');
      result.status = result.failedAssertions.length ? 'FAIL' : 'PASS';
      result.reason = result.status === 'FAIL' ? 'Offline workflow assertions failed.' :
        fixture.mode === 'FIXTURE' ? 'Fixture-driven workflow checks passed; AI extraction accuracy was not evaluated.' :
          'Deterministic domain workflow checks passed.';
    } catch (error) {
      result.status = 'FAIL';
      result.reason = 'Invalid case or offline execution error.';
      result.failedAssertions = error instanceof z.ZodError
        ? error.issues.map(issue => issue.path.join('.') + ': ' + issue.message)
        : [error instanceof Error ? error.message : 'Unknown error.'];
    }
  }
  return results;
}
