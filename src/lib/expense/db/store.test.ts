import { describe, expect, it } from 'vitest';
import { EXPENSE_MIGRATIONS } from '@/lib/expense/db/migrations';
import { driveDeleteNeedsTrash, driveFilesToRemove, expenseDrivePath, isDrivePermissionDenied, isMissingDriveFile } from '@/lib/expense/drive/folders';
import { mapClaimRow, mapExpenseRow } from '@/lib/expense/db/store';
import { expenseEmployeeFromProfile } from '@/lib/expense/employee';
import type { StaffProfile } from '@/types';

const profile: StaffProfile = {
  EmployeeID: ' S0005 ',
  FirstName: 'Anong',
  LastName: 'Siri',
  Nickname: 'Ann',
  Email: 'anong@shopstack.asia',
  Position: ' Finance ',
};

describe('expense database ledger', () => {
  it('maps a Zoho profile to the expense requester', () => {
    expect(expenseEmployeeFromProfile(profile)).toEqual({
      id: 'S0005',
      code: 'S0005',
      name: 'Anong Siri',
      businessUnit: 'Finance',
    });
  });

  it('maps stored expense and claim rows', () => {
    const entry = mapExpenseRow({
      id: 'expense-1',
      employee_id: 'S0005',
      employee_code: 'S0005',
      employee_name: 'Anong Siri',
      business_unit: 'Finance',
      expense_date: '2026-10-10',
      category_code: '453',
      description: 'Taxi',
      currency: 'THB',
      amount: '350.00',
      exchange_rate: '1.00',
      amount_thb: '350.00',
      project_label: '',
      request_number: 'EXP-2026-000001',
      status: 'DRAFT',
      claim_id: null,
      created_at: new Date('2026-10-10T01:00:00.000Z'),
      updated_at: '2026-10-10T01:00:00.000Z',
    });
    expect(entry.requestNumber).toBe('EXP-2026-000001');
    expect(entry.employeeCode).toBe('S0005');
    expect(entry.claimId).toBeNull();
    expect(entry.createdAt).toBe('2026-10-10T01:00:00.000Z');
    const claim = mapClaimRow(
      {
        id: 'claim-1',
        claim_number: 'EXP-2026-10-0001',
        employee_id: 'S0005',
        employee_code: 'S0005',
        employee_name: 'Anong Siri',
        business_unit: 'Finance',
        year: 2026,
        month: 10,
        purpose: 'October',
        claim_date: '2026-10-10',
        total_thb: '350.00',
        status: 'PROCESSING',
        created_at: '2026-10-10T01:00:00.000Z',
      },
      ['expense-1']
    );
    expect(claim.expenseIds).toEqual(['expense-1']);
    expect(claim.employeeCode).toBe('S0005');
  });

  it('creates the expense tables and seeds the taxi category', () => {
    const migration = EXPENSE_MIGRATIONS.find((item) => item.id === '001_expense_ledger');
    expect(migration?.sql).toContain('CREATE TABLE expense_entries');
    expect(migration?.sql).toContain('CREATE TABLE expense_attachments');
    expect(migration?.sql).toContain("'453', 'Taxis and Ground Transportation'");
    const numbers = EXPENSE_MIGRATIONS.find((item) => item.id === '002_expense_request_numbers');
    expect(numbers?.sql).toContain('request_number');
    expect(numbers?.sql).toContain('drive_file_id');
    const roles = EXPENSE_MIGRATIONS.find((item) => item.id === '003_workspace_role_members');
    expect(roles?.sql).toContain('workspace_role_members');
    expect(roles?.sql).toContain("'ADMIN', 'S0005'");
  });

  it('uses the request number as the Drive folder under its year', () => {
    expect(expenseDrivePath('EXP-2026-000001')).toEqual({ year: '2026', name: 'EXP-2026-000001' });
    expect(() => expenseDrivePath('EXP-2026-10-0001')).toThrow(/invalid/);
    expect(isMissingDriveFile({ code: 404, message: 'File not found: 1b4yt8.' })).toBe(true);
    expect(isMissingDriveFile(new Error('Could not upload receipt.pdf: denied'))).toBe(false);
    expect(isDrivePermissionDenied({ code: 403, message: 'The user does not have sufficient permissions for this file.' })).toBe(true);
    expect(isDrivePermissionDenied({ code: 404, message: 'File not found: .' })).toBe(false);
    expect(driveDeleteNeedsTrash({ code: 404, message: 'File not found: 1abc.' })).toBe(true);
    expect(driveDeleteNeedsTrash(new Error('Could not upload receipt.pdf: denied'))).toBe(false);
    expect(expenseDrivePath('EXP-2026-000001').name).toBe('EXP-2026-000001');
    expect(
      driveFilesToRemove({
        storedFileId: 'stored-id',
        fileName: 'Hertz_Thailand_CR_SRS_20260825.pdf',
        listed: [{ id: 'folder-file', name: 'Hertz_Thailand_CR_SRS_20260825.pdf' }],
      })
    ).toEqual(['stored-id', 'folder-file']);
  });
});
