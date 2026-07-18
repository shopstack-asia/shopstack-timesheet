import type { SlackLogLevel } from '@/lib/slack/config';

export type SlackLogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

const LEVEL_ORDER: Record<SlackLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): SlackLogLevel {
  const raw = (process.env.SLACK_LOG_LEVEL || 'info').trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

/**
 * Structured Slack foundation logger.
 * Never pass secrets (tokens, signing secret, raw signed bodies).
 */
export function slackLog(
  level: SlackLogLevel,
  message: string,
  fields: SlackLogFields = {}
): void {
  const min = resolveMinLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[min]) return;

  const line = {
    scope: 'slack',
    level,
    message,
    ...fields,
    ts: new Date().toISOString(),
  };

  const serialized = JSON.stringify(line);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function createSlackRequestLogger(base: SlackLogFields) {
  return {
    debug: (message: string, fields?: SlackLogFields) =>
      slackLog('debug', message, { ...base, ...fields }),
    info: (message: string, fields?: SlackLogFields) =>
      slackLog('info', message, { ...base, ...fields }),
    warn: (message: string, fields?: SlackLogFields) =>
      slackLog('warn', message, { ...base, ...fields }),
    error: (message: string, fields?: SlackLogFields) =>
      slackLog('error', message, { ...base, ...fields }),
  };
}
