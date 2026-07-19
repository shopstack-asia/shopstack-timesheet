import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createDefaultToolRegistry } from '@/lib/tools';
import { createToolContext } from '@/lib/tools/tool-context';
import {
  createGetMyProfileTool,
  type MyEmployeeProfile,
} from '@/lib/tools/business/profile/get-my-profile';
import type { TimesheetEmployeeLookup } from '@/lib/timesheet/employee-identity';
import { TIMESHEET_STAFF_IDENTITY_TYPE } from '@/lib/timesheet/employee-identity';

function makeDeps(lookup: TimesheetEmployeeLookup) {
  let lookupCalls = 0;
  const wrapped: TimesheetEmployeeLookup = async (email) => {
    lookupCalls += 1;
    return lookup(email);
  };
  return {
    lookupCalls: () => lookupCalls,
    deps: {
      lookupTimesheetEmployee: wrapped,
      contextManager: createContextManager({
        store: createContextStore(),
        identityResolver: createIdentityResolver({
          lookup: async () => ({
            ok: true,
            auth: {
              staff: {
                EmployeeID: 'S0005',
                Email: 'prakasit@shopstack.asia',
                FirstName: 'Prakasit',
                LastName: 'Kitrakham',
              },
            },
          }),
        }),
      }),
    },
  };
}

function toolCtx() {
  return createToolContext({
    userId: 'U123456',
    conversationId: 'conv-profile',
    requestId: 'r-profile',
  });
}

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

  it('returns identity from Conversation Context', async () => {
    const { deps } = makeDeps(async () => ({
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetIdentityValue: 'S0005',
      email: 'prakasit@shopstack.asia',
      employeeName: 'Prakasit Kitrakham',
    }));
    const tool = createGetMyProfileTool(deps);
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      const profile = result.result as MyEmployeeProfile;
      expect(profile).toMatchObject({
        slackUserId: 'U123456',
        slackEmail: 'prakasit@shopstack.asia',
        employeeId: 'S0005',
        employeeName: 'Prakasit Kitrakham',
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetIdentityValue: 'S0005',
        timesheetIdentityMatched: true,
        timesheetIdentityStatus: 'matched',
      });
      expect(profile.diagnosticMessage).toMatch(/matches/i);
    }
  });

  it.each([
    [{ employeeId: 'OTHER' }],
    [{ email: 'other@shopstack.asia' }],
    [{ slackUserId: 'U_OTHER' }],
    [{ zohoRecordId: '123' }],
  ])('rejects AI identity field %j', async (input) => {
    const { deps, lookupCalls } = makeDeps(async () => {
      throw new Error('lookup must not run');
    });
    const tool = createGetMyProfileTool(deps);
    const result = await tool.execute(input, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
    expect(lookupCalls()).toBe(0);
  });

  it('matched identity', async () => {
    const { deps } = makeDeps(async (email) => {
      expect(email).toBe('prakasit@shopstack.asia');
      return {
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetIdentityValue: 'S0005',
        email,
        employeeName: 'Prakasit Kitrakham',
      };
    });
    const result = await createGetMyProfileTool(deps).execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        timesheetIdentityMatched: true,
        timesheetIdentityStatus: 'matched',
      });
    }
  });

  it('mismatch when Timesheet uses a different identifier', async () => {
    const { deps } = makeDeps(async () => ({
      timesheetIdentityType: 'internalEmployeeId',
      timesheetIdentityValue: '707161000000285001',
      email: 'prakasit@shopstack.asia',
      employeeName: 'Prakasit Kitrakham',
    }));
    const result = await createGetMyProfileTool(deps).execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        employeeId: 'S0005',
        timesheetIdentityType: 'internalEmployeeId',
        timesheetIdentityValue: '707161000000285001',
        timesheetIdentityMatched: false,
        timesheetIdentityStatus: 'mismatch',
      });
      const msg = (result.result as MyEmployeeProfile).diagnosticMessage;
      expect(msg).toMatch(/S0005/);
      expect(msg).not.toMatch(/token|api.?key|authorization/i);
    }
  });

  it('not_found when no Timesheet employee record', async () => {
    const { deps } = makeDeps(async () => null);
    const result = await createGetMyProfileTool(deps).execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        timesheetIdentityMatched: false,
        timesheetIdentityStatus: 'not_found',
      });
      expect((result.result as MyEmployeeProfile).diagnosticMessage).not.toMatch(
        /no timesheet entries|no work was logged/i
      );
    }
  });

  it('unavailable when employee service fails', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error('ETIMEDOUT');
    });
    const result = await createGetMyProfileTool(deps).execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        timesheetIdentityStatus: 'unavailable',
        timesheetIdentityMatched: false,
      });
      expect((result.result as MyEmployeeProfile).diagnosticMessage).not.toMatch(
        /mismatch/i
      );
    }
  });

  it('cannot obtain another employee profile via AI args', async () => {
    const { deps, lookupCalls } = makeDeps(async () => ({
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetIdentityValue: 'S9999',
      email: 'other@shopstack.asia',
    }));
    const tool = createGetMyProfileTool(deps);
    const hack = await tool.execute({ employeeId: 'S9999' }, toolCtx());
    expect(hack.success).toBe(false);
    expect(lookupCalls()).toBe(0);

    const ok = await tool.execute({}, toolCtx());
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect((ok.result as MyEmployeeProfile).employeeId).toBe('S0005');
    }
  });
});
