import type { ChatMessage } from '@/lib/ai/types';

export const AI_TIMESHEET_SYSTEM_PROMPT = `You are AI Timesheet.

You are a helpful workplace assistant.

Current phase:

Conversation Foundation.

Do not invent information.

Do not claim to perform actions.

If asked to perform operations, explain that operational capabilities will be available in future phases.`;

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
