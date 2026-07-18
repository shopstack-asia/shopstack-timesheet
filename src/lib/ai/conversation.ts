import { createOpenAIClient } from '@/lib/ai/client';
import {
  decideBusinessTool,
  type BusinessToolDecision,
} from '@/lib/ai/decision-engine';
import { AiError, FRIENDLY_AI_FALLBACK } from '@/lib/ai/errors';
import { buildPrompt } from '@/lib/ai/prompt';
import type {
  AssistantToolCall,
  ChatMessage,
  ConversationInput,
  ConversationResult,
  GenerateResponseFn,
} from '@/lib/ai/types';
import {
  createDefaultToolRegistry,
  createToolRouter,
  createToolContext,
  type ToolRegistry,
  type ToolRouter,
} from '@/lib/tools';

/** Soft limit for Slack-friendly replies (chars). */
export const MAX_AI_RESPONSE_CHARS = 3500;

/** Max tool → model rounds per conversation turn (prevents loops). */
export const MAX_TOOL_ROUNDS = 3;

export type RunConversationDeps = {
  generate?: GenerateResponseFn;
  /** Injected registry (defaults to demonstration tools). */
  toolRegistry?: ToolRegistry;
  /** Injected router (defaults from registry). */
  toolRouter?: ToolRouter;
  /** Disable tool calling for this run (tests / text-only). */
  enableTools?: boolean;
  /** Injected decision engine (defaults to decideBusinessTool). */
  decideTool?: typeof decideBusinessTool;
  /** Fixed "now" for Bangkok date resolution in the decision engine. */
  decisionNow?: Date;
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

function decisionToToolCall(
  decision: Extract<BusinessToolDecision, { action: 'call_tool' }>
): AssistantToolCall {
  return {
    id: `decision_${decision.toolName}`,
    type: 'function',
    function: {
      name: decision.toolName,
      arguments: JSON.stringify(decision.arguments),
    },
  };
}

/**
 * Conversation Service — prompt → decision engine → OpenAI → tools → plain text.
 * Business intents always execute Business Tools (forced if the model skips them).
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
        level: 'info',
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
      toolRounds: 0,
    };
  }

  const enableTools = deps?.enableTools !== false;
  const registry = deps?.toolRegistry ?? createDefaultToolRegistry();
  const router = deps?.toolRouter ?? createToolRouter(registry);
  const llmTools = enableTools ? registry.toLlmToolDefinitions() : [];
  const decide = deps?.decideTool ?? decideBusinessTool;
  const decision = decide(userMessage, { now: deps?.decisionNow });

  if (decision.action === 'clarify') {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        usedFallback: false,
        reason: decision.reason,
        toolRounds: 0,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );
    return {
      text: decision.message,
      model: 'decision-engine',
      usedFallback: false,
      toolRounds: 0,
    };
  }

  const decisionHint =
    decision.action === 'call_tool'
      ? [
          `Decision engine requires tool: ${decision.toolName}(${JSON.stringify(decision.arguments)}).`,
          'You must call this tool (or an equivalent Business Tool) before answering.',
          'Do not answer from model knowledge.',
        ].join(' ')
      : undefined;

  const messages: ChatMessage[] = buildPrompt({
    userMessage,
    metadata: input.metadata,
    extraSystemSegments: decisionHint ? [decisionHint] : undefined,
  });

  const generate =
    deps?.generate ??
    ((args) => createOpenAIClient().generateResponse(args));

  const toolContext = createToolContext({
    requestId: input.requestId,
    eventId: input.eventId,
    userId: input.metadata?.slackUserId,
    slackChannel: input.metadata?.channel,
    conversationId:
      input.conversationId || input.metadata?.conversationId,
    metadata: input.metadata,
  });

  try {
    let toolRounds = 0;
    let lastModel = 'unknown';
    let lastUsage: ConversationResult['usage'];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      console.log(
        JSON.stringify({
          scope: 'ai',
          level: 'info',
          message: 'OpenAI request',
          requestId: input.requestId,
          eventId: input.eventId,
          messageCount: messages.length,
          toolRound: round,
          toolsEnabled: llmTools.length > 0,
          decision: decision.action,
          ts: new Date().toISOString(),
        })
      );

      const result = await generate({
        messages,
        requestId: input.requestId,
        eventId: input.eventId,
        tools: llmTools.length > 0 ? llmTools : undefined,
      });

      lastModel = result.model;
      lastUsage = result.usage;

      let toolCalls = result.toolCalls?.filter((c) => c.function?.name) ?? [];

      // Reliability gate: on the first model round, business intent must call a tool.
      if (
        round === 0 &&
        toolCalls.length === 0 &&
        enableTools &&
        decision.action === 'call_tool' &&
        registry.exists(decision.toolName)
      ) {
        console.log(
          JSON.stringify({
            scope: 'ai',
            level: 'info',
            message: 'forcing business tool from decision engine',
            requestId: input.requestId,
            toolName: decision.toolName,
            reason: decision.reason,
            ts: new Date().toISOString(),
          })
        );
        toolCalls = [decisionToToolCall(decision)];
      }

      if (toolCalls.length === 0) {
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
            toolRounds,
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
            toolRounds,
            durationMs: Date.now() - started,
            ts: new Date().toISOString(),
          })
        );

        return {
          text,
          model: result.model,
          usage: result.usage,
          usedFallback: false,
          toolRounds,
        };
      }

      if (round >= MAX_TOOL_ROUNDS) {
        throw new AiError(
          'Tool call limit exceeded without final answer',
          'unexpected'
        );
      }

      toolRounds += 1;

      messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const toolResult = await router.route(
          {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          },
          toolContext
        );

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return {
      text: FRIENDLY_AI_FALLBACK,
      model: lastModel,
      usage: lastUsage,
      usedFallback: true,
      toolRounds,
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
        error: error instanceof Error ? error.message : 'unknown',
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );

    return {
      text: FRIENDLY_AI_FALLBACK,
      model: 'fallback',
      usedFallback: true,
      toolRounds: 0,
    };
  }
}
