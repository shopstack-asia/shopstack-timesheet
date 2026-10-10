import type { ExpenseCategory } from '@/lib/expense/prototype/types';

/** Codes follow the ShopStack expense claim form reference list. */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  { code: '413', name: 'Office Supplies' },
  { code: '415', name: 'Small Equipment' },
  { code: '420', name: 'Computer Supplies' },
  { code: '421', name: 'Postage' },
  { code: '422', name: 'Printing & Stationery' },
  { code: '423', name: 'Subscriptions' },
  { code: '425', name: 'Miscellaneous Expenses' },
  { code: '426', name: 'Repairs and Maintenance' },
  { code: '427', name: 'Bank Fees' },
  { code: '430', name: 'Telephone & Mobile' },
  { code: '431', name: 'Internet' },
  { code: '450', name: 'Flights' },
  { code: '451', name: 'Hotels' },
  { code: '452', name: 'Meals (Travel)' },
  { code: '453', name: 'Taxis and Ground Transportation' },
  { code: '454', name: 'Other Travel (Toll, Mileage, Fuel)' },
  { code: '455', name: 'Messenger Service' },
  { code: '456', name: 'Car Park Expenses' },
  { code: '462', name: 'Customer/Investor Entertainment' },
];

export function getExpenseCategory(code: string): ExpenseCategory | undefined {
  return EXPENSE_CATEGORIES.find((category) => category.code === code);
}

export function expenseCodeForCategory(code: string): string {
  const category = getExpenseCategory(code);
  if (!category) {
    throw new Error(`Unknown expense category: ${code}`);
  }
  return category.code;
}
