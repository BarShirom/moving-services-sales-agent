import { AIExtractionError } from '../integrations/openai/errors.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-nano';

function isPlaceholderAPIKey(value: string): boolean {
  // Recognize copy/paste instructions, including common sk-/sk-proj- placeholder forms.
  // This is a local configuration check, not verification that a key is authentic.
  const label = value.replace(/^sk-(?:proj-)?/i, '').replace(/[^a-z0-9]/gi, '');
  return !label || /^(?:(?:your|insert|paste|enter|replacewith)(?:real)?(?:openai)?(?:api)?key(?:here)?|(?:openai)?apikey(?:here)?|(?:placeholder|example|dummy)(?:key)?|replaceme|changeme|todo|x{3,})$/i.test(label);
}

export function getOpenAIConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || isPlaceholderAPIKey(apiKey)) {
    throw new AIExtractionError(
      'MISSING_API_KEY',
      'OPENAI_API_KEY is missing or still contains a placeholder value. Add a real API key to the root .env file.',
    );
  }
  return {
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    timeout: 30_000,
    maxRetries: 0,
  };
}
