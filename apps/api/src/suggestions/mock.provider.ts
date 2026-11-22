import type { PurchaseRequestCategory, Supplier } from '@levelpath/shared';
import type { SuggestionInput, SuggestionProvider } from './suggestion-provider.js';

// The default provider everywhere: deterministic fixed rules, no network (requirement 12).
// Three markers in the description drive the service's fallback paths without a model.

/** The first category whose keywords appear in the description wins; otherwise `other`. */
const CATEGORY_KEYWORDS: [PurchaseRequestCategory, string[]][] = [
  [
    'hardware',
    ['laptop', 'monitor', 'keyboard', 'mouse', 'computer', 'printer', 'phone', 'headset', 'tablet'],
  ],
  ['software', ['software', 'licence', 'license', 'subscription', 'seat', 'saas']],
  [
    'office_supplies',
    ['pen', 'pencil', 'paper', 'notebook', 'stapler', 'toner', 'envelope', 'marker', 'folder'],
  ],
  ['services', ['consulting', 'cleaning', 'training', 'maintenance', 'catering', 'audit']],
  ['travel', ['flight', 'hotel', 'train', 'taxi', 'travel', 'trip']],
];

const CURRENCY_OF_SYMBOL: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };

/** An integer followed by a space and a word, not part of an amount like `€1,200 each`. */
const QUANTITY = /(?<![\d,.€$£])(\d+) [A-Za-z]/;
/** `€1,200`, `$15`, `£9.99`: a symbol, digits with `,` thousands, optional cents. */
const AMOUNT = /([€$£])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;
const MARKER = /mock:\w+/g;
const MAX_QUANTITY = 1_000_000;

/** Output that fails `suggestionSchema`: an empty title and a category not in the list. */
const INVALID = { title: '', category: 'furniture' };

export class MockProvider implements SuggestionProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';

  suggest(input: SuggestionInput): Promise<unknown> {
    const { description, signal } = input;
    if (description.includes('mock:timeout')) return waitForAbort(signal);
    if (description.includes('mock:invalid')) return Promise.resolve(INVALID);
    // Fails the first call only: the repair call is the one that carries repairErrors.
    if (description.includes('mock:repair') && input.repairErrors === undefined) {
      return Promise.resolve(INVALID);
    }
    return Promise.resolve(suggestByRules(description, input.suppliers));
  }
}

/** Never resolves; rejects with the signal's reason once it aborts (at once if it has). */
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function suggestByRules(description: string, suppliers: Supplier[]) {
  const quantity = parseQuantity(description);
  const amount = parseAmount(description);
  const perItem = /\b(each|per)\b/i.test(description);
  return {
    title: titleOf(description),
    category: categoryOf(description),
    quantity,
    amountCents:
      amount && perItem && quantity !== null ? amount.cents * quantity : (amount?.cents ?? null),
    currency: amount?.currency ?? null,
    supplierId: supplierOf(description, suppliers),
  };
}

function titleOf(description: string): string {
  const title = description.replace(MARKER, ' ').replace(/\s+/g, ' ').trim().slice(0, 200).trim();
  return title === '' ? 'Purchase request' : title;
}

function categoryOf(description: string): PurchaseRequestCategory {
  for (const [category, words] of CATEGORY_KEYWORDS) {
    if (new RegExp(`\\b(${words.join('|')})s?\\b`, 'i').test(description)) return category;
  }
  return 'other';
}

function parseQuantity(description: string): number | null {
  const match = QUANTITY.exec(description);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

/** Integer cents from the digit strings, so no float ever holds the amount. */
function parseAmount(description: string): { cents: number; currency: string } | null {
  const match = AMOUNT.exec(description);
  if (!match) return null;
  const [, symbol, whole, fraction = ''] = match;
  const cents = Number(whole.replace(/,/g, '')) * 100 + Number(fraction.padEnd(2, '0'));
  return { cents, currency: CURRENCY_OF_SYMBOL[symbol] };
}

function supplierOf(description: string, suppliers: Supplier[]): string | null {
  const text = description.toLowerCase();
  return suppliers.find((s) => text.includes(s.name.toLowerCase()))?.id ?? null;
}
