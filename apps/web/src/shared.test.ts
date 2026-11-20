import { createPurchaseRequestSchema, PURCHASE_REQUEST_STATUSES } from '@levelpath/shared';
import { describe, expect, it } from 'vitest';

// The web app reads the API contract from packages/shared, the same schemas the API
// validates with. This proves the wiring the Phase 3 UI work builds on.
describe('@levelpath/shared in the web app', () => {
  it('validates a form the way the API will', () => {
    const form = {
      title: 'Laptops',
      amountCents: 120000,
      supplierId: 'a0000000-0000-4000-8000-000000000201',
    };
    expect(createPurchaseRequestSchema.parse(form).currency).toBe('EUR');
    expect(createPurchaseRequestSchema.safeParse({ ...form, amountCents: -1 }).success).toBe(false);
  });

  it('knows the statuses a request can have', () => {
    expect(PURCHASE_REQUEST_STATUSES).toEqual(['draft', 'submitted', 'approved', 'rejected']);
  });
});
