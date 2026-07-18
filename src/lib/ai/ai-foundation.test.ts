import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  assertOpenAIConfigOnStartup,
  createOpenAIClient,
  loadOpenAIConfig,
  resetOpenAIClient,
} from '@/lib/ai/client';
import { runConversation } from '@/lib/ai/conversation';
import { AiError, FRIENDLY_AI_FALLBACK } from '@/lib/ai/errors';
import { AI_TIMESHEET_SYSTEM_PROMPT, buildPrompt } from '@/lib/ai/prompt';

describe('loadOpenAIConfig', () => {
  it('requires API key', () => {
    expect(() => loadOpenAIConfig({})).toThrow(AiError);
  });

  it('loads defaults', () => {
    const cfg = loadOpenAIConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.maxTokens).toBe(512);
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.timeoutMs).toBe(30_000);
  });

  it('accepts AI_API_KEY fallback', () => {
    const cfg = loadOpenAIConfig({ AI_API_KEY: 'sk-legacy', AI_MODEL: 'gpt-x' });
    expect(cfg.apiKey).toBe('sk-legacy');
    expect(cfg.model).toBe('gpt-x');
  });
});

describe('assertOpenAIConfigOnStartup', () => {
  it('skips when no key', () => {
    expect(() => assertOpenAIConfigOnStartup({})).not.toThrow();
  });

  it('validates when key present', () => {
    expect(() =>
      assertOpenAIConfigOnStartup({ OPENAI_API_KEY: 'sk-test' })
    ).not.toThrow();
  });
});

describe('buildPrompt', () => {
  it('includes system + user messages', () => {
    const messages = buildPrompt({ userMessage: 'Hello' });
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain(AI_TIMESHEET_SYSTEM_PROMPT.slice(0, 20));
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('appends extra system segments', () => {
    const messages = buildPrompt({
      userMessage: 'Hi',
      extraSystemSegments: ['Policy A'],
    });
    expect(messages[0]?.content).toContain('Policy A');
  });
});

describe('createOpenAIClient / generateResponse', () => {
  beforeEach(() => {
    resetOpenAIClient();
  });

  it('returns completion text', async () => {
    const client = createOpenAIClient({
      forceNew: true,
      config: loadOpenAIConfig({ OPENAI_API_KEY: 'sk-test' }),
      fetchImpl: async () => ({
        status: 200,
        json: {
          model: 'gpt-4o-mini',
          choices: [{ message: { content: 'Hello! How can I help you today?' } }],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        },
      }),
    });

    const result = await client.generateResponse({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.text).toBe('Hello! How can I help you today?');
    expect(result.usage?.totalTokens).toBe(18);
  });

  it('maps 401 to invalid_api_key', async () => {
    const client = createOpenAIClient({
      forceNew: true,
      config: loadOpenAIConfig({ OPENAI_API_KEY: 'bad' }),
      fetchImpl: async () => ({
        status: 401,
        json: { error: { message: 'Incorrect API key', code: 'invalid_api_key' } },
      }),
    });
    await expect(
      client.generateResponse({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ code: 'invalid_api_key' });
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const client = createOpenAIClient({
      forceNew: true,
      config: {
        ...loadOpenAIConfig({ OPENAI_API_KEY: 'sk-test' }),
        maxRetries: 2,
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return { status: 429, json: { error: { message: 'rate' } } };
        }
        return {
          status: 200,
          json: { choices: [{ message: { content: 'ok' } }], model: 'm' },
        };
      },
    });
    const result = await client.generateResponse({
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('maps timeout AbortError', async () => {
    const client = createOpenAIClient({
      forceNew: true,
      config: loadOpenAIConfig({ OPENAI_API_KEY: 'sk-test' }),
      fetchImpl: async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    await expect(
      client.generateResponse({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('runConversation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns AI text', async () => {
    const result = await runConversation(
      { userMessage: 'Hello', requestId: 'r1' },
      {
        generate: async () => ({
          text: 'Hello! How can I help you today?',
          model: 'gpt-4o-mini',
        }),
      }
    );
    expect(result.usedFallback).toBe(false);
    expect(result.text).toContain('Hello');
  });

  it('returns friendly fallback on OpenAI failure', async () => {
    const result = await runConversation(
      { userMessage: 'Hello' },
      {
        generate: async () => {
          throw new AiError('rate', 'rate_limited', true);
        },
      }
    );
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe(FRIENDLY_AI_FALLBACK);
  });

  it('rejects oversized responses via fallback', async () => {
    const result = await runConversation(
      { userMessage: 'Hello' },
      {
        generate: async () => ({
          text: 'x'.repeat(5000),
          model: 'm',
        }),
      }
    );
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe(FRIENDLY_AI_FALLBACK);
  });

  it('empty user message uses fallback', async () => {
    const result = await runConversation({ userMessage: '   ' });
    expect(result.usedFallback).toBe(true);
  });
});
