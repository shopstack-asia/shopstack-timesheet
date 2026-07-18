import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertSlackConfigOnStartup,
  isSlackEnvPresent,
  loadSlackConfig,
  resetSlackConfigCache,
  SlackConfigError,
} from '@/lib/slack/config';

const completeEnv = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_SIGNING_SECRET: 'signing-secret',
  SLACK_CLIENT_ID: 'client-id',
  SLACK_CLIENT_SECRET: 'client-secret',
};

describe('loadSlackConfig', () => {
  beforeEach(() => {
    resetSlackConfigCache();
  });

  it('loads required fields and defaults', () => {
    const cfg = loadSlackConfig(completeEnv);
    expect(cfg.botToken).toBe('xoxb-test');
    expect(cfg.signingSecret).toBe('signing-secret');
    expect(cfg.clientId).toBe('client-id');
    expect(cfg.clientSecret).toBe('client-secret');
    expect(cfg.appName).toBe('AI Timesheet');
    expect(cfg.eventsPath).toBe('/api/slack/events');
    expect(cfg.interactionsPath).toBe('/api/slack/interactions');
    expect(cfg.commandsPath).toBe('/api/slack/commands');
    expect(cfg.socketMode).toBe(false);
    expect(cfg.enableAppHome).toBe(true);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.appToken).toBeUndefined();
    expect(cfg.workspace).toBeUndefined();
  });

  it('applies optional overrides', () => {
    const cfg = loadSlackConfig({
      ...completeEnv,
      SLACK_APP_NAME: 'Custom Bot',
      SLACK_APP_TOKEN: 'xapp-token',
      SLACK_VERIFICATION_TOKEN: 'verify',
      SLACK_EVENTS_PATH: '/custom/events',
      SLACK_INTERACTIONS_PATH: '/custom/interactions',
      SLACK_COMMANDS_PATH: '/custom/commands',
      SLACK_ENABLE_SOCKET_MODE: 'false',
      SLACK_ENABLE_APP_HOME: 'false',
      SLACK_ALLOWED_WORKSPACE: 'T123',
      SLACK_LOG_LEVEL: 'debug',
    });
    expect(cfg.appName).toBe('Custom Bot');
    expect(cfg.appToken).toBe('xapp-token');
    expect(cfg.verificationToken).toBe('verify');
    expect(cfg.eventsPath).toBe('/custom/events');
    expect(cfg.interactionsPath).toBe('/custom/interactions');
    expect(cfg.commandsPath).toBe('/custom/commands');
    expect(cfg.enableAppHome).toBe(false);
    expect(cfg.workspace).toBe('T123');
    expect(cfg.logLevel).toBe('debug');
  });

  it('lists every missing required variable by name', () => {
    try {
      loadSlackConfig({});
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlackConfigError);
      const err = e as SlackConfigError;
      expect(err.missing).toEqual([
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET',
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET',
      ]);
      expect(err.message).toContain('SLACK_BOT_TOKEN');
      expect(err.message).not.toContain('xoxb');
    }
  });

  it('requires SLACK_APP_TOKEN when socket mode is enabled', () => {
    expect(() =>
      loadSlackConfig({
        ...completeEnv,
        SLACK_ENABLE_SOCKET_MODE: 'true',
      })
    ).toThrow(SlackConfigError);
    expect(() =>
      loadSlackConfig({
        ...completeEnv,
        SLACK_ENABLE_SOCKET_MODE: 'true',
        SLACK_APP_TOKEN: 'xapp-1',
      })
    ).not.toThrow();
  });
});

describe('assertSlackConfigOnStartup', () => {
  it('skips when no Slack env and flag unset', () => {
    expect(() => assertSlackConfigOnStartup({})).not.toThrow();
  });

  it('fails on partial Slack env (missing vars named)', () => {
    try {
      assertSlackConfigOnStartup({ SLACK_BOT_TOKEN: 'xoxb-only' });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlackConfigError);
      expect((e as SlackConfigError).missing).toContain('SLACK_SIGNING_SECRET');
      expect((e as SlackConfigError).missing).not.toContain('SLACK_BOT_TOKEN');
    }
  });

  it('force-validates when SLACK_VALIDATE_ON_STARTUP=true', () => {
    expect(() =>
      assertSlackConfigOnStartup({ SLACK_VALIDATE_ON_STARTUP: 'true' })
    ).toThrow(SlackConfigError);
  });

  it('passes when complete and force flag set', () => {
    expect(() =>
      assertSlackConfigOnStartup({
        ...completeEnv,
        SLACK_VALIDATE_ON_STARTUP: 'true',
      })
    ).not.toThrow();
  });
});

describe('isSlackEnvPresent', () => {
  it('detects any required credential', () => {
    expect(isSlackEnvPresent({})).toBe(false);
    expect(isSlackEnvPresent({ SLACK_CLIENT_ID: 'x' })).toBe(true);
  });
});
