import { AgentAuthContext } from '@/lib/timesheet/agent-auth';
import { getAgentModel } from '@/lib/timesheet-agent/model';
import { timesheetTools } from '@/lib/timesheet-agent/tools';
import {
  DayEntry,
  dayKey,
  daySetToEntries,
  dayTotal,
  entriesToDaySet,
  mergeAdd,
  mergeClear,
  mergeDelete,
  mergeUpdate,
} from '@/lib/timesheet-agent/merge';
import {
  decideProjectResolution,
  decideTaskResolution,
  formatProjectOption,
  formatTaskOption,
} from '@/lib/timesheet-agent/resolution';
import {
  getAgentTimeZone,
  resolveDateText,
  weekStartMonday,
  zonedYmd,
} from '@/lib/timesheet-agent/dates';
import {
  evaluateClearGuards,
  evaluateWriteGuards,
} from '@/lib/timesheet-agent/guardrails';
import {
  claimPendingWrite,
  clearPendingFromConversation,
  completePendingWrite,
  ConversationState,
  createPendingWrite,
  getPendingWrite,
  loadConversation,
  makeThreadKey,
  PendingWrite,
  releaseClaim,
  saveConversation,
} from '@/lib/timesheet-agent/conversation-state';
import {
  matchConfirmKeyword,
  requiredKeywordInstruction,
  textSatisfiesRequiredKeyword,
} from '@/lib/timesheet-agent/confirm-keywords';
import {
  dayFingerprint,
  normalizeDayEntries,
  verifyDayMatchesExpected,
} from '@/lib/timesheet-agent/verify';
import { auditAgentWrite } from '@/lib/timesheet-agent/audit';
import { Project, Task } from '@/types';

export type AgentRequest = {
  text: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  auth: AgentAuthContext;
};

export type AgentResponse = { text: string };

function emptyState(
  threadKey: string,
  employeeId: string,
  slackUserId: string
): ConversationState {
  return {
    threadKey,
    employeeId,
    slackUserId,
    context: {},
    updatedAt: Date.now(),
  };
}

function summarizeDay(
  date: string,
  entries: DayEntry[],
  projects: Project[],
  tasks: Task[]
): string {
  const pmap = new Map(projects.map((p) => [p.ProjectID, p]));
  const tmap = new Map(tasks.map((t) => [t.TaskID, t]));
  const lines = entries.map((e) => {
    const p = pmap.get(e.projectId);
    const t = tmap.get(e.taskId);
    const pname = p ? `${p.ProjectName} (${p.ProjectCode})` : e.projectId;
    const tname = t ? t.Task : e.taskId;
    return `• ${pname} · ${tname} — *${e.hours.toFixed(2)}* h`;
  });
  const total = entries.reduce((s, e) => s + e.hours, 0);
  return `*${date}*\n${lines.join('\n') || '_No entries_'}\nDay total: *${total.toFixed(2)}* h`;
}

async function loadLeaveHolidays(auth: AgentAuthContext, date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  let leave = null as Awaited<ReturnType<typeof timesheetTools.get_leave_monthly>> | null;
  let holidays = null as Awaited<ReturnType<typeof timesheetTools.get_holidays>> | null;
  try {
    leave = await timesheetTools.get_leave_monthly(auth, y, m);
  } catch {
    leave = null;
  }
  try {
    holidays = await timesheetTools.get_holidays(auth, y);
  } catch {
    holidays = null;
  }
  return { leave, holidays };
}

function reapplyOperation(
  base: DayEntry[],
  pending: PendingWrite
): { ok: true; daySet: Map<string, DayEntry> } | { ok: false; error: string } {
  let daySet = entriesToDaySet(base);
  if (pending.operationType === 'clear') {
    return { ok: true, daySet: mergeClear() };
  }
  if (!pending.targetEntry) {
    return { ok: false, error: 'Missing target entry metadata' };
  }
  const t = pending.targetEntry;
  if (pending.operationType === 'add') {
    const r = mergeAdd(daySet, t, 'replace');
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, daySet: r.daySet };
  }
  if (pending.operationType === 'update') {
    const r = mergeUpdate(daySet, t.projectId, t.taskId, t.hours);
    if (!r.ok) return { ok: false, error: String(r.error) };
    return { ok: true, daySet: r.daySet };
  }
  if (pending.operationType === 'delete') {
    const r = mergeDelete(daySet, t.projectId, t.taskId);
    if (!r.ok) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, daySet: r.daySet };
  }
  return { ok: false, error: 'Unknown operation' };
}

export async function handleAgentMessage(req: AgentRequest): Promise<AgentResponse> {
  const threadKey = makeThreadKey(req.channelId, req.threadTs);
  let state =
    (await loadConversation(threadKey)) ||
    emptyState(threadKey, req.auth.staff.EmployeeID, req.slackUserId);

  if (state.employeeId !== req.auth.staff.EmployeeID) {
    state = emptyState(threadKey, req.auth.staff.EmployeeID, req.slackUserId);
  }
  if (state.slackUserId !== req.slackUserId) {
    return { text: 'This thread belongs to another user.' };
  }

  const text = req.text.trim();
  const keyword = matchConfirmKeyword(text);

  // Deterministic CANCEL
  if (keyword === 'CANCEL') {
    state = await clearPendingFromConversation(state);
    state.flags = undefined;
    state.draft = undefined;
    state.awaitingLeaveOverride = false;
    await saveConversation(state);
    return { text: 'Cancelled. Nothing was saved.' };
  }

  // OVERRIDE without pending — continue leave-blocked draft
  if (keyword === 'OVERRIDE' && state.awaitingLeaveOverride && state.draft) {
    state.flags = { ...state.flags, leaveOverride: true };
    state.awaitingLeaveOverride = false;
    await saveConversation(state);
    return continueAddFlow(req, state, state.draft.intent || 'add_entry');
  }

  // Numeric disambiguation
  if (state.flags?.awaitDisambiguation && /^\d+$/.test(text)) {
    const idx = Number(text) - 1;
    const cand = state.flags.candidates?.[idx];
    if (!cand) {
      return { text: 'Invalid option number. Please pick from the list.' };
    }
    if (state.flags.awaitDisambiguation === 'project') {
      state.draft = { ...state.draft, projectId: cand.id, projectQuery: cand.label };
      state.flags = { ...state.flags, awaitDisambiguation: undefined, candidates: undefined };
      await saveConversation(state);
      return continueAddFlow(req, state);
    }
    if (state.flags.awaitDisambiguation === 'task') {
      state.draft = { ...state.draft, taskId: cand.id, taskQuery: cand.label };
      state.flags = { ...state.flags, awaitDisambiguation: undefined, candidates: undefined };
      await saveConversation(state);
      return continueAddFlow(req, state);
    }
    if (state.flags.awaitDisambiguation === 'merge_policy') {
      const policy = text === '1' ? 'sum' : text === '2' ? 'replace' : null;
      if (!policy || !state.flags.mergePolicyEntry) {
        return { text: 'Reply *1* to add hours or *2* to replace hours.' };
      }
      return finalizeWriteFromDraft(req, state, policy);
    }
    if (state.flags.awaitDisambiguation === 'correction_target') {
      state.draft = { ...state.draft, projectId: cand.id.split('|')[0], taskId: cand.id.split('|')[1] };
      // handled via pending correction path below if we set pending target — simplify: store on pending
      return { text: 'Please restate the correction with the project and task, e.g. “make Hertz Development 6 hours”.' };
    }
  }

  const pending = state.pendingWriteId
    ? await getPendingWrite(state.pendingWriteId)
    : null;

  // Deterministic confirmation execution — ignore LLM for write execution
  if (pending) {
    if (textSatisfiesRequiredKeyword(text, pending.requireKeyword)) {
      return executePending(req, state, pending.id, text);
    }
    // Soft LLM confirm without keyword — refuse
    const modelPeek = await getAgentModel().extractIntent({
      text,
      hasPendingWrite: true,
      lastDate: state.context.lastDate,
    });
    if (modelPeek.intent === 'confirm' || modelPeek.intent === 'override') {
      return {
        text: requiredKeywordInstruction(pending.requireKeyword),
      };
    }
  }

  // Hours correction on pending — target by targetEntryKey
  if (pending && /make it|actually|แก้เป็น|เปลี่ยนเป็น|correction/i.test(text)) {
    const hm = text.match(/(\d+(?:\.\d+)?)/);
    if (hm) {
      const hours = parseFloat(hm[1]);
      if (!(hours > 0) || hours > 24) {
        return { text: 'Hours must be greater than 0 and at most 24.' };
      }
      if (!pending.targetEntryKey) {
        return {
          text: 'I need to know which entry to correct. Name the project and task.',
        };
      }
      const updated = pending.payload.entries.map((e) =>
        dayKey(e.projectId, e.taskId) === pending.targetEntryKey
          ? { ...e, hours }
          : e
      );
      const target = updated.find(
        (e) => dayKey(e.projectId, e.taskId) === pending.targetEntryKey
      );
      if (!target) {
        return { text: 'Target entry is no longer in the pending day. Cancel and start again.' };
      }
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      const summary =
        summarizeDay(pending.payload.date, updated, projects, tasks) +
        `\n\n${requiredKeywordInstruction(pending.requireKeyword)}`;
      const np = await createPendingWrite({
        employeeId: pending.employeeId,
        slackUserId: pending.slackUserId,
        channelId: pending.channelId,
        threadTs: pending.threadTs,
        operation: pending.operation,
        operationType: pending.operationType,
        targetEntryKey: pending.targetEntryKey,
        targetEntry: { ...target },
        baseSnapshot: pending.baseSnapshot,
        payload: { date: pending.payload.date, entries: updated },
        warnings: pending.warnings,
        summaryText: summary,
        requireKeyword: pending.requireKeyword,
      });
      state.pendingWriteId = np.id;
      await saveConversation(state);
      return { text: `Updated pending hours for the target entry.\n\n${np.summaryText}` };
    }
  }

  const model = getAgentModel();
  const decision = await model.extractIntent({
    text,
    hasPendingWrite: Boolean(pending),
    lastDate: state.context.lastDate,
  });

  switch (decision.intent) {
    case 'help':
      return {
        text: `*Timesheet AI*\n• Show week / today\n• List projects / tasks\n• Leave / holidays\n• Add / update / delete entries (confirm with *YES*)\n• Clear a day (*CLEAR*)\n• Cancel (*CANCEL*)\n\nCustom projects cannot be created from Slack — use an existing Project ID.\nI cannot approve timesheets or edit other people.`,
      };
    case 'show_profile': {
      const p = await timesheetTools.get_current_employee(req.auth);
      return {
        text: `*${p.FirstName} ${p.LastName}*\nID: \`${p.EmployeeID}\`\n${p.Position}\n${p.Email}${p.Location ? `\nLocation: ${p.Location}` : ''}`,
      };
    }
    case 'show_week':
    case 'show_today': {
      const tz = getAgentTimeZone();
      const dateRes = resolveDateText(
        decision.dateText || (decision.intent === 'show_today' ? 'today' : 'today'),
        tz
      );
      const anchor = dateRes.ok ? dateRes.date : zonedYmd(tz);
      const weekStart = weekStartMonday(anchor);
      const data = await timesheetTools.get_weekly_timesheet(req.auth, weekStart);
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      if (decision.intent === 'show_today') {
        return { text: summarizeDay(anchor, data[anchor] || [], projects, tasks) };
      }
      const lines: string[] = [`*Week of ${weekStart}*`];
      let weekTotal = 0;
      for (let i = 0; i < 7; i++) {
        const [y, m, dd] = weekStart.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, dd + i));
        const d = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        const ents = data[d] || [];
        const tot = ents.reduce((s, e) => s + e.hours, 0);
        weekTotal += tot;
        lines.push(`${d} — *${tot.toFixed(2)}* h (${ents.length} entries)`);
      }
      lines.push(`Week total: *${weekTotal.toFixed(2)}* h`);
      state.context.lastWeekStart = weekStart;
      await saveConversation(state);
      return { text: lines.join('\n') };
    }
    case 'list_projects': {
      const { projects } = await timesheetTools.list_projects();
      const filter = (decision.filterText || decision.projectQuery || '').toLowerCase();
      const filtered = filter
        ? projects.filter(
            (p) =>
              p.ProjectName.toLowerCase().includes(filter) ||
              p.ProjectClient.toLowerCase().includes(filter) ||
              p.ProjectCode.toLowerCase().includes(filter) ||
              p.ProjectID === filter
          )
        : projects;
      const slice = filtered.slice(0, 25);
      return {
        text: `*Projects*${filter ? ` matching “${filter}”` : ''} (${filtered.length})\n${slice.map((p, i) => formatProjectOption(p, i + 1)).join('\n') || '_None_'}`,
      };
    }
    case 'list_tasks': {
      const tasks = await timesheetTools.list_tasks();
      const filter = (decision.filterText || decision.taskQuery || '').toLowerCase();
      const filtered = filter
        ? tasks.filter((t) => t.Task.toLowerCase().includes(filter) || t.TaskID === filter)
        : tasks;
      return {
        text: `*Tasks* (${filtered.length})\n${filtered
          .slice(0, 25)
          .map((t, i) => formatTaskOption(t, i + 1))
          .join('\n') || '_None_'}`,
      };
    }
    case 'show_holidays': {
      const tz = getAgentTimeZone();
      const today = zonedYmd(tz);
      const year = Number(today.slice(0, 4));
      try {
        const holidays = await timesheetTools.get_holidays(req.auth, year);
        const month = today.slice(0, 7);
        const inMonth = holidays.filter((h) => h.date.startsWith(month));
        const list = (inMonth.length ? inMonth : holidays.slice(0, 20))
          .map((h) => `• ${h.date} — ${h.name}`)
          .join('\n');
        return { text: `*Holidays ${year}*\n${list || '_None in cache_'}` };
      } catch {
        return {
          text: 'Holiday data isn’t loaded. Ask an admin to refresh the holiday cache.',
        };
      }
    }
    case 'show_leave': {
      const tz = getAgentTimeZone();
      const today = zonedYmd(tz);
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      try {
        const leave = await timesheetTools.get_leave_monthly(req.auth, year, month);
        const list = leave
          .map((l) => `• ${l.date} — ${l.type} ${l.leaveType} (status: ${l.status || 'n/a'})`)
          .join('\n');
        return { text: `*Leave ${year}-${String(month).padStart(2, '0')}*\n${list || '_None_'}` };
      } catch {
        return { text: 'Couldn’t load leave. Please try again later.' };
      }
    }
    case 'clear_day': {
      const dateRes = resolveDateText(
        decision.dateText || state.context.lastDate || 'today',
        getAgentTimeZone()
      );
      if (!dateRes.ok) return { text: dateRes.error };
      const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, dateRes.date);
      const existing = normalizeDayEntries(week[dateRes.date] || []);
      if (existing.length === 0) {
        return { text: 'The day is already empty.' };
      }
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      const g = evaluateClearGuards(true);
      const summary =
        summarizeDay(dateRes.date, existing, projects, tasks) +
        `\n\n⚠️ This deletes ALL entries for ${dateRes.date}.\n${requiredKeywordInstruction('CLEAR')}`;
      const pendingWrite = await createPendingWrite({
        employeeId: req.auth.staff.EmployeeID,
        slackUserId: req.slackUserId,
        channelId: req.channelId,
        threadTs: req.threadTs,
        operation: 'clear_day_timesheet',
        operationType: 'clear',
        baseSnapshot: existing,
        payload: { date: dateRes.date, entries: [] },
        warnings: g.warnings,
        summaryText: summary,
        requireKeyword: 'CLEAR',
      });
      state.pendingWriteId = pendingWrite.id;
      state.context.lastDate = dateRes.date;
      await saveConversation(state);
      return { text: summary };
    }
    case 'add_entry':
    case 'update_entry':
    case 'delete_entry': {
      state.draft = {
        intent: decision.intent,
        projectQuery: decision.projectQuery || undefined,
        taskQuery: decision.taskQuery || undefined,
        hours: decision.hours ?? undefined,
      };
      const dateRes = resolveDateText(
        decision.dateText || state.context.lastDate || '',
        getAgentTimeZone()
      );
      if (!dateRes.ok) {
        await saveConversation(state);
        return { text: 'Which date? (today / yesterday / YYYY-MM-DD)' };
      }
      state.draft.date = dateRes.date;
      state.context.lastDate = dateRes.date;
      if (dateRes.isFuture) {
        state.flags = { ...state.flags, futureAcknowledged: false };
      }
      await saveConversation(state);
      return continueAddFlow(req, state, decision.intent);
    }
    case 'confirm':
    case 'override':
      if (state.awaitingLeaveOverride) {
        return { text: requiredKeywordInstruction('OVERRIDE') };
      }
      if (pending) {
        return { text: requiredKeywordInstruction(pending.requireKeyword) };
      }
      return { text: 'Nothing is waiting for confirmation.' };
    default:
      return {
        text: 'I didn’t understand. Try “what did I log this week?”, “list projects”, or “yesterday 4 hours on <project> <task>”. Type *help* for commands.',
      };
  }
}

async function continueAddFlow(
  req: AgentRequest,
  state: ConversationState,
  intent = state.draft?.intent || 'add_entry'
): Promise<AgentResponse> {
  const draft = state.draft || {};
  if (!draft.date) {
    return { text: 'Which date?' };
  }

  const { projects } = await timesheetTools.list_projects();
  const tasks = await timesheetTools.list_tasks();

  if (!draft.projectId) {
    if (!draft.projectQuery) {
      await saveConversation(state);
      return { text: 'Which project? (name, code, or ID)' };
    }
    const res = decideProjectResolution(draft.projectQuery, projects);
    if (res.status === 'ambiguous') {
      state.flags = {
        ...state.flags,
        awaitDisambiguation: 'project',
        candidates: res.candidates.map((p) => ({
          id: p.ProjectID,
          label: `${p.ProjectName} (${p.ProjectCode})`,
        })),
      };
      await saveConversation(state);
      return {
        text:
          'Which project?\n' +
          res.candidates.map((p, i) => formatProjectOption(p, i + 1)).join('\n'),
      };
    }
    if (res.status === 'unknown') {
      const sim =
        res.similar.length > 0
          ? '\nSimilar existing projects:\n' +
            res.similar.map((p, i) => formatProjectOption(p, i + 1)).join('\n')
          : '';
      return {
        text: `No matching project for “${draft.projectQuery}”.${sim}\n\nCustom project creation is *not* available from Slack. Create the project in the Timesheet web app / Sheets master list first, then try again with the Project ID or exact name.`,
      };
    }
    draft.projectId = res.project.ProjectID;
    state.draft = draft;
    state.context.lastProjectId = res.project.ProjectID;
  }

  if (!draft.taskId) {
    if (!draft.taskQuery) {
      await saveConversation(state);
      return { text: 'Which task?' };
    }
    const tres = decideTaskResolution(draft.taskQuery, tasks);
    if (tres.status === 'ambiguous') {
      state.flags = {
        ...state.flags,
        awaitDisambiguation: 'task',
        candidates: tres.candidates.map((t) => ({ id: t.TaskID, label: t.Task })),
      };
      await saveConversation(state);
      return {
        text:
          'Which task?\n' +
          tres.candidates.map((t, i) => formatTaskOption(t, i + 1)).join('\n'),
      };
    }
    if (tres.status === 'unknown') {
      return {
        text: 'No matching task. Task creation isn’t supported — pick from *list tasks*.',
      };
    }
    draft.taskId = tres.task.TaskID;
    state.draft = draft;
    state.context.lastTaskId = tres.task.TaskID;
  }

  if (intent === 'delete_entry') {
    return finalizeDelete(req, state);
  }

  if (draft.hours == null || !(draft.hours > 0)) {
    await saveConversation(state);
    return { text: 'How many hours? (must be > 0 and ≤ 24)' };
  }

  if (intent === 'update_entry') {
    return finalizeUpdate(req, state);
  }

  return finalizeWriteFromDraft(req, state, 'ask');
}

async function finalizeWriteFromDraft(
  req: AgentRequest,
  state: ConversationState,
  dupPolicy: 'ask' | 'sum' | 'replace'
): Promise<AgentResponse> {
  const draft = state.draft!;
  const date = draft.date!;
  const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, date);
  const existing = normalizeDayEntries(week[date] || []);
  let daySet = entriesToDaySet(existing);

  const entry: DayEntry = {
    projectId: draft.projectId!,
    taskId: draft.taskId!,
    hours: draft.hours!,
  };

  const addRes = mergeAdd(daySet, entry, dupPolicy === 'ask' ? 'ask' : dupPolicy);
  if (!addRes.ok) return { text: addRes.error };
  if (addRes.duplicate && addRes.needsPolicy) {
    state.flags = {
      ...state.flags,
      awaitDisambiguation: 'merge_policy',
      mergePolicyEntry: entry,
      candidates: [
        { id: 'sum', label: 'Add hours' },
        { id: 'replace', label: 'Replace hours' },
      ],
    };
    await saveConversation(state);
    return {
      text: `That project/task already has *${addRes.existingHours}* h on ${date}.\n1. Add hours (total ${(addRes.existingHours + entry.hours).toFixed(2)})\n2. Replace with ${entry.hours}\nReply *1* or *2*.`,
    };
  }
  daySet = addRes.daySet;

  return buildPendingSubmit(req, state, date, existing, daySet, 'add', entry);
}

async function finalizeUpdate(req: AgentRequest, state: ConversationState) {
  const draft = state.draft!;
  const date = draft.date!;
  const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, date);
  const existing = normalizeDayEntries(week[date] || []);
  const daySet = entriesToDaySet(existing);
  const entry: DayEntry = {
    projectId: draft.projectId!,
    taskId: draft.taskId!,
    hours: draft.hours!,
  };
  const upd = mergeUpdate(daySet, entry.projectId, entry.taskId, entry.hours);
  if (!upd.ok) {
    if (upd.error === 'NOT_FOUND') {
      return { text: 'No existing line for that project/task. Say add instead?' };
    }
    return { text: String(upd.error) };
  }
  return buildPendingSubmit(req, state, date, existing, upd.daySet, 'update', entry);
}

async function finalizeDelete(req: AgentRequest, state: ConversationState) {
  const draft = state.draft!;
  const date = draft.date!;
  const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, date);
  const existing = normalizeDayEntries(week[date] || []);
  const daySet = entriesToDaySet(existing);
  const entry: DayEntry = {
    projectId: draft.projectId!,
    taskId: draft.taskId!,
    hours: 0,
  };
  // hours unused for delete key
  const existingLine = daySet.get(dayKey(draft.projectId!, draft.taskId!));
  if (!existingLine) {
    return { text: 'That entry wasn’t found on that date.' };
  }
  const del = mergeDelete(daySet, draft.projectId!, draft.taskId!);
  if (!del.ok) return { text: 'That entry wasn’t found on that date.' };

  if (del.becameEmpty) {
    const { projects } = await timesheetTools.list_projects();
    const tasks = await timesheetTools.list_tasks();
    const summary =
      summarizeDay(date, [], projects, tasks) +
      `\n\nDeleting the last entry clears the day.\n${requiredKeywordInstruction('CLEAR')}`;
    const p = await createPendingWrite({
      employeeId: req.auth.staff.EmployeeID,
      slackUserId: req.slackUserId,
      channelId: req.channelId,
      threadTs: req.threadTs,
      operation: 'clear_day_timesheet',
      operationType: 'clear',
      targetEntryKey: dayKey(existingLine.projectId, existingLine.taskId),
      targetEntry: existingLine,
      baseSnapshot: existing,
      payload: { date, entries: [] },
      warnings: ['Last entry delete → clear day'],
      summaryText: summary,
      requireKeyword: 'CLEAR',
    });
    state.pendingWriteId = p.id;
    state.draft = undefined;
    await saveConversation(state);
    return { text: summary };
  }

  return buildPendingSubmit(
    req,
    state,
    date,
    existing,
    del.daySet,
    'delete',
    existingLine
  );
}

async function buildPendingSubmit(
  req: AgentRequest,
  state: ConversationState,
  date: string,
  baseSnapshot: DayEntry[],
  daySet: Map<string, DayEntry>,
  operationType: 'add' | 'update' | 'delete',
  targetEntry: DayEntry
): Promise<AgentResponse> {
  const { leave, holidays } = await loadLeaveHolidays(req.auth, date);
  const tz = getAgentTimeZone();
  const today = zonedYmd(tz);
  const isFuture = date > today;

  const guard = evaluateWriteGuards({
    date,
    daySet,
    leave,
    holidays,
    isFuture,
    createCustomProject: false,
    leaveOverride: state.flags?.leaveOverride,
    holidayAcknowledged: state.flags?.holidayAcknowledged,
    futureAcknowledged: state.flags?.futureAcknowledged,
    over24Acknowledged: state.flags?.over24Acknowledged,
  });

  if (!guard.ok && guard.requireKeyword === 'OVERRIDE') {
    state.awaitingLeaveOverride = true;
    state.draft = {
      ...state.draft,
      date,
      projectId: targetEntry.projectId,
      taskId: targetEntry.taskId,
      hours: targetEntry.hours,
      intent: operationType === 'update' ? 'update_entry' : 'add_entry',
    };
    await saveConversation(state);
    return {
      text: `${guard.blockMessage}\n\nType *OVERRIDE* exactly (you will still need *YES* before anything is saved). Or *CANCEL*.`,
    };
  }

  if (!guard.ok && guard.requireKeyword === 'YES') {
    state.flags = {
      ...state.flags,
      holidayAcknowledged: true,
      futureAcknowledged: true,
      over24Acknowledged: true,
    };
  }

  if (!guard.ok && !guard.requireKeyword) {
    return { text: guard.blockMessage || 'Cannot proceed.' };
  }

  const entries = daySetToEntries(daySet);
  const { projects } = await timesheetTools.list_projects();
  const tasks = await timesheetTools.list_tasks();
  const warnBlock =
    guard.warnings.length > 0
      ? `\nWarnings:\n${guard.warnings.map((w) => `• ${w}`).join('\n')}`
      : '';
  const summary =
    `Confirm save for *${date}?*\n\n` +
    summarizeDay(date, entries, projects, tasks) +
    warnBlock +
    `\n\nTotal after save: *${dayTotal(daySet).toFixed(2)}* h\n${requiredKeywordInstruction('YES')}`;

  const pending = await createPendingWrite({
    employeeId: req.auth.staff.EmployeeID,
    slackUserId: req.slackUserId,
    channelId: req.channelId,
    threadTs: req.threadTs,
    operation: 'submit_day_timesheet',
    operationType,
    targetEntryKey: dayKey(targetEntry.projectId, targetEntry.taskId),
    targetEntry,
    baseSnapshot,
    payload: { date, entries },
    warnings: guard.warnings,
    summaryText: summary,
    requireKeyword: 'YES',
  });
  state.pendingWriteId = pending.id;
  state.draft = undefined;
  state.awaitingLeaveOverride = false;
  await saveConversation(state);
  return { text: summary };
}

async function executePending(
  req: AgentRequest,
  state: ConversationState,
  pendingId: string,
  confirmText: string
): Promise<AgentResponse> {
  let claimed: PendingWrite | null;
  try {
    claimed = await claimPendingWrite(pendingId, req.slackUserId);
  } catch (e) {
    if (e instanceof Error && e.message === 'WRONG_USER') {
      return { text: 'You can’t confirm another user’s pending save.' };
    }
    throw e;
  }
  if (!claimed) {
    return { text: 'Confirmation expired or already used. Please start again.' };
  }

  // Re-validate keyword after claim
  if (!textSatisfiesRequiredKeyword(confirmText, claimed.requireKeyword)) {
    await releaseClaim(pendingId);
    // revert status to pending
    const { getRedisClient } = await import('@/lib/redis');
    const redis = getRedisClient();
    const { pendingKey } = await import('@/lib/timesheet-agent/conversation-state');
    claimed.status = 'pending';
    await redis.setex(pendingKey(pendingId), 600, JSON.stringify(claimed));
    return { text: requiredKeywordInstruction(claimed.requireKeyword) };
  }

  try {
    // Stale check
    const week = await timesheetTools.get_weekly_timesheet_for_date(
      req.auth,
      claimed.payload.date
    );
    const latest = normalizeDayEntries(week[claimed.payload.date] || []);
    const latestFp = dayFingerprint(latest);

    if (latestFp !== claimed.baseFingerprint) {
      const reapplied = reapplyOperation(latest, claimed);
      await completePendingWrite(pendingId, 'cancelled');
      state = await clearPendingFromConversation(state);

      if (!reapplied.ok) {
        await saveConversation(state);
        return {
          text: `The day changed since your confirmation, and I couldn’t safely re-apply the operation (${reapplied.error}). Please start again.`,
        };
      }

      const entries = daySetToEntries(reapplied.daySet);
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      const requireKeyword = claimed.operationType === 'clear' ? 'CLEAR' : 'YES';
      const summary =
        `The day changed since you confirmed. Rebuilt proposal:\n\n` +
        summarizeDay(claimed.payload.date, entries, projects, tasks) +
        `\n\n${requiredKeywordInstruction(requireKeyword)}`;

      const np = await createPendingWrite({
        employeeId: claimed.employeeId,
        slackUserId: claimed.slackUserId,
        channelId: claimed.channelId,
        threadTs: claimed.threadTs,
        operation: claimed.operation,
        operationType: claimed.operationType,
        targetEntryKey: claimed.targetEntryKey,
        targetEntry: claimed.targetEntry,
        baseSnapshot: latest,
        payload: { date: claimed.payload.date, entries },
        warnings: [...claimed.warnings, 'Rebuilt after concurrent change'],
        summaryText: summary,
        requireKeyword,
      });
      state.pendingWriteId = np.id;
      await saveConversation(state);
      return { text: summary };
    }

    // Execute
    if (claimed.operation === 'clear_day_timesheet' || claimed.payload.entries.length === 0) {
      await timesheetTools.clear_day_timesheet(req.auth, claimed.payload.date);
    } else {
      await timesheetTools.submit_day_timesheet(
        req.auth,
        claimed.payload.date,
        claimed.payload.entries
      );
    }

    const afterWeek = await timesheetTools.get_weekly_timesheet_for_date(
      req.auth,
      claimed.payload.date
    );
    const actual = normalizeDayEntries(afterWeek[claimed.payload.date] || []);
    const verification = verifyDayMatchesExpected(claimed.payload.entries, actual);

    if (!verification.ok) {
      auditAgentWrite({
        slackUserId: req.slackUserId,
        employeeId: req.auth.staff.EmployeeID,
        operation: claimed.operation,
        date: claimed.payload.date,
        projectTaskIds: claimed.payload.entries.map((e) => dayKey(e.projectId, e.taskId)),
        result: 'failure',
        error: `verify: ${verification.reason}`,
      });
      await completePendingWrite(pendingId, 'cancelled');
      state = await clearPendingFromConversation(state);
      await saveConversation(state);
      return {
        text:
          `Verification failed after write: ${verification.reason}\n` +
          `Expected total: *${verification.expectedTotal.toFixed(2)}* h\n` +
          `Actual total: *${verification.actualTotal.toFixed(2)}* h\n` +
          `Expected:\n${
            verification.expected
              .map((e) => `• ${e.projectId}|${e.taskId} = ${e.hours}`)
              .join('\n') || '_empty_'
          }\n` +
          `Actual:\n${
            verification.actual
              .map((e) => `• ${e.projectId}|${e.taskId} = ${e.hours}`)
              .join('\n') || '_empty_'
          }\n` +
          `I am *not* claiming success. Please review the web Timesheet.`,
      };
    }

    const { projects } = await timesheetTools.list_projects();
    const tasks = await timesheetTools.list_tasks();

    auditAgentWrite({
      slackUserId: req.slackUserId,
      employeeId: req.auth.staff.EmployeeID,
      operation: claimed.operation,
      date: claimed.payload.date,
      projectTaskIds: claimed.payload.entries.map((e) => dayKey(e.projectId, e.taskId)),
      result: 'success',
    });

    await completePendingWrite(pendingId, 'completed');
    state = await clearPendingFromConversation(state);
    state.context.lastDate = claimed.payload.date;
    await saveConversation(state);

    return {
      text: `Saved.\n\n${summarizeDay(claimed.payload.date, actual, projects, tasks)}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Save failed';
    auditAgentWrite({
      slackUserId: req.slackUserId,
      employeeId: req.auth.staff.EmployeeID,
      operation: claimed.operation,
      date: claimed.payload.date,
      projectTaskIds: claimed.payload.entries.map((e) => dayKey(e.projectId, e.taskId)),
      result: 'failure',
      error: msg,
    });
    await completePendingWrite(pendingId, 'cancelled');
    state = await clearPendingFromConversation(state);
    await saveConversation(state);

    try {
      const week = await timesheetTools.get_weekly_timesheet_for_date(
        req.auth,
        claimed.payload.date
      );
      const saved = week[claimed.payload.date] || [];
      return {
        text: `Save failed: \`${msg}\`\nReloaded day now has ${saved.length} entries. Please verify before retrying.`,
      };
    } catch {
      return { text: `Save failed: \`${msg}\`. Please retry later.` };
    }
  }
}
