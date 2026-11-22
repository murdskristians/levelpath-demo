import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, suggestionResponseSchema } from '@levelpath/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerClient, SEED, startApp } from '../../test/helpers.js';
import type { SuggestionInput, SuggestionProvider } from './suggestion-provider.js';

// Criteria 6 to 10 and 15, over real HTTP against this run's database, with the
// MockProvider (startApp always overrides the provider) or a scripted one.

const A = SEED.acme;
const B = SEED.globex;
const HAPPY = 'need 20 laptops for new sales hires, ~€1,200 each, prefer Nordic Laptops';

let app: INestApplication;
let url: string;
let owner: pg.Client;
beforeAll(async () => {
  ({ app, url } = await startApp());
  owner = await ownerClient();
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

async function suggest(base: string, userId: string | undefined, body?: unknown) {
  const headers: Record<string, string> = {};
  if (userId) headers['X-User-Id'] = userId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}/purchase-requests/suggestion`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

async function requestCount(): Promise<number> {
  const { rows } = await owner.query('select count(*)::int as n from purchase_requests');
  return rows[0].n;
}

describe('POST /purchase-requests/suggestion with the mock', () => {
  it('suggests every field for the happy path, and writes nothing (criterion 6)', async () => {
    const before = await requestCount();
    const res = await suggest(url, A.requester, { description: `  ${HAPPY}  ` });
    expect(res.status).toBe(200);
    const { suggestion } = suggestionResponseSchema.parse(res.body);
    expect(suggestion).toEqual({
      title: HAPPY,
      category: 'hardware',
      quantity: 20,
      amountCents: 2_400_000,
      currency: 'EUR',
      supplierId: A.suppliers[1],
    });
    expect(await requestCount()).toBe(before);
  });

  it("gives Bella the same fields but no supplier: Nordic Laptops is Acme's (criterion 7)", async () => {
    const res = await suggest(url, B.requester, { description: HAPPY });
    expect(res.status).toBe(200);
    expect(suggestionResponseSchema.parse(res.body).suggestion).toMatchObject({
      category: 'hardware',
      quantity: 20,
      amountCents: 2_400_000,
      currency: 'EUR',
      supplierId: null,
    });
  });

  it('leaves out what the description lacks (criterion 8)', async () => {
    const res = await suggest(url, A.requester, { description: 'a box of pens for the office' });
    expect(res.status).toBe(200);
    expect(suggestionResponseSchema.parse(res.body).suggestion).toMatchObject({
      category: 'office_supplies',
      amountCents: null,
      currency: null,
      quantity: null,
      supplierId: null,
    });
  });

  it('answers an approver too: there is no role check (criterion 9)', async () => {
    const res = await suggest(url, A.approver, { description: HAPPY });
    expect(res.status).toBe(200);
    expect(suggestionResponseSchema.parse(res.body).suggestion).not.toBeNull();
  });

  it.each([
    ['{}', {}],
    ['an empty description', { description: '' }],
    ['a blank description', { description: '   ' }],
    ['2001 characters', { description: 'x'.repeat(2001) }],
    ['a tenantId', { description: 'x', tenantId: B.tenant }],
    ['a supplier list', { description: 'x', suppliers: [] }],
    ['no body', undefined],
  ])('answers 400 with issues for %s (criterion 9)', async (_name, body) => {
    const res = await suggest(url, A.requester, body);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(res.body);
    expect(error.statusCode).toBe(400);
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it('answers 401 without X-User-Id (criterion 9)', async () => {
    const res = await suggest(url, undefined, { description: HAPPY });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });

  it('falls back to null for mock:invalid, and repairs mock:repair (criterion 10)', async () => {
    const invalid = await suggest(url, A.requester, { description: 'mock:invalid laptops' });
    expect(invalid).toEqual({ status: 200, body: { suggestion: null } });
    const repair = await suggest(url, A.requester, { description: 'mock:repair 2 laptops' });
    expect(repair.status).toBe(200);
    expect(suggestionResponseSchema.parse(repair.body).suggestion).toMatchObject({
      category: 'hardware',
    });
  });
});

describe('POST /purchase-requests/suggestion, other providers', () => {
  it('falls back to null for mock:timeout at the deadline (criterion 10)', async () => {
    const short = await startApp({ suggestionDeadlineMs: 300 });
    try {
      const started = performance.now();
      const res = await suggest(short.url, A.requester, { description: 'mock:timeout laptops' });
      expect(res).toEqual({ status: 200, body: { suggestion: null } });
      expect(performance.now() - started).toBeLessThan(2_000);
    } finally {
      await short.app.close();
    }
  });

  it("gives the provider only Acme's suppliers, and drops Globex's id (criterion 7)", async () => {
    const inputs: SuggestionInput[] = [];
    const provider: SuggestionProvider = {
      name: 'mock',
      model: 'scripted',
      suggest(input) {
        inputs.push(input);
        return Promise.resolve({
          title: 'Laptops',
          category: 'hardware',
          quantity: 20,
          amountCents: 2_400_000,
          currency: 'EUR',
          supplierId: B.suppliers[1],
        });
      },
    };
    const scripted = await startApp({ suggestionProvider: provider });
    try {
      const res = await suggest(scripted.url, A.requester, { description: HAPPY });
      expect(res.status).toBe(200);
      expect(suggestionResponseSchema.parse(res.body).suggestion).toEqual({
        title: 'Laptops',
        category: 'hardware',
        quantity: 20,
        amountCents: 2_400_000,
        currency: 'EUR',
        supplierId: null,
      });
      expect(inputs).toHaveLength(1);
      expect(inputs[0].description).toBe(HAPPY);
      expect(inputs[0].suppliers).toEqual([
        { id: A.suppliers[0], name: 'Bright Office Supplies' },
        { id: A.suppliers[1], name: 'Nordic Laptops' },
      ]);
    } finally {
      await scripted.app.close();
    }
  });

  it('starts with the mock even when the shell names anthropic or junk (criterion 15)', async () => {
    const saved = { provider: process.env.LLM_PROVIDER, key: process.env.ANTHROPIC_API_KEY };
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'invalid';
    try {
      const started = await startApp();
      try {
        const res = await suggest(started.url, A.requester, { description: HAPPY });
        expect(suggestionResponseSchema.parse(res.body).suggestion).toMatchObject({
          supplierId: A.suppliers[1],
        });
      } finally {
        await started.app.close();
      }
      process.env.LLM_PROVIDER = 'foo';
      const junk = await startApp();
      await junk.app.close();
    } finally {
      restore('LLM_PROVIDER', saved.provider);
      restore('ANTHROPIC_API_KEY', saved.key);
    }
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
