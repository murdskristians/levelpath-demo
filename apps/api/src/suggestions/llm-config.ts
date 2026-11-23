import {
  AnthropicProvider,
  createAnthropicClient,
  type CreateClient,
} from './anthropic.provider.js';
import { MockProvider } from './mock.provider.js';
import type { SuggestionProvider } from './suggestion-provider.js';

/** The model when LLM_MODEL is unset (Chris, spec A1). */
export const DEFAULT_LLM_MODEL = 'claude-opus-5-5';

export type LlmConfig =
  { provider: 'mock' } | { provider: 'anthropic'; apiKey: string; model: string };

/**
 * Which provider to use, read once at startup from the process environment, never from
 * `.env` (requirement 11). Unset means the mock. A refusal is a fixed message that names
 * the variable and never repeats a value from the environment, so no key is ever printed.
 */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = env.LLM_PROVIDER ?? '';
  if (provider === '' || provider === 'mock') return { provider: 'mock' };
  if (provider !== 'anthropic') throw new Error('LLM_PROVIDER must be mock or anthropic');
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.trim() === '') {
    throw new Error('LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment');
  }
  return { provider: 'anthropic', apiKey, model: env.LLM_MODEL || DEFAULT_LLM_MODEL };
}

/** The provider the config names. Tests pass a fake `createClient`: no real SDK client. */
export function createSuggestionProvider(
  config: LlmConfig,
  createClient: CreateClient = createAnthropicClient,
): SuggestionProvider {
  if (config.provider === 'mock') return new MockProvider();
  return new AnthropicProvider({ apiKey: config.apiKey, model: config.model }, createClient);
}
