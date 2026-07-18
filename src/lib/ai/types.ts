/**
 * OpenAI conversation foundation types (vendor-agnostic tool hooks).
 */

import type { LlmToolDefinition } from '@/lib/tools/types';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type AssistantToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** Assistant message tool calls (OpenAI shape; portable enough for adapters). */
  tool_calls?: AssistantToolCall[];
  /** Required when role === 'tool' */
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIConfig {
  apiKey: string;
  /** Optional OpenAI-compatible base URL (default api.openai.com) */
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  /** Transient failure retries (429 / 5xx / network) */
  maxRetries: number;
}

export interface GenerateResponseInput {
  messages: ChatMessage[];
  requestId?: string;
  eventId?: string;
  /** When set, enables model tool calling for this turn */
  tools?: LlmToolDefinition[];
}

export interface GenerateResponseResult {
  text: string;
  model: string;
  toolCalls?: AssistantToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ConversationInput {
  userMessage: string;
  requestId?: string;
  eventId?: string;
  /** Stable conversation id for context cache (required for business tools). */
  conversationId?: string;
  /** Optional metadata for prompt / tool context */
  metadata?: Record<string, string | undefined>;
}

export interface ConversationResult {
  text: string;
  model: string;
  usage?: GenerateResponseResult['usage'];
  usedFallback: boolean;
  /** Number of tool rounds executed (0 = text only) */
  toolRounds?: number;
}

export type GenerateResponseFn = (
  input: GenerateResponseInput
) => Promise<GenerateResponseResult>;
