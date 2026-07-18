/**
 * Authentication abstraction for Business API Client.
 * Tools must never build Authorization headers manually.
 */

export type AuthKind = 'bearer' | 'api_key' | 'oauth' | 'jwt';

export type AuthProvider = {
  readonly kind: AuthKind;
  /** Apply auth headers. Must never log credentials. */
  apply(headers: Record<string, string>): void | Promise<void>;
};

/**
 * Authorization: Bearer <token>
 * Current production path for Timesheet API.
 */
export function createBearerTokenProvider(token: string): AuthProvider {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Bearer token must not be empty');
  }
  return {
    kind: 'bearer',
    apply(headers) {
      headers.Authorization = `Bearer ${trimmed}`;
    },
  };
}

/**
 * API Key via configurable header (default X-API-Key).
 * Ready for gateways that prefer header keys over Bearer.
 */
export function createApiKeyProvider(
  apiKey: string,
  headerName = 'X-API-Key'
): AuthProvider {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('API key must not be empty');
  }
  const name = headerName.trim() || 'X-API-Key';
  return {
    kind: 'api_key',
    apply(headers) {
      headers[name] = trimmed;
    },
  };
}

/**
 * Future OAuth provider stub — throws until implemented.
 */
export function createOAuthProvider(_getAccessToken: () => Promise<string>): AuthProvider {
  return {
    kind: 'oauth',
    async apply() {
      throw new Error('OAuth auth provider is not implemented yet');
    },
  };
}

/**
 * Future JWT provider stub — throws until implemented.
 */
export function createJwtProvider(_getJwt: () => Promise<string>): AuthProvider {
  return {
    kind: 'jwt',
    async apply() {
      throw new Error('JWT auth provider is not implemented yet');
    },
  };
}
