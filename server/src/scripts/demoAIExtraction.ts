import { israelReferenceDate } from '../config/referenceDate.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createLead } from '../domain/createLead.js';
import { processCustomerMessageWithExtractor } from '../domain/conversation/processCustomerMessage.js';
import { extractMessageWithAI } from '../integrations/openai/extractMessageWithAI.js';
import { AIExtractionError } from '../integrations/openai/errors.js';

// Works from either the root or workspace script; environment variables take precedence.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const text = process.argv.slice(2).join(' ') || `צריך להעביר מקרר גדול מרמת גן לתל אביב.
האיסוף מביאליק 20, קומה 2 בלי מעלית.
יש גם בערך 15 ארגזים.`;

try {
  const result = await processCustomerMessageWithExtractor(createLead(), text, {
    extractor: extractMessageWithAI, referenceDate: israelReferenceDate(new Date()),
  });
  console.log(JSON.stringify({
    extraction: result.extraction,
    lead: result.lead,
    missingRequirements: result.requirements.missingRequired,
    nextQuestion: result.nextQuestion,
    responseText: result.responseText,
  }, null, 2));
} catch (error) {
  console.error(error instanceof AIExtractionError
    ? `${error.code}: ${error.message}`
    : 'AI demo failed unexpectedly.');
  process.exitCode = 1;
}
