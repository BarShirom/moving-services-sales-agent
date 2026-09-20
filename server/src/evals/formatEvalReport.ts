import type { EvalReport } from './types.js';

export function formatEvalReport(report: EvalReport): string {
  const c = report.conversation;
  const p = report.pricing;
  const lines = [
    'Moving Services Sales Agent Eval Report', '', report.scope, '',
    'Conversation evals:', c.total + ' total | ' + c.passed + ' passed | ' + c.failed + ' failed | ' + c.notRun + ' not run',
    '', 'Pricing dataset:', p.total + ' total',
    p.sourceQuality.closed_job + ' closed_job | ' + p.sourceQuality.quoted_only + ' quoted_only | ' +
      p.sourceQuality.historical_estimate + ' historical_estimate',
    p.ready + ' ready for future pricing eval | ' + p.invalid + ' invalid',
    'Known closed prices: ' + p.withClosedPrice + ' | Known quotes: ' + p.withQuotedPrice +
      ' | Human approval required: ' + p.requiringHumanApproval + ' | Price ranges: ' + p.withPriceRange,
  ];
  const failures = [
    ...report.errors,
    ...c.results.filter(r => r.status === 'FAIL').flatMap(r => r.failedAssertions.map(f => r.id + ': ' + f)),
    ...p.results.filter(r => r.status === 'INVALID').flatMap(r => r.failedAssertions.map(f => r.id + ': ' + f)),
  ];
  if (failures.length) lines.push('', 'Failures:', ...failures.map(line => '- ' + line));
  const notRun = c.results.filter(r => r.status === 'NOT_RUN');
  if (notRun.length) lines.push('', 'Not run:', ...notRun.map(r => '- ' + r.id + ': ' + r.reason));
  const manual = c.results.filter(r => r.manualMustNot.length);
  if (manual.length) lines.push('', 'Manual mustNot review remains for ' + manual.length +
    ' cases; JSON output lists unscored statements. PASS applies only to the implemented checks.');
  lines.push('', 'Final result:', report.status);
  return lines.join('\n') + '\n';
}
