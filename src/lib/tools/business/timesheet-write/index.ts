import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import {
  assertNotAborted,
  isPlainObject,
  rejectAiIdentityFields,
  requireConversationIds,
  resolveContextManager,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import { ToolError } from '@/lib/tools/errors';
import { parseRequiredIsoDate } from '@/lib/tools/business/timesheet/date-input';
import {
  prepareCreateTimesheetEntry,
  prepareDeleteTimesheetEntry,
  prepareSubmitTimesheet,
  prepareUpdateTimesheetEntry,
  type PrepareDeps,
  type WriteIdentity,
} from '@/lib/timesheet/write/prepare';
import { confirmTimesheetChange, type ConfirmDeps } from '@/lib/timesheet/write/confirm';
import { cancelTimesheetChange, type CancelDeps } from '@/lib/timesheet/write/cancel';
import type { JsonValue } from '@/lib/tools/types';

export type TimesheetWriteToolDeps = BusinessToolDeps &
  PrepareDeps &
  ConfirmDeps &
  CancelDeps;

async function loadWriteIdentity(
  deps: TimesheetWriteToolDeps | undefined,
  context: ToolContext
): Promise<WriteIdentity> {
  const { conversationId, slackUserId } = requireConversationIds(context);
  const manager = resolveContextManager(deps);
  const conv = await manager.getConversationContext({
    conversationId,
    slackUserId,
    requestId: context.requestId,
    signal: context.signal,
    ensureWorkContext: false,
  });
  return {
    employeeId: conv.employeeId,
    email: conv.slackEmail,
    slackUserId: conv.slackUserId,
    conversationId,
    requestId: context.requestId,
    sourceEventId: context.eventId,
  };
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function resultJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export async function executePrepareCreate(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'prepare_create_timesheet_entry';
  try {
    assertNotAborted(context.signal);
    rejectAiIdentityFields(input);
    const date = parseRequiredIsoDate(input.date, 'date');
    const hours = asOptionalNumber(input.hours);
    if (hours === undefined) {
      throw new ToolError('hours is required', 'validation_error');
    }
    const identity = await loadWriteIdentity(deps, context);
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date,
        hours,
        projectId: asOptionalString(input.projectId),
        taskId: asOptionalString(input.taskId),
        projectName: asOptionalString(input.projectName),
        taskName: asOptionalString(input.taskName),
      },
      deps
    );
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createPrepareCreateTimesheetEntryTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'prepare_create_timesheet_entry',
    description: [
      'Prepare adding one Time Log entry for the conversation employee.',
      'Does NOT write Google Sheets. Stores a pending change and returns confirmation_required.',
      'Requires date (YYYY-MM-DD), hours, and projectId or projectName plus taskId or taskName.',
      'Never pass employeeId, staffId, email, or slackUserId.',
      'Never invent Project IDs. Unknown projects cannot be created from Slack.',
    ].join(' '),
    version: '1.0.0',
    idempotent: false,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD Asia/Bangkok' },
        hours: { type: 'number', description: 'Hours > 0 and ≤ 24' },
        projectId: { type: 'string' },
        taskId: { type: 'string' },
        projectName: {
          type: 'string',
          description: 'Resolver only when projectId unknown',
        },
        taskName: {
          type: 'string',
          description: 'Resolver only when taskId unknown',
        },
      },
      required: ['date', 'hours'],
      additionalProperties: false,
    },
    async execute(input, context) {
      return executePrepareCreate(deps, input, context);
    },
  };
}

export async function executePrepareUpdate(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'prepare_update_timesheet_entry';
  try {
    assertNotAborted(context.signal);
    rejectAiIdentityFields(input);
    const date = parseRequiredIsoDate(input.date, 'date');
    const identity = await loadWriteIdentity(deps, context);
    const result = await prepareUpdateTimesheetEntry(
      identity,
      {
        date,
        entryId: asOptionalString(input.entryId),
        hours: asOptionalNumber(input.hours),
        projectId: asOptionalString(input.projectId),
        taskId: asOptionalString(input.taskId),
        projectName: asOptionalString(input.projectName),
        taskName: asOptionalString(input.taskName),
        matchProjectName: asOptionalString(input.matchProjectName),
        matchTaskName: asOptionalString(input.matchTaskName),
      },
      deps
    );
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createPrepareUpdateTimesheetEntryTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'prepare_update_timesheet_entry',
    description: [
      'Prepare updating an existing Time Log entry. Does NOT write Google Sheets.',
      'Prefer entryId from a prior get_timesheet. Or use matchProjectName/matchTaskName to locate within the day.',
      'Never pass identity fields. Require confirmation via confirm_timesheet_change.',
    ].join(' '),
    version: '1.0.0',
    idempotent: false,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        entryId: { type: 'string' },
        hours: { type: 'number' },
        projectId: { type: 'string' },
        taskId: { type: 'string' },
        projectName: { type: 'string' },
        taskName: { type: 'string' },
        matchProjectName: { type: 'string' },
        matchTaskName: { type: 'string' },
      },
      required: ['date'],
      additionalProperties: false,
    },
    async execute(input, context) {
      return executePrepareUpdate(deps, input, context);
    },
  };
}

export async function executePrepareDelete(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'prepare_delete_timesheet_entry';
  try {
    assertNotAborted(context.signal);
    rejectAiIdentityFields(input);
    const date = parseRequiredIsoDate(input.date, 'date');
    const identity = await loadWriteIdentity(deps, context);
    const result = await prepareDeleteTimesheetEntry(
      identity,
      {
        date,
        entryId: asOptionalString(input.entryId),
        matchProjectName: asOptionalString(input.matchProjectName),
        matchTaskName: asOptionalString(input.matchTaskName),
      },
      deps
    );
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createPrepareDeleteTimesheetEntryTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'prepare_delete_timesheet_entry',
    description: [
      'Prepare deleting one Time Log entry. Does NOT write Google Sheets.',
      'Prefer entryId, or matchProjectName within the employee day. Require confirmation.',
    ].join(' '),
    version: '1.0.0',
    idempotent: false,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        entryId: { type: 'string' },
        matchProjectName: { type: 'string' },
        matchTaskName: { type: 'string' },
      },
      required: ['date'],
      additionalProperties: false,
    },
    async execute(input, context) {
      return executePrepareDelete(deps, input, context);
    },
  };
}

export async function executePrepareSubmit(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'prepare_submit_timesheet';
  try {
    assertNotAborted(context.signal);
    rejectAiIdentityFields(input);
    await loadWriteIdentity(deps, context);
    const result = await prepareSubmitTimesheet();
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createPrepareSubmitTimesheetTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'prepare_submit_timesheet',
    description: [
      'Prepare Submit Week. Currently unsupported: UI Submit Week only upserts daily Time Log rows;',
      'there is no separate submitted status in Google Sheets. Prefer create/update/delete entry tools.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          description: 'Monday YYYY-MM-DD (ignored; submit is unsupported)',
        },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      return executePrepareSubmit(deps, input, context);
    },
  };
}

export async function executeConfirmTimesheetChange(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'confirm_timesheet_change';
  try {
    assertNotAborted(context.signal);
    rejectAiIdentityFields(input);
    // Reject mutation payload reconstruction
    for (const key of [
      'date',
      'projectId',
      'taskId',
      'hours',
      'proposedSnapshot',
      'operation',
      'writeEntries',
      'entries',
    ]) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        throw new ToolError(
          `${key} must not be provided; confirmation loads mutation from the pending store`,
          'validation_error'
        );
      }
    }
    const confirmationId = asOptionalString(input.confirmationId);
    if (!confirmationId) {
      throw new ToolError('confirmationId is required', 'validation_error');
    }
    const identity = await loadWriteIdentity(deps, context);
    const result = await confirmTimesheetChange(identity, confirmationId, deps);
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createConfirmTimesheetChangeTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'confirm_timesheet_change',
    description: [
      'Execute a previously prepared Timesheet change by confirmationId only.',
      'Loads mutation from the server pending store. Never accept mutation fields.',
      'Verifies ownership, expiry, snapshot hash, writes via canonical day replace, read-back verifies.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        confirmationId: { type: 'string' },
      },
      required: ['confirmationId'],
      additionalProperties: false,
    },
    async execute(input, context) {
      return executeConfirmTimesheetChange(deps, input, context);
    },
  };
}

export async function executeCancelTimesheetChange(
  deps: TimesheetWriteToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const tool = 'cancel_timesheet_change';
  try {
    assertNotAborted(context.signal);
    if (!isPlainObject(input)) {
      throw new ToolError('Invalid input', 'validation_error');
    }
    rejectAiIdentityFields(input);
    const identity = await loadWriteIdentity(deps, context);
    const result = await cancelTimesheetChange(
      identity,
      asOptionalString(input.confirmationId),
      deps
    );
    return toolSuccess(tool, started, resultJson(result));
  } catch (error) {
    return toolFailureFromError(tool, started, error);
  }
}

export function createCancelTimesheetChangeTool(
  deps?: TimesheetWriteToolDeps
): Tool {
  return {
    name: 'cancel_timesheet_change',
    description: [
      'Cancel a pending Timesheet confirmation. No Google Sheets write.',
      'If confirmationId omitted and exactly one pending exists for the conversation, cancel that one.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        confirmationId: { type: 'string' },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      return executeCancelTimesheetChange(deps, input, context);
    },
  };
}

export const prepareCreateTimesheetEntryTool =
  createPrepareCreateTimesheetEntryTool();
export const prepareUpdateTimesheetEntryTool =
  createPrepareUpdateTimesheetEntryTool();
export const prepareDeleteTimesheetEntryTool =
  createPrepareDeleteTimesheetEntryTool();
export const prepareSubmitTimesheetTool = createPrepareSubmitTimesheetTool();
export const confirmTimesheetChangeTool = createConfirmTimesheetChangeTool();
export const cancelTimesheetChangeTool = createCancelTimesheetChangeTool();

/** AI-visible write tools (prepare/confirm/cancel only — no direct mutate). */
export const BUSINESS_WRITE_TOOLS: Tool[] = [
  prepareCreateTimesheetEntryTool,
  prepareUpdateTimesheetEntryTool,
  prepareDeleteTimesheetEntryTool,
  prepareSubmitTimesheetTool,
  confirmTimesheetChangeTool,
  cancelTimesheetChangeTool,
];
