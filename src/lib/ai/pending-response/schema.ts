import { z } from 'zod';
import type { PendingResponseExtraction } from '@/lib/ai/pending-response/types';

const CorrectionSchema = z
  .object({
    dateHint: z.string().min(1).optional(),
    projectHint: z.string().min(1).optional(),
    taskHint: z.string().min(1).optional(),
    hours: z.number().finite().optional(),
  })
  .strict();

export const PendingResponseExtractionSchema = z
  .object({
    intent: z.enum([
      'confirm',
      'cancel',
      'correction',
      'unrelated',
      'ambiguous',
    ]),
    confidence: z.number().finite().min(0).max(1),
    hasNewMutation: z.boolean(),
    correction: CorrectionSchema.nullable(),
    reasonCode: z.string().min(1).max(120),
  })
  .strict();

const FORBIDDEN_IDENTITY_KEYS = [
  'employeeId',
  'email',
  'slackUserId',
  'staffId',
  'timesheetStaffId',
  'zohoRecordId',
  'zohoId',
  'confirmationId',
  'executionVersion',
  'snapshotHash',
  'redisKey',
  'toolName',
] as const;

/**
 * Parse and validate pending-response JSON.
 * Rejects unknown properties and any identity / authorization fields.
 */
export function parsePendingResponseExtraction(
  raw: unknown
): PendingResponseExtraction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('pending_response_malformed: not an object');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of FORBIDDEN_IDENTITY_KEYS) {
    if (key in obj) {
      throw new Error(
        `pending_response_malformed: forbidden field ${key}`
      );
    }
  }
  if (obj.correction && typeof obj.correction === 'object') {
    const corr = obj.correction as Record<string, unknown>;
    for (const key of FORBIDDEN_IDENTITY_KEYS) {
      if (key in corr) {
        throw new Error(
          `pending_response_malformed: forbidden field correction.${key}`
        );
      }
    }
  }
  const parsed = PendingResponseExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`pending_response_malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}
