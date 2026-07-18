export type AiErrorCode =
  | 'missing_api_key'
  | 'invalid_config'
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_api_key'
  | 'network'
  | 'empty_response'
  | 'oversized_response'
  | 'unexpected';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;

  constructor(message: string, code: AiErrorCode, retryable = false) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
  }
}

export const FRIENDLY_AI_FALLBACK =
  "Sorry, I couldn't generate a response.\n\nPlease try again.";
