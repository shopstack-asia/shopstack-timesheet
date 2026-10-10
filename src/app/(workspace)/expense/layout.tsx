'use client';

import { ExpenseProvider } from '@/components/expense/prototype/ExpenseProvider';

export default function ExpenseSectionLayout({ children }: { children: React.ReactNode }) {
  return <ExpenseProvider>{children}</ExpenseProvider>;
}
