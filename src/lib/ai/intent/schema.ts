import { z } from 'zod';
import type { StructuredIntent } from '@/lib/ai/intent/types';

export const StructuredIntentSchema = z
  .object({
    domain: z.enum([
      'timesheet',
      'profile',
      'work_context',
      'general',
      'unknown',
    ]),
    intent: z.enum([
      'get_my_profile',
      'get_work_context',
      'get_timesheet_day',
      'get_timesheet_range',
      'create_timesheet_entry',
      'update_timesheet_entry',
      'delete_timesheet_entry',
      'confirm_timesheet_change',
      'cancel_timesheet_change',
      'submit_timesheet',
      'general_conversation',
      'unknown',
    ]),
    confidence: z.enum(['high', 'medium', 'low']),
    dateExpression: z.string().nullable().optional(),
    startDateExpression: z.string().nullable().optional(),
    endDateExpression: z.string().nullable().optional(),
    projectHint: z.string().nullable().optional(),
    taskHint: z.string().nullable().optional(),
    hours: z.number().finite().nullable().optional(),
    confirmationId: z.string().nullable().optional(),
    missingFields: z
      .array(
        z.enum([
          'date',
          'project',
          'task',
          'hours',
          'confirmationId',
          'range',
          'matchEntry',
        ])
      )
      .default([]),
    ambiguities: z.array(z.string()).default([]),
    refersToPrevious: z.boolean().optional(),
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
] as const;

/**
 * Parse and validate AI structured intent JSON.
 * Rejects malformed output and any identity-bearing keys.
 */
export function parseStructuredIntent(raw: unknown): StructuredIntent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('malformed_intent: not an object');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of FORBIDDEN_IDENTITY_KEYS) {
    if (key in obj) {
      throw new Error(`malformed_intent: forbidden identity field ${key}`);
    }
  }
  const parsed = StructuredIntentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`malformed_intent: ${parsed.error.message}`);
  }
  return {
    ...parsed.data,
    missingFields: parsed.data.missingFields ?? [],
    ambiguities: parsed.data.ambiguities ?? [],
  };
}
