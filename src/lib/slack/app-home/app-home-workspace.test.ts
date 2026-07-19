/**
 * Workspace isolation for Slack App Home (events + interactions).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signSlackRequest } from '@/lib/slack/verifier';
import { POST as interactionsPOST } from '@/app/api/slack/interactions/route';
import { dispatchSlackEvent } from '@/lib/slack/dispatcher';
import {
  APP_HOME_ACTION,
  APP_HOME_VALUE,
  buildAppHomeConversationId,
  evaluateWorkspaceAccess,
  handleAppHomeAction,
  handleAppHomeOpened,
  loadAppHomeDashboard,
} from '@/lib/slack/app-home';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import type { TimesheetRange, WorkContext } from '@/lib/tools/business/types';
import type { SlackEventEnvelope } from '@/lib/slack/types';

const SECRET = 'test-signing-secret';
const FIXED_NOW = new Date('2026-07-18T10:00:00.000Z');

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
}));

const handleAppHomeActionSpy = vi.fn();

vi.mock('@/lib/slack/app-home/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/slack/app-home/actions')>();
  return {
    ...actual,
    handleAppHomeAction: (...args: Parameters<typeof actual.handleAppHomeAction>) => {
      handleAppHomeActionSpy(...args);
      return actual.handleAppHomeAction(...args);
    },
  };
});

vi.mock('@/lib/slack/config', () => ({
  getSlackConfig: () => ({
    enableAppHome: true,
    appName: 'AI Timesheet',
    botToken: 'xoxb-test',
    signingSecret: SECRET,
    clientId: 'x',
    clientSecret: 'x',
    eventsPath: '/api/slack/events',
    interactionsPath: '/api/slack/interactions',
    commandsPath: '/api/slack/commands',
    socketMode: false,
    logLevel: 'info',
    workspace: process.env.SLACK_ALLOWED_WORKSPACE?.trim() || undefined,
  }),
}));

function identityManager() {
  const store = createContextStore();
  return createContextManager({
    store,
    identityResolver: {
      resolveEmployee: async (uid: string) => ({
        slackUserId: uid,
        slackEmail: 'prakasit@shopstack.asia',
        employeeId: 'EMP-1',
        employeeName: 'Prakasit Demo',
      }),
    },
  });
}

function emptyRange(): TimesheetRange {
  const dates = [
    '2026-07-13',
    '2026-07-14',
    '2026-07-15',
    '2026-07-16',
    '2026-07-17',
    '2026-07-18',
    '2026-07-19',
  ];
  return {
    startDate: dates[0]!,
    endDate: dates[6]!,
    days: dates.map((date) => ({
      date,
      entries: [],
      totalHours: 0,
      expectedHours: 8,
      remainingHours: 8,
      submitted: false,
    })),
    totalHours: 0,
    expectedHours: 56,
    remainingHours: 56,
    submittedDays: 0,
    unsubmittedDays: 7,
  };
}

function emptyWork(): WorkContext {
  return { user: { id: 'E1', name: 'P' }, clients: [] };
}

function signedInteraction(payload: object, opts?: { secret?: string }) {
  const body = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const secret = opts?.secret ?? SECRET;
  const signature = signSlackRequest(secret, ts, body);
  return new NextRequest('http://localhost/api/slack/interactions', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': ts,
    },
  });
}

describe('evaluateWorkspaceAccess', () => {
  it('exact match only when allow-list configured', () => {
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: 'T-ALLOWED',
        allowedWorkspaceId: 'T-ALLOWED',
      })
    ).toEqual({ outcome: 'allowed', workspaceId: 'T-ALLOWED' });
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: 'T-FOREIGN',
        allowedWorkspaceId: 'T-ALLOWED',
      }).outcome
    ).toBe('mismatch');
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: '',
        allowedWorkspaceId: 'T-ALLOWED',
      }).outcome
    ).toBe('missing_workspace');
    // no fuzzy / case-insensitive
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: 't-allowed',
        allowedWorkspaceId: 'T-ALLOWED',
      }).outcome
    ).toBe('mismatch');
  });

  it('unconfigured allow-list still returns actual or empty', () => {
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: 'T1',
        allowedWorkspaceId: undefined,
      })
    ).toEqual({ outcome: 'allowed', workspaceId: 'T1' });
    expect(
      evaluateWorkspaceAccess({
        actualWorkspaceId: '',
        allowedWorkspaceId: undefined,
      })
    ).toEqual({ outcome: 'allowed', workspaceId: '' });
  });
});

describe('workspace-scoped conversation ids', () => {
  it('TEST 12: T1/U1, T2/U1, T1/U2 all differ', () => {
    const a = buildAppHomeConversationId('T1', 'U1');
    const b = buildAppHomeConversationId('T2', 'U1');
    const c = buildAppHomeConversationId('T1', 'U2');
    expect(a).toBe('slack:app_home:T1:U1');
    expect(b).toBe('slack:app_home:T2:U1');
    expect(c).toBe('slack:app_home:T1:U2');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('TEST 13: encodes separators and whitespace', () => {
    expect(buildAppHomeConversationId('T:1', 'U 1')).toBe(
      `slack:app_home:${encodeURIComponent('T:1')}:${encodeURIComponent('U 1')}`
    );
    expect(buildAppHomeConversationId('T:1', 'U 1')).not.toBe(
      buildAppHomeConversationId('T', '1:U 1')
    );
  });

  it('TEST 14: unscoped namespace when workspace missing', () => {
    expect(buildAppHomeConversationId('', 'U1')).toBe(
      'slack:app_home:unscoped:U1'
    );
    expect(buildAppHomeConversationId(undefined, 'U1')).toBe(
      'slack:app_home:unscoped:U1'
    );
  });
});

describe('App Home event workspace isolation', () => {
  const publishes: unknown[] = [];
  const identityCalls: string[] = [];

  beforeEach(() => {
    publishes.length = 0;
    identityCalls.length = 0;
  });

  const store = createContextStore();
  const manager = createContextManager({
    store,
    identityResolver: {
      resolveEmployee: async (uid: string) => {
        identityCalls.push(uid);
        return {
          slackUserId: uid,
          slackEmail: 'prakasit@shopstack.asia',
          employeeId: 'EMP-1',
          employeeName: 'Prakasit Demo',
        };
      },
    },
  });

  const deps = {
    client: {
      views: {
        publish: vi.fn(async () => {
          publishes.push(1);
          return { ok: true };
        }),
      },
    },
    enableLoadingView: false,
    wasProcessed: vi.fn(async () => false),
    contextManager: manager,
    now: FIXED_NOW,
    readTimesheetRange: async () => emptyRange(),
    loadWorkContext: async () => emptyWork(),
    getTimesheetUrl: () => undefined,
  };

  function env(teamId?: string): SlackEventEnvelope {
    return {
      type: 'event_callback',
      team_id: teamId,
      event_id: `Ev-${teamId || 'none'}`,
      event: {
        type: 'app_home_opened',
        user: 'U1',
        tab: 'home',
        channel: 'D1',
      },
    };
  }

  it('TEST 1: allowed App Home event publishes with scoped context id', async () => {
    const conversationIds: string[] = [];
    const mgr = createContextManager({
      store: createContextStore(),
      identityResolver: {
        resolveEmployee: async (uid) => {
          identityCalls.push(uid);
          return {
            slackUserId: uid,
            slackEmail: 'prakasit@shopstack.asia',
            employeeId: 'EMP-1',
            employeeName: 'Prakasit',
          };
        },
      },
    });
    const origGet = mgr.getConversationContext.bind(mgr);
    mgr.getConversationContext = async (input) => {
      conversationIds.push(input.conversationId);
      return origGet(input);
    };

    const result = await handleAppHomeOpened(
      { requestId: 'r1', envelope: env('T-ALLOWED') },
      {
        ...deps,
        allowedWorkspaceId: 'T-ALLOWED',
        contextManager: mgr,
      }
    );
    expect(result.published).toBe(true);
    expect(identityCalls).toHaveLength(1);
    expect(publishes).toHaveLength(1);
    expect(conversationIds[0]).toBe('slack:app_home:T-ALLOWED:U1');
  });

  it('TEST 2: foreign App Home event — zero side effects', async () => {
    const result = await handleAppHomeOpened(
      { requestId: 'r1', envelope: env('T-FOREIGN') },
      { ...deps, allowedWorkspaceId: 'T-ALLOWED' }
    );
    expect(result).toEqual({
      published: false,
      reason: 'mismatch',
    });
    expect(identityCalls).toHaveLength(0);
    expect(publishes).toHaveLength(0);

    const route = await dispatchSlackEvent(env('T-FOREIGN'), {
      requestId: 'r1',
      allowedWorkspace: 'T-ALLOWED',
      appHome: { ...deps, allowedWorkspaceId: 'T-ALLOWED' },
    });
    expect(route).toEqual({
      handled: false,
      route: 'workspace_mismatch',
    });
    expect(identityCalls).toHaveLength(0);
    expect(publishes).toHaveLength(0);
  });

  it('TEST 3: missing workspace on App Home event', async () => {
    const result = await handleAppHomeOpened(
      { requestId: 'r1', envelope: env(undefined) },
      { ...deps, allowedWorkspaceId: 'T-ALLOWED' }
    );
    expect(result.reason).toBe('missing_workspace');
    expect(identityCalls).toHaveLength(0);
    expect(publishes).toHaveLength(0);
  });
});

describe('App Home action workspace isolation (handler defense in depth)', () => {
  it('TEST 10: foreign team on direct handler call', async () => {
    const publish = vi.fn(async () => ({ ok: true }));
    const open = vi.fn(async () => ({ ok: true }));
    const wasProcessed = vi.fn(async () => false);
    const read = vi.fn(async () => emptyRange());
    const result = await handleAppHomeAction(
      {
        user: { id: 'U1' },
        team: { id: 'T-FOREIGN' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'x.1',
          },
        ],
      },
      {
        allowedWorkspaceId: 'T-ALLOWED',
        wasProcessed,
        client: { views: { publish, open } },
        contextManager: identityManager(),
        readTimesheetRange: read,
        loadWorkContext: async () => emptyWork(),
      }
    );
    expect(result).toEqual({ handled: true, reason: 'mismatch' });
    expect(wasProcessed).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('TEST 11: missing team defense in depth', async () => {
    const publish = vi.fn(async () => ({ ok: true }));
    const result = await handleAppHomeAction(
      {
        user: { id: 'U1' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'x.2',
          },
        ],
      },
      {
        allowedWorkspaceId: 'T-ALLOWED',
        client: { views: { publish } },
        contextManager: identityManager(),
        readTimesheetRange: async () => emptyRange(),
      }
    );
    expect(result.reason).toBe('missing_workspace');
    expect(publish).not.toHaveBeenCalled();
  });

  it('TEST 7/8/9: foreign help, retry, url — zero side effects', async () => {
    for (const action_id of [
      APP_HOME_ACTION.help,
      APP_HOME_ACTION.retry,
      APP_HOME_ACTION.openTimesheet,
    ]) {
      const publish = vi.fn(async () => ({ ok: true }));
      const open = vi.fn(async () => ({ ok: true }));
      const read = vi.fn(async () => emptyRange());
      const result = await handleAppHomeAction(
        {
          user: { id: 'U1' },
          team: { id: 'T-FOREIGN' },
          trigger_id: 'trig',
          actions: [{ action_id, value: 'x', action_ts: `${action_id}.1` }],
        },
        {
          allowedWorkspaceId: 'T-ALLOWED',
          client: { views: { publish, open } },
          contextManager: identityManager(),
          readTimesheetRange: read,
        }
      );
      expect(result.reason).toBe('mismatch');
      expect(publish).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('TEST 4: allowed refresh loads scoped dashboard', async () => {
    const conversationIds: string[] = [];
    const mgr = createContextManager({
      store: createContextStore(),
      identityResolver: {
        resolveEmployee: async (uid) => ({
          slackUserId: uid,
          slackEmail: 'prakasit@shopstack.asia',
          employeeId: 'EMP-1',
          employeeName: 'Prakasit',
        }),
      },
    });
    const orig = mgr.getConversationContext.bind(mgr);
    mgr.getConversationContext = async (input) => {
      conversationIds.push(input.conversationId);
      return orig(input);
    };
    const publish = vi.fn(async () => ({ ok: true }));
    await handleAppHomeAction(
      {
        user: { id: 'U1' },
        team: { id: 'T-ALLOWED' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'ok.1',
          },
        ],
      },
      {
        allowedWorkspaceId: 'T-ALLOWED',
        wasProcessed: async () => false,
        client: { views: { publish } },
        contextManager: mgr,
        now: FIXED_NOW,
        readTimesheetRange: async () => emptyRange(),
        loadWorkContext: async () => emptyWork(),
      }
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(conversationIds[0]).toBe('slack:app_home:T-ALLOWED:U1');
  });
});

describe('App Home interactions route workspace isolation', () => {
  beforeEach(() => {
    handleAppHomeActionSpy.mockClear();
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.SLACK_ALLOWED_WORKSPACE = 'T-ALLOWED';
  });

  it('TEST 5: foreign Refresh returns 200 and does not call handler', async () => {
    const res = await interactionsPOST(
      signedInteraction({
        type: 'block_actions',
        user: { id: 'U1' },
        team: { id: 'T-FOREIGN' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'f.1',
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(handleAppHomeActionSpy).not.toHaveBeenCalled();
  });

  it('TEST 6: missing workspace Refresh returns 200 with zero handler calls', async () => {
    const res = await interactionsPOST(
      signedInteraction({
        type: 'block_actions',
        user: { id: 'U1' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'm.1',
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(handleAppHomeActionSpy).not.toHaveBeenCalled();
  });

  it('TEST 15: invalid signature still 401', async () => {
    const res = await interactionsPOST(
      signedInteraction(
        {
          type: 'block_actions',
          user: { id: 'U1' },
          team: { id: 'T-ALLOWED' },
          actions: [
            {
              action_id: APP_HOME_ACTION.refresh,
              value: APP_HOME_VALUE.refresh,
            },
          ],
        },
        { secret: 'wrong-secret' }
      )
    );
    expect(res.status).toBe(401);
    expect(handleAppHomeActionSpy).not.toHaveBeenCalled();
  });

  it('TEST 4 route: allowed Refresh schedules handler', async () => {
    const res = await interactionsPOST(
      signedInteraction({
        type: 'block_actions',
        user: { id: 'U1' },
        team: { id: 'T-ALLOWED' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: 'ok.route',
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    // waitUntil is fire-and-forget; spy is called synchronously when waitUntil invokes
    await Promise.resolve();
    expect(handleAppHomeActionSpy).toHaveBeenCalled();
  });
});

describe('loader uses workspace-scoped id', () => {
  it('builds scoped conversation id from trusted workspace', async () => {
    const ids: string[] = [];
    const mgr = createContextManager({
      store: createContextStore(),
      identityResolver: {
        resolveEmployee: async (uid) => ({
          slackUserId: uid,
          slackEmail: 'a@shopstack.asia',
          employeeId: 'E1',
          employeeName: 'A',
        }),
      },
    });
    const orig = mgr.getConversationContext.bind(mgr);
    mgr.getConversationContext = async (input) => {
      ids.push(input.conversationId);
      return orig(input);
    };
    await loadAppHomeDashboard({
      slackUserId: 'U1',
      workspaceId: 'T-ALLOWED',
      contextManager: mgr,
      now: FIXED_NOW,
      readTimesheetRange: async () => emptyRange(),
      loadWorkContext: async () => emptyWork(),
    });
    expect(ids[0]).toBe('slack:app_home:T-ALLOWED:U1');
  });
});
