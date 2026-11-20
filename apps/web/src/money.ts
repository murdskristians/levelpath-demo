export function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    // An unknown currency code: show the plain number and the code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "12.34" to 1234, by string digits so there is no float error. Null when not an amount. */
export function parseAmountToCents(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
