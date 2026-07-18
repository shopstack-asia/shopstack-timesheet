import { createOpenAIClient } from '@/lib/ai/client';
import { AiError, FRIENDLY_AI_FALLBACK } from '@/lib/ai/errors';
import { buildPrompt } from '@/lib/ai/prompt';
import type {
  ConversationInput,
  ConversationResult,
  GenerateResponseFn,
} from '@/lib/ai/types';

/** Soft limit for Slack-friendly replies (chars). */
export const MAX_AI_RESPONSE_CHARS = 3500;

export type RunConversationDeps = {
  generate?: GenerateResponseFn;
};

function validateResponseText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new AiError('Empty AI response', 'empty_response');
  }
  if (trimmed.length > MAX_AI_RESPONSE_CHARS) {
    throw new AiError(
      `AI response exceeds ${MAX_AI_RESPONSE_CHARS} characters`,
      'oversized_response'
    );
  }
  return trimmed;
}

/**
 * Conversation Service — prompt → OpenAI → validated plain text.
 * No Slack I/O. No business APIs.
 */
export async function runConversation(
  input: ConversationInput,
  deps?: RunConversationDeps
): Promise<ConversationResult> {
  const started = Date.now();
  const userMessage = input.userMessage?.trim() || '';

  console.log(
    JSON.stringify({
      scope: 'ai',
      level: 'info',
      message: 'conversation started',
      requestId: input.requestId,
      eventId: input.eventId,
      ts: new Date().toISOString(),
    })
  );

  if (!userMessage) {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'warn',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        usedFallback: true,
        reason: 'empty_user_message',
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );
    return {
      text: FRIENDLY_AI_FALLBACK,
      model: 'none',
      usedFallback: true,
    };
  }

  const messages = buildPrompt({
    userMessage,
    metadata: input.metadata,
  });

  const generate =
    deps?.generate ??
    ((args) => createOpenAIClient().generateResponse(args));

  try {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'OpenAI request',
        requestId: input.requestId,
        eventId: input.eventId,
        messageCount: messages.length,
        ts: new Date().toISOString(),
      })
    );

    const result = await generate({
      messages,
      requestId: input.requestId,
      eventId: input.eventId,
    });

    const text = validateResponseText(result.text);

    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'OpenAI response',
        requestId: input.requestId,
        eventId: input.eventId,
        model: result.model,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );

    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        usedFallback: false,
        model: result.model,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );

    return {
      text,
      model: result.model,
      usage: result.usage,
      usedFallback: false,
    };
  } catch (error) {
    const code = error instanceof AiError ? error.code : 'unexpected';
    console.error(
      JSON.stringify({
        scope: 'ai',
        level: 'error',
        message: 'conversation failed — using fallback',
        requestId: input.requestId,
        eventId: input.eventId,
        errorCode: code,
        // Never include API key or raw upstream authorization
        error: error instanceof Error ? error.message : 'unknown',
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );

    return {
      text: FRIENDLY_AI_FALLBACK,
      model: 'fallback',
      usedFallback: true,
    };
  }
}
