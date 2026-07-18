/**
 * Structured logging for Business API Client.
 * Never logs Authorization, API keys, passwords, or tokens.
 */

export type BusinessLogLevel = 'info' | 'warn' | 'error';

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

export function sanitizeHeadersForLog(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function logBusinessApi(
  enabled: boolean,
  level: BusinessLogLevel,
  message: string,
  fields: Record<string, string | number | boolean | undefined>
): void {
  if (!enabled) return;
  const line = JSON.stringify({
    scope: 'business-api',
    level,
    message,
    ...fields,
    ts: new Date().toISOString(),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
