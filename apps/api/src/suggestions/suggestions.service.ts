import { Inject, Injectable, Logger } from '@nestjs/common';
import { suggestionSchema, type Supplier, type Suggestion } from '@levelpath/shared';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { DatabaseService } from '../db/database.service.js';
import { zodIssues } from '../validation/zod-validation.pipe.js';
import {
  ProviderStop,
  SUGGESTION_DEADLINE_MS,
  SUGGESTION_PROVIDER,
  type RepairError,
  type SuggestionProvider,
} from './suggestion-provider.js';

/** The first call and one repair: never a third (requirement 16). */
const MAX_ATTEMPTS = 2;

type FallbackReason = 'invalid' | 'timeout' | 'refusal' | 'max_tokens' | 'error';

/** The reason the deadline's AbortController aborts with. */
export class SuggestionDeadlineExceeded extends Error {
  constructor(ms: number) {
    super(`the suggestion took longer than ${ms} ms`);
    this.name = 'SuggestionDeadlineExceeded';
  }
}

/**
 * A suggestion for the New request form, hardened whatever the provider (requirements
 * 8, 9 and 14 to 19): one deadline, every output parsed with `suggestionSchema`, one
 * repair call for a schema failure only, and `null` (fill it in yourself) for anything
 * else. Nothing the LLM does becomes an exception for the route.
 */
@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(SUGGESTION_PROVIDER) private readonly provider: SuggestionProvider,
    @Inject(SUGGESTION_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  async suggest(user: AuthUser, description: string): Promise<Suggestion | null> {
    // The caller's suppliers, under RLS. The transaction ends here, so no pooled
    // connection is held while the model thinks (A5).
    const suppliers = await this.db.withTenant(user.tenantId, (trx) =>
      trx.selectFrom('suppliers').select(['id', 'name']).orderBy('name').orderBy('id').execute(),
    );

    const start = performance.now();
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new SuggestionDeadlineExceeded(this.deadlineMs)),
      this.deadlineMs,
    );
    let attempts = 0;
    let validationFailures = 0;
    let suggestion: Suggestion | null = null;
    let reason: FallbackReason | undefined;
    let errorClass: string | undefined;

    try {
      let repairErrors: RepairError[] | undefined;
      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        const remaining = Math.max(1, Math.floor(this.deadlineMs - (performance.now() - start)));
        const call = this.provider.suggest({
          description,
          suppliers,
          signal: deadline.signal,
          timeoutMs: remaining,
          repairErrors,
        });
        // A provider that ignores the signal still can't outlive the deadline.
        const raw = await raceAbort(call, deadline.signal);
        const parsed = suggestionSchema.safeParse(raw);
        if (parsed.success) {
          suggestion = withOwnSupplier(parsed.data, suppliers);
          break;
        }
        validationFailures++;
        repairErrors = zodIssues(parsed.error);
      }
      if (suggestion === null) reason = 'invalid';
    } catch (err) {
      // Logged below by class only: an API error's message can quote the input.
      errorClass = err instanceof Error ? err.constructor.name : typeof err;
      reason = deadline.signal.aborted
        ? 'timeout'
        : err instanceof ProviderStop
          ? err.reason
          : 'error';
    } finally {
      clearTimeout(timer);
    }

    // One line per suggestion: lengths and a hash, never the text (requirement 19).
    this.logger.log(
      JSON.stringify({
        event: 'llm_suggestion',
        provider: this.provider.name,
        model: this.provider.model,
        latencyMs: Math.round(performance.now() - start),
        attempts,
        validationFailures,
        outcome: suggestion === null ? 'fallback' : 'suggested',
        reason,
        errorClass,
        descriptionLength: description.length,
        descriptionHash: createHash('sha256').update(description).digest('hex').slice(0, 12),
      }),
    );
    return suggestion;
  }
}

/** A supplier the caller's company doesn't have becomes null; the rest is kept (requirement 9). */
function withOwnSupplier(suggestion: Suggestion, suppliers: Supplier[]): Suggestion {
  const own = suppliers.some((s) => s.id === suggestion.supplierId);
  return own ? suggestion : { ...suggestion, supplierId: null };
}

/**
 * Settles with `promise`, or rejects with the signal's reason as soon as it aborts
 * (at once if it already has). Both handlers are always attached, so a provider promise
 * that rejects after the race is over never becomes an unhandled rejection.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
