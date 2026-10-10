import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const decoded = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
    parts.push(
      decoded.replace(/<([0-9A-Fa-f\s]+)>/g, (match, hex: string) => {
        const compact = hex.replace(/\s+/g, '');
        if (compact.length < 2 || compact.length % 2 !== 0) return match;
        return Buffer.from(compact, 'hex').toString('latin1');
      })
    );
  }
  return parts.join('\n');
}
import { renderClaimFormPdf } from '@/lib/expense/pdf/claim-form';
import { renderFullPackagePdf } from '@/lib/expense/pdf/package';

const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);

async function multiPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['Receipt page 1', 'Receipt page 2']) {
    const page = doc.addPage();
    page.drawText(label, { x: 50, y: 700, size: 18, font });
  }
  return doc.save();
}

const row = {
  date: '2026-09-05',
  expense: 'Taxis and Ground Transportation',
  code: '453',
  explanation: 'Taxi',
  currency: 'THB',
  amount: '350.00',
  exchangeRate: '1.00',
  amountThb: '350.00',
};

describe('expense claim pdf', () => {
  it('renders the claim form with totals', async () => {
    const bytes = await renderClaimFormPdf({
      claimNumber: 'EXP-2026-09-0001',
      employeeName: 'Somchai',
      businessUnit: 'Engineering',
      purpose: 'September expenses',
      claimDate: '2026-10-01',
      rows: [row, { ...row, date: '2026-09-12', explanation: 'Customer dinner', amount: '2500.00', amountThb: '2500.00', code: '462' }],
      totalThb: '2850.00',
    });
    const text = await pdfText(bytes);
    expect(text).toContain('EXPENSE CLAIM FORM');
    expect(text).toContain('Somchai');
    expect(text).toContain('2,850.00');
    expect(text).toContain('Customer dinner');
    expect(text).toContain('Total Claimed / (Returned)');
    expect(text).toContain('USD300.00');
    expect(text).toContain('Office Supplies');
    expect(text).toContain('( Employee )');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('continues onto another page when there are many rows', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      ...row,
      date: '2026-09-01',
      explanation: `Expense line ${index + 1} with a longer explanation for wrapping`,
    }));
    const bytes = await renderClaimFormPdf({
      claimNumber: 'EXP-2026-09-0002',
      employeeName: 'Somsri',
      businessUnit: 'Operations',
      purpose: 'Many lines',
      claimDate: '2026-10-01',
      rows,
      totalThb: '14000.00',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(await pdfText(bytes)).toContain('Expense line 40');
  });

  it('merges image and multi-page PDF attachments in order', async () => {
    const form = await renderClaimFormPdf({
      claimNumber: 'EXP-2026-09-0001',
      employeeName: 'Somchai',
      businessUnit: 'Engineering',
      purpose: 'September',
      claimDate: '2026-10-01',
      rows: [row],
      totalThb: '350.00',
    });
    const formPages = (await PDFDocument.load(form)).getPageCount();
    const receipt = await multiPagePdf();
    const bytes = await renderFullPackagePdf({
      formPdf: form,
      header: {
        claimNumber: 'EXP-2026-09-0001',
        employeeName: 'Somchai',
        businessUnit: 'Engineering',
        purpose: 'September',
        claimDate: '2026-10-01',
      },
      groups: [
        {
          index: 1,
          date: '2026-09-05',
          category: 'Taxis and Ground Transportation',
          description: 'Taxi',
          attachments: [
            { fileName: 'taxi.png', mimeType: 'image/png', bytes: TINY_PNG },
            { fileName: 'restaurant-receipt.pdf', mimeType: 'application/pdf', bytes: receipt },
          ],
        },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(formPages + 1 + 1 + 1 + 2);
    const text = await pdfText(bytes);
    expect(text).toContain('taxi.png');
    expect(text).toContain('restaurant-receipt.pdf');
    expect(text.split('EXPENSE CLAIM FORM').length - 1).toBeGreaterThan(1);
    expect(text).toContain('Name :');
    expect(text).toContain('Business Unit :');
  });

  it('names a missing or unreadable attachment instead of skipping it', async () => {
    const form = await renderClaimFormPdf({
      claimNumber: 'EXP-2026-09-0001',
      employeeName: 'Somchai',
      businessUnit: 'Engineering',
      purpose: 'September',
      claimDate: '2026-10-01',
      rows: [row],
      totalThb: '350.00',
    });
    await expect(
      renderFullPackagePdf({
        formPdf: form,
        header: {
          claimNumber: 'EXP-2026-09-0001',
          employeeName: 'Somchai',
          businessUnit: 'Engineering',
          purpose: 'September',
          claimDate: '2026-10-01',
        },
        groups: [
          {
            index: 2,
            date: '2026-09-12',
            category: 'Customer/Investor Entertainment',
            description: 'Customer dinner',
            attachments: [{ fileName: 'broken.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }],
          },
        ],
      })
    ).rejects.toThrow(/broken.pdf/);
  });
});
