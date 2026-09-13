import type { NextQuestion, RequirementResult } from './types.js';

export function selectNextQuestion(requirements: RequirementResult[]): NextQuestion | null {
  const missing = requirements.filter(result => result.status === 'MISSING');
  const pricing = missing.filter(result => result.stage === 'PRICING');
  const candidates = (pricing.length > 0 ? pricing : missing).filter(result => result.question !== null);
  const first = candidates[0];
  if (!first) return null;

  const group = (result: RequirementResult): string => {
    if (result.itemIndex !== undefined) return `item:${result.itemIndex}`;
    return result.id.split('.')[0];
  };
  const selected = candidates.filter(result => group(result) === group(first)).slice(0, 2);
  return {
    text: selected.map(result => result.question).join(' '),
    requirements: selected.map(({ id, itemIndex }) => itemIndex === undefined ? { id } : { id, itemIndex }),
  };
}
