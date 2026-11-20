import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12.34', 1234],
    ['0.29', 29],
    ['1.15', 115],
    ['12.5', 1250],
    ['7', 700],
    [' 3.00 ', 300],
  ])('parses %s', (text, cents) => {
    expect(parseAmountToCents(text)).toBe(cents);
  });

  it.each(['-1', 'abc', '1,5', '', '1.234', '.5'])('rejects %j', (text) => {
    expect(parseAmountToCents(text)).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats in the currency', () => {
    expect(formatAmount(125000, 'EUR')).toBe(
      new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(1250),
    );
  });

  it('survives an unknown currency code', () => {
    expect(formatAmount(150, 'ZZ')).toBe('1.50 ZZ');
  });
});
