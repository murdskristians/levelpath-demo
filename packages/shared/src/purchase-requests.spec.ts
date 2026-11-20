import { describe, expect, it } from 'vitest';
import {
  createPurchaseRequestSchema,
  decisionSchema,
  MAX_AMOUNT_CENTS,
  purchaseRequestSchema,
} from './purchase-requests.js';

const SUPPLIER = 'a0000000-0000-4000-8000-000000000201';
const valid = { title: 'Laptops', amountCents: 120000, currency: 'EUR', supplierId: SUPPLIER };

describe('createPurchaseRequestSchema', () => {
  it('accepts a valid request, trims the title, and defaults the currency to EUR', () => {
    expect(
      createPurchaseRequestSchema.parse({
        title: '  Laptops ',
        amountCents: 0,
        supplierId: SUPPLIER,
      }),
    ).toEqual({ title: 'Laptops', amountCents: 0, currency: 'EUR', supplierId: SUPPLIER });
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
  ])('rejects %s', (_what, change) => {
    expect(createPurchaseRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
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
