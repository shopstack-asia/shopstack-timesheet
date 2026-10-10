import { PDFDocument, StandardFonts } from 'pdf-lib';
import { EXPENSE_CATEGORIES } from '@/lib/expense/prototype/categories';
import { DEMO_EMPLOYEES } from '@/lib/expense/prototype/employees';
import { createExpense, createMonthlyClaim, eligibleClaimExpenses } from '@/lib/expense/prototype/service';
import type { ExpenseDatabase } from '@/lib/expense/prototype/types';

const SEEDED = 'seeded';

async function samplePdf(lines: string[]): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, line] of lines.entries()) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(line, { x: 48, y: 760, size: 18, font });
    page.drawText(`Page ${index + 1} of ${lines.length}`, { x: 48, y: 730, size: 12, font });
  }
  const bytes = await doc.save();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

async function sampleImage(label: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 480;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a sample receipt image');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 800, 480);
  context.strokeStyle = '#111111';
  context.strokeRect(16, 16, 768, 448);
  context.fillStyle = '#111111';
  context.font = '32px sans-serif';
  label.split('\n').forEach((line, index) => {
    context.fillText(line, 40, 80 + index * 44);
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create a sample receipt image');
  return blob;
}

async function ensureDefaultCategories(db: ExpenseDatabase): Promise<void> {
  if (await db.getMeta('categories')) return;
  await db.setMeta('categories', JSON.stringify(EXPENSE_CATEGORIES));
}

async function ensureAugustReceipt(db: ExpenseDatabase): Promise<void> {
  const august = (await db.listExpenses()).find((entry) => entry.description === 'August flight already claimed');
  if (!august) return;
  if ((await db.listAttachments(august.id)).length > 0) return;
  const receipt = await samplePdf(['August flight receipt', 'Bangkok to Singapore']);
  await db.saveAttachment({
    id: crypto.randomUUID(),
    expenseId: august.id,
    fileName: 'august-flight-receipt.pdf',
    mimeType: 'application/pdf',
    size: receipt.size,
    blob: receipt,
  });
}

async function ensureProcessingClaim(db: ExpenseDatabase): Promise<void> {
  const claims = await db.listClaims();
  if (claims.some((claim) => claim.status === 'PROCESSING')) return;
  const somchai = DEMO_EMPLOYEES[0];
  const eligible = eligibleClaimExpenses(await db.listExpenses(), somchai.id, 2026, 9);
  if (eligible.length === 0) return;
  await createMonthlyClaim(db, {
    employeeId: somchai.id,
    year: 2026,
    month: 9,
    purpose: 'September expenses',
    claimDate: '2026-10-01',
  });
}

export async function ensureDemoData(db: ExpenseDatabase): Promise<void> {
  await ensureDefaultCategories(db);
  if ((await db.getMeta(SEEDED)) === '1') {
    await ensureAugustReceipt(db);
    await ensureProcessingClaim(db);
    return;
  }
  const [somchai, somsri, somying] = DEMO_EMPLOYEES;
  const taxiImage = await sampleImage('Taxi receipt\n350 THB\n05 Sep 2026');
  const dinnerPdf = await samplePdf(['Restaurant receipt', 'Payment slip page']);
  const dinnerImage = await sampleImage('Payment slip\nCustomer dinner');
  const suppliesPdf = await samplePdf(['Office supplies invoice']);

  const taxi = await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-09-05',
    categoryCode: '453',
    description: 'Taxi',
    currency: 'THB',
    amount: '350.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 1,
    newAttachments: [
      { fileName: 'taxi-receipt.png', mimeType: 'image/png', size: taxiImage.size, blob: taxiImage },
    ],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, taxi.id)), status: 'SUBMITTED' });

  const dinner = await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-09-12',
    categoryCode: '462',
    description: 'Customer dinner',
    currency: 'THB',
    amount: '2500.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 2,
    newAttachments: [
      { fileName: 'restaurant-receipt.pdf', mimeType: 'application/pdf', size: dinnerPdf.size, blob: dinnerPdf },
      { fileName: 'payment-slip.png', mimeType: 'image/png', size: dinnerImage.size, blob: dinnerImage },
    ],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, dinner.id)), status: 'SUBMITTED' });

  const parking = await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-09-18',
    categoryCode: '456',
    description: 'Parking',
    currency: 'THB',
    amount: '100.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, parking.id)), status: 'SUBMITTED' });

  const supplies = await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-09-25',
    categoryCode: '413',
    description: 'Office supplies',
    currency: 'THB',
    amount: '850.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 1,
    newAttachments: [
      { fileName: 'supplies-invoice.pdf', mimeType: 'application/pdf', size: suppliesPdf.size, blob: suppliesPdf },
    ],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, supplies.id)), status: 'SUBMITTED' });

  await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-09-02',
    categoryCode: '425',
    description: 'Cancelled magazine',
    currency: 'THB',
    amount: '120.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  }).then(async (entry) => {
    await db.saveExpense({ ...entry, status: 'CANCELLED' });
  });

  await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-10-03',
    categoryCode: '431',
    description: 'Home internet top-up',
    currency: 'THB',
    amount: '499.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  });

  const usd = await createExpense(db, {
    employeeId: somsri.id,
    expenseDate: '2026-09-08',
    categoryCode: '450',
    description: 'Regional flight',
    currency: 'USD',
    amount: '120.00',
    exchangeRate: '36.50',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, usd.id)), status: 'SUBMITTED' });

  await createExpense(db, {
    employeeId: somsri.id,
    expenseDate: '2026-09-15',
    categoryCode: '451',
    description: 'Hotel draft',
    currency: 'SGD',
    amount: '200.00',
    exchangeRate: '25.00',
    projectLabel: '',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  });

  const salesMeal = await createExpense(db, {
    employeeId: somying.id,
    expenseDate: '2026-09-20',
    categoryCode: '452',
    description: 'Travel meal',
    currency: 'THB',
    amount: '640.00',
    exchangeRate: '1.00',
    projectLabel: 'Presales visit',
    attachmentCount: 0,
    newAttachments: [],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, salesMeal.id)), status: 'SUBMITTED' });

  const augustReceipt = await samplePdf(['August flight receipt', 'Bangkok to Singapore']);
  const august = await createExpense(db, {
    employeeId: somchai.id,
    expenseDate: '2026-08-14',
    categoryCode: '450',
    description: 'August flight already claimed',
    currency: 'THB',
    amount: '4200.00',
    exchangeRate: '1.00',
    projectLabel: '',
    attachmentCount: 1,
    newAttachments: [
      {
        fileName: 'august-flight-receipt.pdf',
        mimeType: 'application/pdf',
        size: augustReceipt.size,
        blob: augustReceipt,
      },
    ],
    removeAttachmentIds: [],
  });
  await db.saveExpense({ ...(await find(db, august.id)), status: 'SUBMITTED' });
  const augustClaim = await createMonthlyClaim(db, {
    employeeId: somchai.id,
    year: 2026,
    month: 8,
    purpose: 'August travel',
    claimDate: '2026-09-01',
  });
  await db.saveExpense({ ...(await find(db, august.id)), status: 'PAID', claimId: augustClaim.id });
  await ensureProcessingClaim(db);

  await db.setMeta(SEEDED, '1');
}

async function find(db: ExpenseDatabase, id: string) {
  const entry = (await db.listExpenses()).find((item) => item.id === id);
  if (!entry) throw new Error('Seeded expense was not saved');
  return entry;
}

export async function resetDemoData(db: ExpenseDatabase): Promise<void> {
  await db.clearAll();
  await ensureDemoData(db);
}
