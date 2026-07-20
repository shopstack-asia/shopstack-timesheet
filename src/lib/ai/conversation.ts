import { createOpenAIClient } from '@/lib/ai/client';
import type { BusinessToolDecision } from '@/lib/ai/decision-engine';
import { AiError, FRIENDLY_AI_FALLBACK } from '@/lib/ai/errors';
import {
  decideWithIntentExtraction,
  type DecideWithIntentResult,
  type ExtractIntentFn,
  type IntentDraftStore,
} from '@/lib/ai/intent';
import {
  routePendingResponse,
  gateCorrectionAfterCancel,
  resolveSelectionAfterToolResult,
  type ExtractPendingResponseFn,
  type RoutePendingResponseInput,
} from '@/lib/ai/pending-response';
import {
  getDefaultSelectedPendingStore,
  type SelectedPendingStore,
} from '@/lib/ai/pending-response/selection-store';
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
import {
  cancelTimesheetChange,
  type CancelDeps,
} from '@/lib/timesheet/write/cancel';
import { getDefaultPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import { PendingStoreError } from '@/lib/timesheet/write/pending-store';
import type { CancelTimesheetChangeResult } from '@/lib/timesheet/write/pending-types';
import { getConversationContext } from '@/lib/conversation/context';
import type { WriteIdentity } from '@/lib/timesheet/write/prepare';

/** Soft limit for Slack-friendly replies (chars). */
export const MAX_AI_RESPONSE_CHARS = 3500;

/** Max tool → model rounds per conversation turn (prevents loops). */
export const MAX_TOOL_ROUNDS = 3;

export const TOOLS_DISABLED_FOR_BUSINESS_MESSAGE =
  'Business tools are disabled for this request, so I cannot look up your work data.';

export const REQUIRED_TOOL_MISSING_MESSAGE =
  'This assistant is missing a required Business Tool and cannot answer that request.';

export type RunConversationDeps = {
  generate?: GenerateResponseFn;
  /** Injected registry (defaults to demonstration tools). */
  toolRegistry?: ToolRegistry;
  /** Injected router (defaults from registry). */
  toolRouter?: ToolRouter;
  /** Disable tool calling for this run (tests / text-only). */
  enableTools?: boolean;
  /**
   * Test-only: inject AI-first decision orchestrator.
   * Production always uses decideWithIntentExtraction (never regex NL routing).
   */
  decideWithIntent?: (
    userMessage: string,
    options: Parameters<typeof decideWithIntentExtraction>[1]
  ) => Promise<DecideWithIntentResult>;
  /** Injected structured intent extractor (tests). */
  extractIntent?: ExtractIntentFn;
  /** Injected semantic pending-response extractor (tests). */
  extractPendingResponse?: ExtractPendingResponseFn;
  /** Injected pending router (tests). */
  routePending?: (
    input: RoutePendingResponseInput
  ) => ReturnType<typeof routePendingResponse>;
  /** Intent draft store (tests). */
  intentDraftStore?: IntentDraftStore;
  /** Fixed "now" for Bangkok date resolution. */
  decisionNow?: Date;
  /** Pending store override (tests). */
  pendingStore?: Parameters<typeof routePendingResponse>[0]['pendingStore'];
  /** Conversation context loader override (tests). */
  getContext?: Parameters<typeof routePendingResponse>[0]['getContext'];
  /** Multi-pending selection store (tests inject in-memory; production uses Redis). */
  selectionStore?: SelectedPendingStore;
  /** Injectable cancel for correction supersede race tests. */
  cancelPendingChange?: (
    identity: WriteIdentity,
    confirmationId: string | undefined,
    deps?: CancelDeps
  ) => Promise<CancelTimesheetChangeResult>;
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
 * Round-0 enforcement: the required Business Tool must run with Decision Engine args.
 * Unrelated tools (ping, wrong business tool, etc.) never satisfy the gate.
 */
export function enforceRequiredBusinessTool(
  toolCalls: AssistantToolCall[],
  decision: Extract<BusinessToolDecision, { action: 'call_tool' }>
): { toolCalls: AssistantToolCall[]; enforced: boolean } {
  const required = toolCalls.filter(
    (c) => c.function.name === decision.toolName
  );
  if (required.length === 1) {
    // Keep a single call; replace arguments with Decision Engine values.
    return {
      toolCalls: [
        {
          ...required[0]!,
          function: {
            name: decision.toolName,
            arguments: JSON.stringify(decision.arguments),
          },
        },
      ],
      enforced: false,
    };
  }
  if (required.length > 1) {
    return {
      toolCalls: [decisionToToolCall(decision)],
      enforced: true,
    };
  }
  // Missing required tool (zero calls, or only unrelated tools).
  return {
    toolCalls: [decisionToToolCall(decision)],
    enforced: true,
  };
}

/**
 * Conversation Service — prompt → decision engine → OpenAI → tools → plain text.
 * Recognized business intents require the exact Decision Engine tool before answering.
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
  const conversationId =
    input.conversationId?.trim() ||
    input.metadata?.conversationId?.trim() ||
    '';
  const slackUserId = input.metadata?.slackUserId?.trim() || '';

  // --- Pending-aware semantic routing (before normal AI-first intent) ---
  const pendingRouteFn = deps?.routePending ?? routePendingResponse;
  const selectionStore =
    deps?.selectionStore ?? getDefaultSelectedPendingStore();
  let suppressConfirmCancelTools = false;
  let decision: BusinessToolDecision;
  let intentResult: DecideWithIntentResult | undefined;
  let clearSelectionAfterTools = false;

  const pendingRoute = await pendingRouteFn({
    userMessage,
    conversationId,
    slackUserId,
    requestId: input.requestId,
    eventId: input.eventId,
    generate: deps?.generate,
    extractPending: deps?.extractPendingResponse,
    pendingStore: deps?.pendingStore,
    getContext: deps?.getContext,
    selectionStore,
    nowMs: deps?.decisionNow?.getTime(),
  });

  if (pendingRoute.handled && pendingRoute.clearSelectionNow) {
    await selectionStore.clearAll(conversationId, slackUserId);
  }
  if (pendingRoute.handled && pendingRoute.clearSelectionOnSuccess) {
    clearSelectionAfterTools = true;
  }

  if (pendingRoute.handled) {
    // Unrelated → answer normally; keep pending; strip confirm/cancel tools
    if (
      pendingRoute.enforcement.enforcementOutcome === 'unrelated_passthrough'
    ) {
      suppressConfirmCancelTools = true;
      const intentDecide = deps?.decideWithIntent ?? decideWithIntentExtraction;
      intentResult = await intentDecide(userMessage, {
        now: deps?.decisionNow,
        pendingChanges: [],
        conversationId,
        slackUserId,
        requestId: input.requestId,
        eventId: input.eventId,
        extractIntent: deps?.extractIntent,
        draftStore: deps?.intentDraftStore,
      });
      decision = intentResult.decision;
      // Never allow confirm/cancel tools while an owned pending sits unanswered
      if (
        decision.action === 'call_tool' &&
        (decision.toolName === 'confirm_timesheet_change' ||
          decision.toolName === 'cancel_timesheet_change')
      ) {
        decision = { action: 'none', reason: 'pending_unrelated_passthrough' };
      }
    } else if (
      pendingRoute.enforcement.enforcementOutcome === 'correction_prepare' &&
      pendingRoute.enforcement.correctionPrepare
    ) {
      // Supersede old proposal only after authoritative cancel === cancelled
      try {
        const conv = await (deps?.getContext ?? getConversationContext)({
          conversationId,
          slackUserId,
          requestId: input.requestId,
          ensureWorkContext: false,
        });
        const cancelFn = deps?.cancelPendingChange ?? cancelTimesheetChange;
        const cancelResult = await cancelFn(
          {
            employeeId: conv.employeeId,
            email: conv.slackEmail,
            slackUserId: conv.slackUserId,
            conversationId,
            requestId: input.requestId,
            sourceEventId: input.eventId,
            firstName: conv.firstName,
            lastName: conv.lastName,
            position: conv.position,
          },
          pendingRoute.enforcement.correctionPrepare.cancelConfirmationId,
          { pendingStore: deps?.pendingStore }
        );
        const gate = gateCorrectionAfterCancel(cancelResult, userMessage);
        if (!gate.proceed) {
          return {
            text: gate.message,
            model: 'pending-response',
            usedFallback: false,
            toolRounds: 0,
          };
        }
        // Old selection cleared only after authoritative cancel === cancelled
        try {
          const cleared = await selectionStore.clearAll(
            conversationId,
            slackUserId
          );
          if (cleared.outcome === 'unavailable') {
            console.log(
              JSON.stringify({
                scope: 'ai',
                level: 'warn',
                message:
                  'selection cleanup unavailable after correction cancel',
                requestId: input.requestId,
                eventId: input.eventId,
                ts: new Date().toISOString(),
              })
            );
          }
        } catch {
          console.log(
            JSON.stringify({
              scope: 'ai',
              level: 'warn',
              message: 'selection cleanup failed after correction cancel',
              requestId: input.requestId,
              eventId: input.eventId,
              ts: new Date().toISOString(),
            })
          );
        }
        clearSelectionAfterTools = false;
      } catch {
        return {
          text: /[\u0E00-\u0E7F]/.test(userMessage)
            ? 'ยังไม่สามารถแทนที่รายการที่รออยู่ได้ครับ กรุณาลองใหม่อีกครั้ง ยังไม่มีการเตรียมรายการใหม่'
            : 'Could not replace the pending proposal. Please try again — no replacement was prepared.',
          model: 'pending-response',
          usedFallback: false,
          toolRounds: 0,
        };
      }
      decision = pendingRoute.decision;
      intentResult = {
        decision,
        extractionOutcome: 'pending_semantic_handled',
      };
    } else {
      decision = pendingRoute.decision;
      intentResult = {
        decision,
        extractionOutcome: 'pending_semantic_handled',
      };
    }
  } else {
    // No owned pending — normal AI-first path (acknowledgements cannot confirm)
    let pendingChanges: Array<{ confirmationId: string; summary: string }> =
      [];
    try {
      pendingChanges = conversationId
        ? (
            await (
              deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore()
            ).findPendingByConversation(conversationId)
          ).map((c) => ({
            confirmationId: c.confirmationId,
            summary: c.summary,
          }))
        : [];
    } catch (error) {
      if (
        error instanceof PendingStoreError &&
        error.code === 'REDIS_UNAVAILABLE'
      ) {
        // Fail closed only when we cannot safely know pending state for writes;
        // read/general conversation may continue without confirm tools.
        suppressConfirmCancelTools = true;
      } else if (!(error instanceof PendingStoreError)) {
        throw error;
      }
    }

    const intentDecide = deps?.decideWithIntent ?? decideWithIntentExtraction;
    intentResult = await intentDecide(userMessage, {
      now: deps?.decisionNow,
      pendingChanges,
      conversationId,
      slackUserId,
      requestId: input.requestId,
      eventId: input.eventId,
      extractIntent: deps?.extractIntent,
      draftStore: deps?.intentDraftStore,
    });
    decision = intentResult.decision;
  }

  const llmTools = enableTools
    ? registry
        .toLlmToolDefinitions()
        .filter((t) => {
          if (!suppressConfirmCancelTools) return true;
          return (
            t.function.name !== 'confirm_timesheet_change' &&
            t.function.name !== 'cancel_timesheet_change'
          );
        })
    : [];

  if (decision.action === 'clarify') {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        extractionOutcome: intentResult.extractionOutcome,
        typedErrorCode: intentResult.typedErrorCode,
        reason: decision.reason,
        toolRounds: 0,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );
    return {
      text: decision.message,
      model: 'intent-enforcement',
      usedFallback: false,
      toolRounds: 0,
    };
  }

  if (decision.action === 'call_tool' && !enableTools) {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        usedFallback: false,
        reason: 'tools_disabled_for_business_intent',
        toolRounds: 0,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );
    return {
      text: TOOLS_DISABLED_FOR_BUSINESS_MESSAGE,
      model: 'decision-engine',
      usedFallback: false,
      toolRounds: 0,
    };
  }

  if (decision.action === 'call_tool' && !registry.exists(decision.toolName)) {
    console.log(
      JSON.stringify({
        scope: 'ai',
        level: 'info',
        message: 'conversation completed',
        requestId: input.requestId,
        eventId: input.eventId,
        usedFallback: false,
        reason: 'required_tool_missing',
        toolName: decision.toolName,
        toolRounds: 0,
        durationMs: Date.now() - started,
        ts: new Date().toISOString(),
      })
    );
    return {
      text: REQUIRED_TOOL_MISSING_MESSAGE,
      model: 'decision-engine',
      usedFallback: false,
      toolRounds: 0,
    };
  }

  const decisionHint =
    decision.action === 'call_tool'
      ? [
          `Decision engine requires tool: ${decision.toolName}(${JSON.stringify(decision.arguments)}).`,
          'You must call this exact Business Tool before answering.',
          'Do not answer from model knowledge. Do not substitute ping/current_date/current_time or another Business Tool.',
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

      if (round === 0 && decision.action === 'call_tool') {
        const enforced = enforceRequiredBusinessTool(toolCalls, decision);
        if (enforced.enforced) {
          console.log(
            JSON.stringify({
              scope: 'ai',
              level: 'info',
              message: 'enforcing required business tool from decision engine',
              requestId: input.requestId,
              toolName: decision.toolName,
              reason: decision.reason,
              modelToolNames: toolCalls.map((c) => c.function.name),
              ts: new Date().toISOString(),
            })
          );
        }
        toolCalls = enforced.toolCalls;
      }

      if (toolCalls.length === 0) {
        // Business intent cannot reach here without a required tool on round 0.
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

        if (
          clearSelectionAfterTools &&
          (call.function.name === 'confirm_timesheet_change' ||
            call.function.name === 'cancel_timesheet_change')
        ) {
          const lifecycle = resolveSelectionAfterToolResult({
            toolName: call.function.name,
            toolResult,
          });
          if (
            lifecycle.action === 'clear' ||
            lifecycle.action === 'clear_stale'
          ) {
            try {
              const cleared = await selectionStore.clearAll(
                conversationId,
                slackUserId
              );
              if (cleared.outcome === 'unavailable') {
                console.log(
                  JSON.stringify({
                    scope: 'ai',
                    level: 'warn',
                    message: 'selection cleanup unavailable after authoritative tool outcome',
                    requestId: input.requestId,
                    eventId: input.eventId,
                    reason: lifecycle.reason,
                    ts: new Date().toISOString(),
                  })
                );
              }
            } catch {
              console.log(
                JSON.stringify({
                  scope: 'ai',
                  level: 'warn',
                  message: 'selection cleanup failed after authoritative tool outcome',
                  requestId: input.requestId,
                  eventId: input.eventId,
                  reason: lifecycle.reason,
                  ts: new Date().toISOString(),
                })
              );
            }
            clearSelectionAfterTools = false;
          } else if (lifecycle.action === 'preserve') {
            console.log(
              JSON.stringify({
                scope: 'ai',
                level: 'info',
                message: 'selection preserved after tool outcome',
                requestId: input.requestId,
                eventId: input.eventId,
                reason: lifecycle.reason,
                ts: new Date().toISOString(),
              })
            );
          }
        }

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
