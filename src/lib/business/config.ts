import { BusinessApiError } from '@/lib/business/errors';
import type { BusinessApiConfig } from '@/lib/business/types';

export type BusinessEnv = Record<string, string | undefined>;

const DEFAULTS = {
  timeoutMs: 15_000,
  maxRetries: 2,
  logging: true,
};

function readNumber(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new BusinessApiError(`Invalid ${name}: ${raw}`, 'invalid_config');
  }
  return n;
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new BusinessApiError(
    `Invalid boolean value: ${raw}`,
    'invalid_config'
  );
}

/**
 * Load Business API config from env.
 * Secrets are never returned via toString/logging helpers.
 */
export function loadBusinessApiConfig(
  env: BusinessEnv = process.env
): BusinessApiConfig {
  const baseUrl = env.BUSINESS_API_BASE_URL?.trim() || '';
  if (!baseUrl) {
    throw new BusinessApiError(
      'Missing required environment variable: BUSINESS_API_BASE_URL',
      'missing_config'
    );
  }

  const apiKey = env.BUSINESS_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new BusinessApiError(
      'Missing required environment variable: BUSINESS_API_KEY',
      'missing_config'
    );
  }

  const timeoutMs = Math.floor(
    readNumber(
      env.BUSINESS_API_TIMEOUT_MS,
      DEFAULTS.timeoutMs,
      'BUSINESS_API_TIMEOUT_MS'
    )
  );
  if (timeoutMs < 1000) {
    throw new BusinessApiError(
      'BUSINESS_API_TIMEOUT_MS must be >= 1000',
      'invalid_config'
    );
  }

  const maxRetries = Math.floor(
    readNumber(env.BUSINESS_API_RETRY, DEFAULTS.maxRetries, 'BUSINESS_API_RETRY')
  );

  const logging = readBool(env.BUSINESS_API_LOGGING, DEFAULTS.logging);

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    timeoutMs,
    apiKey,
    maxRetries,
    logging,
  };
}

export function isBusinessApiEnvPresent(env: BusinessEnv = process.env): boolean {
  return Boolean(
    env.BUSINESS_API_BASE_URL?.trim() || env.BUSINESS_API_KEY?.trim()
  );
}

/**
 * Startup validation (mirrors Slack / OpenAI pattern).
 * - BUSINESS_API_VALIDATE_ON_STARTUP=true → always validate
 * - Else validate when any BUSINESS_API_* identity env is set
 */
export function assertBusinessApiConfigOnStartup(
  env: BusinessEnv = process.env
): void {
  const force =
    env.BUSINESS_API_VALIDATE_ON_STARTUP?.trim().toLowerCase() === 'true';
  if (!force && !isBusinessApiEnvPresent(env)) {
    return;
  }
  loadBusinessApiConfig(env);
}
