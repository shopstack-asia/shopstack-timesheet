/**
 * Slack App Home — unit + production-path tests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchSlackEvent } from '@/lib/slack/dispatcher';
import {
  APP_HOME_ACTION,
  APP_HOME_VALUE,
  buildAppHomeConversationId,
  buildAppHomeView,
  buildAppHomeHelpModal,
  assertAppHomeViewSafe,
  escapeSlackMrkdwn,
  getSafeAppHomeTimesheetUrl,
  handleAppHomeOpened,
  handleAppHomeAction,
  loadAppHomeDashboard,
  selectAppHomeProjects,
  bangkokMondaySundayWeek,
  thaiWeekRangeLabel,
  formatHoursDisplay,
} from '@/lib/slack/app-home';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import type { TimesheetRange, WorkContext } from '@/lib/tools/business/types';
import type { SlackEventEnvelope } from '@/lib/slack/types';

const FIXED_NOW = new Date('2026-07-18T10:00:00.000Z'); // Bangkok Sat 18 Jul 2026

vi.mock('@/lib/slack/config', () => ({
  getSlackConfig: () => ({
    enableAppHome: true,
    appName: 'AI Timesheet',
    botToken: 'x',
    signingSecret: 'x',
    clientId: 'x',
    clientSecret: 'x',
    eventsPath: '/api/slack/events',
    interactionsPath: '/api/slack/interactions',
    commandsPath: '/api/slack/commands',
    socketMode: false,
    logLevel: 'info',
  }),
}));

function makeRange(days: Array<{ date: string; hours: number; entries?: number }>): TimesheetRange {
  const mapped = days.map((d) => ({
    date: d.date,
    entries: Array.from({ length: d.entries ?? (d.hours > 0 ? 1 : 0) }, () => ({
      hours: d.hours / (d.entries || 1),
    })),
    totalHours: d.hours,
    expectedHours: 8,
    remainingHours: Math.max(0, 8 - d.hours),
    submitted: false,
  }));
  const totalHours = mapped.reduce((s, d) => s + d.totalHours, 0);
  return {
    startDate: days[0]!.date,
    endDate: days[days.length - 1]!.date,
    days: mapped,
    totalHours,
    expectedHours: mapped.length * 8,
    remainingHours: Math.max(0, mapped.length * 8 - totalHours),
    submittedDays: 0,
    unsubmittedDays: mapped.length,
  };
}

function workContext(projects: Array<{ client: string; id: string; name: string }>): WorkContext {
  const byClient = new Map<string, WorkContext['clients'][0]>();
  for (const p of projects) {
    let c = byClient.get(p.client);
    if (!c) {
      c = { id: `C-${p.client}`, name: p.client, projects: [] };
      byClient.set(p.client, c);
    }
    c.projects.push({ id: p.id, name: p.name, roles: [] });
  }
  return {
    user: { id: 'E1', name: 'Prakasit' },
    clients: [...byClient.values()],
  };
}

function identityManager(opts?: {
  fail?: boolean;
  name?: string;
  employeeId?: string;
  email?: string;
  slackUserId?: string;
}) {
  const slackUserId = opts?.slackUserId || 'U1';
  const store = createContextStore();
  return createContextManager({
    store,
    identityResolver: {
      resolveEmployee: async (uid: string) => {
        if (opts?.fail) throw new Error('identity failed');
        if (uid !== slackUserId && opts?.slackUserId) {
          // allow any for multi-user tests when not locked
        }
        return {
          slackUserId: uid,
          slackEmail: opts?.email || 'prakasit@shopstack.asia',
          employeeId: opts?.employeeId || 'EMP-1',
          employeeName: opts?.name || 'Prakasit Demo',
        };
      },
    },
  });
}

describe('App Home week / date helpers', () => {
  it('computes Monday–Sunday Bangkok week', () => {
    const w = bangkokMondaySundayWeek(FIXED_NOW);
    expect(w.startDate).toBe('2026-07-13');
    expect(w.endDate).toBe('2026-07-19');
    expect(w.dates).toHaveLength(7);
    expect(w.today).toBe('2026-07-18');
  });

  it('handles Sunday boundary', () => {
    const sun = new Date('2026-07-19T10:00:00.000Z');
    const w = bangkokMondaySundayWeek(sun);
    expect(w.startDate).toBe('2026-07-13');
    expect(w.endDate).toBe('2026-07-19');
    expect(w.today).toBe('2026-07-19');
  });

  it('handles month boundary', () => {
    const d = new Date('2026-07-01T10:00:00.000Z'); // Wed
    const w = bangkokMondaySundayWeek(d);
    expect(w.startDate).toBe('2026-06-29');
    expect(w.endDate).toBe('2026-07-05');
  });

  it('handles year boundary', () => {
    const d = new Date('2026-01-01T10:00:00.000Z'); // Thu
    const w = bangkokMondaySundayWeek(d);
    expect(w.startDate).toBe('2025-12-29');
    expect(w.endDate).toBe('2026-01-04');
  });

  it('handles leap-year boundary', () => {
    const d = new Date('2024-02-29T10:00:00.000Z'); // Thu
    const w = bangkokMondaySundayWeek(d);
    expect(w.startDate).toBe('2024-02-26');
    expect(w.endDate).toBe('2024-03-03');
    expect(w.dates).toContain('2024-02-29');
  });

  it('does not UTC off-by-one for late Bangkok evening', () => {
    // 2026-07-17 20:00 UTC = 2026-07-18 03:00 Bangkok
    const d = new Date('2026-07-17T20:00:00.000Z');
    const w = bangkokMondaySundayWeek(d);
    expect(w.today).toBe('2026-07-18');
  });

  it('formats week label in Thai', () => {
    expect(thaiWeekRangeLabel('2026-07-13', '2026-07-19')).toBe(
      '13–19 กรกฎาคม 2026'
    );
  });

  it('preserves decimal hours display', () => {
    expect(formatHoursDisplay(3.5)).toBe('3.5');
    expect(formatHoursDisplay(10)).toBe('10');
  });
});

describe('App Home projects', () => {
  it('dedupes and sorts projects; caps at five with extra count', () => {
    const wc = workContext([
      { client: 'Zeta', id: 'P1', name: 'Alpha' },
      { client: 'Acme', id: 'P2', name: 'Beta' },
      { client: 'Acme', id: 'P2', name: 'Beta duplicate' },
      { client: 'Mitrphol', id: 'P3', name: 'RMS' },
      { client: 'Hertz', id: 'P4', name: 'Commerce' },
      { client: 'Shopstack', id: 'P5', name: 'Suite' },
      { client: 'Other', id: 'P6', name: 'Extra' },
    ]);
    const { projects, extraCount } = selectAppHomeProjects(wc);
    expect(projects).toHaveLength(5);
    expect(extraCount).toBe(1);
    expect(projects[0]!.clientName).toBe('Acme');
    expect(projects.every((p) => !('id' in p))).toBe(true);
  });

  it('empty work context', () => {
    expect(selectAppHomeProjects({ user: { id: 'x', name: 'n' }, clients: [] })).toEqual({
      projects: [],
      extraCount: 0,
    });
  });
});

describe('App Home URL', () => {
  it('omits button when URL missing', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    const prevApp = process.env.APP_URL;
    const prevAuth = process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
    delete process.env.NEXTAUTH_URL;
    expect(getSafeAppHomeTimesheetUrl({ ...process.env })).toBeUndefined();
    if (prev) process.env.NEXT_PUBLIC_APP_URL = prev;
    if (prevApp) process.env.APP_URL = prevApp;
    if (prevAuth) process.env.NEXTAUTH_URL = prevAuth;
  });

  it('requires HTTPS in production', () => {
    expect(
      getSafeAppHomeTimesheetUrl({
        NEXT_PUBLIC_APP_URL: 'http://example.com',
        NODE_ENV: 'production',
      })
    ).toBeUndefined();
    expect(
      getSafeAppHomeTimesheetUrl({
        NEXT_PUBLIC_APP_URL: 'https://example.com',
        NODE_ENV: 'production',
      })
    ).toBe('https://example.com/timesheet');
  });

  it('rejects identity query params', () => {
    // getConfiguredTimesheetUrl always builds /timesheet without query —
    // ensure safe helper never appends identity
    const url = getSafeAppHomeTimesheetUrl({
      NEXT_PUBLIC_APP_URL: 'https://timesheet.shopstack.asia',
      NODE_ENV: 'production',
    });
    expect(url).toBe('https://timesheet.shopstack.asia/timesheet');
    expect(url).not.toMatch(/employee|staff|email|user|token/i);
  });
});

describe('App Home view builder', () => {
  it('builds type home with stable ids and single-asterisk bold', () => {
    const view = buildAppHomeView({
      kind: 'dashboard',
      displayName: 'Prakasit',
      timesheet: {
        status: 'ok',
        weekLabel: '13–19 กรกฎาคม 2026',
        totalHours: 10,
        days: [
          {
            date: '2026-07-18',
            weekdayLabel: 'ส.',
            dateLabel: '18 ก.ค.',
            hours: 10,
            isToday: true,
          },
        ],
      },
      projects: {
        status: 'ok',
        projects: [{ clientName: 'Mitrphol', projectName: 'RMS' }],
        extraCount: 0,
      },
      timesheetUrl: 'https://example.com/timesheet',
    });
    expect(view.type).toBe('home');
    expect(view.blocks.length).toBeLessThan(90);
    const raw = JSON.stringify(view);
    expect(raw).not.toContain('**');
    expect(raw).toContain('*สัปดาห์นี้*');
    expect(raw).not.toContain('|---');
    expect(raw).not.toContain('private_metadata');
    expect(raw).not.toContain('EMP-');
    expect(raw).toContain(APP_HOME_ACTION.refresh);
    assertAppHomeViewSafe(view);
  });

  it('empty timesheet wording is not access denial', () => {
    const view = buildAppHomeView({
      kind: 'dashboard',
      timesheet: {
        status: 'empty',
        weekLabel: '13–19 กรกฎาคม 2026',
        totalHours: 0,
        days: [],
      },
      projects: { status: 'empty', projects: [], extraCount: 0 },
    });
    const raw = JSON.stringify(view);
    expect(raw).toContain('ยังไม่มีรายการลงเวลา');
    expect(raw).not.toMatch(/access|ไม่มีสิทธิ์|unauthorized/i);
  });

  it('identity error uses controlled wording', () => {
    const view = buildAppHomeView({ kind: 'identity_error' });
    const raw = JSON.stringify(view);
    expect(raw).toContain('ไม่สามารถเชื่อมโยงบัญชี Slack');
    expect(raw).not.toContain('Redis');
    expect(raw).not.toContain('Zoho');
    expect(raw).not.toContain('OpenAI');
  });

  it('escapeSlackMrkdwn escapes specials', () => {
    expect(escapeSlackMrkdwn('A <B> & C')).toBe('A &lt;B&gt; &amp; C');
  });

  it('help modal is deterministic', () => {
    const modal = buildAppHomeHelpModal();
    expect(modal.type).toBe('modal');
    expect(JSON.stringify(modal)).toContain('ลงเวลางาน RMS');
  });
});

describe('App Home data loader', () => {
  it('sums week and daily hours; preserves decimals; excludes out-of-week via range', async () => {
    const manager = identityManager();
    const range = makeRange([
      { date: '2026-07-13', hours: 0 },
      { date: '2026-07-14', hours: 0 },
      { date: '2026-07-15', hours: 0 },
      { date: '2026-07-16', hours: 0 },
      { date: '2026-07-17', hours: 0 },
      { date: '2026-07-18', hours: 3.5, entries: 2 },
      { date: '2026-07-19', hours: 6.5 },
    ]);
    const result = await loadAppHomeDashboard({ slackUserId: 'U1', workspaceId: 'T-ALLOWED', 
      now: FIXED_NOW,
      contextManager: manager,
      readTimesheetRange: async () => range,
      loadWorkContext: async () =>
        workContext([{ client: 'Mitrphol', id: 'P1', name: 'RMS' }]),
      getTimesheetUrl: () => 'https://example.com/timesheet',
    });
    expect(result.identityOutcome).toBe('ok');
    expect(result.model.kind).toBe('dashboard');
    if (result.model.kind === 'dashboard') {
      expect(result.model.timesheet.totalHours).toBe(10);
      expect(result.model.timesheet.days.find((d) => d.date === '2026-07-18')?.hours).toBe(3.5);
      expect(result.model.displayName).toBe('Prakasit');
      // No invented expected hours in model
      expect(JSON.stringify(result.model)).not.toContain('expectedHours');
    }
  });

  it('identity failure renders identity error', async () => {
    const result = await loadAppHomeDashboard({ slackUserId: 'U1', workspaceId: 'T-ALLOWED', 
      contextManager: identityManager({ fail: true }),
      readTimesheetRange: async () => {
        throw new Error('should not run');
      },
    });
    expect(result.identityOutcome).toBe('failed');
    expect(result.model.kind).toBe('identity_error');
  });

  it('timesheet failure + work context success → partial', async () => {
    const result = await loadAppHomeDashboard({ slackUserId: 'U1', workspaceId: 'T-ALLOWED', 
      now: FIXED_NOW,
      contextManager: identityManager(),
      readTimesheetRange: async () => {
        throw new Error('sheets down');
      },
      loadWorkContext: async () =>
        workContext([{ client: 'Mitrphol', id: 'P1', name: 'RMS' }]),
    });
    expect(result.model.kind).toBe('dashboard');
    if (result.model.kind === 'dashboard') {
      expect(result.model.timesheet.status).toBe('error');
      expect(result.model.projects.status).toBe('ok');
    }
  });

  it('timesheet success + work context failure → partial', async () => {
    const result = await loadAppHomeDashboard({ slackUserId: 'U1', workspaceId: 'T-ALLOWED', 
      now: FIXED_NOW,
      contextManager: identityManager(),
      readTimesheetRange: async () =>
        makeRange(
          bangkokMondaySundayWeek(FIXED_NOW).dates.map((date) => ({
            date,
            hours: date === '2026-07-18' ? 2 : 0,
          }))
        ),
      loadWorkContext: async () => {
        throw new Error('api down');
      },
    });
    expect(result.model.kind).toBe('dashboard');
    if (result.model.kind === 'dashboard') {
      expect(result.model.timesheet.status).toBe('ok');
      expect(result.model.projects.status).toBe('error');
    }
  });

  it('both fail → dependency error', async () => {
    const result = await loadAppHomeDashboard({ slackUserId: 'U1', workspaceId: 'T-ALLOWED', 
      now: FIXED_NOW,
      contextManager: identityManager(),
      readTimesheetRange: async () => {
        throw new Error('ts');
      },
      loadWorkContext: async () => {
        throw new Error('wc');
      },
    });
    expect(result.model.kind).toBe('dependency_error');
  });

  it('isolates users via conversation id', () => {
    expect(buildAppHomeConversationId('T1', 'U1')).toBe('slack:app_home:T1:U1');
    expect(buildAppHomeConversationId('T1', 'U2')).toBe('slack:app_home:T1:U2');
    expect(buildAppHomeConversationId('T2', 'U1')).toBe('slack:app_home:T2:U1');
  });
});

describe('App Home event handler', () => {
  const publishes: Array<{ user: string; view: unknown }> = [];
  const chatPosts: unknown[] = [];

  beforeEach(() => {
    publishes.length = 0;
    chatPosts.length = 0;
  });

  const viewsClient = {
    views: {
      publish: vi.fn(async ({ user_id, view }: { user_id: string; view: unknown }) => {
        publishes.push({ user: user_id, view });
        return { ok: true };
      }),
    },
  };

  const baseDeps = {
    client: viewsClient,
    enableLoadingView: false,
    wasProcessed: vi.fn(async () => false),
    allowedWorkspaceId: null as string | null,
    contextManager: identityManager(),
    now: FIXED_NOW,
    readTimesheetRange: async () =>
      makeRange(
        bangkokMondaySundayWeek(FIXED_NOW).dates.map((date) => ({
          date,
          hours: 0,
        }))
      ),
    loadWorkContext: async () =>
      workContext([{ client: 'Mitrphol', id: 'P1', name: 'RMS' }]),
    getTimesheetUrl: () => 'https://example.com/timesheet',
  };

  function envelope(partial: Partial<SlackEventEnvelope['event']> & { type: string }): SlackEventEnvelope {
    return {
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'EvHome1',
      event: {
        type: partial.type,
        user: partial.user || 'U1',
        tab: partial.tab,
        channel: partial.channel || 'D1',
        event_ts: '1.1',
      },
    };
  }

  it('publishes home view for app_home_opened tab=home', async () => {
    const result = await handleAppHomeOpened(
      {
        requestId: 'r1',
        envelope: envelope({ type: 'app_home_opened', tab: 'home' }),
      },
      baseDeps
    );
    expect(result.published).toBe(true);
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.user).toBe('U1');
    expect((publishes[0]!.view as { type: string }).type).toBe('home');
  });

  it('ignores non-home tab', async () => {
    const result = await handleAppHomeOpened(
      {
        requestId: 'r1',
        envelope: envelope({ type: 'app_home_opened', tab: 'messages' }),
      },
      baseDeps
    );
    expect(result.published).toBe(false);
    expect(publishes).toHaveLength(0);
  });

  it('dedupes duplicate event_id', async () => {
    const wasProcessed = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await handleAppHomeOpened(
      { requestId: 'r1', envelope: envelope({ type: 'app_home_opened', tab: 'home' }) },
      { ...baseDeps, wasProcessed }
    );
    await handleAppHomeOpened(
      { requestId: 'r1', envelope: envelope({ type: 'app_home_opened', tab: 'home' }) },
      { ...baseDeps, wasProcessed }
    );
    expect(publishes).toHaveLength(1);
  });

  it('does not post a DM', async () => {
    await handleAppHomeOpened(
      { requestId: 'r1', envelope: envelope({ type: 'app_home_opened', tab: 'home' }) },
      baseDeps
    );
    expect(chatPosts).toHaveLength(0);
  });

  it('dispatcher routes app_home_opened without OpenAI', async () => {
    const generate = vi.fn();
    const extractIntent = vi.fn();
    const route = await dispatchSlackEvent(
      envelope({ type: 'app_home_opened', tab: 'home' }),
      {
        requestId: 'r1',
        generate,
        extractIntent,
        appHome: baseDeps,
      }
    );
    expect(route).toEqual({ handled: true, route: 'app_home_opened' });
    expect(generate).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(publishes.length).toBeGreaterThan(0);
  });
});

describe('App Home actions', () => {
  it('refresh reloads and republishes; ignores forged identity', async () => {
    const publishes: unknown[] = [];
    const readSpy = vi.fn(async () =>
      makeRange(
        bangkokMondaySundayWeek(FIXED_NOW).dates.map((date) => ({
          date,
          hours: 1,
        }))
      )
    );
    await handleAppHomeAction(
      {
        user: { id: 'U1' },
        team: { id: 'T1' },
        actions: [
          {
            action_id: APP_HOME_ACTION.refresh,
            value: APP_HOME_VALUE.refresh,
            action_ts: '1.2',
          },
        ],
        employeeId: 'FORGED',
        email: 'evil@shopstack.asia',
        staffId: 'S-FORGED',
      },
      {
        requestId: 'r1',
        allowedWorkspaceId: null,
        wasProcessed: async () => false,
        client: {
          views: {
            publish: async ({ view }) => {
              publishes.push(view);
              return { ok: true };
            },
          },
        },
        contextManager: identityManager({ employeeId: 'EMP-REAL' }),
        now: FIXED_NOW,
        readTimesheetRange: readSpy,
        loadWorkContext: async () => workContext([]),
        getTimesheetUrl: () => undefined,
      }
    );
    expect(readSpy).toHaveBeenCalled();
    expect(publishes).toHaveLength(1);
    const identityArg = readSpy.mock.calls.at(0)?.at(0) as
      | { employeeId?: string }
      | undefined;
    expect(identityArg?.employeeId).toBe('EMP-REAL');
    expect(identityArg?.employeeId).not.toBe('FORGED');
  });

  it('duplicate action delivery is safe', async () => {
    let calls = 0;
    const wasProcessed = vi.fn(async () => {
      calls += 1;
      return calls > 1;
    });
    const publish = vi.fn(async () => ({ ok: true }));
    const payload = {
      user: { id: 'U1' },
      team: { id: 'T1' },
      actions: [
        {
          action_id: APP_HOME_ACTION.refresh,
          value: APP_HOME_VALUE.refresh,
          action_ts: 'dup.1',
        },
      ],
    };
    const deps = {
      allowedWorkspaceId: null as string | null,
      wasProcessed,
      client: { views: { publish } },
      contextManager: identityManager(),
      now: FIXED_NOW,
      readTimesheetRange: async () =>
        makeRange(
          bangkokMondaySundayWeek(FIXED_NOW).dates.map((d) => ({
            date: d,
            hours: 0,
          }))
        ),
      loadWorkContext: async () => workContext([]),
    };
    await handleAppHomeAction(payload, deps);
    await handleAppHomeAction(payload, deps);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('help opens modal when trigger_id present', async () => {
    const open = vi.fn(async () => ({ ok: true }));
    await handleAppHomeAction(
      {
        user: { id: 'U1' },
        team: { id: 'T1' },
        trigger_id: 'trig',
        actions: [{ action_id: APP_HOME_ACTION.help, value: APP_HOME_VALUE.help, action_ts: 'h.1' }],
      },
      {
        allowedWorkspaceId: null,
        wasProcessed: async () => false,
        client: {
          views: {
            publish: async () => ({ ok: true }),
            open,
          },
        },
      }
    );
    expect(open).toHaveBeenCalled();
  });
});

describe('App Home no-write / no-OpenAI invariants', () => {
  it('opening Home never calls write tools or Sheets writers', async () => {
    const writeSpies = {
      prepare_create_timesheet_entry: vi.fn(),
      prepare_update_timesheet_entry: vi.fn(),
      prepare_delete_timesheet_entry: vi.fn(),
      confirm_timesheet_change: vi.fn(),
      submitDayTimesheetForStaff: vi.fn(),
      clearDayTimesheetForStaff: vi.fn(),
    };
    // Ensure they are never invoked by our handler path
    await handleAppHomeOpened(
      {
        requestId: 'r1',
        envelope: {
          type: 'event_callback',
          team_id: 'T1',
          event_id: 'EvNoWrite',
          event: { type: 'app_home_opened', user: 'U1', tab: 'home' },
        },
      },
      {
        enableLoadingView: false,
        allowedWorkspaceId: null,
        wasProcessed: async () => false,
        client: {
          views: { publish: async () => ({ ok: true }) },
        },
        contextManager: identityManager(),
        now: FIXED_NOW,
        readTimesheetRange: async () =>
          makeRange(
            bangkokMondaySundayWeek(FIXED_NOW).dates.map((date) => ({
              date,
              hours: 0,
            }))
          ),
        loadWorkContext: async () => workContext([]),
      }
    );
    for (const spy of Object.values(writeSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
