import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatMoney } from '@/lib/expense/prototype/money';
import { SHOPSTACK_LOGO_PNG_BASE64 } from '@/lib/expense/pdf/shopstack-logo';

export type ClaimFormRow = {
  date: string;
  expense: string;
  code: string;
  explanation: string;
  currency: string;
  amount: string;
  exchangeRate: string;
  amountThb: string;
};

export type ClaimFormInput = {
  claimNumber: string;
  employeeName: string;
  businessUnit: string;
  purpose: string;
  claimDate: string;
  rows: ClaimFormRow[];
  totalThb: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 28;
const RIGHT = PAGE_WIDTH - 28;
const TABLE_WIDTH = RIGHT - LEFT;
const ROW_HEIGHT = 16;
const BLANK_ROWS_ON_SHORT_FORM = 18;

const HEADER_BLUE = rgb(0.357, 0.608, 0.835);
const CODE_BLUE = rgb(0.678, 0.847, 0.902);
const STRIPE = rgb(0.851, 0.918, 0.969);
const LINE = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const WHITE = rgb(1, 1, 1);
const MUTED = rgb(0.25, 0.25, 0.25);

/** Printed category box, in the order on Expense Claim Form.pdf. */
export const CLAIM_FORM_REFERENCE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Office Supplies', '413'],
  ['Small Equipment', '415'],
  ['Computer Supplies', '420'],
  ['Postage', '421'],
  ['Printing & Stationery', '422'],
  ['Subscriptions', '423'],
  ['Miscellaneous Expenses', '425'],
  ['Repairs and Maintenance', '426'],
  ['Bank Fees', '427'],
  ['Telephone & Mobile', '430'],
  ['Internet', '431'],
  ['Flights', '450'],
  ['Hotels', '451'],
  ['Meals (Travel)', '452'],
  ['Taxis and Ground Transportation', '453'],
  ['Other Travel (Toll,Mileage,Fuel)', '454'],
  ['Messenger Service', '455'],
  ['Car Park Expenses', '456'],
  ['Customer/Investor Entertainment', '462'],
];

const COLUMN_WIDTHS = [44, 86, 42, 156, 46, 58, 46, TABLE_WIDTH - 478] as const;

type Column = { x: number; width: number };

function columns(): Column[] {
  let x = LEFT;
  return COLUMN_WIDTHS.map((width) => {
    const column = { x, width };
    x += width;
    return column;
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pdfSafe(text: string): string {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return pdfSafe(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = pdfSafe(text).replace(/\s+/g, ' ').trim();
  if (!safe) return [''];
  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      lines.push(word);
      return;
    }
    let piece = '';
    for (const char of word) {
      const next = piece + char;
      if (font.widthOfTextAtSize(next, size) > maxWidth && piece) {
        lines.push(piece);
        piece = char;
      } else {
        piece = next;
      }
    }
    if (piece) lines.push(piece);
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = '';
      if (font.widthOfTextAtSize(word, size) <= maxWidth) current = word;
      else pushWord(word);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawCentered(
  page: PDFPage,
  text: string,
  x: number,
  bottom: number,
  width: number,
  height: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>
) {
  const safe = pdfSafe(text);
  const textWidth = font.widthOfTextAtSize(safe, size);
  page.drawText(safe, {
    x: x + Math.max(1, (width - textWidth) / 2),
    y: bottom + (height - size) / 2 + 1,
    size,
    font,
    color,
  });
}

function drawLeft(
  page: PDFPage,
  text: string,
  x: number,
  baseline: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>
) {
  page.drawText(pdfSafe(text), { x, y: baseline, size, font, color });
}

function box(
  page: PDFPage,
  x: number,
  bottom: number,
  width: number,
  height: number,
  fill: ReturnType<typeof rgb>
) {
  page.drawRectangle({ x, y: bottom, width, height, color: fill, borderColor: LINE, borderWidth: 0.4 });
}

type PreparedRow = {
  cells: string[][];
  height: number;
};

function prepareRow(row: ClaimFormRow, font: PDFFont, cols: Column[]): PreparedRow {
  const values = [
    displayDate(row.date),
    row.expense,
    row.code,
    row.explanation,
    row.currency,
    formatMoney(row.amount),
    row.exchangeRate,
    formatMoney(row.amountThb),
  ];
  const cells = values.map((value, index) => wrapText(value, font, 7.5, cols[index].width - 4));
  const lines = Math.max(1, ...cells.map((cell) => cell.length));
  return { cells, height: Math.max(ROW_HEIGHT, lines * 9 + 6) };
}

export const CLAIM_FORM_FOOTNOTE =
  '*Attach all receipts to expense forms. COO or CFO signature required on all expenses exceeding USD300.00';

function footerHeight(): number {
  return 16 + 16 + 14 + 12 + CLAIM_FORM_REFERENCE_ROWS.length * 11 + 16 + 28;
}

export type ClaimDocumentHeader = Pick<
  ClaimFormInput,
  'claimNumber' | 'employeeName' | 'businessUnit' | 'purpose' | 'claimDate'
>;

/** Same opening block as the claim form: logo, number, title, name, unit, purpose, and date. */
export function drawClaimDocumentHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  logo: Awaited<ReturnType<PDFDocument['embedPng']>>,
  input: ClaimDocumentHeader
): number {
  const maxLogoWidth = 108;
  const maxLogoHeight = 20;
  const logoWidth = Math.min(maxLogoWidth, (logo.width / logo.height) * maxLogoHeight);
  const logoHeight = logoWidth * (logo.height / logo.width);
  let y = PAGE_HEIGHT - 18;
  page.drawImage(logo, { x: LEFT, y: y - logoHeight, width: logoWidth, height: logoHeight });
  if (input.claimNumber) {
    drawLeft(page, input.claimNumber, RIGHT - font.widthOfTextAtSize(input.claimNumber, 8) - 2, y - 12, font, 8, MUTED);
  }
  y -= logoHeight + 8;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.8, color: INK });
  y -= 18;
  const title = 'EXPENSE CLAIM FORM';
  drawLeft(page, title, LEFT + (TABLE_WIDTH - bold.widthOfTextAtSize(title, 13)) / 2, y, bold, 13, INK);
  y -= 20;
  const purposeLines = wrapText(input.purpose, font, 9, 250);
  drawField(page, font, 'Name :', input.employeeName, LEFT, y, 300);
  drawField(page, font, 'Business Unit :', input.businessUnit, LEFT + 310, y, TABLE_WIDTH - 310);
  y -= 16;
  drawField(page, font, 'Purpose :', purposeLines[0] ?? '', LEFT, y, 300);
  drawField(page, font, 'Date :', displayDate(input.claimDate), LEFT + 310, y, TABLE_WIDTH - 310);
  for (const extra of purposeLines.slice(1)) {
    y -= 12;
    drawLeft(page, extra, LEFT + 52, y, font, 9, INK);
  }
  return y - 12;
}

export async function renderClaimFormPdf(input: ClaimFormInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(decodeBase64(SHOPSTACK_LOGO_PNG_BASE64));
  const cols = columns();
  const prepared = input.rows.map((row) => prepareRow(row, font, cols));
  const totalLabel = formatMoney(input.totalThb);
  const maxLogoWidth = 108;
  const maxLogoHeight = 20;
  const fittedWidth = Math.min(maxLogoWidth, (logo.width / logo.height) * maxLogoHeight);
  const logoWidth = fittedWidth;
  const logoHeight = fittedWidth * (logo.height / logo.width);

  const purposeLines = wrapText(input.purpose, font, 9, 250);
  const headerBlock = 18 + logoHeight + 14 + 16 + 8 + purposeLines.length * 12 + 14 + 28;

  const pages: Array<{ rows: PreparedRow[]; blanks: number; footer: boolean }> = [];
  let index = 0;
  const blankSource: PreparedRow = { cells: cols.map(() => ['']), height: ROW_HEIGHT };

  while (index < prepared.length || pages.length === 0) {
    const isFirst = pages.length === 0;
    const top = PAGE_HEIGHT - (isFirst ? headerBlock : 56);
    const remaining = prepared.slice(index);
    const fit = (limit: number) => {
      let used = 0;
      let count = 0;
      for (const row of remaining) {
        if (used + row.height > limit) break;
        used += row.height;
        count += 1;
      }
      return count;
    };
    const withFooter = fit(top - 24 - footerHeight());
    if (withFooter >= remaining.length) {
      const blanks =
        pages.length === 0 && remaining.length < BLANK_ROWS_ON_SHORT_FORM
          ? BLANK_ROWS_ON_SHORT_FORM - remaining.length
          : 0;
      pages.push({ rows: remaining, blanks, footer: true });
      break;
    }
    const withoutFooter = Math.max(1, fit(top - 24));
    pages.push({ rows: prepared.slice(index, index + withoutFooter), blanks: 0, footer: false });
    index += withoutFooter;
  }

  pages.forEach((slice, pageIndex) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - 18;

    if (pageIndex === 0) {
      y = drawClaimDocumentHeader(page, font, bold, logo, input);
    } else {
      const continued = `EXPENSE CLAIM FORM (continued)  ${input.claimNumber}`;
      drawLeft(page, continued, LEFT, y - 12, bold, 11, INK);
      y -= 28;
    }

    y = drawTableHeader(page, bold, cols, y);

    const body = [
      ...slice.rows.map((row, rowIndex) => ({ row, stripe: rowIndex % 2 === 1 })),
      ...Array.from({ length: slice.blanks }, (_, blankIndex) => ({
        row: blankSource,
        stripe: (slice.rows.length + blankIndex) % 2 === 1,
      })),
    ];
    body.forEach(({ row, stripe }) => {
      drawDataRow(page, font, cols, row, y - row.height, stripe);
      y -= row.height;
    });

    if (!slice.footer) return;

    y -= 2;
    drawTotalRow(page, bold, cols, y - 16, 'Total Expenses', totalLabel);
    y -= 16;
    drawTotalRow(page, bold, cols, y - 16, 'Total Claimed / (Returned)', totalLabel);
    y -= 28;
    const noteLines = wrapText(CLAIM_FORM_FOOTNOTE, font, 7, TABLE_WIDTH);
    for (const line of noteLines) {
      drawLeft(page, line, LEFT, y, font, 7, INK);
      y -= 9;
    }
    y -= 8;
    drawSignatures(page, font, LEFT, y);
    drawReferenceBox(page, font, bold, RIGHT - 230, y);
  });

  return doc.save();
}

function drawField(
  page: PDFPage,
  font: PDFFont,
  label: string,
  value: string,
  x: number,
  baseline: number,
  width: number
) {
  drawLeft(page, label, x, baseline, font, 9, INK);
  const labelWidth = font.widthOfTextAtSize(label, 9) + 4;
  const lineStart = x + labelWidth;
  const lineEnd = x + width;
  page.drawLine({
    start: { x: lineStart, y: baseline - 2 },
    end: { x: lineEnd, y: baseline - 2 },
    thickness: 0.6,
    color: INK,
  });
  const safe = pdfSafe(value);
  const max = lineEnd - lineStart - 4;
  let size = 9;
  while (size > 6 && font.widthOfTextAtSize(safe, size) > max) size -= 0.5;
  drawLeft(page, safe, lineStart + 2, baseline, font, size, INK);
}

function drawTableHeader(page: PDFPage, bold: PDFFont, cols: Column[], top: number): number {
  const height = 14;
  const upper = top - height;
  const lower = upper - height;
  const span = (from: number, to: number, text: string, tall: boolean) => {
    const x = cols[from].x;
    const width = cols.slice(from, to + 1).reduce((sum, column) => sum + column.width, 0);
    const bottom = tall ? lower : upper;
    const boxHeight = tall ? height * 2 : height;
    box(page, x, bottom, width, boxHeight, HEADER_BLUE);
    drawCentered(page, text, x, bottom, width, boxHeight, bold, 7, WHITE);
  };
  span(0, 0, 'Date', true);
  span(1, 1, 'Expense', true);
  box(page, cols[2].x, upper, cols[2].width, height, HEADER_BLUE);
  drawCentered(page, 'Expense', cols[2].x, upper, cols[2].width, height, bold, 7, WHITE);
  box(page, cols[2].x, lower, cols[2].width, height, HEADER_BLUE);
  drawCentered(page, 'Code', cols[2].x, lower, cols[2].width, height, bold, 7, WHITE);
  span(3, 3, 'Explanation', true);
  const amountX = cols[4].x;
  const amountWidth = cols[4].width + cols[5].width;
  box(page, amountX, upper, amountWidth, height, HEADER_BLUE);
  drawCentered(page, 'Amount (Currency)', amountX, upper, amountWidth, height, bold, 7, WHITE);
  box(page, cols[4].x, lower, cols[4].width, height, HEADER_BLUE);
  drawCentered(page, 'Currency', cols[4].x, lower, cols[4].width, height, bold, 6.5, WHITE);
  box(page, cols[5].x, lower, cols[5].width, height, HEADER_BLUE);
  drawCentered(page, 'Amount', cols[5].x, lower, cols[5].width, height, bold, 6.5, WHITE);
  span(6, 6, 'Ex. Rate', true);
  box(page, cols[7].x, upper, cols[7].width, height, HEADER_BLUE);
  drawCentered(page, 'Amount', cols[7].x, upper, cols[7].width, height, bold, 7, WHITE);
  box(page, cols[7].x, lower, cols[7].width, height, HEADER_BLUE);
  drawCentered(page, '(THB)', cols[7].x, lower, cols[7].width, height, bold, 7, WHITE);
  return lower;
}

function drawDataRow(
  page: PDFPage,
  font: PDFFont,
  cols: Column[],
  row: PreparedRow,
  bottom: number,
  stripe: boolean
) {
  row.cells.forEach((lines, index) => {
    const fill = index === 2 ? CODE_BLUE : stripe ? STRIPE : WHITE;
    box(page, cols[index].x, bottom, cols[index].width, row.height, fill);
      const numeric = index >= 5;
    lines.forEach((line, lineIndex) => {
      const size = 7.5;
      const baseline = bottom + row.height - 11 - lineIndex * 9;
      if (numeric) {
        const width = font.widthOfTextAtSize(pdfSafe(line), size);
        drawLeft(page, line, cols[index].x + cols[index].width - width - 3, baseline, font, size, INK);
      } else {
        const alignCenter = index === 0 || index === 2 || index === 4;
        if (alignCenter) {
          drawCentered(page, line, cols[index].x, baseline - 2, cols[index].width, size + 4, font, size, INK);
        } else {
          drawLeft(page, line, cols[index].x + 3, baseline, font, size, INK);
        }
      }
    });
  });
}

function drawTotalRow(
  page: PDFPage,
  bold: PDFFont,
  cols: Column[],
  bottom: number,
  label: string,
  amount: string
) {
  const labelWidth = cols.slice(0, 7).reduce((sum, column) => sum + column.width, 0);
  box(page, LEFT, bottom, labelWidth, 16, WHITE);
  const labelWidthText = bold.widthOfTextAtSize(label, 8);
  drawLeft(page, label, LEFT + labelWidth - labelWidthText - 6, bottom + 4, bold, 8, INK);
  box(page, cols[7].x, bottom, cols[7].width, 16, WHITE);
  const amountWidth = bold.widthOfTextAtSize(amount, 8);
  drawLeft(page, amount, cols[7].x + cols[7].width - amountWidth - 3, bottom + 4, bold, 8, INK);
}

function drawSignatures(page: PDFPage, font: PDFFont, x: number, top: number) {
  const labels = ['( Employee )', '( Dept. Manager )', '( COO or CFO if >USD300 )'];
  labels.forEach((label, index) => {
    const y = top - 18 - index * 36;
    drawLeft(page, 'Signature :', x, y, font, 9, INK);
    page.drawLine({
      start: { x: x + 58, y: y - 1 },
      end: { x: x + 190, y: y - 1 },
      thickness: 0.6,
      color: INK,
    });
    const captionWidth = font.widthOfTextAtSize(label, 8);
    drawLeft(page, label, x + 58 + (132 - captionWidth) / 2, y - 12, font, 8, MUTED);
  });
}

function drawReferenceBox(page: PDFPage, font: PDFFont, bold: PDFFont, x: number, top: number) {
  const width = 230;
  const nameWidth = 176;
  const rowHeight = 11;
  const headerBottom = top - 14;
  box(page, x, headerBottom, nameWidth, 14, HEADER_BLUE);
  box(page, x + nameWidth, headerBottom, width - nameWidth, 14, HEADER_BLUE);
  drawCentered(page, 'EXPENSES', x, headerBottom, nameWidth, 14, bold, 7, WHITE);
  drawCentered(page, 'CODE', x + nameWidth, headerBottom, width - nameWidth, 14, bold, 7, WHITE);
  CLAIM_FORM_REFERENCE_ROWS.forEach(([name, code], index) => {
    const bottom = headerBottom - (index + 1) * rowHeight;
    box(page, x, bottom, nameWidth, rowHeight, WHITE);
    box(page, x + nameWidth, bottom, width - nameWidth, rowHeight, WHITE);
    drawLeft(page, name, x + 3, bottom + 2.5, font, 6.5, INK);
    drawCentered(page, code, x + nameWidth, bottom, width - nameWidth, rowHeight, font, 6.5, INK);
  });
}
