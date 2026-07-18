import type { ToolContext } from '@/lib/tools/types';

export type CreateToolContextInput = {
  requestId?: string;
  eventId?: string;
  userId?: string;
  slackChannel?: string;
  conversationId?: string;
  metadata?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

/** Build an immutable tool execution context. */
export function createToolContext(
  input: CreateToolContextInput = {}
): ToolContext {
  return {
    requestId: input.requestId,
    eventId: input.eventId,
    userId: input.userId,
    slackChannel: input.slackChannel,
    conversationId: input.conversationId,
    metadata: input.metadata ? { ...input.metadata } : undefined,
    signal: input.signal,
  };
}
