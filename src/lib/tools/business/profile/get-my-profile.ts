import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import {
  assertNotAborted,
  rejectAiIdentityFields,
  requireConversationIds,
  resolveContextManager,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import {
  verifyTimesheetEmployeeIdentity,
  type TimesheetEmployeeLookup,
  type VerifyTimesheetEmployeeIdentityResult,
} from '@/lib/timesheet/employee-identity';
import { ToolError } from '@/lib/tools/errors';
import type { JsonValue } from '@/lib/tools/types';

export type MyEmployeeProfile = {
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  employeeName?: string;
  timesheetIdentityType: string;
  timesheetIdentityValue?: string;
  timesheetIdentityMatched: boolean;
  timesheetIdentityStatus: VerifyTimesheetEmployeeIdentityResult['timesheetIdentityStatus'];
  diagnosticMessage: string;
};

export type GetMyProfileDeps = BusinessToolDeps & {
  /** Injected Timesheet employee lookup (defaults to Zoho by email). */
  lookupTimesheetEmployee?: TimesheetEmployeeLookup;
};

const TOOL_NAME = 'get_my_profile';

const FORBIDDEN_IDENTITY_KEYS = [
  'employeeId',
  'employee_id',
  'email',
  'slackUserId',
  'slack_user_id',
  'zohoRecordId',
  'zoho_record_id',
] as const;

function assertEmptyProfileInput(input: Record<string, unknown>): void {
  rejectAiIdentityFields(input, FORBIDDEN_IDENTITY_KEYS);
  if (Object.keys(input).length > 0) {
    throw new ToolError(
      'get_my_profile accepts no arguments',
      'validation_error'
    );
  }
}

function logProfile(event: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: 'business-tool',
      toolName: TOOL_NAME,
      level: 'info',
      ts: new Date().toISOString(),
      identitySource: 'conversation_context',
      ...event,
    })
  );
}

export async function executeGetMyProfile(
  deps: GetMyProfileDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  try {
    assertNotAborted(context.signal);
    assertEmptyProfileInput(input);

    const { conversationId, slackUserId } = requireConversationIds(context);
    const manager = resolveContextManager(deps);
    const conv = await manager.getConversationContext({
      conversationId,
      slackUserId,
      requestId: context.requestId,
      signal: context.signal,
      ensureWorkContext: false,
    });

    const verification = await verifyTimesheetEmployeeIdentity(
      {
        employeeId: conv.employeeId,
        slackEmail: conv.slackEmail,
      },
      deps?.lookupTimesheetEmployee
    );

    const profile: MyEmployeeProfile = {
      slackUserId: conv.slackUserId,
      slackEmail: conv.slackEmail,
      employeeId: conv.employeeId,
      employeeName: verification.employeeName,
      timesheetIdentityType: verification.timesheetIdentityType,
      timesheetIdentityValue: verification.timesheetIdentityValue,
      timesheetIdentityMatched: verification.timesheetIdentityMatched,
      timesheetIdentityStatus: verification.timesheetIdentityStatus,
      diagnosticMessage: verification.diagnosticMessage,
    };

    logProfile({
      requestId: context.requestId,
      conversationId,
      identityVerificationStatus: profile.timesheetIdentityStatus,
      timesheetIdentityType: profile.timesheetIdentityType,
      durationMs: Date.now() - started,
    });

    return toolSuccess(TOOL_NAME, started, profile as unknown as JsonValue);
  } catch (error) {
    logProfile({
      level: 'error',
      requestId: context.requestId,
      conversationId: context.conversationId,
      durationMs: Date.now() - started,
      errorCode:
        error instanceof ToolError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'unexpected',
    });
    return toolFailureFromError(TOOL_NAME, started, error);
  }
}

export function createGetMyProfileTool(deps?: GetMyProfileDeps): Tool {
  return {
    name: TOOL_NAME,
    description: [
      'Return the current Slack user’s resolved Timesheet employee identity from Conversation Context.',
      'Verifies that identity against the same Zoho EmployeeID / Time Log Staff ID used by the Weekly Timesheet UI.',
      'Accepts no arguments. Never pass employeeId, email, or slackUserId.',
      'Use for Who am I? / What is my employee ID? / Verify my Timesheet identity.',
      'Read-only — does not change identity mappings or Conversation Context.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(input, context: ToolContext) {
      return executeGetMyProfile(deps, input, context);
    },
  };
}

export const getMyProfileTool = createGetMyProfileTool();
