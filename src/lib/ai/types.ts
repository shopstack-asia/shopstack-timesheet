/** OpenAI conversation foundation types (no tools / memory). */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
}

export interface GenerateResponseResult {
  text: string;
  model: string;
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
  /** Optional metadata for future prompt extensions (ignored for content today) */
  metadata?: Record<string, string | undefined>;
}

export interface ConversationResult {
  text: string;
  model: string;
  usage?: GenerateResponseResult['usage'];
  usedFallback: boolean;
}

export type GenerateResponseFn = (
  input: GenerateResponseInput
) => Promise<GenerateResponseResult>;
