import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createPurchaseRequestSchema,
  decisionSchema,
  MAX_AMOUNT_CENTS,
  MAX_DESCRIPTION_LENGTH,
  purchaseRequestSchema,
  suggestionRequestSchema,
  suggestionResponseSchema,
  suggestionSchema,
  updatePurchaseRequestSchema,
} from './purchase-requests.js';

const SUPPLIER = 'a0000000-0000-4000-8000-000000000201';
const valid = {
  title: 'Laptops',
  amountCents: 120000,
  currency: 'EUR',
  supplierId: SUPPLIER,
  category: 'hardware',
};

describe('createPurchaseRequestSchema', () => {
  it('accepts a valid request, trims the title, and defaults the currency to EUR and the description to empty', () => {
    expect(
      createPurchaseRequestSchema.parse({
        title: '  Laptops ',
        amountCents: 0,
        supplierId: SUPPLIER,
        category: 'hardware',
      }),
    ).toEqual({
      title: 'Laptops',
      amountCents: 0,
      currency: 'EUR',
      supplierId: SUPPLIER,
      category: 'hardware',
      description: '',
    });
  });

  it('trims the description and accepts the longest one', () => {
    expect(
      createPurchaseRequestSchema.parse({ ...valid, description: '  For the new hires  ' })
        .description,
    ).toBe('For the new hires');
    const longest = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
    expect(createPurchaseRequestSchema.parse({ ...valid, description: longest }).description).toBe(
      longest,
    );
  });

  it.each([
    ['an id the client picked', { id: 'a0000000-0000-4000-8000-000000000999' }],
    ['a tenant the client picked', { tenantId: 'b0000000-0000-4000-8000-000000000001' }],
    ['a status the client picked', { status: 'approved' }],
  ])('rejects %s (strict: unknown keys are refused)', (_what, extra) => {
    expect(createPurchaseRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it.each([
    ['an empty title', { title: '   ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a negative amount', { amountCents: -1 }],
    ['a fractional amount', { amountCents: 10.5 }],
    ['an amount over the cap', { amountCents: MAX_AMOUNT_CENTS + 1 }],
    ['an amount as a string', { amountCents: '100' }],
    ['a lowercase currency', { currency: 'eur' }],
    ['a supplier id that is no UUID', { supplierId: 'not-a-uuid' }],
    ['no category', { category: undefined }],
    ['a category outside the list', { category: 'furniture' }],
    ['a description over 2000 characters', { description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }],
  ])('rejects %s', (_what, change) => {
    expect(createPurchaseRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe('updatePurchaseRequestSchema', () => {
  it('behaves as create: defaults the currency and description', () => {
    expect(
      updatePurchaseRequestSchema.parse({
        title: 'Laptops',
        amountCents: 5,
        supplierId: SUPPLIER,
        category: 'hardware',
      }),
    ).toMatchObject({ currency: 'EUR', description: '' });
  });

  it.each([{ status: 'approved' }, { id: SUPPLIER }, { tenantId: SUPPLIER }])(
    'rejects the extra key %o',
    (extra) => {
      expect(updatePurchaseRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    },
  );
});

describe('decisionSchema', () => {
  it('accepts an approval without a comment', () => {
    expect(decisionSchema.parse({ decision: 'approved' })).toEqual({
      decision: 'approved',
      comment: '',
    });
  });

  it('requires a comment for a rejection, and says so on the comment field', () => {
    const result = decisionSchema.safeParse({ decision: 'rejected', comment: '  ' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['comment']);
    expect(decisionSchema.parse({ decision: 'rejected', comment: 'Over budget' }).comment).toBe(
      'Over budget',
    );
  });

  it('rejects an unknown decision and unknown keys', () => {
    expect(decisionSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: 'approved', approverId: SUPPLIER }).success).toBe(
      false,
    );
  });
});

describe('purchaseRequestSchema', () => {
  const response = {
    id: 'a0000000-0000-4000-8000-000000000303',
    title: 'Standing desks',
    amountCents: 640000,
    currency: 'EUR',
    status: 'approved',
    category: 'office_supplies',
    description: 'For the support team',
    supplier: { id: SUPPLIER, name: 'Bright Office Supplies' },
    requester: { id: 'a0000000-0000-4000-8000-000000000101', name: 'Alice' },
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    decision: {
      decision: 'approved',
      comment: null,
      approver: { id: 'a0000000-0000-4000-8000-000000000102', name: 'Amir' },
      decidedAt: '2026-11-20T10:00:00.000Z',
    },
  };

  it('reads a response as the API returns it, with or without a decision', () => {
    expect(purchaseRequestSchema.parse(response)).toEqual(response);
    expect(
      purchaseRequestSchema.parse({ ...response, status: 'draft', decision: null }).decision,
    ).toBeNull();
  });

  it('refuses a response that leaks a field the contract does not have', () => {
    expect(
      purchaseRequestSchema.safeParse({
        ...response,
        tenantId: 'a0000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});

describe('suggestionRequestSchema', () => {
  it('accepts a description and trims it', () => {
    expect(suggestionRequestSchema.parse({ description: '  20 laptops  ' })).toEqual({
      description: '20 laptops',
    });
  });

  it.each([
    ['an empty description', { description: '' }],
    ['a blank description', { description: '   ' }],
    ['a description over 2000 characters', { description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }],
    ['no description', {}],
    ['a tenant the client picked', { description: 'x', tenantId: SUPPLIER }],
    ['suppliers the client picked', { description: 'x', suppliers: [] }],
  ])('rejects %s', (_what, body) => {
    expect(suggestionRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('suggestionSchema', () => {
  const suggestion = {
    title: '20 laptops for new sales hires',
    category: 'hardware',
    quantity: 20,
    amountCents: 2_400_000,
    currency: 'EUR',
    supplierId: 'a0000000-0000-4000-8000-000000000202',
  };

  it('accepts a full suggestion, and null for every field the description lacks', () => {
    expect(suggestionSchema.parse(suggestion)).toEqual(suggestion);
    const empty = {
      ...suggestion,
      quantity: null,
      amountCents: null,
      currency: null,
      supplierId: null,
    };
    expect(suggestionSchema.parse(empty)).toEqual(empty);
  });

  // The real provider sends this schema to the model as JSON Schema. A default or a
  // transform would make that conversion fail or differ from what the API accepts.
  it('converts to a strict JSON Schema with every field required', () => {
    const json = z.toJSONSchema(suggestionSchema) as {
      additionalProperties: boolean;
      required: string[];
    };
    expect(json.additionalProperties).toBe(false);
    expect([...json.required].sort()).toEqual(
      ['amountCents', 'category', 'currency', 'quantity', 'supplierId', 'title'].sort(),
    );
  });

  // Spec criterion 11(f): what the model may get wrong is a schema failure, not a suggestion.
  it.each([
    ['a string, not an object', 'not json'],
    ['null', null],
    ['a quantity of 0', { ...suggestion, quantity: 0 }],
    ['a fractional amount', { ...suggestion, amountCents: 1.5 }],
    ['a lowercase currency', { ...suggestion, currency: 'eur' }],
    ['a category outside the list', { ...suggestion, category: 'furniture' }],
    ['a supplier id that is no UUID', { ...suggestion, supplierId: 'Nordic Laptops' }],
    ['an empty title', { ...suggestion, title: '  ' }],
    ['a missing field', { title: 'x', category: 'other' }],
    ['an extra field', { ...suggestion, tenantId: SUPPLIER }],
  ])('rejects %s', (_what, output) => {
    expect(suggestionSchema.safeParse(output).success).toBe(false);
  });
});

describe('suggestionResponseSchema', () => {
  it('accepts no suggestion', () => {
    expect(suggestionResponseSchema.parse({ suggestion: null })).toEqual({ suggestion: null });
  });

  it('refuses a body without the suggestion key', () => {
    expect(suggestionResponseSchema.safeParse({}).success).toBe(false);
  });
});
