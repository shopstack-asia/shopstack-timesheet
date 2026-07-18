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

describe('createOpenAIClient tool calling', () => {
  beforeEach(() => {
    resetOpenAIClient();
  });

  it('returns tool_calls without requiring text', async () => {
    const client = createOpenAIClient({
      forceNew: true,
      config: loadOpenAIConfig({ OPENAI_API_KEY: 'sk-test' }),
      fetchImpl: async ({ body }) => {
        const b = body as { tools?: unknown[] };
        expect(b.tools?.length).toBeGreaterThan(0);
        return {
          status: 200,
          json: {
            model: 'gpt-4o-mini',
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_ping',
                      type: 'function',
                      function: { name: 'ping', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        };
      },
    });

    const result = await client.generateResponse({
      messages: [{ role: 'user', content: 'Ping' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'ping',
            description: 'ping',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });
    expect(result.toolCalls?.[0]?.function.name).toBe('ping');
    expect(result.text).toBe('');
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
        enableTools: false,
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
        enableTools: false,
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
        enableTools: false,
      }
    );
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe(FRIENDLY_AI_FALLBACK);
  });

  it('empty user message uses fallback', async () => {
    const result = await runConversation(
      { userMessage: '   ' },
      { enableTools: false }
    );
    expect(result.usedFallback).toBe(true);
  });

  it('executes tool then returns final AI answer (ping)', async () => {
    let round = 0;
    const result = await runConversation(
      { userMessage: 'Ping', requestId: 'r1', eventId: 'e1' },
      {
        generate: async (input) => {
          round += 1;
          if (round === 1) {
            expect(input.tools?.some((t) => t.function.name === 'ping')).toBe(
              true
            );
            return {
              text: '',
              model: 'gpt-4o-mini',
              toolCalls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'ping', arguments: '{}' },
                },
              ],
            };
          }
          const toolMsg = input.messages.find((m) => m.role === 'tool');
          expect(toolMsg?.content).toContain('"success":true');
          expect(toolMsg?.content).toContain('pong');
          return {
            text: 'Pong!',
            model: 'gpt-4o-mini',
          };
        },
      }
    );
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe('Pong!');
    expect(result.toolRounds).toBe(1);
  });

  it('executes current_time tool then final answer', async () => {
    let round = 0;
    const result = await runConversation(
      { userMessage: 'What time is it?' },
      {
        generate: async () => {
          round += 1;
          if (round === 1) {
            return {
              text: '',
              model: 'm',
              toolCalls: [
                {
                  id: 'call_t',
                  type: 'function',
                  function: { name: 'current_time', arguments: '{}' },
                },
              ],
            };
          }
          return {
            text: 'Current server time is 14:32 ICT.',
            model: 'm',
          };
        },
      }
    );
    expect(result.text).toContain('14:32');
    expect(result.toolRounds).toBe(1);
  });

  it('feeds unknown-tool failure back to the model', async () => {
    let round = 0;
    const result = await runConversation(
      { userMessage: 'Do something' },
      {
        generate: async (input) => {
          round += 1;
          if (round === 1) {
            return {
              text: '',
              model: 'm',
              toolCalls: [
                {
                  id: 'call_x',
                  type: 'function',
                  function: { name: 'not_a_tool', arguments: '{}' },
                },
              ],
            };
          }
          const toolMsg = input.messages.find((m) => m.role === 'tool');
          expect(toolMsg?.content).toContain('unknown_tool');
          return { text: 'I cannot do that yet.', model: 'm' };
        },
      }
    );
    expect(result.text).toContain('cannot');
  });
});
