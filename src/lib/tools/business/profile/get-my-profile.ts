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
  deriveTimesheetStaffIdentity,
  TIMESHEET_STAFF_IDENTITY_TYPE,
} from '@/lib/timesheet/timesheet-staff-identity';
import { ToolError } from '@/lib/tools/errors';
import type { JsonValue } from '@/lib/tools/types';

export type TimesheetMappingStatus = 'configured' | 'missing';

export type MyEmployeeProfile = {
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  employeeName?: string;
  identitySource: 'conversation_context';
  timesheetIdentityType: typeof TIMESHEET_STAFF_IDENTITY_TYPE;
  timesheetStaffId?: string;
  timesheetMappingStatus: TimesheetMappingStatus;
  diagnosticMessage: string;
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
  'staffId',
  'timesheetStaffId',
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

export function buildMyEmployeeProfileFromContext(conv: {
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  employeeName?: string;
}): MyEmployeeProfile {
  const derived = deriveTimesheetStaffIdentity({
    employeeId: conv.employeeId,
  });

  if (!derived.ok) {
    return {
      slackUserId: conv.slackUserId,
      slackEmail: conv.slackEmail,
      employeeId: conv.employeeId?.trim() || '',
      employeeName: conv.employeeName,
      identitySource: 'conversation_context',
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetMappingStatus: 'missing',
      diagnosticMessage:
        'Conversation Context does not contain the employee ID required for the Google Sheets Time Log Staff ID filter.',
    };
  }

  return {
    slackUserId: conv.slackUserId,
    slackEmail: conv.slackEmail,
    employeeId: derived.identity.staffId,
    employeeName: conv.employeeName,
    identitySource: 'conversation_context',
    timesheetIdentityType: derived.identity.identityType,
    timesheetStaffId: derived.identity.staffId,
    timesheetMappingStatus: 'configured',
    diagnosticMessage: `The canonical Timesheet reader will filter Google Sheets Time Log using Staff ID ${derived.identity.staffId} from Conversation Context.`,
  };
}

export async function executeGetMyProfile(
  deps: BusinessToolDeps | undefined,
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

    const profile = buildMyEmployeeProfileFromContext(conv);

    logProfile({
      requestId: context.requestId,
      conversationId,
      timesheetIdentityType: profile.timesheetIdentityType,
      mappingStatus: profile.timesheetMappingStatus,
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

export function createGetMyProfileTool(deps?: BusinessToolDeps): Tool {
  return {
    name: TOOL_NAME,
    description: [
      'Return the current Slack user’s employee identity from Conversation Context.',
      'Reports the Google Sheets Time Log Staff ID the canonical Timesheet reader will use (Zoho EmployeeID).',
      'Does not call Zoho or Slack. Accepts no arguments — never pass employeeId, email, or slackUserId.',
      'Use for Who am I? / What is my employee ID? / Show my Timesheet identity.',
      'Read-only — does not change identity mappings or Conversation Context.',
    ].join(' '),
    version: '2.0.0',
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
