import { describe, expect, it } from 'vitest';
import { expenseCodeForCategory } from '@/lib/expense/prototype/categories';
import { createMemoryExpenseDatabase } from '@/lib/expense/prototype/memory-db';
import { addThb, calculateAmountThb, formatMoney } from '@/lib/expense/prototype/money';
import {
  cancelExpense,
  createExpense,
  createMonthlyClaim,
  deleteCategory,
  markClaimPaid,
  markExpensePaid,
  deleteDraftExpense,
  deleteExpenseRecord,
  deleteMonthlyClaim,
  groupEligibleClaimExpenses,
  listCategories,
  saveCategories,
  saveCategory,
  submitExpense,
  updateDraftExpense,
} from '@/lib/expense/prototype/service';
import { validateAttachmentFile, validateExpenseDraft } from '@/lib/expense/prototype/validation';
import type { SaveExpenseInput } from '@/lib/expense/prototype/service';
import type { ExpenseEntry } from '@/lib/expense/prototype/types';

function draft(overrides: Partial<SaveExpenseInput> = {}): SaveExpenseInput {
  return {
    employeeId: 'demo-somchai',
    expenseDate: '2026-09-05',
    categoryCode: '453',
    description: 'Taxi',
    currency: 'THB',
    amount: '350.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
    ...overrides,
  };
}

describe('expense money and categories', () => {
  it('derives the expense code from the category', () => {
    expect(expenseCodeForCategory('462')).toBe('462');
  });

  it('converts foreign amounts to THB with half-up rounding', () => {
    expect(calculateAmountThb('350.00', '1.00')).toBe('350.00');
    expect(calculateAmountThb('10.10', '1.005')).toBe('10.15');
    expect(calculateAmountThb('120.00', '36.50')).toBe('4380.00');
    expect(addThb('350.00', '2500.00')).toBe('2850.00');
    expect(formatMoney('3800.00')).toBe('3,800.00');
  });

  it('requires an exchange rate for foreign currency and rejects bad files', () => {
    expect(validateExpenseDraft({ ...draft(), currency: 'USD', exchangeRate: '' }).exchangeRate).toBeTruthy();
    expect(validateExpenseDraft(draft())).toEqual({});
    expect(validateAttachmentFile({ name: 'notes.txt', type: 'text/plain', size: 10 })).toMatch(/PDF, JPG, or PNG/);
    expect(validateAttachmentFile({ name: 'a.pdf', type: 'application/pdf', size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
    expect(validateAttachmentFile({ name: 'a.jpg', type: 'image/jpeg', size: 20 })).toBeNull();
  });
});

describe('expense entries and monthly claims', () => {
  it('creates, edits, submits, and cancels a draft', async () => {
    const db = createMemoryExpenseDatabase();
    const created = await createExpense(db, draft());
    expect(created.status).toBe('DRAFT');
    expect(created.amountThb).toBe('350.00');
    const updated = await updateDraftExpense(db, created.id, draft({ description: 'Airport taxi', amount: '400.00' }));
    expect(updated.description).toBe('Airport taxi');
    expect(updated.amountThb).toBe('400.00');
    const submitted = await submitExpense(db, created.id);
    expect(submitted.status).toBe('SUBMITTED');
    await expect(updateDraftExpense(db, created.id, draft())).rejects.toThrow(/draft/);
    const cancelled = await cancelExpense(db, created.id);
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('stores multiple attachments and removes one', async () => {
    const db = createMemoryExpenseDatabase();
    const first = new Blob(['one'], { type: 'image/png' });
    const second = new Blob(['two'], { type: 'application/pdf' });
    const created = await createExpense(
      db,
      draft({
        newAttachments: [
          { fileName: 'a.png', mimeType: 'image/png', size: first.size, blob: first },
          { fileName: 'b.pdf', mimeType: 'application/pdf', size: second.size, blob: second },
        ],
      })
    );
    expect(await db.listAttachments(created.id)).toHaveLength(2);
    const [remove] = await db.listAttachments(created.id);
    await updateDraftExpense(db, created.id, draft({ removeAttachmentIds: [remove.id] }));
    const left = await db.listAttachments(created.id);
    expect(left).toHaveLength(1);
    expect(await db.getAttachment(left[0].id)).toMatchObject({ fileName: left[0].fileName });
  });

  it('deletes only drafts', async () => {
    const db = createMemoryExpenseDatabase();
    const created = await createExpense(db, draft());
    await deleteDraftExpense(db, created.id);
    expect(await db.listExpenses()).toHaveLength(0);
    const submitted = await createExpense(db, draft({ description: 'Submitted' }));
    await submitExpense(db, submitted.id);
    await expect(deleteDraftExpense(db, submitted.id)).rejects.toThrow(/Only draft/);
  });

  it('deletes an expense in any status and deletes a paid claim without removing its expenses', async () => {
    const db = createMemoryExpenseDatabase();
    const created = await createExpense(db, draft({ description: 'Taxi', amount: '100.00' }));
    await submitExpense(db, created.id);
    await deleteExpenseRecord(db, created.id, { anyStatus: true });
    expect(await db.listExpenses()).toHaveLength(0);

    const kept = await createExpense(db, draft({ description: 'Dinner', amount: '200.00' }));
    await submitExpense(db, kept.id);
    const claim = await createMonthlyClaim(db, {
      employeeId: 'demo-somchai',
      year: 2026,
      month: 9,
      purpose: 'September expenses',
      claimDate: '2026-10-01',
    });
    await markClaimPaid(db, claim.id);
    await deleteMonthlyClaim(db, claim.id);
    expect(await db.listClaims()).toHaveLength(0);
    const remaining = (await db.listExpenses()).find((entry) => entry.id === kept.id);
    expect(remaining?.status).toBe('PAID');
    expect(remaining?.claimId).toBeNull();
  });

  it('groups only submitted expenses that are not already on a claim', () => {
    const entry = (overrides: Partial<ExpenseEntry>): ExpenseEntry => ({
      id: 'expense-1',
      employeeId: 'S0005',
      employeeCode: 'S0005',
      employeeName: 'Prakasit Kitrakham',
      businessUnit: 'Chief Technology Officer',
      expenseDate: '2026-10-05',
      categoryCode: '453',
      description: 'Taxi',
      currency: 'THB',
      amount: '100.00',
      exchangeRate: '1.00',
      amountThb: '100.00',
      projectLabel: '',
      requestNumber: 'EXP-2026-000001',
      status: 'SUBMITTED',
      claimId: null,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
      ...overrides,
    });
    const groups = groupEligibleClaimExpenses(
      [
        entry({ id: 'waiting', amountThb: '100.00' }),
        entry({ id: 'another', employeeId: 'S0005', amountThb: '50.00', description: 'Meal' }),
        entry({ id: 'paid', status: 'PAID' }),
        entry({ id: 'draft', status: 'DRAFT' }),
        entry({ id: 'claimed', claimId: 'claim-1' }),
        entry({ id: 'other-month', expenseDate: '2026-09-05' }),
        entry({
          id: 'other-person',
          employeeId: 'S0008',
          employeeName: 'Anong Siri',
          businessUnit: 'Finance',
          amountThb: '20.00',
        }),
      ],
      2026,
      10
    );
    expect(groups.map((group) => group.employeeId)).toEqual(['S0008', 'S0005']);
    expect(groups.find((group) => group.employeeId === 'S0005')?.entries.map((item) => item.id)).toEqual(['another', 'waiting']);
    expect(groups.find((group) => group.employeeId === 'S0005')?.totalThb).toBe('150.00');
    expect(groupEligibleClaimExpenses([entry({ status: 'PAID' })], 2026, 10)).toEqual([]);
  });

  it('consolidates submitted expenses and blocks a second claim', async () => {
    const db = createMemoryExpenseDatabase();
    const taxi = await createExpense(db, draft({ amount: '350.00', description: 'Taxi' }));
    const dinner = await createExpense(
      db,
      draft({ expenseDate: '2026-09-12', categoryCode: '462', description: 'Customer dinner', amount: '2500.00' })
    );
    const draftEntry = await createExpense(
      db,
      draft({ expenseDate: '2026-09-20', description: 'Still drafting', amount: '50.00' })
    );
    const cancelled = await createExpense(
      db,
      draft({ expenseDate: '2026-09-21', description: 'Void', amount: '80.00' })
    );
    await submitExpense(db, taxi.id);
    await submitExpense(db, dinner.id);
    await cancelExpense(db, cancelled.id);

    const claim = await createMonthlyClaim(db, {
      employeeId: 'demo-somchai',
      year: 2026,
      month: 9,
      purpose: 'September expenses',
      claimDate: '2026-10-01',
    });
    expect(claim.claimNumber).toBe('EXP-2026-09-0001');
    expect(claim.expenseIds).toEqual([taxi.id, dinner.id]);
    expect(claim.totalThb).toBe('2850.00');
    expect(claim.status).toBe('PROCESSING');
    const saved = await db.listExpenses();
    expect(saved.find((entry) => entry.id === draftEntry.id)?.claimId).toBeNull();
    expect(saved.find((entry) => entry.id === cancelled.id)?.claimId).toBeNull();
    expect(saved.find((entry) => entry.id === taxi.id)?.claimId).toBe(claim.id);
    await expect(
      createMonthlyClaim(db, {
        employeeId: 'demo-somchai',
        year: 2026,
        month: 9,
        purpose: 'Again',
        claimDate: '2026-10-02',
      })
    ).rejects.toThrow(/No submitted expenses/);
  });

  it('issues a request number per expense and does not reuse it after delete', async () => {
    const db = createMemoryExpenseDatabase();
    const first = await createExpense(db, draft({ expenseDate: '2026-10-01', description: 'First' }));
    const second = await createExpense(db, draft({ expenseDate: '2026-10-02', description: 'Second' }));
    const otherYear = await createExpense(db, draft({ expenseDate: '2027-01-04', description: 'Next year' }));
    expect(first.requestNumber).toBe('EXP-2026-000001');
    expect(second.requestNumber).toBe('EXP-2026-000002');
    expect(otherYear.requestNumber).toBe('EXP-2027-000001');
    await deleteDraftExpense(db, first.id);
    const third = await createExpense(db, draft({ expenseDate: '2026-10-03', description: 'Third' }));
    expect(third.requestNumber).toBe('EXP-2026-000003');
  });

  it('stores the employee supplied by the caller', async () => {
    const db = createMemoryExpenseDatabase();
    const created = await createExpense(db, draft({ employeeId: 'S0005' }), {
      id: 'S0005',
      code: 'S0005',
      name: 'Real Person',
      businessUnit: 'Engineering',
    });
    expect(created.employeeCode).toBe('S0005');
    expect(created.employeeName).toBe('Real Person');
    expect(created.businessUnit).toBe('Engineering');
  });

  it('adds a category and refuses to delete one that an expense uses', async () => {
    const db = createMemoryExpenseDatabase();
    await saveCategory(db, { code: '499', name: 'Demo Supplies' });
    const created = await createExpense(db, draft({ categoryCode: '499', description: 'New category' }));
    expect(created.categoryCode).toBe('499');
    expect((await listCategories(db)).some((category) => category.code === '499')).toBe(true);
    await expect(deleteCategory(db, '499')).rejects.toThrow(/used by an expense/);
    await deleteDraftExpense(db, created.id);
    await deleteCategory(db, '499');
    expect((await listCategories(db)).some((category) => category.code === '499')).toBe(false);
  });

  it('saves renamed, added, and deleted categories in one write', async () => {
    const db = createMemoryExpenseDatabase();
    const current = await listCategories(db);
    const next = current
      .filter((category) => category.code !== '421')
      .map((category) => (category.code === '413' ? { code: '413', name: 'Office Materials' } : category));
    await saveCategories(db, [...next, { code: '499', name: 'Demo Supplies' }, { code: '', name: '' }]);
    const saved = await listCategories(db);
    expect(saved.some((category) => category.code === '421')).toBe(false);
    expect(saved.find((category) => category.code === '413')?.name).toBe('Office Materials');
    expect(saved.find((category) => category.code === '499')?.name).toBe('Demo Supplies');
    expect(saved).toEqual([...saved].sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true })));
  });

  it('keeps the stored categories when a batch delete removes one an expense uses', async () => {
    const db = createMemoryExpenseDatabase();
    const before = await listCategories(db);
    await createExpense(db, draft({ categoryCode: '413', description: 'Paper' }));
    await expect(saveCategories(db, before.filter((category) => category.code !== '413'))).rejects.toThrow(
      /used by an expense/
    );
    expect(await listCategories(db)).toEqual(before);
  });

  it('keeps the stored categories when a batch contains a duplicated code', async () => {
    const db = createMemoryExpenseDatabase();
    const before = await listCategories(db);
    await expect(saveCategories(db, [...before, { code: '413', name: 'Again' }])).rejects.toThrow(/duplicated/);
    expect(await listCategories(db)).toEqual(before);
  });

  it('marks a submitted expense paid without removing its claim number', async () => {
    const db = createMemoryExpenseDatabase();
    const submitted = await createExpense(db, draft());
    await submitExpense(db, submitted.id);
    const claim = await createMonthlyClaim(db, {
      employeeId: 'demo-somchai',
      year: 2026,
      month: 9,
      purpose: 'September',
      claimDate: '2026-10-01',
    });
    const paid = await markExpensePaid(db, submitted.id);
    expect(paid.status).toBe('PAID');
    expect(paid.claimId).toBe(claim.id);
    expect((await db.listClaims()).find((item) => item.id === claim.id)?.status).toBe('PAID');
    await expect(markExpensePaid(db, submitted.id)).rejects.toThrow(/submitted/);
    await expect(cancelExpense(db, submitted.id)).rejects.toThrow(/Paid expenses/);
  });

  it('marks a processing claim paid and pays its submitted expenses', async () => {
    const db = createMemoryExpenseDatabase();
    const submitted = await createExpense(db, draft());
    await submitExpense(db, submitted.id);
    const claim = await createMonthlyClaim(db, {
      employeeId: 'demo-somchai',
      year: 2026,
      month: 9,
      purpose: 'September',
      claimDate: '2026-10-01',
    });
    expect(claim.status).toBe('PROCESSING');
    const paid = await markClaimPaid(db, claim.id);
    expect(paid.status).toBe('PAID');
    expect((await db.listExpenses()).find((entry) => entry.id === submitted.id)?.status).toBe('PAID');
    await expect(markClaimPaid(db, claim.id)).rejects.toThrow(/already paid/);
  });
});
