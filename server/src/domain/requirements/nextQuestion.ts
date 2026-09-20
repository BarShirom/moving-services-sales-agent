import type { NextQuestion, RequirementResult } from './types.js';

export function selectNextQuestion(requirements: RequirementResult[]): NextQuestion | null {
  const missing = requirements.filter(result => result.status === 'MISSING');
  const pricing = missing.filter(result => result.stage === 'PRICING');
  const candidates = (pricing.length > 0 ? pricing : missing).filter(result => result.question !== null);
  const first = candidates[0];
  if (!first) return null;

  const group = (result: RequirementResult): string => {
    if (['item.width', 'item.height', 'item.depth'].includes(result.id)) return `dimensions:${result.itemIndex}`;
    if (result.itemIndex !== undefined) return `item:${result.itemIndex}`;
    return result.id.split('.')[0];
  };
  const dimensionGroup = group(first).startsWith('dimensions:');
  const selected = candidates.filter(result => group(result) === group(first)).slice(0, dimensionGroup ? 3 : 2);
  const axes: Record<string, string> = { 'item.width': 'הרוחב', 'item.height': 'הגובה', 'item.depth': 'העומק' };
  const names = selected.map(result => axes[result.id]);
  const dimensionNames = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ו${names.at(-1)}`;
  return {
    text: dimensionGroup
      ? first.question!.replace(/^מה (הרוחב|הגובה|העומק)/u, `אפשר לשלוח את ${dimensionNames}`)
      : selected.map(result => result.question).join(' '),
    requirements: selected.map(({ id, itemIndex }) => itemIndex === undefined ? { id } : { id, itemIndex }),
  };
}
