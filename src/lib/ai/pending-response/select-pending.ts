/**
 * Deterministic selection among multiple owned pending proposals.
 * Never uses createdAt for authorization. Never accepts AI-supplied confirmationId.
 * Selection-only messages must not be treated as confirm/cancel write authorization.
 */

import type { OwnedPendingRef } from '@/lib/ai/pending-response/enforce';
import {
  proposalBusinessLabel,
  safeFingerprint,
  sortOwnedPendingForPresentation,
  type PendingChoiceSnapshot,
} from '@/lib/ai/pending-response/selection-types';

export type PendingSelectionDecision =
  | { status: 'selected_only'; pending: OwnedPendingRef }
  | {
      status: 'selected_with_action';
      pending: OwnedPendingRef;
      responseText: string;
    }
  | { status: 'none' }
  | { status: 'ambiguous'; matches: OwnedPendingRef[] }
  | { status: 'invalid_ordinal' };

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Bare ordinal protocol — not natural-language write authorization. */
export function parseOrdinalProtocol(userMessage: string): number | null {
  const t = userMessage.trim();
  const m =
    t.match(/^(\d{1,2})$/) ||
    t.match(/^(?:ข้อ|รายการ|number|no\.?|#)\s*(\d{1,2})$/i) ||
    t.match(/^เลือก\s*(?:ข้อ|รายการ)?\s*(\d{1,2})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Safe human-readable lines for multi-pending clarification (no IDs).
 * Candidates are sorted for stable presentation before numbering.
 */
export function formatOwnedPendingChoices(
  candidates: OwnedPendingRef[],
  userMessage: string
): { message: string; ordered: OwnedPendingRef[] } {
  const ordered = sortOwnedPendingForPresentation(candidates);
  const th = /[\u0E00-\u0E7F]/.test(userMessage);
  const lines = ordered.map((c, i) => {
    const L = proposalBusinessLabel(c);
    const parts = [
      L.date,
      L.project,
      L.task,
      L.hours !== undefined ? `${L.hours} ชั่วโมง` : undefined,
    ].filter(Boolean);
    return `${i + 1}. ${parts.join(' — ') || 'รายการที่รออยู่'}`;
  });
  const header = th
    ? 'มีหลายรายการที่รอการยืนยันครับ กรุณาเลือกหมายเลขหรือระบุวันที่ Project งาน หรือจำนวนชั่วโมง'
    : 'There are multiple pending proposals. Please choose a number or identify one by date, project, task, or hours.';
  return {
    ordered,
    message: [header, '', ...lines].join('\n'),
  };
}

export function formatSelectedPendingSummary(
  pending: OwnedPendingRef,
  userMessage: string
): string {
  const th = /[\u0E00-\u0E7F]/.test(userMessage);
  const L = proposalBusinessLabel(pending);
  const parts = [
    L.date,
    L.project,
    L.task,
    L.hours !== undefined ? `${L.hours} ชั่วโมง` : undefined,
  ].filter(Boolean);
  const summary = parts.join(' — ') || 'รายการที่เลือก';
  if (th) {
    return [
      `เลือกรายการนี้แล้วครับ: *${summary}*`,
      '',
      'ต้องการยืนยัน ยกเลิก หรือแก้ไขรายการนี้ครับ?',
    ].join('\n');
  }
  return [
    `Selected: *${summary}*`,
    '',
    'Would you like to confirm, cancel, or change this proposal?',
  ].join('\n');
}

export function buildChoiceSnapshot(input: {
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  ordered: OwnedPendingRef[];
  nowMs: number;
  /** Earliest pending expiry among candidates (ISO). */
  expiresAt: string;
}): PendingChoiceSnapshot {
  return {
    schemaVersion: 1,
    conversationId: input.conversationId,
    slackUserId: input.slackUserId,
    employeeId: input.employeeId,
    choices: input.ordered.map((p, i) => ({
      ordinal: i + 1,
      confirmationId: p.confirmationId,
      safeFingerprint: safeFingerprint(p),
    })),
    createdAt: new Date(input.nowMs).toISOString(),
    expiresAt: input.expiresAt,
  };
}

/**
 * Resolve ordinal against the exact displayed-choice snapshot.
 * Never shifts ordinals when the live pending set changes.
 */
export function resolveOrdinalFromSnapshot(
  ordinal: number,
  snapshot: PendingChoiceSnapshot,
  liveById: Map<string, OwnedPendingRef>
):
  | { status: 'unique'; pending: OwnedPendingRef }
  | { status: 'invalid_ordinal' }
  | { status: 'stale' } {
  const choice = snapshot.choices.find((c) => c.ordinal === ordinal);
  if (!choice) return { status: 'invalid_ordinal' };
  const live = liveById.get(choice.confirmationId);
  if (!live) return { status: 'stale' };
  if (safeFingerprint(live) !== choice.safeFingerprint) return { status: 'stale' };
  return { status: 'unique', pending: live };
}

/**
 * Match the user reply to owned pending proposals using visible business fields only.
 */
export function resolveOwnedPendingByBusinessFields(
  userMessage: string,
  candidates: OwnedPendingRef[]
):
  | { status: 'unique'; pending: OwnedPendingRef }
  | { status: 'none' }
  | { status: 'ambiguous'; matches: OwnedPendingRef[] } {
  if (candidates.length === 0) return { status: 'none' };
  if (candidates.length === 1) {
    return { status: 'unique', pending: candidates[0]! };
  }

  const msg = normalize(userMessage);
  if (!msg) return { status: 'none' };

  const scored = candidates.map((c) => {
    const L = proposalBusinessLabel(c);
    let score = 0;
    if (L.date && msg.includes(normalize(L.date))) score += 4;
    if (L.project && msg.includes(normalize(L.project))) score += 3;
    if (L.project) {
      for (const token of L.project
        .split(/[\s()/,-]+/)
        .filter((t) => t.length >= 3)) {
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
  if (positive.length === 0) return { status: 'none' };
  const max = Math.max(...positive.map((s) => s.score));
  const top = positive.filter((s) => s.score === max);
  if (top.length === 1) return { status: 'unique', pending: top[0]!.pending };
  return { status: 'ambiguous', matches: top.map((t) => t.pending) };
}

/**
 * Full multi-pending selection decision (ordinal protocol + business fields).
 * Does not run semantic extraction — caller decides selected_only vs action.
 */
export function resolvePendingSelectionDecision(input: {
  userMessage: string;
  candidates: OwnedPendingRef[];
  snapshot?: PendingChoiceSnapshot | null;
}): PendingSelectionDecision {
  const { userMessage, candidates, snapshot } = input;
  if (candidates.length === 0) return { status: 'none' };

  const liveById = new Map(candidates.map((c) => [c.confirmationId, c]));
  const ordinal = parseOrdinalProtocol(userMessage);

  if (ordinal !== null) {
    if (!snapshot) return { status: 'invalid_ordinal' };
    const resolved = resolveOrdinalFromSnapshot(ordinal, snapshot, liveById);
    if (resolved.status === 'invalid_ordinal') return { status: 'invalid_ordinal' };
    if (resolved.status === 'stale') return { status: 'none' };
    return { status: 'selected_only', pending: resolved.pending };
  }

  const byFields = resolveOwnedPendingByBusinessFields(userMessage, candidates);
  if (byFields.status === 'unique') {
    // Treat business-field match as selection first; caller may upgrade to
    // selected_with_action after semantic classification of the same message.
    return { status: 'selected_only', pending: byFields.pending };
  }
  if (byFields.status === 'ambiguous') {
    return { status: 'ambiguous', matches: byFields.matches };
  }
  return { status: 'none' };
}

/** @deprecated Use resolveOwnedPendingByBusinessFields / resolvePendingSelectionDecision */
export function resolveOwnedPendingSelection(
  userMessage: string,
  candidates: OwnedPendingRef[]
):
  | { status: 'unique'; pending: OwnedPendingRef }
  | { status: 'none' }
  | { status: 'ambiguous'; matches: OwnedPendingRef[] } {
  return resolveOwnedPendingByBusinessFields(userMessage, candidates);
}
