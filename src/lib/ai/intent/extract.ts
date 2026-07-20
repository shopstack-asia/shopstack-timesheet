import { createOpenAIClient } from '@/lib/ai/client';
import { parseStructuredIntent } from '@/lib/ai/intent/schema';
import type { StructuredIntent } from '@/lib/ai/intent/types';
import type { ChatMessage, GenerateResponseFn } from '@/lib/ai/types';

export const INTENT_EXTRACTION_SYSTEM_PROMPT = `You extract structured Timesheet assistant intents from Thai and English Slack messages.

Return ONLY a JSON object matching this schema (no markdown, no commentary):
{
  "domain": "timesheet" | "profile" | "work_context" | "general" | "unknown",
  "intent": one of:
    get_my_profile, get_work_context, get_timesheet_day, get_timesheet_range,
    create_timesheet_entry, update_timesheet_entry, delete_timesheet_entry,
    confirm_timesheet_change, cancel_timesheet_change, submit_timesheet,
    general_conversation, unknown,
  "confidence": "high" | "medium" | "low",
  "dateExpression": string | null,
  "startDateExpression": string | null,
  "endDateExpression": string | null,
  "projectHint": string | null,
  "taskHint": string | null,
  "hours": number | null,
  "confirmationId": string | null,
  "missingFields": string[],
  "ambiguities": string[],
  "refersToPrevious": boolean
}

Rules:
- Understand conversational Thai/English, mixed language, abbreviations (RMS, PM, Dev, QA), typos, missing spaces, and alternate word order.
- projectHint / taskHint are short hints only — never invent IDs.
- NEVER include employeeId, email, slackUserId, staffId, timesheetStaffId, or Zoho IDs.
- For create/update/delete timesheet entries, extract EVERY present slot from the same message:
  - dateExpression: วันนี้ / today / yesterday / ISO date
  - projectHint: project code or name (e.g. RMS)
  - taskHint: task name or abbreviation after เป็น / as / under / งาน (e.g. เป็น PM → taskHint "PM", Project Manager → "Project Manager")
  - hours: numeric hours (3 ชม. / 3 hours / สามชั่วโมง → 3)
- Example: "ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM" → create_timesheet_entry with projectHint=RMS, dateExpression=วันนี้, hours=3, taskHint=PM, missingFields=[].
- For incomplete timesheet writes, set intent to the write type and list only truly missing slots in missingFields.
- When a pending draft summary is provided, fill the outstanding missingFields from short answers (PM, 3, RMS, วันนี้). Set refersToPrevious=true for those answers.
- Bare confirm/cancel of a pending proposal is handled by a dedicated semantic pending-response extractor (not this schema). Do not invent confirmationId.
- When no pending proposal applies, confirm_timesheet_change / cancel_timesheet_change should not be used to force a write.
- General chit-chat (ขอบคุณ, สวัสดี, เล่าเรื่อง…, What is…) → general_conversation with refersToPrevious=false. Never treat thanks or off-topic chat as Project/Task/hours.
- Set refersToPrevious=true when the user is answering a missing field from the pending draft summary.
- If clearly timesheet-related but unclear which write → create_timesheet_entry with missingFields, not general_conversation.
- hours must be a number when present (e.g. สามชั่วโมง → 3).
- dateExpression may be "วันนี้", "yesterday", ISO date, etc.
- Do not put Project codes into taskHint or Task abbreviations into projectHint when both appear.`;

export type ExtractIntentInput = {
  userMessage: string;
  draftSummary?: string;
  requestId?: string;
  eventId?: string;
};

export type ExtractIntentFn = (
  input: ExtractIntentInput
) => Promise<StructuredIntent>;

function buildMessages(input: ExtractIntentInput): ChatMessage[] {
  const parts = [
    `User message:\n${input.userMessage}`,
  ];
  if (input.draftSummary) {
    parts.push(
      `Pending incomplete draft (same conversation). Fill ONLY the missingFields from the user message; keep other slots. Last clarification and counts are included for context:\n${input.draftSummary}`
    );
  }
  return [
    { role: 'system', content: INTENT_EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Call OpenAI with strict JSON object response; validate with Zod.
 */
export async function extractStructuredIntent(
  input: ExtractIntentInput,
  deps?: { generate?: GenerateResponseFn }
): Promise<StructuredIntent> {
  const generate =
    deps?.generate ??
    ((args) =>
      createOpenAIClient().generateResponse({
        ...args,
        responseFormat: 'json_object',
        temperature: 0,
      }));

  const result = await generate({
    messages: buildMessages(input),
    requestId: input.requestId,
    eventId: input.eventId,
    responseFormat: 'json_object',
    temperature: 0,
  });

  const text = result.text?.trim();
  if (!text) {
    throw new Error('extraction_failed: empty JSON');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('extraction_failed: invalid JSON');
  }

  return parseStructuredIntent(parsed);
}
