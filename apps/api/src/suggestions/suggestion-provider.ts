import type { Supplier } from '@levelpath/shared';

/** One validation problem with the previous output, as the repair call receives it. */
export interface RepairError {
  path: string;
  message: string;
}

/** What a provider gets for one call. The service decides all of it. */
export interface SuggestionInput {
  /** The trimmed description: untrusted text from the requester. */
  description: string;
  /** The caller's company's suppliers, read in its tenant transaction. */
  suppliers: Supplier[];
  /** Aborted when the suggestion's deadline expires. */
  signal: AbortSignal;
  /** The milliseconds left of that deadline: the longest this call may take. */
  timeoutMs: number;
  /** Set only on the repair call: why the previous output failed the schema. */
  repairErrors?: RepairError[];
}

/**
 * Turns a description into a suggestion. It returns the output **unvalidated**: the
 * service parses every output with `suggestionSchema`, whichever provider made it.
 */
export interface SuggestionProvider {
  readonly name: 'mock' | 'anthropic';
  readonly model: string;
  suggest(input: SuggestionInput): Promise<unknown>;
}

/** The model stopped without a usable answer. A failure that is never repaired. */
export class ProviderStop extends Error {
  constructor(readonly reason: 'refusal' | 'max_tokens') {
    super(`the model stopped: ${reason}`);
    this.name = 'ProviderStop';
  }
}

/** Injection token for the SuggestionProvider. HTTP tests always override it. */
export const SUGGESTION_PROVIDER = Symbol('SUGGESTION_PROVIDER');

/** Injection token for the whole suggestion's deadline, in milliseconds. */
export const SUGGESTION_DEADLINE_MS = Symbol('SUGGESTION_DEADLINE_MS');

/** One deadline for the whole suggestion, the repair call included (requirement 14). */
export const DEFAULT_SUGGESTION_DEADLINE_MS = 15_000;
