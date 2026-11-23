import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseService, SEED } from '../../test/helpers.js';
import type { AuthUser } from '../auth/auth-user.js';
import { MockProvider } from './mock.provider.js';
import {
  ProviderStop,
  type SuggestionInput,
  type SuggestionProvider,
} from './suggestion-provider.js';
import { SuggestionsService } from './suggestions.service.js';

// Criteria 7, 11 and 12: the service's hardening, against this run's real database
// (the supplier read goes through withTenant and RLS) with only the provider scripted.

const A = SEED.acme;
const B = SEED.globex;
const ALICE: AuthUser = { userId: A.requester, tenantId: A.tenant, role: 'requester' };
const BELLA: AuthUser = { userId: B.requester, tenantId: B.tenant, role: 'requester' };
const DEADLINE_MS = 50;

const VALID = {
  title: 'Laptops',
  category: 'hardware',
  quantity: 20,
  amountCents: 2_400_000,
  currency: 'EUR',
  supplierId: A.suppliers[1],
};
const INVALID = { title: '', category: 'furniture' };

type Step = unknown | ((input: SuggestionInput) => unknown);

/** A provider that answers with each step in turn and records every input it gets. */
function scripted(steps: Step[]) {
  const inputs: SuggestionInput[] = [];
  const provider: SuggestionProvider = {
    name: 'mock',
    model: 'scripted',
    async suggest(input) {
      inputs.push(input);
      const step = steps[inputs.length - 1];
      return typeof step === 'function' ? (step as (i: SuggestionInput) => unknown)(input) : step;
    },
  };
  return { provider, inputs };
}

const db = databaseService();
afterAll(() => db.onModuleDestroy());
const service = (provider: SuggestionProvider) => new SuggestionsService(db, provider, DEADLINE_MS);

/** Every log call during a test, from Nest's Logger and from console. */
let logged: unknown[][];
beforeEach(() => {
  logged = [];
  const record = (...args: unknown[]) => void logged.push(args);
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(record);
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(record);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The llm_suggestion lines among the log calls, parsed. */
function suggestionLines(): Record<string, unknown>[] {
  return logged
    .map((args) => args[0])
    .filter((m): m is string => typeof m === 'string' && m.includes('"event":"llm_suggestion"'))
    .map((m) => JSON.parse(m) as Record<string, unknown>);
}
function theLine(): Record<string, unknown> {
  const lines = suggestionLines();
  expect(lines).toHaveLength(1);
  return lines[0];
}

describe('the provider input (criterion 7)', () => {
  it("gets the trimmed description and exactly the caller's company's suppliers", async () => {
    const { provider, inputs } = scripted([VALID]);
    await service(provider).suggest(ALICE, 'need 20 laptops');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].description).toBe('need 20 laptops');
    expect(inputs[0].suppliers).toEqual([
      { id: A.suppliers[0], name: 'Bright Office Supplies' },
      { id: A.suppliers[1], name: 'Nordic Laptops' },
    ]);
    expect(inputs[0].repairErrors).toBeUndefined();
    expect(inputs[0].timeoutMs).toBeLessThanOrEqual(DEADLINE_MS);
    expect(inputs[0].signal.aborted).toBe(false);
  });

  it("replaces another company's supplier with null and keeps the rest", async () => {
    const { provider } = scripted([{ ...VALID, supplierId: B.suppliers[1] }]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toEqual({
      ...VALID,
      supplierId: null,
    });
  });

  it("as Bella, Acme's supplier is the foreign one", async () => {
    const { provider, inputs } = scripted([VALID]);
    expect(await service(provider).suggest(BELLA, 'laptops')).toMatchObject({ supplierId: null });
    expect(inputs[0].suppliers.map((s) => s.id)).toEqual([...B.suppliers]);
  });
});

describe('hardening (criterion 11)', () => {
  it('(a) valid output on the first call: suggested, one call', async () => {
    const { provider, inputs } = scripted([VALID]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toEqual(VALID);
    expect(inputs).toHaveLength(1);
    expect(theLine()).toMatchObject({ outcome: 'suggested', attempts: 1, validationFailures: 0 });
  });

  it('(b) invalid, then valid: suggested, and the repair call got the validation errors', async () => {
    const { provider, inputs } = scripted([INVALID, VALID]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toEqual(VALID);
    expect(inputs).toHaveLength(2);
    const paths = inputs[1].repairErrors?.map((e) => e.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['title', 'category']));
    for (const e of inputs[1].repairErrors ?? []) expect(e.message).not.toBe('');
    expect(theLine()).toMatchObject({ outcome: 'suggested', attempts: 2, validationFailures: 1 });
  });

  it('(c) invalid twice: null after exactly two calls, never a third', async () => {
    const { provider, inputs } = scripted([INVALID, INVALID, VALID]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
    expect(inputs).toHaveLength(2);
    expect(theLine()).toMatchObject({
      outcome: 'fallback',
      reason: 'invalid',
      attempts: 2,
      validationFailures: 2,
    });
  });

  it('(d) a provider that never resolves: null at the deadline, its signal aborted', async () => {
    const { provider, inputs } = scripted([() => new Promise(() => {})]);
    const started = performance.now();
    expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
    expect(performance.now() - started).toBeLessThan(DEADLINE_MS + 500);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].signal.aborted).toBe(true);
    expect(theLine()).toMatchObject({
      outcome: 'fallback',
      reason: 'timeout',
      attempts: 1,
      errorClass: 'SuggestionDeadlineExceeded',
    });
  });

  it('(d) one deadline covers the repair call too', async () => {
    const slowInvalid = () => new Promise((r) => setTimeout(() => r(INVALID), 30));
    const { provider, inputs } = scripted([slowInvalid, () => new Promise(() => {})]);
    const started = performance.now();
    expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
    expect(performance.now() - started).toBeLessThan(DEADLINE_MS + 500);
    expect(inputs).toHaveLength(2);
    expect(inputs[1].timeoutMs).toBeLessThan(DEADLINE_MS);
    expect(theLine()).toMatchObject({ reason: 'timeout', attempts: 2, validationFailures: 1 });
  });

  it('(d) a provider that rejects after the deadline causes no unhandled rejection', async () => {
    const late = () => new Promise((_r, reject) => setTimeout(() => reject(new Error('late')), 80));
    const { provider } = scripted([late]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
    // Vitest fails the run on an unhandled rejection; give the late one time to happen.
    await new Promise((r) => setTimeout(r, 100));
    expect(theLine()).toMatchObject({ reason: 'timeout' });
  });

  it('(e) a provider that throws: null after one call, no repair', async () => {
    const { provider, inputs } = scripted([
      () => {
        throw new TypeError('fetch failed');
      },
      VALID,
    ]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
    expect(inputs).toHaveLength(1);
    expect(theLine()).toMatchObject({
      outcome: 'fallback',
      reason: 'error',
      errorClass: 'TypeError',
      attempts: 1,
      validationFailures: 0,
    });
  });

  it.each(['refusal', 'max_tokens'] as const)(
    '(e) a %s stop: null after one call, no repair',
    async (stop) => {
      const { provider, inputs } = scripted([
        () => {
          throw new ProviderStop(stop);
        },
        VALID,
      ]);
      expect(await service(provider).suggest(ALICE, 'laptops')).toBeNull();
      expect(inputs).toHaveLength(1);
      expect(theLine()).toMatchObject({ reason: stop, errorClass: 'ProviderStop', attempts: 1 });
    },
  );

  it.each([
    ['a string', 'not json {'],
    ['a number', 42],
    ['null', null],
    ['an array', [VALID]],
    ['quantity 0', { ...VALID, quantity: 0 }],
    ['amountCents 1.5', { ...VALID, amountCents: 1.5 }],
    ['currency "eur"', { ...VALID, currency: 'eur' }],
    ['a supplier by name', { ...VALID, supplierId: 'Nordic Laptops' }],
    ['an extra field', { ...VALID, notes: 'x' }],
  ])('(f) %s is a schema failure, so it is repaired', async (_name, bad) => {
    const { provider, inputs } = scripted([bad, VALID]);
    expect(await service(provider).suggest(ALICE, 'laptops')).toEqual(VALID);
    expect(inputs).toHaveLength(2);
    expect(inputs[1].repairErrors?.length).toBeGreaterThan(0);
    expect(theLine()).toMatchObject({ validationFailures: 1, attempts: 2 });
  });
});

describe('the log line (criterion 12)', () => {
  const MARKER = 'ZQX-SECRET-7731';
  const RAW = { ...INVALID, title: `RAW-OUTPUT-${MARKER}-9f2e` };

  it.each([
    ['(a)', [VALID], 'suggested', 1, undefined],
    ['(b)', [RAW, VALID], 'suggested', 2, undefined],
    ['(c)', [RAW, RAW], 'fallback', 2, 'invalid'],
  ] as const)(
    '%s writes one line with every field, and no description or raw output',
    async (_case, steps, outcome, attempts, reason) => {
      const description = `need 20 laptops for ${MARKER}`;
      const { provider } = scripted([...steps]);
      await service(provider).suggest(ALICE, description);

      const line = theLine();
      expect(Object.keys(line).sort()).toEqual(
        [
          'event',
          'provider',
          'model',
          'latencyMs',
          'attempts',
          'validationFailures',
          'outcome',
          'descriptionLength',
          'descriptionHash',
          ...(reason ? ['reason'] : []),
        ].sort(),
      );
      expect(line).toMatchObject({
        event: 'llm_suggestion',
        provider: 'mock',
        model: 'scripted',
        attempts,
        outcome,
        descriptionLength: description.length,
      });
      if (reason) expect(line.reason).toBe(reason);
      expect(line.descriptionHash).toMatch(/^[0-9a-f]{12}$/);
      expect(typeof line.latencyMs).toBe('number');

      const everything = JSON.stringify(logged);
      expect(everything).not.toContain(MARKER);
      expect(everything).not.toContain('RAW-OUTPUT');
      expect(everything).not.toContain('Alice');
      expect(everything).not.toContain('Acme');
    },
  );

  it('hashes the same description the same way, and a different one differently', async () => {
    const svc = service(new MockProvider());
    await svc.suggest(ALICE, 'pens');
    await svc.suggest(ALICE, 'pens');
    await svc.suggest(ALICE, 'pencils');
    const [one, two, three] = suggestionLines();
    expect(one.descriptionHash).toBe(two.descriptionHash);
    expect(one.descriptionHash).not.toBe(three.descriptionHash);
    expect(one).toMatchObject({ provider: 'mock', model: 'mock' });
  });
});

describe('with the MockProvider (requirement 12 through the service)', () => {
  const svc = () => new SuggestionsService(db, new MockProvider(), DEADLINE_MS);

  it('mock:repair is repaired on the second call', async () => {
    expect(await svc().suggest(ALICE, 'mock:repair 2 laptops')).toMatchObject({
      category: 'hardware',
      quantity: 2,
    });
    expect(theLine()).toMatchObject({ attempts: 2, validationFailures: 1 });
  });

  it('mock:invalid falls back after two calls', async () => {
    expect(await svc().suggest(ALICE, 'mock:invalid laptops')).toBeNull();
    expect(theLine()).toMatchObject({ reason: 'invalid', attempts: 2 });
  });

  it('mock:timeout falls back at the deadline', async () => {
    expect(await svc().suggest(ALICE, 'mock:timeout laptops')).toBeNull();
    expect(theLine()).toMatchObject({ reason: 'timeout', attempts: 1 });
  });
});
