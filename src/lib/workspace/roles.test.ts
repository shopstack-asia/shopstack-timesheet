import { describe, expect, it } from 'vitest';
import { canOpenWorkspacePath } from '@/lib/workspace/access';
import { parseEmployeeCodes, rolesForEmployee } from '@/lib/workspace/roles';

describe('workspace role assignments', () => {
  it('normalizes employee codes and rejects a malformed code', () => {
    expect(parseEmployeeCodes([' s0005 ', '', 'S0005'])).toEqual(['S0005']);
    expect(() => parseEmployeeCodes(['S 0005'])).toThrow(/invalid/);
  });

  it('keeps Settings for Administrator and Expense Management for both assigned roles', () => {
    expect(canOpenWorkspacePath('/settings/roles', ['EMPLOYEE'])).toBe(false);
    expect(canOpenWorkspacePath('/settings/roles', ['EMPLOYEE', 'HR'])).toBe(false);
    expect(canOpenWorkspacePath('/settings/roles', ['EMPLOYEE', 'ADMIN'])).toBe(true);
    expect(canOpenWorkspacePath('/expense/management/expenses', ['EMPLOYEE'])).toBe(false);
    expect(canOpenWorkspacePath('/expense/management/expenses', ['EMPLOYEE', 'HR'])).toBe(true);
    expect(canOpenWorkspacePath('/expense/mine', ['EMPLOYEE'])).toBe(true);
    expect(rolesForEmployee('S0005', [{ role: 'ADMIN', employeeCodes: ['S0005'] }])).toEqual([
      'EMPLOYEE',
      'ADMIN',
    ]);
  });
});
