/**
 * Deterministic confirmation keywords — never rely on LLM intent alone for execution.
 */

export type ConfirmKind = 'YES' | 'CLEAR' | 'OVERRIDE' | 'CANCEL';

const YES_ALIASES = new Set(['yes', 'y', 'ยืนยัน']);
const CLEAR_ALIASES = new Set(['clear']);
const OVERRIDE_ALIASES = new Set(['override']);
const CANCEL_ALIASES = new Set(['cancel', 'no', 'abort', 'never mind', 'nevermind', 'ยกเลิก']);

export function normalizeConfirmText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchConfirmKeyword(text: string): ConfirmKind | null {
  const n = normalizeConfirmText(text);
  if (YES_ALIASES.has(n)) return 'YES';
  if (CLEAR_ALIASES.has(n)) return 'CLEAR';
  if (OVERRIDE_ALIASES.has(n)) return 'OVERRIDE';
  if (CANCEL_ALIASES.has(n)) return 'CANCEL';
  return null;
}

/**
 * Whether `text` satisfies the required confirmation for a pending write.
 * LLM "confirm" intent alone is never sufficient.
 */
export function textSatisfiesRequiredKeyword(
  text: string,
  requireKeyword: 'YES' | 'CLEAR' | 'OVERRIDE' | 'CREATE PROJECT' | undefined
): boolean {
  const matched = matchConfirmKeyword(text);
  if (requireKeyword === 'CLEAR') return matched === 'CLEAR';
  if (requireKeyword === 'OVERRIDE') return matched === 'OVERRIDE';
  if (requireKeyword === 'CREATE PROJECT') {
    return normalizeConfirmText(text) === 'create project';
  }
  // Normal write: YES only (not CLEAR/OVERRIDE)
  return matched === 'YES';
}

export function requiredKeywordInstruction(
  requireKeyword: 'YES' | 'CLEAR' | 'OVERRIDE' | 'CREATE PROJECT' | undefined
): string {
  if (requireKeyword === 'CLEAR') {
    return 'Type *CLEAR* exactly to confirm clearing the day, or *CANCEL* to abort.';
  }
  if (requireKeyword === 'OVERRIDE') {
    return 'Type *OVERRIDE* exactly to acknowledge leave, then you will still need *YES* to save.';
  }
  if (requireKeyword === 'CREATE PROJECT') {
    return 'Type *CREATE PROJECT* exactly to continue, or *CANCEL* to abort.';
  }
  return 'Type *YES* exactly to save, or *CANCEL* to abort.';
}
