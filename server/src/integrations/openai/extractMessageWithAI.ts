import OpenAI from 'openai';
import { ZodError } from 'zod';
import type { ParsedResponse, ResponseParseParams } from 'openai/resources/responses/responses';
import { DEFAULT_OPENAI_MODEL, getOpenAIConfig } from '../../config/openai.js';
import type { MessageExtractionInput } from '../../domain/conversation/processCustomerMessage.js';
import type { ExtractionResult } from '../../domain/extraction/types.js';
import { buildExtractionContext } from './context.js';
import { convertAIExtraction } from './convertExtraction.js';
import { AIExtractionError } from './errors.js';
import { EXTRACTION_INSTRUCTIONS } from './prompt.js';
import { extractionTextFormat } from './schema.js';

// A narrow Responses boundary: tests can inject this without credentials or network.
export type StructuredResponse = Pick<ParsedResponse<unknown>, 'status' | 'output' | 'output_parsed'>;
export type StructuredResponseRequest = (request: ResponseParseParams) => Promise<StructuredResponse>;

export interface AIExtractorOptions {
  env?: NodeJS.ProcessEnv;
  request?: StructuredResponseRequest;
}

export type AIExtractor = (input: MessageExtractionInput) => Promise<ExtractionResult>;

export function createAIExtractor(options: AIExtractorOptions = {}): AIExtractor {
  // Lazily configured so importing the module never requires a key or opens a connection.
  let configured: { model: string; request: StructuredResponseRequest } | undefined;
  return async (input: MessageExtractionInput) => {
    const snapshot = structuredClone(input);
    const context = buildExtractionContext(snapshot);
    if (!configured) {
      if (options.request) {
        // The fake transport owns authentication; a real client always checks the API key.
        configured = {
          model: (options.env ?? process.env).OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
          request: options.request,
        };
      } else {
        const { model, ...clientOptions } = getOpenAIConfig(options.env);
        const client = new OpenAI(clientOptions);
        configured = { model, request: request => client.responses.parse(request) };
      }
    }
    let response: StructuredResponse;
    try {
      response = await configured.request({
        model: configured.model,
        instructions: EXTRACTION_INSTRUCTIONS,
        input: [{ role: 'user', content: JSON.stringify(context) }],
        text: { format: extractionTextFormat },
        store: false,
        max_output_tokens: 4_000,
      });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        throw new AIExtractionError('INVALID_EXTRACTION', 'OpenAI returned an invalid structured extraction.');
      }
      // Do not include raw SDK errors: they can contain request data or provider details.
      throw new AIExtractionError('REQUEST_FAILED', 'OpenAI extraction request failed. Check connectivity, credentials, and model access.');
    }
    const refused = response.output.some(item => item.type === 'message'
      && item.content.some(part => part.type === 'refusal'));
    if (response.status === 'failed') {
      throw new AIExtractionError('REQUEST_FAILED', 'OpenAI could not complete the extraction request.');
    }
    if (response.status !== 'completed' || refused || response.output_parsed == null) {
      throw new AIExtractionError('NO_STRUCTURED_OUTPUT', 'OpenAI refused or returned no complete structured extraction.');
    }
    return convertAIExtraction(response.output_parsed, snapshot.lead, { referenceDate: snapshot.referenceDate });
  };
}

const defaultExtractor = createAIExtractor();
export const extractMessageWithAI: AIExtractor = input => defaultExtractor(input);
