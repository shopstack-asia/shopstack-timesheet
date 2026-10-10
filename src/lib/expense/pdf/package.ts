import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawClaimDocumentHeader, type ClaimDocumentHeader } from '@/lib/expense/pdf/claim-form';
import { SHOPSTACK_LOGO_PNG_BASE64 } from '@/lib/expense/pdf/shopstack-logo';

export type PackageAttachment = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type PackageGroup = {
  index: number;
  date: string;
  category: string;
  description: string;
  attachments: PackageAttachment[];
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type HeaderAssets = {
  font: PDFFont;
  bold: PDFFont;
  logo: Awaited<ReturnType<PDFDocument['embedPng']>>;
};

function drawAttachmentDetails(page: PDFPage, font: PDFFont, y: number, group: PackageGroup, attachment: PackageAttachment) {
  const lines = [
    `Expense #${group.index}`,
    `Date: ${group.date}`,
    `Category: ${group.category}`,
    `Description: ${group.description}`,
    `Attachment: ${attachment.fileName}`,
  ];
  let cursor = y - 8;
  for (const line of lines) {
    page.drawText(line, { x: 28, y: cursor, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    cursor -= 18;
  }
  return cursor;
}

async function addSeparator(
  output: PDFDocument,
  assets: HeaderAssets,
  header: ClaimDocumentHeader,
  group: PackageGroup,
  attachment: PackageAttachment
): Promise<void> {
  const page = output.addPage([595.28, 841.89]);
  const y = drawClaimDocumentHeader(page, assets.font, assets.bold, assets.logo, header);
  drawAttachmentDetails(page, assets.font, y, group, attachment);
}

async function appendPdf(
  output: PDFDocument,
  assets: HeaderAssets,
  header: ClaimDocumentHeader,
  bytes: Uint8Array,
  fileName: string
): Promise<void> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes);
  } catch {
    throw new Error(`Could not read PDF attachment: ${fileName}`);
  }
  const indices = source.getPageIndices();
  if (indices.length === 0) {
    throw new Error(`PDF attachment has no pages: ${fileName}`);
  }
  const embedded = await output.embedPdf(source, indices);
  for (const item of embedded) {
    const page = output.addPage([595.28, 841.89]);
    const y = drawClaimDocumentHeader(page, assets.font, assets.bold, assets.logo, header);
    const maxWidth = 539;
    const maxHeight = Math.max(160, y - 40);
    const scale = Math.min(maxWidth / item.width, maxHeight / item.height);
    const width = item.width * scale;
    const height = item.height * scale;
    page.drawPage(item, {
      x: (595.28 - width) / 2,
      y: Math.max(28, y - 16 - height),
      width,
      height,
    });
  }
}

async function appendImage(
  output: PDFDocument,
  assets: HeaderAssets,
  header: ClaimDocumentHeader,
  group: PackageGroup,
  attachment: PackageAttachment
): Promise<void> {
  const page = output.addPage([595.28, 841.89]);
  const y = drawClaimDocumentHeader(page, assets.font, assets.bold, assets.logo, header);
  const bottom = drawAttachmentDetails(page, assets.font, y, group, attachment);
  const image =
    attachment.mimeType === 'image/png'
      ? await output.embedPng(attachment.bytes).catch(() => {
          throw new Error(`Could not read image attachment: ${attachment.fileName}`);
        })
      : await output.embedJpg(attachment.bytes).catch(() => {
          throw new Error(`Could not read image attachment: ${attachment.fileName}`);
        });
  const maxWidth = 500;
  const maxHeight = Math.max(120, bottom - 48);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (595.28 - width) / 2,
    y: bottom - 16 - height,
    width,
    height,
  });
}

export async function renderFullPackagePdf(input: {
  formPdf: Uint8Array;
  header: ClaimDocumentHeader;
  groups: PackageGroup[];
}): Promise<Uint8Array> {
  const output = await PDFDocument.load(input.formPdf);
  const assets: HeaderAssets = {
    font: await output.embedFont(StandardFonts.Helvetica),
    bold: await output.embedFont(StandardFonts.HelveticaBold),
    logo: await output.embedPng(decodeBase64(SHOPSTACK_LOGO_PNG_BASE64)),
  };

  for (const group of input.groups) {
    for (const attachment of group.attachments) {
      await addSeparator(output, assets, input.header, group, attachment);
      if (attachment.mimeType === 'application/pdf') {
        await appendPdf(output, assets, input.header, attachment.bytes, attachment.fileName);
      } else if (attachment.mimeType === 'image/png' || attachment.mimeType === 'image/jpeg') {
        await appendImage(output, assets, input.header, group, attachment);
      } else {
        throw new Error(`Unsupported attachment type for ${attachment.fileName}`);
      }
    }
  }

  return output.save();
}

export async function loadPackageGroups(
  groups: Array<PackageGroup & { attachments: Array<PackageAttachment | null> }>
): Promise<PackageGroup[]> {
  return groups.map((group) => ({
    ...group,
    attachments: group.attachments.map((attachment) => {
      if (!attachment) {
        throw new Error(`Missing attachment in expense #${group.index}`);
      }
      return attachment;
    }),
  }));
}
