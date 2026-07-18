/**
 * Prevent Google Sheets formula injection for user-controlled cell values.
 */
export function sanitizeSheetCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const s = String(value);
  const trimmedStart = s.trimStart();
  if (
    /^[=+\-@]/.test(trimmedStart) ||
    s.startsWith('\t') ||
    s.startsWith('\r') ||
    s.startsWith('\n')
  ) {
    return `'${s}`;
  }
  return s;
}

/** Sanitize every cell in a row before Sheets write */
export function sanitizeSheetRow(values: unknown[]): (string | number)[] {
  return values.map((v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    return sanitizeSheetCellValue(v);
  });
}
