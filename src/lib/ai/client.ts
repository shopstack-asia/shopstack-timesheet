import { AiError } from '@/lib/ai/errors';
import type {
  AssistantToolCall,
  GenerateResponseInput,
  GenerateResponseResult,
  OpenAIConfig,
} from '@/lib/ai/types';

export type AiEnv = Record<string, string | undefined>;

const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxTokens: 512,
  temperature: 0.7,
  timeoutMs: 30_000,
  maxRetries: 2,
};

function readNumber(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new AiError(`Invalid ${name}: ${raw}`, 'invalid_config');
  }
  return n;
}

/**
 * Load OpenAI config from env.
 * Accepts OPENAI_* (preferred) and falls back to AI_API_KEY / AI_MODEL / AI_BASE_URL.
 */
export function loadOpenAIConfig(env: AiEnv = process.env): OpenAIConfig {
  const apiKey =
    env.OPENAI_API_KEY?.trim() || env.AI_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new AiError(
      'Missing required environment variable: OPENAI_API_KEY (or AI_API_KEY)',
      'missing_api_key'
    );
  }

  const temperature = readNumber(
    env.OPENAI_TEMPERATURE,
    DEFAULTS.temperature,
    'OPENAI_TEMPERATURE'
  );
  if (temperature > 2) {
    throw new AiError('OPENAI_TEMPERATURE must be <= 2', 'invalid_config');
  }

  const maxTokens = Math.floor(
    readNumber(env.OPENAI_MAX_TOKENS, DEFAULTS.maxTokens, 'OPENAI_MAX_TOKENS')
  );
  if (maxTokens < 1) {
    throw new AiError('OPENAI_MAX_TOKENS must be >= 1', 'invalid_config');
  }

  const timeoutMs = Math.floor(
    readNumber(env.OPENAI_TIMEOUT_MS, DEFAULTS.timeoutMs, 'OPENAI_TIMEOUT_MS')
  );
  if (timeoutMs < 1000) {
    throw new AiError('OPENAI_TIMEOUT_MS must be >= 1000', 'invalid_config');
  }

  const baseUrl = (
    env.OPENAI_BASE_URL?.trim() ||
    env.AI_BASE_URL?.trim() ||
    DEFAULTS.baseUrl
  ).replace(/\/$/, '');

  return {
    apiKey,
    baseUrl,
    model: env.OPENAI_MODEL?.trim() || env.AI_MODEL?.trim() || DEFAULTS.model,
    maxTokens,
    temperature,
    timeoutMs,
    maxRetries: DEFAULTS.maxRetries,
  };
}

export function isOpenAIEnvPresent(env: AiEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim() || env.AI_API_KEY?.trim());
}

/**
 * Startup validation (mirrors Slack config pattern).
 * - OPENAI_VALIDATE_ON_STARTUP=true → always validate
 * - Else validate when any OpenAI key env is set (catch partial misconfig)
 */
export function assertOpenAIConfigOnStartup(env: AiEnv = process.env): void {
  const force = env.OPENAI_VALIDATE_ON_STARTUP?.trim().toLowerCase() === 'true';
  if (!force && !isOpenAIEnvPresent(env)) {
    return;
  }
  loadOpenAIConfig(env);
}

type ChatCompletionsFetcher = (args: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
}) => Promise<{ status: number; json: unknown }>;

async function defaultFetch(args: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
}): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(args.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, json };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError('OpenAI request timed out', 'timeout', true);
    }
    throw new AiError(
      error instanceof Error ? error.message : 'OpenAI network failure',
      'network',
      true
    );
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapHttpError(status: number, json: unknown): AiError {
  const errObj =
    json && typeof json === 'object' && 'error' in json
      ? (json as { error?: { message?: string; code?: string; type?: string } })
          .error
      : undefined;
  const msg = errObj?.message || `OpenAI HTTP ${status}`;
  if (status === 401 || errObj?.code === 'invalid_api_key') {
    return new AiError(msg, 'invalid_api_key', false);
  }
  if (status === 429) {
    return new AiError(msg, 'rate_limited', true);
  }
  if (status >= 500) {
    return new AiError(msg, 'server_error', true);
  }
  return new AiError(msg, 'unexpected', false);
}

function parseToolCalls(raw: unknown): AssistantToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: AssistantToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    };
    if (!c.id || !c.function?.name) continue;
    calls.push({
      id: c.id,
      type: 'function',
      function: {
        name: c.function.name,
        arguments:
          typeof c.function.arguments === 'string'
            ? c.function.arguments
            : '{}',
      },
    });
  }
  return calls.length > 0 ? calls : undefined;
}

function extractCompletion(json: unknown): {
  text: string;
  model: string;
  toolCalls?: AssistantToolCall[];
  usage?: GenerateResponseResult['usage'];
} {
  if (!json || typeof json !== 'object') {
    throw new AiError('Invalid OpenAI response body', 'unexpected');
  }
  const body = json as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: unknown;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const message = body.choices?.[0]?.message;
  const text = message?.content?.trim() || '';
  const toolCalls = parseToolCalls(message?.tool_calls);
  return {
    text,
    model: body.model || 'unknown',
    toolCalls,
    usage: body.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        }
      : undefined,
  };
}

export type OpenAIClient = {
  generateResponse: (
    input: GenerateResponseInput
  ) => Promise<GenerateResponseResult>;
  getConfig: () => OpenAIConfig;
};

let singleton: OpenAIClient | null = null;
let singletonConfigKey: string | null = null;

function configCacheKey(cfg: OpenAIConfig): string {
  // Do not include apiKey value in logs; only use for cache identity length+prefix
  return `${cfg.baseUrl}|${cfg.model}|${cfg.apiKey.length}`;
}

/**
 * Create (or return singleton) OpenAI chat client.
 * Never logs the API key.
 */
export function createOpenAIClient(deps?: {
  config?: OpenAIConfig;
  fetchImpl?: ChatCompletionsFetcher;
  forceNew?: boolean;
}): OpenAIClient {
  const config = deps?.config ?? loadOpenAIConfig();
  const key = configCacheKey(config);
  if (!deps?.forceNew && singleton && singletonConfigKey === key && !deps?.fetchImpl) {
    return singleton;
  }

  const fetchImpl = deps?.fetchImpl ?? defaultFetch;

  const client: OpenAIClient = {
    getConfig: () => config,
    async generateResponse(input) {
      const url = `${config.baseUrl}/chat/completions`;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: input.messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      };
      if (input.tools && input.tools.length > 0) {
        body.tools = input.tools;
        body.tool_choice = 'auto';
      }

      let attempt = 0;
      let lastError: AiError | undefined;

      while (attempt <= config.maxRetries) {
        try {
          const { status, json } = await fetchImpl({
            url,
            apiKey: config.apiKey,
            body,
            timeoutMs: config.timeoutMs,
          });

          if (status >= 400) {
            throw mapHttpError(status, json);
          }

          const extracted = extractCompletion(json);
          const hasTools =
            extracted.toolCalls && extracted.toolCalls.length > 0;
          if (!extracted.text && !hasTools) {
            throw new AiError('Empty OpenAI completion', 'empty_response');
          }
          return {
            text: extracted.text,
            model: extracted.model || config.model,
            toolCalls: extracted.toolCalls,
            usage: extracted.usage,
          };
        } catch (error) {
          const aiError =
            error instanceof AiError
              ? error
              : error instanceof Error && error.name === 'AbortError'
                ? new AiError('OpenAI request timed out', 'timeout', true)
                : new AiError(
                    error instanceof Error
                      ? error.message
                      : 'Unexpected OpenAI error',
                    'unexpected',
                    false
                  );
          lastError = aiError;
          if (!aiError.retryable || attempt >= config.maxRetries) {
            throw aiError;
          }
          const backoff = 250 * Math.pow(2, attempt);
          await sleep(backoff);
          attempt += 1;
        }
      }

      throw lastError || new AiError('OpenAI request failed', 'unexpected');
    },
  };

  if (!deps?.fetchImpl) {
    singleton = client;
    singletonConfigKey = key;
  }

  return client;
}

/** Reset singleton (tests). */
export function resetOpenAIClient(): void {
  singleton = null;
  singletonConfigKey = null;
}

export async function generateResponse(
  input: GenerateResponseInput,
  deps?: { client?: OpenAIClient }
): Promise<GenerateResponseResult> {
  const client = deps?.client ?? createOpenAIClient();
  return client.generateResponse(input);
}
