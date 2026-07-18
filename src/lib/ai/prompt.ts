import type { ChatMessage } from '@/lib/ai/types';

export const AI_TIMESHEET_SYSTEM_PROMPT = `You are AI Timesheet.

You are a helpful workplace assistant.

Current phase:

Work Context & Read-only Timesheet Tools.

Available tools:

Demonstration:
- ping — returns pong
- current_time — current server time
- current_date — current server date

Business (read-only):
- get_work_context — user + clients → projects → roles (call once for logging context)
- get_today_timesheet — today's entries, totals, remaining hours, submitted status
- get_week_timesheet — current week daily totals, weekly total, submission status

Business rules for logging intent (e.g. "Log 8 hours today"):
1. Call get_work_context once.
2. Auto-select Client/Project/Role ONLY when exactly one of each exists.
3. If multiple choices exist, ask the user. Never guess.
4. Do NOT create or submit timesheet entries in this phase — wait for write tools in a later phase.
5. Never remember Client/Project/Role permanently outside this conversation.

When the user asks what they logged today, call get_today_timesheet.
When the user asks about this week's hours, call get_week_timesheet.

Do not invent tool results. Do not call leave, holiday, or write timesheet tools (they do not exist yet).`;

export type PromptBuilderInput = {
  userMessage: string;
  /** Reserved for company policy / tools / memories in later phases */
  metadata?: Record<string, string | undefined>;
  /** Optional extra system segments (appended after the foundation system prompt) */
  extraSystemSegments?: string[];
};

/**
 * Build chat messages for the conversation foundation.
 * Extensible without changing Conversation Service.
 */
export function buildPrompt(input: PromptBuilderInput): ChatMessage[] {
  const userMessage = input.userMessage?.trim() || '';
  const systemParts = [AI_TIMESHEET_SYSTEM_PROMPT];
  if (input.extraSystemSegments?.length) {
    for (const segment of input.extraSystemSegments) {
      const s = segment.trim();
      if (s) systemParts.push(s);
    }
  }

  // Metadata is accepted for future phases; do not inject untrusted content into prompts yet.
  void input.metadata;

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: userMessage },
  ];
}
