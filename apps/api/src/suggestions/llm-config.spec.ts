import { describe, expect, it } from 'vitest';
import { createSuggestionProvider, llmConfigFromEnv } from './llm-config.js';
import { MockProvider } from './mock.provider.js';

// Criterion 13: what the API reads at startup. The Anthropic provider itself is step 6.

const KEY = 'sk-ant-test-k-7f3a';

/** The message of what `fn` throws, or fails the test. */
function thrown(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a throw');
}

describe('llmConfigFromEnv', () => {
  it('gives the mock for an empty environment, and for LLM_PROVIDER=mock', () => {
    expect(llmConfigFromEnv({})).toEqual({ provider: 'mock' });
    expect(llmConfigFromEnv({ LLM_PROVIDER: 'mock', ANTHROPIC_API_KEY: KEY })).toEqual({
      provider: 'mock',
    });
    expect(createSuggestionProvider(llmConfigFromEnv({}))).toBeInstanceOf(MockProvider);
  });

  it.each([{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }])(
    'refuses anthropic without a key (%j), naming ANTHROPIC_API_KEY',
    (keyEnv) => {
      expect(thrown(() => llmConfigFromEnv({ LLM_PROVIDER: 'anthropic', ...keyEnv }))).toBe(
        'LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment',
      );
    },
  );

  it('refuses any other provider, naming the allowed values and not repeating the value', () => {
    const message = thrown(() => llmConfigFromEnv({ LLM_PROVIDER: 'foo', ANTHROPIC_API_KEY: KEY }));
    expect(message).toBe('LLM_PROVIDER must be mock or anthropic');
    expect(message).not.toContain(KEY);
  });

  it('gives anthropic with the key and LLM_MODEL, or the default model', () => {
    expect(
      llmConfigFromEnv({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY, LLM_MODEL: 'm' }),
    ).toEqual({ provider: 'anthropic', apiKey: KEY, model: 'm' });
    expect(llmConfigFromEnv({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY })).toMatchObject({
      model: 'claude-opus-5-5',
    });
  });
});
