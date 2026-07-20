/**
 * Multi-pending selection navigation state (not write authorization).
 */

import { z } from 'zod';
import type { OwnedPendingRef } from '@/lib/ai/pending-response/enforce';

/** Short TTL — must never outlive the selected PendingTimesheetChange. */
export const SELECTED_PENDING_TTL_SECONDS = 10 * 60;

export const SelectedPendingTimesheetTargetSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversationId: z.string().min(1),
    slackUserId: z.string().min(1),
    employeeId: z.string().min(1),
    confirmationId: z.string().min(1),
    selectedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    selectionVersion: z.number().int().nonnegative(),
  })
  .strict();

export type SelectedPendingTimesheetTarget = z.infer<
  typeof SelectedPendingTimesheetTargetSchema
>;

export const PendingChoiceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversationId: z.string().min(1),
    slackUserId: z.string().min(1),
    employeeId: z.string().min(1),
    choices: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive(),
            confirmationId: z.string().min(1),
            safeFingerprint: z.string().min(1),
          })
          .strict()
      )
      .min(1),
    createdAt: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

export type PendingChoiceSnapshot = z.infer<typeof PendingChoiceSnapshotSchema>;

export function selectedPendingKey(
  conversationId: string,
  slackUserId: string
): string {
  const c = encodeURIComponent(conversationId.trim());
  const u = encodeURIComponent(slackUserId.trim());
  return `timesheet:selected-pending:${c}:${u}`;
}

export function pendingChoicesKey(
  conversationId: string,
  slackUserId: string
): string {
  const c = encodeURIComponent(conversationId.trim());
  const u = encodeURIComponent(slackUserId.trim());
  return `timesheet:pending-choices:${c}:${u}`;
}

export function proposalBusinessLabel(p: OwnedPendingRef): {
  date?: string;
  project?: string;
  task?: string;
  hours?: number;
  operation: string;
} {
  const date =
    p.date ||
    p.proposal.date ||
    (typeof p.summaryPayload.date === 'string'
      ? p.summaryPayload.date
      : undefined);
  const project =
    p.proposal.projectName ||
    (typeof p.summaryPayload.projectName === 'string'
      ? p.summaryPayload.projectName
      : undefined);
  const task =
    p.proposal.taskName ||
    (typeof p.summaryPayload.taskName === 'string'
      ? p.summaryPayload.taskName
      : undefined);
  const hours =
    p.proposal.hours ??
    (typeof p.summaryPayload.hours === 'number'
      ? p.summaryPayload.hours
      : typeof p.summaryPayload.toHours === 'number'
        ? p.summaryPayload.toHours
        : undefined);
  return { date, project, task, hours, operation: p.operation };
}

/** Deterministic fingerprint from canonical visible business fields only. */
export function safeFingerprint(p: OwnedPendingRef): string {
  const L = proposalBusinessLabel(p);
  return [
    L.operation,
    L.date ?? '',
    L.project ?? '',
    L.task ?? '',
    L.hours === undefined ? '' : String(L.hours),
  ].join('|');
}

/** Stable presentation order — not authorization. */
export function sortOwnedPendingForPresentation(
  candidates: OwnedPendingRef[]
): OwnedPendingRef[] {
  return [...candidates].sort((a, b) => {
    const La = proposalBusinessLabel(a);
    const Lb = proposalBusinessLabel(b);
    const keys: Array<keyof typeof La> = [
      'date',
      'project',
      'task',
      'hours',
      'operation',
    ];
    for (const k of keys) {
      const av = La[k];
      const bv = Lb[k];
      const as = av === undefined ? '' : String(av);
      const bs = bv === undefined ? '' : String(bv);
      if (as < bs) return -1;
      if (as > bs) return 1;
    }
    // Tie-break on confirmationId for stable sort only (never shown to user)
    return a.confirmationId.localeCompare(b.confirmationId);
  });
}

export function parseSelectedTarget(
  raw: unknown
): SelectedPendingTimesheetTarget | null {
  const parsed = SelectedPendingTimesheetTargetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseChoiceSnapshot(
  raw: unknown
): PendingChoiceSnapshot | null {
  const parsed = PendingChoiceSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  const snap = parsed.data;
  const ordinals = new Set<number>();
  const ids = new Set<string>();
  for (const c of snap.choices) {
    if (ordinals.has(c.ordinal) || ids.has(c.confirmationId)) return null;
    ordinals.add(c.ordinal);
    ids.add(c.confirmationId);
  }
  return snap;
}

export function ttlSecondsUntil(
  expiresAtIso: string,
  nowMs: number
): number {
  const exp = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(exp)) return 1;
  const sec = Math.floor((exp - nowMs) / 1000);
  return Math.max(1, Math.min(SELECTED_PENDING_TTL_SECONDS, sec));
}

/**
 * Selection/choice TTL must never outlive the selected pending record,
 * and never exceed SELECTED_PENDING_TTL_SECONDS (10 minutes).
 */
export function selectionExpiryIso(
  pendingExpiresAtIso: string,
  nowMs: number
): string {
  const pendingExp = new Date(pendingExpiresAtIso).getTime();
  const cap = nowMs + SELECTED_PENDING_TTL_SECONDS * 1000;
  const chosen = Number.isFinite(pendingExp)
    ? Math.min(pendingExp, cap)
    : cap;
  return new Date(Math.max(nowMs + 1000, chosen)).toISOString();
}

export function earliestPendingExpiryIso(
  candidates: Array<{ expiresAt: string }>,
  nowMs: number
): string {
  let min = nowMs + SELECTED_PENDING_TTL_SECONDS * 1000;
  for (const c of candidates) {
    const t = new Date(c.expiresAt).getTime();
    if (Number.isFinite(t)) min = Math.min(min, t);
  }
  return selectionExpiryIso(new Date(min).toISOString(), nowMs);
}
