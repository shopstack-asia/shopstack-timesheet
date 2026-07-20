/**
 * Deterministic selection among multiple owned pending proposals.
 * Never uses createdAt / array order. Never accepts AI-supplied confirmationId.
 */

import type { OwnedPendingRef } from '@/lib/ai/pending-response/enforce';

export type ResolveOwnedPendingSelectionResult =
  | { status: 'unique'; pending: OwnedPendingRef }
  | { status: 'none' }
  | { status: 'ambiguous'; matches: OwnedPendingRef[] };

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function payloadString(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const v = payload[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function payloadNumber(
  payload: Record<string, unknown>,
  key: string
): number | undefined {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function proposalLabel(p: OwnedPendingRef): {
  date?: string;
  project?: string;
  task?: string;
  hours?: number;
} {
  const date =
    p.date ||
    p.proposal.date ||
    payloadString(p.summaryPayload, 'date');
  const project =
    p.proposal.projectName ||
    payloadString(p.summaryPayload, 'projectName');
  const task =
    p.proposal.taskName || payloadString(p.summaryPayload, 'taskName');
  const hours =
    p.proposal.hours ??
    payloadNumber(p.summaryPayload, 'hours') ??
    payloadNumber(p.summaryPayload, 'toHours');
  return { date, project, task, hours };
}

/**
 * Safe human-readable lines for multi-pending clarification (no IDs).
 */
export function formatOwnedPendingChoices(
  candidates: OwnedPendingRef[],
  userMessage: string
): string {
  const th = /[\u0E00-\u0E7F]/.test(userMessage);
  const lines = candidates.map((c, i) => {
    const L = proposalLabel(c);
    const parts = [
      L.date,
      L.project,
      L.task,
      L.hours !== undefined ? `${L.hours} ชั่วโมง` : undefined,
    ].filter(Boolean);
    return `${i + 1}. ${parts.join(' — ') || c.proposal.summaryText.split('\n')[0] || 'รายการที่รออยู่'}`;
  });
  if (th) {
    return [
      'มีหลายรายการ Timesheet ที่รอการยืนยันครับ กรุณาระบุว่ารายการใดที่ต้องการโดยใช้วันที่ Project งาน หรือจำนวนชั่วโมง',
      '',
      ...lines,
    ].join('\n');
  }
  return [
    'There are multiple pending Timesheet proposals. Please identify which one using date, project, task, or hours:',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Match the user reply to owned pending proposals using visible business fields only.
 * Returns unique / none / ambiguous — never picks by order or createdAt.
 */
export function resolveOwnedPendingSelection(
  userMessage: string,
  candidates: OwnedPendingRef[]
): ResolveOwnedPendingSelectionResult {
  if (candidates.length === 0) return { status: 'none' };
  if (candidates.length === 1) {
    return { status: 'unique', pending: candidates[0]! };
  }

  const msg = normalize(userMessage);
  if (!msg) return { status: 'none' };

  const scored = candidates.map((c) => {
    const L = proposalLabel(c);
    let score = 0;
    if (L.date && msg.includes(normalize(L.date))) score += 4;
    if (L.project && msg.includes(normalize(L.project))) score += 3;
    // Also match a distinctive token from project (e.g. HERTZ from "Commerce Suite (HERTZ)")
    if (L.project) {
      for (const token of L.project.split(/[\s()/,-]+/).filter((t) => t.length >= 3)) {
        if (msg.includes(normalize(token))) score += 2;
      }
    }
    if (L.task && msg.includes(normalize(L.task))) score += 2;
    if (L.hours !== undefined) {
      const hourRe = new RegExp(
        `(?:^|\\D)${String(L.hours).replace('.', '\\.')}(?:\\D|$)`
      );
      if (hourRe.test(msg)) score += 1;
    }
    return { pending: c, score };
  });

  const positive = scored.filter((s) => s.score > 0);
  if (positive.length === 0) {
    return { status: 'none' };
  }

  const max = Math.max(...positive.map((s) => s.score));
  const top = positive.filter((s) => s.score === max);
  if (top.length === 1) {
    return { status: 'unique', pending: top[0]!.pending };
  }
  return { status: 'ambiguous', matches: top.map((t) => t.pending) };
}
