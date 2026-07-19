import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createDefaultToolRegistry } from '@/lib/tools';
import { createToolContext } from '@/lib/tools/tool-context';
import {
  buildMyEmployeeProfileFromContext,
  createGetMyProfileTool,
  type MyEmployeeProfile,
} from '@/lib/tools/business/profile/get-my-profile';
import { agentAuthFromConversationIdentity } from '@/lib/timesheet/canonical-read';
import { getTimeLogRowsForStaffRange } from '@/lib/timesheet/timesheet-service';
import { readDailyTimesheetForEmployee } from '@/lib/timesheet/canonical-read';
import { TIMESHEET_STAFF_IDENTITY_TYPE } from '@/lib/timesheet/timesheet-staff-identity';
import type { TimeLogRow } from '@/types';
import * as zohoPeople from '@/lib/zoho-people';

function makeManager(opts?: {
  employeeId?: string;
  employeeName?: string;
  lookup?: ReturnType<typeof vi.fn>;
}) {
  const lookup =
    opts?.lookup ??
    vi.fn(async () => ({
      ok: true as const,
      auth: {
        staff: {
          EmployeeID: opts?.employeeId ?? 'S0005',
          Email: 'prakasit@shopstack.asia',
          FirstName: 'Prakasit',
          LastName: 'Kitrakham',
        },
      },
    }));

  return {
    lookup,
    contextManager: createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({ lookup }),
    }),
  };
}

function toolCtx() {
  return createToolContext({
    userId: 'U123456',
    conversationId: 'conv-profile',
    requestId: 'r-profile',
  });
}

const july18Fixture: TimeLogRow[] = [
  {
    'Time Log ID': '1',
    Date: '2026-07-18',
    'Staff ID': 'S0005',
    'Staff First Name': 'Prakasit',
    'Staff Last Name': 'Kitrakham',
    'Staff Position': 'CTO',
    'Project ID': '73',
    'Project Client': 'Hertz',
    'Project Name': 'Commerce Suite',
    'Project Code': 'HERTZ-PLATFORM-2026-01',
    'Task ID': '3',
    Task: 'Development',
    Hours: 5,
  },
  {
    'Time Log ID': '2',
    Date: '2026-07-18',
    'Staff ID': 'S0005',
    'Staff First Name': 'Prakasit',
    'Staff Last Name': 'Kitrakham',
    'Staff Position': 'CTO',
    'Project ID': '52',
    'Project Client': 'Mitrphol',
    'Project Name': 'Raw Material Supply Management System (RMS)',
    'Project Code': 'MIT-RMS-2025-01',
    'Task ID': '5',
    Task: 'Project Management',
    Hours: 3,
  },
  {
    'Time Log ID': '3',
    Date: '2026-07-18',
    'Staff ID': 'S0005',
    'Staff First Name': 'Prakasit',
    'Staff Last Name': 'Kitrakham',
    'Staff Position': 'CTO',
    'Project ID': '70',
    'Project Client': 'Shopstack',
    'Project Name': 'Commerce Suite',
    'Project Code': 'SS-COMMERCE-SUTE',
    'Task ID': '3',
    Task: 'Development',
    Hours: 2,
  },
];

describe('get_my_profile tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('schema: empty object, idempotent, registered', () => {
    const tool = createGetMyProfileTool();
    expect(tool.name).toBe('get_my_profile');
    expect(tool.idempotent).toBe(true);
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(createDefaultToolRegistry().exists('get_my_profile')).toBe(true);
  });

  it('performs no Zoho or secondary identity lookup', async () => {
    const zohoSpy = vi.spyOn(zohoPeople, 'getZohoPeopleService');
    const { contextManager, lookup } = makeManager();
    const tool = createGetMyProfileTool({ contextManager });

    // Warm Conversation Context once (identity boundary — not the tool)
    await contextManager.getConversationContext({
      conversationId: 'conv-profile',
      slackUserId: 'U123456',
    });
    const lookupsBefore = lookup.mock.calls.length;
    zohoSpy.mockClear();

    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(true);
    expect(zohoSpy).not.toHaveBeenCalled();
    expect(lookup.mock.calls.length).toBe(lookupsBefore);

    zohoSpy.mockRestore();
  });

  it('returns Conversation Context identity and configured Staff ID', async () => {
    const { contextManager } = makeManager();
    const tool = createGetMyProfileTool({ contextManager });
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        slackUserId: 'U123456',
        slackEmail: 'prakasit@shopstack.asia',
        employeeId: 'S0005',
        employeeName: 'Prakasit Kitrakham',
        identitySource: 'conversation_context',
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetStaffId: 'S0005',
        timesheetMappingStatus: 'configured',
      });
      expect((result.result as MyEmployeeProfile).diagnosticMessage).toMatch(
        /Staff ID S0005/
      );
      expect(result.result).not.toHaveProperty('timesheetIdentityMatched');
    }
  });

  it('reports missing when employeeId is blank on context payload', () => {
    const profile = buildMyEmployeeProfileFromContext({
      slackUserId: 'U1',
      slackEmail: 'ada@shopstack.asia',
      employeeId: '  ',
    });
    expect(profile.timesheetMappingStatus).toBe('missing');
    expect(profile.timesheetStaffId).toBeUndefined();
  });

  it.each([
    [{ employeeId: 'OTHER' }],
    [{ email: 'other@shopstack.asia' }],
    [{ slackUserId: 'U_OTHER' }],
    [{ zohoRecordId: '123' }],
    [{ staffId: 'OTHER' }],
    [{ timesheetStaffId: 'OTHER' }],
    [{ unexpected: true }],
  ])('rejects forbidden input %j without calling context', async (input) => {
    const { contextManager, lookup } = makeManager();
    const tool = createGetMyProfileTool({ contextManager });
    const getSpy = vi.spyOn(contextManager, 'getConversationContext');
    const result = await tool.execute(input, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
    expect(getSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('cross-employee: rejects AI employeeId and keeps context unchanged', async () => {
    const { contextManager } = makeManager();
    const tool = createGetMyProfileTool({ contextManager });
    const hack = await tool.execute({ employeeId: 'ANOTHER_EMPLOYEE' }, toolCtx());
    expect(hack.success).toBe(false);

    const ok = await tool.execute({}, toolCtx());
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect((ok.result as MyEmployeeProfile).employeeId).toBe('S0005');
      expect((ok.result as MyEmployeeProfile).employeeId).not.toBe(
        'ANOTHER_EMPLOYEE'
      );
    }
  });

  it('canonical Staff ID consistency across profile, auth, and Time Log filter', async () => {
    const employeeId = 'S0005';
    const profile = buildMyEmployeeProfileFromContext({
      slackUserId: 'U123456',
      slackEmail: 'prakasit@shopstack.asia',
      employeeId,
      employeeName: 'Prakasit Kitrakham',
    });
    expect(profile.timesheetStaffId).toBe(employeeId);

    const auth = agentAuthFromConversationIdentity({
      employeeId,
      email: 'prakasit@shopstack.asia',
    });
    expect(auth.staff.EmployeeID).toBe(employeeId);

    const rows = await getTimeLogRowsForStaffRange(
      auth,
      '2026-07-18',
      '2026-07-18',
      async () => [
        ...july18Fixture,
        { ...july18Fixture[0]!, 'Time Log ID': 'x', 'Staff ID': 'OTHER', Hours: 99 },
      ]
    );
    expect(rows.every((r) => r['Staff ID'] === employeeId)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('real data fixture: profile Staff ID aligns with get_timesheet S0005 / 10h', async () => {
    const profile = buildMyEmployeeProfileFromContext({
      slackUserId: 'U123456',
      slackEmail: 'prakasit@shopstack.asia',
      employeeId: 'S0005',
    });
    expect(profile.timesheetStaffId).toBe('S0005');

    const day = await readDailyTimesheetForEmployee(
      { employeeId: 'S0005', email: 'prakasit@shopstack.asia' },
      '2026-07-18',
      { loader: async () => july18Fixture }
    );
    expect(day.entries).toHaveLength(3);
    expect(day.totalHours).toBe(10);
  });
});
