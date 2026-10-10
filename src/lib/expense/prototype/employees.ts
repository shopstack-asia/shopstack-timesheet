import type { DemoEmployee } from '@/lib/expense/prototype/types';

/** Fictional people used only by the local expense prototype. */
export const DEMO_EMPLOYEES: readonly DemoEmployee[] = [
  { id: 'demo-somchai', code: 'S9001', name: 'Somchai', businessUnit: 'Engineering' },
  { id: 'demo-somsri', code: 'S9002', name: 'Somsri', businessUnit: 'Operations' },
  { id: 'demo-somying', code: 'S9003', name: 'Somying', businessUnit: 'Sales' },
];

export function getDemoEmployee(id: string): DemoEmployee | undefined {
  return DEMO_EMPLOYEES.find((employee) => employee.id === id);
}
