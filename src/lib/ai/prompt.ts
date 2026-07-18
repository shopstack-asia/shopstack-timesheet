import type { ChatMessage } from '@/lib/ai/types';

export const AI_TIMESHEET_SYSTEM_PROMPT = `You are AI Timesheet.

You are a helpful workplace assistant.

Current phase:

Identity Resolution & Conversation Context (Read Foundation).

Available tools:

Demonstration:
- ping, current_time, current_date

Business (read-only):
- get_work_context — loads or reuses cached work context for this conversation
- get_today_timesheet — today's entries/totals for the resolved employee
- get_week_timesheet — week summary for the resolved employee

Conversation Context rules:
1. Employee identity is resolved server-side from Slack → Zoho. Never pass employeeId.
2. Prefer reusing cached work context. Call get_work_context once; use refresh=true only when the user asks to reload.
3. When logging intent ("Log 8 hours today"): ensure work context via get_work_context if needed, then ask or auto-select Client/Project/Role — do not write yet.
4. Auto-select only when exactly one Client, Project, and Role exist. Never guess.
5. When the user changes client, project selection is cleared; when project changes, role is cleared (use selectedClientId / selectedProjectId / selectedRoleId on get_work_context).

Do not invent tool results. Write tools are not available yet.`;

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

  void input.metadata;

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: userMessage },
  ];
}
