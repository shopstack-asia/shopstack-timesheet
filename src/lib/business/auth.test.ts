import { describe, expect, it } from 'vitest';
import {
  createApiKeyProvider,
  createBearerTokenProvider,
  createJwtProvider,
  createOAuthProvider,
} from '@/lib/business/auth';

describe('auth providers', () => {
  it('Bearer provider sets Authorization header', () => {
    const provider = createBearerTokenProvider('secret-token');
    const headers: Record<string, string> = {};
    provider.apply(headers);
    expect(provider.kind).toBe('bearer');
    expect(headers.Authorization).toBe('Bearer secret-token');
  });

  it('rejects empty bearer token', () => {
    expect(() => createBearerTokenProvider('  ')).toThrow(/empty/);
  });

  it('API key provider sets X-API-Key by default', () => {
    const provider = createApiKeyProvider('key-123');
    const headers: Record<string, string> = {};
    provider.apply(headers);
    expect(provider.kind).toBe('api_key');
    expect(headers['X-API-Key']).toBe('key-123');
  });

  it('API key provider supports custom header name', () => {
    const provider = createApiKeyProvider('key-123', 'X-Custom-Key');
    const headers: Record<string, string> = {};
    provider.apply(headers);
    expect(headers['X-Custom-Key']).toBe('key-123');
  });

  it('OAuth provider stub rejects until implemented', async () => {
    const provider = createOAuthProvider(async () => 'tok');
    await expect(provider.apply({})).rejects.toThrow(/not implemented/);
  });

  it('JWT provider stub rejects until implemented', async () => {
    const provider = createJwtProvider(async () => 'jwt');
    await expect(provider.apply({})).rejects.toThrow(/not implemented/);
  });
});
