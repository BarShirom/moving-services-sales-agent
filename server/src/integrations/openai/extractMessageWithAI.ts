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
import { AIWindowError, createAIWindowFromEnv, type AIWindow } from '../../safety/aiWindow.js';
import { extractionDiagnostics, type AIExtractionDiagnostic } from './diagnostics.js';

// A narrow Responses boundary: tests can inject this without credentials or network.
export type StructuredResponse = Pick<ParsedResponse<unknown>, 'status' | 'output' | 'output_parsed'>;
export type StructuredResponseRequest = (request: ResponseParseParams, options?: { signal: AbortSignal }) => Promise<StructuredResponse>;

export interface AIExtractorOptions {
  env?: NodeJS.ProcessEnv;
  request?: StructuredResponseRequest;
  window?: AIWindow;
  /** Operator-only allowlisted failures. Never included in customer responses. */
  onDiagnostic?: (value: AIExtractionDiagnostic) => void;
}

let defaultWindow: AIWindow | undefined;
/** Legacy windows stay consumed; an explicitly provisioned beta replays the same release allowance. */
export function initializeDefaultAIWindow(env: NodeJS.ProcessEnv = process.env): AIWindow {
  return defaultWindow ??= createAIWindowFromEnv(env);
}

export type AIAdmission = (request: ResponseParseParams, run: () => Promise<StructuredResponse>) => Promise<StructuredResponse>;
export type AIExtractor = (input: MessageExtractionInput, admission?: AIAdmission) => Promise<ExtractionResult>;

export function buildExtractionRequest(input: MessageExtractionInput, model = DEFAULT_OPENAI_MODEL): ResponseParseParams {
  return {
    model, instructions: EXTRACTION_INSTRUCTIONS,
    ...(model === 'gpt-6-luna' ? { reasoning: { effort: 'none' as const }, service_tier: 'default' as const } : {}),
    input: [{ role: 'user', content: JSON.stringify(buildExtractionContext(input)) }],
    text: { format: extractionTextFormat }, store: false, max_output_tokens: 4_000,
  };
}

export function createAIExtractor(options: AIExtractorOptions = {}): AIExtractor {
  // Lazily configured so importing the module never requires a key or opens a connection.
  let configured: { model: string; request: (request: ResponseParseParams, signal: AbortSignal | undefined,
    diagnostic: ReturnType<typeof extractionDiagnostics>) => Promise<StructuredResponse> } | undefined;
  return async (input: MessageExtractionInput, admission?: AIAdmission) => {
    let window = options.window;
    const diagnostic = extractionDiagnostics(value => {
      // The same allowlisted diagnostic goes to its existing operator sink and, in
      // public-beta mode, the release journal. A failed fsync closes that gate.
      window?.recordDiagnostic?.(value);
      if (options.onDiagnostic) options.onDiagnostic(value);
      else console.warn(JSON.stringify(value));
    });
    try {
      const snapshot = structuredClone(input);
      const request = buildExtractionRequest(snapshot,
        configured?.model ?? ((options.env ?? process.env).OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL));
      if (!configured) {
        diagnostic.stage('configuration');
        if (options.request) {
          // The fake transport owns authentication; a real client always checks the API key.
          configured = {
            model: (options.env ?? process.env).OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
            request: (request, signal) => options.request!(request, signal ? { signal } : undefined),
          };
        } else {
          const env = options.env ?? process.env;
          const { model, ...clientOptions } = getOpenAIConfig(env);
          // Pin transport identity and disable verbose SDK logs/ambient endpoint overrides.
          const client = new OpenAI({ ...clientOptions, baseURL: 'https://api.openai.com/v1',
            project: env.OPENAI_PROJECT_ID, organization: null, logLevel: 'off' });
          configured = { model, request: async (request, signal, diagnostic) => {
            const pending = client.responses.parse(request, { signal, maxRetries: 0, timeout: 30_000 });
            // Both await the SAME SDK promise: capture safe HTTP metadata before
            // JSON/Zod parsing can throw, without another request or any retry.
            const response = await pending.asResponse();
            diagnostic.response(response.status, response.headers.get('x-request-id'));
            diagnostic.stage('structured_parsing');
            return await pending;
          } };
        }
      }
      const transport = configured.request;
      // Only explicit injected test transports may omit the durable gate.
      window ??= options.request ? undefined : initializeDefaultAIWindow(options.env);
      const invoke = async (signal?: AbortSignal) => {
        diagnostic.stage('transport'); diagnostic.dispatch();
        try {
          const response = await transport(request, signal, diagnostic);
          window?.recordProviderReceipt?.(diagnostic.receipt());
          return response;
        }
        catch (error) {
          if (error instanceof AIWindowError) throw error;
          diagnostic.capture(error);
          if (error instanceof ZodError || error instanceof SyntaxError) {
            throw new AIExtractionError('INVALID_EXTRACTION', 'OpenAI returned an invalid structured extraction.');
          }
          // Do not include raw SDK errors: they can contain request data or provider details.
          throw new AIExtractionError('REQUEST_FAILED', 'OpenAI extraction request failed. Check connectivity, credentials, and model access.');
        }
      };
      const validate = (response: StructuredResponse) => {
        diagnostic.stage('response_validation');
        const refused = response.output.some(item => item.type === 'message'
          && item.content.some(part => part.type === 'refusal'));
        if (response.status === 'failed') {
          diagnostic.classified('failed_response');
          throw new AIExtractionError('REQUEST_FAILED', 'OpenAI could not complete the extraction request.');
        }
        if (response.status !== 'completed' || refused || response.output_parsed == null) {
          diagnostic.classified(refused ? 'refusal' : response.status !== 'completed' ? 'incomplete_response' : 'missing_output');
          throw new AIExtractionError('NO_STRUCTURED_OUTPUT', 'OpenAI refused or returned no complete structured extraction.');
        }
        diagnostic.stage('domain_validation');
        try { return convertAIExtraction(response.output_parsed, snapshot.lead, { referenceDate: snapshot.referenceDate }); }
        catch (error) { diagnostic.capture(error); throw error; }
      };
      let extraction: ExtractionResult | undefined;
      const run = () => {
        const validated = async (signal?: AbortSignal) => {
          try {
            const response = await invoke(signal);
            extraction = validate(response);
            return response;
          } catch (error) {
            // Persist before AI Window outcome/close handling, never after recreation.
            if (window?.recordDiagnostic) {
              diagnostic.capture(error);
              diagnostic.failure(new AIWindowError('request_failed'));
            }
            throw error;
          }
        };
        return window ? window.run(request, validated) : validated();
      };
      // Admission errors remain typed; budget/concurrency rejection never calls transport.
      diagnostic.stage('admission');
      const response = await (admission ? admission(request, run) : run());
      return extraction ?? validate(response);
    } catch (error) { diagnostic.failure(error); throw error; }
  };
}

const defaultExtractor = createAIExtractor();
export const extractMessageWithAI: AIExtractor = (input, admission) => defaultExtractor(input, admission);
