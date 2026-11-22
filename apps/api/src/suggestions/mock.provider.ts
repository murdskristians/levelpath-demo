import type { PurchaseRequestCategory, Supplier } from '@levelpath/shared';
import type { SuggestionInput, SuggestionProvider } from './suggestion-provider.js';

// The default provider everywhere: deterministic fixed rules, no network (requirement 12).
// Three markers in the description drive the service's fallback paths without a model.

/**
 * The longest keyword found in the description decides, so a phrase beats a word inside it
 * (`printer paper` is office supplies, `printer` alone hardware). On a tie the earlier
 * category in this table wins; with no keyword, `other`.
 */
const CATEGORY_KEYWORDS: [PurchaseRequestCategory, string[]][] = [
  [
    'hardware',
    [
      'laptop',
      'monitor',
      'keyboard',
      'mouse',
      'computer',
      'printer',
      'phone',
      'headset',
      'tablet',
      'docking station',
    ],
  ],
  ['software', ['software', 'licence', 'license', 'subscription', 'seat', 'saas']],
  [
    'office_supplies',
    [
      'pen',
      'pencil',
      'paper',
      'printer paper',
      'notebook',
      'stapler',
      'toner',
      'envelope',
      'marker',
      'folder',
    ],
  ],
  ['services', ['consulting', 'cleaning', 'training', 'maintenance', 'catering', 'audit']],
  ['travel', ['flight', 'hotel', 'train', 'taxi', 'travel', 'trip']],
];

const CURRENCY_OF_SYMBOL: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };

/** An integer followed by a space and a word, not part of an amount like `€1,200 each`. */
const QUANTITY = /(?<![\d,.€$£])(\d+) [A-Za-z]/;
/** Quantities written as words, `one` to `twelve`; the index plus one is the number. */
const NUMBER_WORDS = 'one two three four five six seven eight nine ten eleven twelve'.split(' ');
/** `Two laptops`: a number word followed by a space and a word. */
const QUANTITY_WORD = new RegExp(`\\b(${NUMBER_WORDS.join('|')}) [A-Za-z]`, 'i');
/** Digits with `,` thousands and optional cents: `1,200`, `15`, `9.99`. */
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
/** The three ways an amount is written: `€1,200`, `EUR 1,200`, `1,200.00 EUR`. */
const AMOUNT_FORMS: { pattern: RegExp; read: (m: RegExpExecArray) => [string, string, string] }[] =
  [
    {
      pattern: new RegExp(String.raw`([€$£])\s?${NUMBER}`),
      read: (m) => [CURRENCY_OF_SYMBOL[m[1]], m[2], m[3] ?? ''],
    },
    {
      pattern: new RegExp(String.raw`\b(EUR|USD|GBP)\s?${NUMBER}`),
      read: (m) => [m[1], m[2], m[3] ?? ''],
    },
    {
      pattern: new RegExp(String.raw`(?<![\d,.])${NUMBER}\s?(EUR|USD|GBP)\b`),
      read: (m) => [m[3], m[1], m[2] ?? ''],
    },
  ];
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
  let best: { category: PurchaseRequestCategory; length: number } | null = null;
  for (const [category, words] of CATEGORY_KEYWORDS) {
    for (const word of words) {
      if (word.length <= (best?.length ?? 0)) continue;
      if (new RegExp(`\\b${word}s?\\b`, 'i').test(description))
        best = { category, length: word.length };
    }
  }
  return best?.category ?? 'other';
}

/** Whichever comes first in the text: a digit quantity (`20 laptops`) or a word (`Two laptops`). */
function parseQuantity(description: string): number | null {
  const digits = QUANTITY.exec(description);
  const word = QUANTITY_WORD.exec(description);
  let n: number;
  if (digits && (!word || digits.index < word.index)) n = Number(digits[1]);
  else if (word) n = NUMBER_WORDS.indexOf(word[1].toLowerCase()) + 1;
  else return null;
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

/**
 * The first amount in the text, in any of the three forms. Integer cents from the digit
 * strings, so no float ever holds the amount.
 */
function parseAmount(description: string): { cents: number; currency: string } | null {
  let first: { index: number; parts: [string, string, string] } | null = null;
  for (const { pattern, read } of AMOUNT_FORMS) {
    const match = pattern.exec(description);
    if (match && (!first || match.index < first.index)) {
      first = { index: match.index, parts: read(match) };
    }
  }
  if (!first) return null;
  const [currency, whole, fraction] = first.parts;
  const cents = Number(whole.replace(/,/g, '')) * 100 + Number(fraction.padEnd(2, '0'));
  return { cents, currency };
}

function supplierOf(description: string, suppliers: Supplier[]): string | null {
  const text = description.toLowerCase();
  return suppliers.find((s) => text.includes(s.name.toLowerCase()))?.id ?? null;
}
