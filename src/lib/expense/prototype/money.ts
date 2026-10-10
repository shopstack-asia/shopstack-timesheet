import { EXPENSE_CURRENCIES, type ExpenseCurrency } from '@/lib/expense/prototype/types';

const AMOUNT_SCALE = 2;
const RATE_SCALE = 6;

function assertDecimal(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a positive decimal`);
  }
  return trimmed;
}

function toScaled(value: string, scale: number, label: string): bigint {
  const trimmed = assertDecimal(value, label);
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > scale) {
    throw new Error(`${label} supports at most ${scale} decimal places`);
  }
  const digits = (fraction + '0'.repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(digits);
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function isExpenseCurrency(value: string): value is ExpenseCurrency {
  return (EXPENSE_CURRENCIES as readonly string[]).includes(value);
}

export function defaultExchangeRate(currency: ExpenseCurrency): string | null {
  return currency === 'THB' ? '1.00' : null;
}

/** Amount (THB) = amount × exchange rate, rounded half up to 2 decimal places. */
export function calculateAmountThb(amount: string, exchangeRate: string): string {
  const amountMinor = toScaled(amount, AMOUNT_SCALE, 'Amount');
  const rateMinor = toScaled(exchangeRate, RATE_SCALE, 'Exchange rate');
  if (amountMinor <= 0n) throw new Error('Amount must be greater than zero');
  if (rateMinor <= 0n) throw new Error('Exchange rate must be greater than zero');
  const product = amountMinor * rateMinor;
  const divisor = 10n ** BigInt(RATE_SCALE);
  const rounded = (product + divisor / 2n) / divisor;
  return fromScaled(rounded, AMOUNT_SCALE);
}

export function addThb(left: string, right: string): string {
  const sum =
    toScaled(left, AMOUNT_SCALE, 'Amount') + toScaled(right, AMOUNT_SCALE, 'Amount');
  return fromScaled(sum, AMOUNT_SCALE);
}

export function formatMoney(value: string): string {
  const negative = value.trim().startsWith('-');
  const [whole, fraction = '00'] = value.replace('-', '').split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withCommas}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
