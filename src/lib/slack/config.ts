/**
 * Centralized Slack App configuration (server-side only).
 *
 * Secrets must never be logged, committed, or exposed via NEXT_PUBLIC_* /
 * next.config.js `env`. Call {@link getSlackConfig} from server code only.
 */

export type SlackLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SlackConfig {
  /** Display name for the Slack app */
  appName: string;
  botToken: string;
  signingSecret: string;
  clientId: string;
  clientSecret: string;
  /** Required only when Socket Mode is enabled */
  appToken?: string;
  /** Legacy verification token (optional; prefer signing secret) */
  verificationToken?: string;

  eventsPath: string;
  interactionsPath: string;
  commandsPath: string;

  socketMode: boolean;
  enableAppHome: boolean;

  /** Allowed Slack team/workspace ID, if restricted */
  workspace?: string;
  logLevel: SlackLogLevel;
}

const REQUIRED_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
] as const;

const DEFAULTS = {
  appName: 'AI Timesheet',
  eventsPath: '/api/slack/events',
  interactionsPath: '/api/slack/interactions',
  commandsPath: '/api/slack/commands',
  socketMode: false,
  enableAppHome: true,
  logLevel: 'info' as SlackLogLevel,
};

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return defaultValue;
}

function parseLogLevel(raw: string | undefined): SlackLogLevel {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') {
    return v;
  }
  return DEFAULTS.logLevel;
}

export class SlackConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    const list = missing.join(', ');
    super(
      `Slack configuration incomplete. Missing required environment variable(s): ${list}. ` +
        `Set them in the server environment (never NEXT_PUBLIC_*). See doc/features/ops/features/environment-variables.md.`
    );
    this.name = 'SlackConfigError';
    this.missing = missing;
  }
}

export type SlackEnv = Record<string, string | undefined>;

/**
 * Pure load + validate from a key/value map (testable).
 * Does not log secret values — only missing key names.
 */
export function loadSlackConfig(env: SlackEnv = process.env): SlackConfig {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new SlackConfigError([...missing]);
  }

  const socketMode = parseBool(env.SLACK_ENABLE_SOCKET_MODE, DEFAULTS.socketMode);
  const appToken = env.SLACK_APP_TOKEN?.trim() || undefined;

  if (socketMode && !appToken) {
    throw new SlackConfigError(['SLACK_APP_TOKEN']);
  }

  return {
    appName: env.SLACK_APP_NAME?.trim() || DEFAULTS.appName,
    botToken: env.SLACK_BOT_TOKEN!.trim(),
    signingSecret: env.SLACK_SIGNING_SECRET!.trim(),
    clientId: env.SLACK_CLIENT_ID!.trim(),
    clientSecret: env.SLACK_CLIENT_SECRET!.trim(),
    appToken,
    verificationToken: env.SLACK_VERIFICATION_TOKEN?.trim() || undefined,
    eventsPath: env.SLACK_EVENTS_PATH?.trim() || DEFAULTS.eventsPath,
    interactionsPath:
      env.SLACK_INTERACTIONS_PATH?.trim() || DEFAULTS.interactionsPath,
    commandsPath: env.SLACK_COMMANDS_PATH?.trim() || DEFAULTS.commandsPath,
    socketMode,
    enableAppHome: parseBool(env.SLACK_ENABLE_APP_HOME, DEFAULTS.enableAppHome),
    workspace: env.SLACK_ALLOWED_WORKSPACE?.trim() || undefined,
    logLevel: parseLogLevel(env.SLACK_LOG_LEVEL),
  };
}

let cached: SlackConfig | null = null;

/** Cached Slack config for the current process. Throws {@link SlackConfigError} if invalid. */
export function getSlackConfig(): SlackConfig {
  if (!cached) {
    cached = loadSlackConfig();
  }
  return cached;
}

/** Reset cache (tests only). */
export function resetSlackConfigCache(): void {
  cached = null;
}

/**
 * True when any Slack credential env is present (partial or full).
 * Used to detect misconfigured deploys without requiring Slack on every process.
 */
export function isSlackEnvPresent(env: SlackEnv = process.env): boolean {
  return REQUIRED_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

/**
 * Startup validation for Local / UAT / Production.
 *
 * - `SLACK_VALIDATE_ON_STARTUP=true` → always validate (fail if any required missing).
 * - Otherwise validate only when at least one Slack credential is set (catch partial config).
 * - No Slack vars and flag unset → skip (reminders-only / non-Slack deploys).
 *
 * Never logs secret values.
 */
export function assertSlackConfigOnStartup(env: SlackEnv = process.env): void {
  const force = env.SLACK_VALIDATE_ON_STARTUP?.trim().toLowerCase() === 'true';
  if (!force && !isSlackEnvPresent(env)) {
    return;
  }
  loadSlackConfig(env);
}
