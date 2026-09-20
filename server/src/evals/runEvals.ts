import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEvalInputs } from './loadEvalCases.js';
import { runConversationEvals } from './runConversationEvals.js';
import { runPricingEvals } from './runPricingEvals.js';
import { formatEvalReport } from './formatEvalReport.js';
import type { EvalReport } from './types.js';

export interface EvalInputs {
  conversationCases: unknown[];
  pricingCases: unknown[];
}
const scope = 'Offline only. Fixtures evaluate workflow, not AI extraction accuracy. Pricing accuracy is not scored.';

export async function evaluateDatasets(inputs: EvalInputs): Promise<EvalReport> {
  const results = await runConversationEvals(inputs.conversationCases);
  const pricing = runPricingEvals(inputs.pricingCases);
  const conversation = {
    total: results.length, passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length, notRun: results.filter(r => r.status === 'NOT_RUN').length,
    results,
  };
  const errors: string[] = [];
  if (conversation.passed + conversation.failed === 0) errors.push('No conversation cases were executable.');
  if (pricing.total === 0) errors.push('Pricing dataset is empty.');
  const failed = conversation.failed > 0 || pricing.invalid > 0 || errors.length > 0;
  return { status: failed ? 'FAILED' : 'PASSED', exitCode: failed ? 1 : 0,
    scope, errors, conversation, pricing };
}

export async function runEvals(load: () => Promise<EvalInputs> = loadEvalInputs): Promise<EvalReport> {
  try {
    return await evaluateDatasets(await load());
  } catch (error) {
    const report = await evaluateDatasets({ conversationCases: [], pricingCases: [] });
    report.errors = ['Unable to load eval datasets: ' + (error instanceof Error ? error.message : 'Unknown error.')];
    return report;
  }
}

export async function runEvalCli(
  args: string[], load: () => Promise<EvalInputs> = loadEvalInputs,
  write: (text: string) => void = text => { process.stdout.write(text); },
): Promise<0 | 1> {
  const unknown = args.filter(arg => arg !== '--json');
  const report = unknown.length
    ? await runEvals(async () => { throw new Error('Unknown CLI argument; supported flag: --json.'); })
    : await runEvals(load);
  write(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatEvalReport(report));
  return report.exitCode;
}

// Importing the runner in tests has no CLI side effects.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runEvalCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
