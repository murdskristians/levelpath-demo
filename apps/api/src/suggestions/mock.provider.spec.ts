import { suggestionSchema } from '@levelpath/shared';
import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock.provider.js';
import type { SuggestionInput } from './suggestion-provider.js';

// Requirement 12: the MockProvider's fixed rules (criteria 6 to 8) and its three markers.

const ACME = [
  { id: 'a0000000-0000-4000-8000-000000000201', name: 'Bright Office Supplies' },
  { id: 'a0000000-0000-4000-8000-000000000202', name: 'Nordic Laptops' },
];
const GLOBEX = [
  { id: 'b0000000-0000-4000-8000-000000000201', name: 'Harbor Print Co' },
  { id: 'b0000000-0000-4000-8000-000000000202', name: 'Summit IT Hardware' },
];
const HAPPY = 'need 20 laptops for new sales hires, ~€1,200 each, prefer Nordic Laptops';

const mock = new MockProvider();
function suggest(description: string, over: Partial<SuggestionInput> = {}) {
  return mock.suggest({
    description,
    suppliers: ACME,
    signal: new AbortController().signal,
    timeoutMs: 15_000,
    ...over,
  });
}

describe('MockProvider rules', () => {
  it('names itself mock, model mock', () => {
    expect([mock.name, mock.model]).toEqual(['mock', 'mock']);
  });

  it('reads the happy-path description (criterion 6)', async () => {
    expect(await suggest(HAPPY)).toEqual({
      title: HAPPY,
      category: 'hardware',
      quantity: 20,
      amountCents: 2_400_000,
      currency: 'EUR',
      supplierId: ACME[1].id,
    });
  });

  it("finds no supplier among another company's (criterion 7)", async () => {
    expect(await suggest(HAPPY, { suppliers: GLOBEX })).toMatchObject({ supplierId: null });
  });

  it('gives nulls for what the text lacks (criterion 8)', async () => {
    expect(await suggest('a box of pens for the office')).toEqual({
      title: 'a box of pens for the office',
      category: 'office_supplies',
      quantity: null,
      amountCents: null,
      currency: null,
      supplierId: null,
    });
  });

  it.each([
    ['€1,200 each', null, 120_000, 'EUR'],
    ['$15', null, 1_500, 'USD'],
    ['3 chairs at £9.99 per chair', 3, 2_997, 'GBP'],
    ['2 laptops, €1,234,567.5 total', 2, 123_456_750, 'EUR'],
    ['5 notebooks $2.05 each', 5, 1_025, 'USD'],
  ])('reads %j as quantity %s, %i cents %s', async (text, quantity, cents, currency) => {
    expect(await suggest(text)).toMatchObject({ quantity, amountCents: cents, currency });
  });

  it.each([
    ['Design tool seats', 'software'],
    ['two flights to Riga', 'travel'],
    ['office cleaning', 'services'],
    ['something else entirely', 'other'],
    ['MONITORS', 'hardware'],
  ])('puts %j in %s', async (text, category) => {
    expect(await suggest(text)).toMatchObject({ category });
  });

  it('matches the supplier name ignoring case', async () => {
    expect(await suggest('pens from bright office supplies')).toMatchObject({
      supplierId: ACME[0].id,
    });
  });

  it('builds a title of at most 200 characters, without markers, never empty', async () => {
    const long = (await suggest(`${'x'.repeat(250)} laptops`)) as { title: string };
    expect(long.title).toHaveLength(200);
    expect(await suggest('mock:repair   2  laptops', { repairErrors: [] })).toMatchObject({
      title: '2 laptops',
    });
    expect(await suggest('mock:repair', { repairErrors: [] })).toMatchObject({
      title: 'Purchase request',
    });
  });

  it('gives output that passes suggestionSchema', async () => {
    for (const text of [HAPPY, 'a box of pens for the office', 'x']) {
      expect(suggestionSchema.safeParse(await suggest(text)).success).toBe(true);
    }
  });
});

describe('MockProvider markers', () => {
  it('mock:invalid fails the schema on every call, the repair call too', async () => {
    for (const repairErrors of [undefined, [{ path: 'title', message: 'x' }]]) {
      const out = await suggest('mock:invalid laptops', { repairErrors });
      expect(suggestionSchema.safeParse(out).success).toBe(false);
    }
  });

  it('mock:repair fails the first call only', async () => {
    const first = await suggest('mock:repair 2 laptops');
    expect(suggestionSchema.safeParse(first).success).toBe(false);
    const repaired = await suggest('mock:repair 2 laptops', { repairErrors: [] });
    expect(suggestionSchema.parse(repaired)).toMatchObject({ category: 'hardware', quantity: 2 });
  });

  it('mock:timeout waits for its signal and rejects with its reason', async () => {
    const controller = new AbortController();
    const pending = suggest('mock:timeout laptops', { signal: controller.signal });
    const reason = new Error('deadline');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('mock:timeout rejects at once when the signal has already aborted', async () => {
    const reason = new Error('already');
    await expect(suggest('mock:timeout', { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });
});
