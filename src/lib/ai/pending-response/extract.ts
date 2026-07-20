import { createOpenAIClient } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/errors';
import { parsePendingResponseExtraction } from '@/lib/ai/pending-response/schema';
import type {
  PendingResponseExtraction,
  PendingResponseExtractorOutcome,
  SafePendingProposalContext,
} from '@/lib/ai/pending-response/types';
import type { ChatMessage, GenerateResponseFn } from '@/lib/ai/types';

export const PENDING_RESPONSE_SYSTEM_PROMPT = `You classify a user's reply to a pending Timesheet confirmation proposal.

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "intent": "confirm" | "cancel" | "correction" | "unrelated" | "ambiguous",
  "confidence": number between 0 and 1,
  "hasNewMutation": boolean,
  "correction": {
    "dateHint"?: string,
    "projectHint"?: string,
    "taskHint"?: string,
    "hours"?: number
  } | null,
  "reasonCode": string
}

You interpret MEANING — not a fixed vocabulary list. Understand Thai and English, polite particles (ครับ/ค่ะ/นะ), colloquial speech, conversational acknowledgements, minor spelling mistakes, and previously unseen paraphrases.

Intent definitions:
- confirm: the user accepts the pending proposal as-is (no changes). Examples of meaning only: agreement, go-ahead, save it — including natural variations. Do NOT require any exact word.
- cancel: the user rejects / aborts / does not want the pending proposal saved. Cancellation meaning always wins over acknowledgement when both appear.
- correction: the user wants to change date, project, task, and/or hours of the proposal (partial or full). Set hasNewMutation=true and fill correction with any hints present. Leave missing hints omitted.
- unrelated: the message is about something else (greeting, thanks, read question, chit-chat) and is NOT deciding the pending proposal. Keep hasNewMutation=false and correction=null.
- ambiguous: mixed/conflicting instructions, unclear whether to confirm or cancel, or you cannot safely decide. Prefer ambiguous over guessing confirm.

Hard rules:
- NEVER invent employeeId, email, slackUserId, staffId, confirmationId, tool names, Redis keys, executionVersion, or snapshot hashes. Those fields are forbidden.
- If the user both confirms and cancels, or confirms while also changing fields → intent=ambiguous or correction (never confirm).
- If hasNewMutation is true OR correction is non-null → intent must NOT be confirm.
- Confirm only when the proposal is accepted unchanged.
- Negation ("ไม่ยืนยัน", "don't confirm", "อย่าบันทึก") → cancel or ambiguous, never confirm.
- Low certainty → lower confidence and/or intent=ambiguous.
- reasonCode: short snake_case label for your classification (e.g. natural_agreement, polite_cancel, hours_correction, off_topic_read).`;

export type ExtractPendingResponseInput = {
  userMessage: string;
  proposal: SafePendingProposalContext;
  requestId?: string;
  eventId?: string;
};

export type ExtractPendingResponseResult =
  | {
      ok: true;
      extraction: PendingResponseExtraction;
      extractorOutcome: 'extracted';
    }
  | {
      ok: false;
      extractorOutcome: Exclude<
        PendingResponseExtractorOutcome,
        'extracted'
      >;
      errorMessage?: string;
    };

export type ExtractPendingResponseFn = (
  input: ExtractPendingResponseInput
) => Promise<ExtractPendingResponseResult>;

function buildMessages(input: ExtractPendingResponseInput): ChatMessage[] {
  const proposalJson = JSON.stringify({
    operation: input.proposal.operation,
    date: input.proposal.date ?? null,
    projectName: input.proposal.projectName ?? null,
    taskName: input.proposal.taskName ?? null,
    hours: input.proposal.hours ?? null,
    fromHours: input.proposal.fromHours ?? null,
    toHours: input.proposal.toHours ?? null,
    summaryText: input.proposal.summaryText,
  });

  return [
    { role: 'system', content: PENDING_RESPONSE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Pending proposal (safe fields only):\n${proposalJson}`,
        `User reply:\n${input.userMessage}`,
      ].join('\n\n'),
    },
  ];
}

function mapTransportError(
  error: unknown
): Exclude<PendingResponseExtractorOutcome, 'extracted'> {
  if (error instanceof AiError) {
    if (error.code === 'timeout') return 'timeout';
    return 'transport_error';
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/timeout|ETIMEDOUT|AbortError/i.test(msg)) return 'timeout';
  if (/pending_response_malformed: forbidden/i.test(msg)) {
    return 'identity_forbidden';
  }
  if (/pending_response_malformed/i.test(msg)) return 'schema_invalid';
  if (/invalid JSON|empty JSON/i.test(msg)) {
    return /empty/i.test(msg) ? 'empty_response' : 'invalid_json';
  }
  return 'unknown_error';
}

/**
 * Semantic pending-response extraction via OpenAI json_object + Zod.
 * Does not authorize writes — callers must enforce deterministically.
 */
export async function extractPendingResponse(
  input: ExtractPendingResponseInput,
  deps?: { generate?: GenerateResponseFn }
): Promise<ExtractPendingResponseResult> {
  const generate =
    deps?.generate ??
    ((args) =>
      createOpenAIClient().generateResponse({
        ...args,
        responseFormat: 'json_object',
        temperature: 0,
      }));

  try {
    const result = await generate({
      messages: buildMessages(input),
      requestId: input.requestId,
      eventId: input.eventId,
      responseFormat: 'json_object',
      temperature: 0,
    });

    const text = result.text?.trim();
    if (!text) {
      return { ok: false, extractorOutcome: 'empty_response' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, extractorOutcome: 'invalid_json' };
    }

    try {
      const extraction = parsePendingResponseExtraction(parsed);
      return { ok: true, extraction, extractorOutcome: 'extracted' };
    } catch (error) {
      const outcome = mapTransportError(error);
      return {
        ok: false,
        extractorOutcome:
          outcome === 'unknown_error' ? 'schema_invalid' : outcome,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error) {
    return {
      ok: false,
      extractorOutcome: mapTransportError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
