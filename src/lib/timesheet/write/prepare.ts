import { randomBytes } from 'crypto';
import { readDailyTimesheetForEmployee } from '@/lib/timesheet/canonical-read';
import {
  getDefaultPendingTimesheetChangeStore,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store';
import {
  daySnapshotFromDailyEntries,
  hashDaySnapshot,
} from '@/lib/timesheet/write/snapshot-hash';
import {
  formatProjectLabel,
  resolveProject,
  resolveTask,
} from '@/lib/timesheet/write/master-resolve';
import { auditTimesheetWrite } from '@/lib/timesheet/write/audit-log';
import type {
  PrepareTimesheetChangeResult,
  SnapshotEntry,
} from '@/lib/timesheet/write/pending-types';
import { isValidCalendarDate } from '@/lib/tools/business/timesheet/date-input';
import type { Project, Task } from '@/types';

export type WriteIdentity = {
  employeeId: string;
  email: string;
  slackUserId: string;
  conversationId: string;
  requestId?: string;
  sourceEventId?: string;
};

export type PrepareDeps = {
  pendingStore?: PendingTimesheetChangeStore;
  readDaily?: typeof readDailyTimesheetForEmployee;
};

function newConfirmationId(): string {
  return `confirm_${randomBytes(12).toString('hex')}`;
}

function validateHours(hours: number): string | null {
  if (!Number.isFinite(hours) || Number.isNaN(hours)) {
    return 'จำนวนชั่วโมงไม่ถูกต้องครับ';
  }
  if (hours <= 0) {
    return 'จำนวนชั่วโมงต้องมากกว่า 0 ครับ';
  }
  if (hours > 24) {
    return 'จำนวนชั่วโมงต่อรายการต้องไม่เกิน 24 ครับ';
  }
  return null;
}

export async function prepareCreateTimesheetEntry(
  identity: WriteIdentity,
  input: {
    date: string;
    hours: number;
    projectId?: string;
    taskId?: string;
    projectName?: string;
    taskName?: string;
  },
  deps?: PrepareDeps
): Promise<PrepareTimesheetChangeResult> {
  const store = deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const read = deps?.readDaily ?? readDailyTimesheetForEmployee;

  if (!isValidCalendarDate(input.date)) {
    return {
      status: 'validation_failed',
      message: 'วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ YYYY-MM-DD ครับ',
    };
  }
  const hoursErr = validateHours(input.hours);
  if (hoursErr) {
    return { status: 'validation_failed', message: hoursErr };
  }
  if (!input.projectId && !input.projectName) {
    return {
      status: 'clarification_required',
      message: 'ต้องการลงเวลาให้ Project ไหนครับ',
    };
  }
  if (!input.taskId && !input.taskName) {
    return {
      status: 'clarification_required',
      message: 'ต้องการลงงานประเภทอะไรครับ',
    };
  }

  const projectRes = await resolveProject({
    projectId: input.projectId,
    projectName: input.projectName,
  });
  if (projectRes.status === 'not_found') {
    return {
      status: 'validation_failed',
      message:
        'ไม่พบ Project ที่ระบุ และไม่สามารถสร้าง Project ใหม่จาก Slack ได้ครับ',
    };
  }
  if (projectRes.status === 'ambiguous') {
    return {
      status: 'clarification_required',
      message: 'พบ Project ชื่อใกล้เคียงมากกว่าหนึ่งรายการ กรุณาเลือก Project ที่ต้องการครับ',
      candidates: projectRes.candidates.map((p) => ({
        projectId: p.ProjectID,
        projectName: formatProjectLabel(p),
        clientName: p.ProjectClient,
      })),
    };
  }

  const taskRes = await resolveTask({
    taskId: input.taskId,
    taskName: input.taskName,
  });
  if (taskRes.status === 'not_found') {
    return {
      status: 'validation_failed',
      message: 'ไม่พบงาน (Task) ที่ระบุครับ',
    };
  }
  if (taskRes.status === 'ambiguous') {
    return {
      status: 'clarification_required',
      message: 'พบงานชื่อใกล้เคียงมากกว่าหนึ่งรายการ กรุณาเลือกงานที่ต้องการครับ',
      candidates: taskRes.candidates.map((t) => ({
        taskId: t.TaskID,
        taskName: t.Task,
      })),
    };
  }

  const project = projectRes.value;
  const task = taskRes.value;

  const day = await read(
    {
      employeeId: identity.employeeId,
      email: identity.email,
      slackUserId: identity.slackUserId,
    },
    input.date
  );

  const original = daySnapshotFromDailyEntries(input.date, day.entries);
  const duplicate = day.entries.find(
    (e) => e.projectId === project.ProjectID && e.taskId === task.TaskID
  );
  if (duplicate) {
    return {
      status: 'duplicate_found',
      message:
        'มีรายการ Project และงานนี้อยู่แล้วในวันนั้น หากต้องการเปลี่ยนชั่วโมง กรุณาใช้คำสั่งแก้ไขครับ',
      existingEntryId: duplicate.id,
      date: input.date,
    };
  }

  const proposedEntries: SnapshotEntry[] = [
    ...original.entries,
    {
      projectId: project.ProjectID,
      taskId: task.TaskID,
      hours: input.hours,
    },
  ];
  const proposed = {
    date: input.date,
    entries: proposedEntries,
  };
  const confirmationId = newConfirmationId();
  const confirmationMessage = [
    'ต้องการบันทึกรายการนี้ใช่ไหมครับ',
    '',
    `• *${project.ProjectClient}* — ${formatProjectLabel(project)}: ${task.Task} ${input.hours} ชั่วโมง`,
    `• วันที่ ${input.date}`,
    '',
    'ตอบ *ยืนยัน* หรือ *ยกเลิก*',
  ].join('\n');

  store.create({
    confirmationId,
    operation: 'create_entry',
    conversationId: identity.conversationId,
    slackUserId: identity.slackUserId,
    employeeId: identity.employeeId,
    date: input.date,
    originalSnapshot: original,
    originalSnapshotHash: hashDaySnapshot(original),
    proposedSnapshot: proposed,
    proposedSnapshotHash: hashDaySnapshot(proposed),
    summary: confirmationMessage,
    summaryPayload: {
      clientName: project.ProjectClient,
      projectName: formatProjectLabel(project),
      taskName: task.Task,
      hours: input.hours,
      date: input.date,
    },
    writeEntries: proposedEntries.map((e) => ({
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
    })),
    requestId: identity.requestId,
    sourceEventId: identity.sourceEventId,
  });

  auditTimesheetWrite({
    message: 'prepare_create',
    requestId: identity.requestId,
    conversationId: identity.conversationId,
    operation: 'create_entry',
    confirmationId,
    targetDate: input.date,
    projectId: project.ProjectID,
    taskId: task.TaskID,
    hours: input.hours,
    pendingStatus: 'pending',
    entryCountBefore: original.entries.length,
    entryCountAfter: proposed.entries.length,
  });

  return {
    status: 'confirmation_required',
    confirmationId,
    operation: 'create_entry',
    date: input.date,
    summary: {
      clientName: project.ProjectClient,
      projectName: formatProjectLabel(project),
      taskName: task.Task,
      hours: input.hours,
    },
    confirmationMessage,
  };
}

export async function prepareUpdateTimesheetEntry(
  identity: WriteIdentity,
  input: {
    date: string;
    entryId?: string;
    hours?: number;
    projectId?: string;
    taskId?: string;
    /** Resolver only — find existing entry by client/project label within the day */
    matchProjectName?: string;
    matchTaskName?: string;
    projectName?: string;
    taskName?: string;
  },
  deps?: PrepareDeps
): Promise<PrepareTimesheetChangeResult> {
  const store = deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const read = deps?.readDaily ?? readDailyTimesheetForEmployee;

  if (!isValidCalendarDate(input.date)) {
    return {
      status: 'validation_failed',
      message: 'วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ YYYY-MM-DD ครับ',
    };
  }
  const hasChange =
    input.hours !== undefined ||
    input.projectId ||
    input.taskId ||
    input.projectName ||
    input.taskName;
  if (!hasChange) {
    return {
      status: 'validation_failed',
      message: 'กรุณาระบุค่าที่ต้องการแก้ไขครับ',
    };
  }
  if (input.hours !== undefined) {
    const hoursErr = validateHours(input.hours);
    if (hoursErr) return { status: 'validation_failed', message: hoursErr };
  }

  const day = await read(
    {
      employeeId: identity.employeeId,
      email: identity.email,
      slackUserId: identity.slackUserId,
    },
    input.date
  );

  let existing = input.entryId?.trim()
    ? day.entries.find((e) => e.id === input.entryId!.trim())
    : undefined;

  if (!existing && (input.matchProjectName || input.matchTaskName)) {
    const match = findEntriesByLabels(day.entries, {
      projectName: input.matchProjectName,
      taskName: input.matchTaskName,
    });
    if (match.status === 'ambiguous') {
      return {
        status: 'clarification_required',
        message: 'พบหลายรายการที่ตรงกัน กรุณาเลือกรายการที่ต้องการแก้ไขครับ',
        candidates: match.candidates.map((e) => ({
          entryId: e.id || '',
          clientName: e.clientName || '',
          projectName: e.projectName || '',
          taskName: e.taskName || '',
          hours: String(e.hours),
        })),
      };
    }
    if (match.status === 'resolved') existing = match.value;
  }

  if (!existing || !existing.projectId || !existing.taskId) {
    return {
      status: 'validation_failed',
      message: 'ไม่พบรายการ Timesheet ของคุณในวันนี้ครับ',
    };
  }

  let project: Project | undefined;
  let task: Task | undefined;

  if (input.projectId || input.projectName) {
    const projectRes = await resolveProject({
      projectId: input.projectId,
      projectName: input.projectName,
    });
    if (projectRes.status !== 'resolved') {
      return {
        status:
          projectRes.status === 'ambiguous'
            ? 'clarification_required'
            : 'validation_failed',
        message:
          projectRes.status === 'ambiguous'
            ? 'พบ Project หลายรายการ กรุณาเลือกครับ'
            : 'ไม่พบ Project ที่ระบุครับ',
        candidates:
          projectRes.status === 'ambiguous'
            ? projectRes.candidates.map((p) => ({
                projectId: p.ProjectID,
                projectName: formatProjectLabel(p),
              }))
            : undefined,
      };
    }
    project = projectRes.value;
  }
  if (input.taskId || input.taskName) {
    const taskRes = await resolveTask({
      taskId: input.taskId,
      taskName: input.taskName,
    });
    if (taskRes.status !== 'resolved') {
      return {
        status:
          taskRes.status === 'ambiguous'
            ? 'clarification_required'
            : 'validation_failed',
        message:
          taskRes.status === 'ambiguous'
            ? 'พบงานหลายรายการ กรุณาเลือกครับ'
            : 'ไม่พบงานที่ระบุครับ',
        candidates:
          taskRes.status === 'ambiguous'
            ? taskRes.candidates.map((t) => ({
                taskId: t.TaskID,
                taskName: t.Task,
              }))
            : undefined,
      };
    }
    task = taskRes.value;
  }

  const nextProjectId = project?.ProjectID ?? existing.projectId;
  const nextTaskId = task?.TaskID ?? existing.taskId;
  const nextHours = input.hours ?? existing.hours;

  const original = daySnapshotFromDailyEntries(input.date, day.entries);
  const proposedEntries: SnapshotEntry[] = original.entries.map((e) =>
    e.id === existing.id
      ? {
          id: e.id,
          projectId: nextProjectId,
          taskId: nextTaskId,
          hours: nextHours,
        }
      : e
  );
  const proposed = { date: input.date, entries: proposedEntries };

  // Load labels for confirmation
  const projectResFinal = await resolveProject({ projectId: nextProjectId });
  const taskResFinal = await resolveTask({ taskId: nextTaskId });
  const clientName =
    projectResFinal.status === 'resolved'
      ? projectResFinal.value.ProjectClient
      : existing.clientName || '';
  const projectLabel =
    projectResFinal.status === 'resolved'
      ? formatProjectLabel(projectResFinal.value)
      : existing.projectName || nextProjectId;
  const taskLabel =
    taskResFinal.status === 'resolved'
      ? taskResFinal.value.Task
      : existing.taskName || nextTaskId;

  const confirmationMessage = [
    'ต้องการแก้ไขรายการนี้ใช่ไหมครับ',
    '',
    '*เดิม*',
    `• ${existing.clientName || clientName} — ${existing.projectName || projectLabel}: ${existing.taskName || taskLabel} ${existing.hours} ชั่วโมง`,
    '',
    '*ใหม่*',
    `• ${clientName} — ${projectLabel}: ${taskLabel} ${nextHours} ชั่วโมง`,
    '',
    'ตอบ *ยืนยัน* เพื่อดำเนินการ หรือ *ยกเลิก*',
  ].join('\n');

  const confirmationId = newConfirmationId();
  store.create({
    confirmationId,
    operation: 'update_entry',
    conversationId: identity.conversationId,
    slackUserId: identity.slackUserId,
    employeeId: identity.employeeId,
    date: input.date,
    originalSnapshot: original,
    originalSnapshotHash: hashDaySnapshot(original),
    proposedSnapshot: proposed,
    proposedSnapshotHash: hashDaySnapshot(proposed),
    summary: confirmationMessage,
    summaryPayload: {
      fromHours: existing.hours,
      toHours: nextHours,
      clientName,
      projectName: projectLabel,
      taskName: taskLabel,
      date: input.date,
    },
    writeEntries: proposedEntries.map((e) => ({
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
    })),
    requestId: identity.requestId,
    sourceEventId: identity.sourceEventId,
  });

  auditTimesheetWrite({
    message: 'prepare_update',
    requestId: identity.requestId,
    conversationId: identity.conversationId,
    operation: 'update_entry',
    confirmationId,
    targetDate: input.date,
    pendingStatus: 'pending',
  });

  return {
    status: 'confirmation_required',
    confirmationId,
    operation: 'update_entry',
    date: input.date,
    summary: {
      fromHours: existing.hours,
      toHours: nextHours,
      clientName,
      projectName: projectLabel,
      taskName: taskLabel,
    },
    confirmationMessage,
  };
}

function findEntriesByLabels(
  entries: Array<{
    id?: string;
    clientName?: string;
    projectName?: string;
    taskName?: string;
    hours: number;
    projectId?: string;
    taskId?: string;
  }>,
  match: { projectName?: string; taskName?: string }
):
  | { status: 'resolved'; value: (typeof entries)[number] }
  | { status: 'ambiguous'; candidates: typeof entries }
  | { status: 'not_found' } {
  const pn = match.projectName?.trim().toLowerCase();
  const tn = match.taskName?.trim().toLowerCase();
  const hits = entries.filter((e) => {
    const client = (e.clientName || '').toLowerCase();
    const project = (e.projectName || '').toLowerCase();
    const task = (e.taskName || '').toLowerCase();
    const projectOk =
      !pn ||
      client.includes(pn) ||
      project.includes(pn) ||
      pn.includes(client) ||
      pn.includes(project);
    const taskOk = !tn || task.includes(tn) || tn.includes(task);
    return projectOk && taskOk;
  });
  if (hits.length === 1) return { status: 'resolved', value: hits[0]! };
  if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
  return { status: 'not_found' };
}

export async function prepareDeleteTimesheetEntry(
  identity: WriteIdentity,
  input: {
    date: string;
    entryId?: string;
    matchProjectName?: string;
    matchTaskName?: string;
  },
  deps?: PrepareDeps
): Promise<PrepareTimesheetChangeResult> {
  const store = deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const read = deps?.readDaily ?? readDailyTimesheetForEmployee;

  if (!isValidCalendarDate(input.date)) {
    return {
      status: 'validation_failed',
      message: 'วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ YYYY-MM-DD ครับ',
    };
  }

  const day = await read(
    {
      employeeId: identity.employeeId,
      email: identity.email,
      slackUserId: identity.slackUserId,
    },
    input.date
  );

  let existing = input.entryId?.trim()
    ? day.entries.find((e) => e.id === input.entryId!.trim())
    : undefined;

  if (!existing && (input.matchProjectName || input.matchTaskName)) {
    const match = findEntriesByLabels(day.entries, {
      projectName: input.matchProjectName,
      taskName: input.matchTaskName,
    });
    if (match.status === 'ambiguous') {
      return {
        status: 'clarification_required',
        message: 'พบหลายรายการที่ตรงกัน กรุณาเลือกรายการที่ต้องการลบครับ',
        candidates: match.candidates.map((e) => ({
          entryId: e.id || '',
          clientName: e.clientName || '',
          projectName: e.projectName || '',
          taskName: e.taskName || '',
          hours: String(e.hours),
        })),
      };
    }
    if (match.status === 'resolved') existing = match.value;
  }

  if (!existing || !existing.projectId || !existing.taskId) {
    return {
      status: 'validation_failed',
      message: 'ไม่พบรายการ Timesheet ของคุณในวันนี้ครับ',
    };
  }

  const original = daySnapshotFromDailyEntries(input.date, day.entries);
  const proposed = {
    date: input.date,
    entries: original.entries.filter((e) => e.id !== existing.id),
  };

  const confirmationMessage = [
    'ต้องการลบรายการนี้ใช่ไหมครับ',
    '',
    `• ${existing.clientName || ''} — ${existing.projectName || ''}: ${existing.taskName || ''} ${existing.hours} ชั่วโมง`,
    `• วันที่ ${input.date}`,
    '',
    'ตอบ *ยืนยัน* เพื่อดำเนินการ หรือ *ยกเลิก*',
  ].join('\n');

  const confirmationId = newConfirmationId();
  store.create({
    confirmationId,
    operation: 'delete_entry',
    conversationId: identity.conversationId,
    slackUserId: identity.slackUserId,
    employeeId: identity.employeeId,
    date: input.date,
    originalSnapshot: original,
    originalSnapshotHash: hashDaySnapshot(original),
    proposedSnapshot: proposed,
    proposedSnapshotHash: hashDaySnapshot(proposed),
    summary: confirmationMessage,
    summaryPayload: {
      clientName: existing.clientName,
      projectName: existing.projectName,
      taskName: existing.taskName,
      hours: existing.hours,
      date: input.date,
    },
    writeEntries: proposed.entries.map((e) => ({
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
    })),
    requestId: identity.requestId,
    sourceEventId: identity.sourceEventId,
  });

  auditTimesheetWrite({
    message: 'prepare_delete',
    requestId: identity.requestId,
    conversationId: identity.conversationId,
    operation: 'delete_entry',
    confirmationId,
    targetDate: input.date,
    pendingStatus: 'pending',
  });

  return {
    status: 'confirmation_required',
    confirmationId,
    operation: 'delete_entry',
    date: input.date,
    summary: {
      clientName: existing.clientName,
      projectName: existing.projectName,
      taskName: existing.taskName,
      hours: existing.hours,
    },
    confirmationMessage,
  };
}

export async function prepareSubmitTimesheet(): Promise<PrepareTimesheetChangeResult> {
  return {
    status: 'unsupported',
    message:
      'Submit Week ในระบบปัจจุบันคือการบันทึก Time Log รายวัน ไม่มีสถานะ submitted แยกต่างหาก กรุณาใช้คำสั่งเพิ่ม/แก้ไข/ลบรายการแทนครับ',
  };
}
