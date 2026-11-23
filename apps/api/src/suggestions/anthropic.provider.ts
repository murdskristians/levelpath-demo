import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  JSONOutputFormat,
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import { suggestionSchema } from '@levelpath/shared';
import { buildPrompt } from './prompt.js';
import {
  ProviderStop,
  type SuggestionInput,
  type SuggestionProvider,
} from './suggestion-provider.js';

/** The one SDK method this provider uses: what a test stubs. */
export interface MessagesClient {
  messages: {
    create(
      body: MessageCreateParamsNonStreaming,
      options: { timeout: number; signal: AbortSignal },
    ): PromiseLike<Message>;
  };
}

export type CreateClient = (options: ClientOptions) => MessagesClient;

/** The real SDK client. Only the running API calls this; tests pass their own. */
export const createAnthropicClient: CreateClient = (options) => new Anthropic(options);

/** Room for the model's thinking as well as the six-field answer (spec A16). */
const MAX_TOKENS = 2048;

/**
 * The real model, used only when LLM_PROVIDER=anthropic (requirement 13). It calls
 * `messages.create` with the schema as the output format and returns the answer
 * **unvalidated**: `messages.parse` would throw on a schema failure and lose the output
 * the repair needs, so the service's `suggestionSchema` parse is the only judge.
 */
export class AnthropicProvider implements SuggestionProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: MessagesClient;
  private readonly format: JSONOutputFormat;

  constructor(
    config: { apiKey: string; model: string },
    createClient: CreateClient = createAnthropicClient,
  ) {
    this.model = config.model;
    // The service owns every attempt, so the SDK never retries on its own (A3). An
    // explicit log level, so ANTHROPIC_LOG=debug can't log requests with the description.
    this.client = createClient({ apiKey: config.apiKey, maxRetries: 0, logLevel: 'warn' });
    // The JSON schema only, without the helper's throwing `parse`.
    const { type, schema } = zodOutputFormat(suggestionSchema);
    this.format = { type, schema };
  }

  async suggest(input: SuggestionInput): Promise<unknown> {
    const { system, user } = buildPrompt(input);
    const message = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: this.format, effort: 'low' },
      },
      { timeout: input.timeoutMs, signal: input.signal },
    );
    // Before the text: a refusal or a cut-off answer is never repaired.
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
      throw new ProviderStop(message.stop_reason);
    }
    // Thinking blocks come first; the answer is the first text block.
    const block = message.content.find((b) => b.type === 'text');
    // No text block: null fails suggestionSchema, so the service repairs it like bad JSON.
    if (!block || block.type !== 'text') return null;
    try {
      return JSON.parse(block.text) as unknown;
    } catch (err) {
      // Not JSON: hand the raw text on, so it fails the schema and gets repaired.
      if (err instanceof SyntaxError) return block.text;
      throw err;
    }
  }
}
