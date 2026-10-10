import { describe, expect, it } from 'vitest';
import {
  authorizeExpenseManagement,
  canAccessExpenseManagement,
  resolveWorkspaceRoles,
  type WorkspaceRole,
} from '@/lib/workspace/authorization';
import type { StaffProfile } from '@/types';

function profile(partial: Partial<StaffProfile> = {}): StaffProfile {
  return {
    EmployeeID: 'S0001',
    FirstName: 'Ada',
    LastName: 'Lovelace',
    Nickname: 'Ada',
    Email: 'ada@shopstack.asia',
    Position: 'Engineer',
    ...partial,
  };
}

describe('workspace roles', () => {
  it('assigns EMPLOYEE only, including when the job title or email looks administrative', () => {
    expect(resolveWorkspaceRoles(undefined)).toEqual(['EMPLOYEE']);
    expect(
      resolveWorkspaceRoles(
        profile({
          Email: 'admin@shopstack.asia',
          Position: 'HR Manager',
        })
      )
    ).toEqual(['EMPLOYEE']);
    expect(
      resolveWorkspaceRoles(profile({ Email: 'hr@shopstack.asia', Position: 'Admin' }))
    ).toEqual(['EMPLOYEE']);
  });

  it('grants HR or ADMIN only from stored employee codes', () => {
    expect(
      resolveWorkspaceRoles(profile({ EmployeeID: 'S0005', Position: 'Engineer' }), [
        { role: 'ADMIN', employeeCodes: ['S0005'] },
      ])
    ).toEqual(['EMPLOYEE', 'ADMIN']);
    expect(
      resolveWorkspaceRoles(profile({ EmployeeID: 's0010' }), [
        { role: 'HR', employeeCodes: ['S0010'] },
      ])
    ).toEqual(['EMPLOYEE', 'HR']);
    expect(
      resolveWorkspaceRoles(profile({ EmployeeID: 'S0005' }), [
        { role: 'ADMIN', employeeCodes: ['S0001'] },
      ])
    ).toEqual(['EMPLOYEE']);
  });

  it('allows Expense Management only for HR or ADMIN roles', () => {
    const cases: Array<[WorkspaceRole[], boolean]> = [
      [['EMPLOYEE'], false],
      [['HR'], true],
      [['ADMIN'], true],
      [['EMPLOYEE', 'HR'], true],
    ];
    for (const [roles, allowed] of cases) {
      expect(canAccessExpenseManagement(roles)).toBe(allowed);
    }
  });
});

describe('authorizeExpenseManagement', () => {
  it('rejects a missing session', () => {
    expect(authorizeExpenseManagement(null)).toEqual({
      allowed: false,
      status: 401,
      error: 'Authentication required',
      roles: [],
    });
    const missing = authorizeExpenseManagement(undefined);
    expect(missing.allowed).toBe(false);
    if (!missing.allowed) {
      expect(missing.status).toBe(401);
    }
  });

  it('rejects an authenticated employee while role mapping is unavailable', () => {
    const decision = authorizeExpenseManagement({ staffProfile: profile() });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.status).toBe(403);
      expect(decision.roles).toEqual(['EMPLOYEE']);
    }
  });

  it('allows an assigned administrator', () => {
    const decision = authorizeExpenseManagement(
      { staffProfile: profile({ EmployeeID: 'S0005' }) },
      [{ role: 'ADMIN', employeeCodes: ['S0005'] }]
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.roles).toEqual(['EMPLOYEE', 'ADMIN']);
  });
});
