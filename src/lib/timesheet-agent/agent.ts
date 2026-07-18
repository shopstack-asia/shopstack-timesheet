import { AgentAuthContext } from '@/lib/timesheet/agent-auth';
import { getAgentModel } from '@/lib/timesheet-agent/model';
import { timesheetTools } from '@/lib/timesheet-agent/tools';
import {
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
  saveConversation,
} from '@/lib/timesheet-agent/conversation-state';
import { auditAgentWrite } from '@/lib/timesheet-agent/audit';
import { Project, Task } from '@/types';

export type AgentRequest = {
  text: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  auth: AgentAuthContext;
};

export type AgentResponse = {
  text: string;
};

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
  entries: Array<{ projectId: string; taskId: string; hours: number }>,
  projects: Project[],
  tasks: Task[]
): string {
  const pmap = new Map(projects.map((p) => [p.ProjectID, p]));
  const tmap = new Map(tasks.map((t) => [t.TaskID, t]));
  const lines = entries.map((e) => {
    const p = pmap.get(e.projectId);
    const t = tmap.get(e.taskId);
    const pname = p
      ? `${p.ProjectName} (${p.ProjectCode})`
      : e.projectId;
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

  // Numeric selection for disambiguation
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
  }

  const pending = state.pendingWriteId
    ? await getPendingWrite(state.pendingWriteId)
    : null;

  const model = getAgentModel();
  const decision = await model.extractIntent({
    text,
    hasPendingWrite: Boolean(pending),
    lastDate: state.context.lastDate,
  });

  // Keyword confirms for pending
  if (pending && (decision.intent === 'confirm' || decision.intent === 'override')) {
    if (decision.intent === 'override') {
      state.flags = { ...state.flags, leaveOverride: true };
      await saveConversation(state);
      // Rebuild pending with override — fall through to re-prepare
      return { text: 'OVERRIDE noted. Reply *YES* to confirm the save.' };
    }
    const kw = pending.requireKeyword;
    const upper = text.trim().toUpperCase();
    if (kw === 'CLEAR' && upper !== 'CLEAR') {
      return { text: `Type *CLEAR* to confirm clearing ${pending.payload.date}.` };
    }
    if (kw === 'CREATE PROJECT' && upper !== 'CREATE PROJECT') {
      return { text: 'Type *CREATE PROJECT* to confirm creating the shared project.' };
    }
    if ((kw === 'YES' || !kw) && !/^(yes|y|confirm|ok|save|ยืนยัน|clear|create project)$/i.test(text.trim()) && upper !== 'CLEAR' && upper !== 'CREATE PROJECT') {
      // allow YES variants already matched by intent confirm
    }
    return executePending(req, state, pending.id);
  }

  if (decision.intent === 'cancel') {
    state = await clearPendingFromConversation(state);
    state.flags = undefined;
    state.draft = undefined;
    await saveConversation(state);
    return { text: 'Cancelled. Nothing was saved.' };
  }

  if (decision.intent === 'correction' && pending) {
    if (decision.hours != null && decision.hours > 0) {
      const updated = [...pending.payload.entries];
      if (updated.length) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          hours: decision.hours,
        };
      }
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      const summary = summarizeDay(pending.payload.date, updated, projects, tasks);
      const np = await createPendingWrite({
        employeeId: req.auth.staff.EmployeeID,
        slackUserId: req.slackUserId,
        channelId: req.channelId,
        threadTs: req.threadTs,
        operation: pending.operation,
        payload: { date: pending.payload.date, entries: updated },
        warnings: pending.warnings,
        summaryText: summary + '\n\nReply *YES* to save · *CANCEL* to abort',
        requireKeyword: pending.requireKeyword,
      });
      state.pendingWriteId = np.id;
      await saveConversation(state);
      return { text: `Updated pending hours.\n\n${np.summaryText}` };
    }
    return { text: 'Tell me the corrected hours, e.g. “make it 6 hours”.' };
  }

  switch (decision.intent) {
    case 'help':
      return {
        text: `*Timesheet AI*\n• Show week / today\n• List projects / tasks\n• Leave / holidays\n• Add / update / delete entries (with confirmation)\n• Clear a day (type CLEAR)\n• Cancel pending saves\n\nI cannot approve timesheets or edit other people.`,
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
        const day = data[anchor] || [];
        return { text: summarizeDay(anchor, day, projects, tasks) };
      }
      const days = Object.keys(data).sort();
      // ensure Mon-Sun listing
      const lines: string[] = [`*Week of ${weekStart}*`];
      let weekTotal = 0;
      for (let i = 0; i < 7; i++) {
        const d = (() => {
          const [y, m, dd] = weekStart.split('-').map(Number);
          const dt = new Date(Date.UTC(y, m - 1, dd + i));
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        })();
        const ents = data[d] || [];
        const tot = ents.reduce((s, e) => s + e.hours, 0);
        weekTotal += tot;
        lines.push(`${d} — *${tot.toFixed(2)}* h (${ents.length} entries)`);
      }
      lines.push(`Week total: *${weekTotal.toFixed(2)}* h`);
      void days;
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
      const body = slice.map((p, i) => formatProjectOption(p, i + 1)).join('\n');
      return {
        text: `*Projects*${filter ? ` matching “${filter}”` : ''} (${filtered.length})\n${body || '_None_'}${filtered.length > 25 ? '\n_…truncated_' : ''}`,
      };
    }
    case 'list_tasks': {
      const tasks = await timesheetTools.list_tasks();
      const filter = (decision.filterText || decision.taskQuery || '').toLowerCase();
      const filtered = filter
        ? tasks.filter((t) => t.Task.toLowerCase().includes(filter) || t.TaskID === filter)
        : tasks;
      const slice = filtered.slice(0, 25);
      return {
        text: `*Tasks* (${filtered.length})\n${slice.map((t, i) => formatTaskOption(t, i + 1)).join('\n') || '_None_'}`,
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
      const existing = week[dateRes.date] || [];
      const { projects } = await timesheetTools.list_projects();
      const tasks = await timesheetTools.list_tasks();
      const g = evaluateClearGuards(existing.length > 0);
      const summary =
        summarizeDay(dateRes.date, existing, projects, tasks) +
        `\n\n⚠️ This deletes ALL entries for ${dateRes.date}.\nType *CLEAR* to confirm · *CANCEL* to abort`;
      const pendingWrite = await createPendingWrite({
        employeeId: req.auth.staff.EmployeeID,
        slackUserId: req.slackUserId,
        channelId: req.channelId,
        threadTs: req.threadTs,
        operation: 'clear_day_timesheet',
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
        date: undefined,
        projectQuery: decision.projectQuery || undefined,
        taskQuery: decision.taskQuery || undefined,
        hours: decision.hours ?? undefined,
        projectId: undefined,
        taskId: undefined,
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
      state.flags = {
        ...state.flags,
        futureAcknowledged: dateRes.isFuture ? state.flags?.futureAcknowledged : true,
      };
      if (dateRes.isFuture && !state.flags?.futureAcknowledged) {
        await saveConversation(state);
        // will be handled in finalize with guard
      }
      await saveConversation(state);
      return continueAddFlow(req, state, decision.intent);
    }
    default:
      // Try heuristic add if hours present in text
      if (decision.intent === 'unknown') {
        return {
          text: 'I didn’t understand. Try “what did I log this week?”, “list projects”, or “yesterday 4 hours on <project> <task>”.',
        };
      }
      return { text: 'I didn’t understand. Type *help* for commands.' };
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
      state.flags = {
        ...state.flags,
        createCustomProject: false,
        awaitDisambiguation: undefined,
      };
      await saveConversation(state);
      const sim =
        res.similar.length > 0
          ? '\nSimilar:\n' + res.similar.map((p, i) => formatProjectOption(p, i + 1)).join('\n')
          : '';
      return {
        text: `No project match for “${draft.projectQuery}”.${sim}\nPick an existing project, or ask to create a custom project (requires CREATE PROJECT confirmation).`,
      };
    }
    draft.projectId = res.project.ProjectID;
    state.draft = draft;
    state.context.lastProjectId = res.project.ProjectID;
    state.context.lastProjectLabel = res.project.ProjectName;
  }

  if (!draft.taskId) {
    if (!draft.taskQuery) {
      await saveConversation(state);
      return { text: 'Which task?' };
    }
    const tres = decideTaskResolution(draft.taskQuery, tasks);
    if (tres.status === 'ambiguous') {
      state.flags = {
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
  const existing = week[date] || [];
  let daySet = entriesToDaySet(existing);

  const entry = {
    projectId: draft.projectId!,
    taskId: draft.taskId!,
    hours: draft.hours!,
  };

  const addRes = mergeAdd(daySet, entry, dupPolicy === 'ask' ? 'ask' : dupPolicy);
  if (!addRes.ok) {
    return { text: addRes.error };
  }
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

  return buildPendingSubmit(req, state, date, daySet, false);
}

async function finalizeUpdate(req: AgentRequest, state: ConversationState) {
  const draft = state.draft!;
  const date = draft.date!;
  const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, date);
  const daySet = entriesToDaySet(week[date] || []);
  const upd = mergeUpdate(daySet, draft.projectId!, draft.taskId!, draft.hours!);
  if (!upd.ok) {
    if (upd.error === 'NOT_FOUND') {
      return { text: 'No existing line for that project/task. Say add instead?' };
    }
    return { text: String(upd.error) };
  }
  return buildPendingSubmit(req, state, date, upd.daySet, false);
}

async function finalizeDelete(req: AgentRequest, state: ConversationState) {
  const draft = state.draft!;
  const date = draft.date!;
  const week = await timesheetTools.get_weekly_timesheet_for_date(req.auth, date);
  const daySet = entriesToDaySet(week[date] || []);
  const del = mergeDelete(daySet, draft.projectId!, draft.taskId!);
  if (!del.ok) {
    return { text: 'That entry wasn’t found on that date.' };
  }
  if (del.becameEmpty) {
    const { projects } = await timesheetTools.list_projects();
    const tasks = await timesheetTools.list_tasks();
    const summary =
      summarizeDay(date, [], projects, tasks) +
      `\n\nDeleting the last entry clears the day.\nType *CLEAR* to confirm · *CANCEL* to abort`;
    const p = await createPendingWrite({
      employeeId: req.auth.staff.EmployeeID,
      slackUserId: req.slackUserId,
      channelId: req.channelId,
      threadTs: req.threadTs,
      operation: 'clear_day_timesheet',
      payload: { date, entries: [] },
      warnings: ['Last entry delete → clear day'],
      summaryText: summary,
      requireKeyword: 'CLEAR',
    });
    state.pendingWriteId = p.id;
    await saveConversation(state);
    return { text: summary };
  }
  return buildPendingSubmit(req, state, date, del.daySet, false);
}

async function buildPendingSubmit(
  req: AgentRequest,
  state: ConversationState,
  date: string,
  daySet: ReturnType<typeof entriesToDaySet>,
  customProject: boolean
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
    createCustomProject: customProject || state.flags?.createCustomProject,
    leaveOverride: state.flags?.leaveOverride,
    holidayAcknowledged: state.flags?.holidayAcknowledged,
    futureAcknowledged: state.flags?.futureAcknowledged,
    over24Acknowledged: state.flags?.over24Acknowledged,
  });

  if (!guard.ok && guard.requireKeyword === 'OVERRIDE') {
    await saveConversation(state);
    return { text: `${guard.blockMessage}\n\nOr *CANCEL*.` };
  }
  if (!guard.ok && guard.requireKeyword === 'CREATE PROJECT') {
    await saveConversation(state);
    return { text: `${guard.blockMessage}` };
  }
  if (!guard.ok && guard.requireKeyword === 'YES') {
    // Still create pending but require YES and set flags on confirm path via warnings
    state.flags = {
      ...state.flags,
      holidayAcknowledged: true,
      futureAcknowledged: true,
      over24Acknowledged: true,
    };
  }

  const entries = daySetToEntries(daySet);
  const { projects } = await timesheetTools.list_projects();
  const tasks = await timesheetTools.list_tasks();
  const warnBlock =
    guard.warnings.length > 0 ? `\nWarnings:\n${guard.warnings.map((w) => `• ${w}`).join('\n')}` : '';
  const summary =
    `Confirm save for *${date}?*\n\n` +
    summarizeDay(date, entries, projects, tasks) +
    warnBlock +
    `\n\nTotal after save: *${dayTotal(daySet).toFixed(2)}* h\nReply *YES* to save · *CANCEL* to abort`;

  const pending = await createPendingWrite({
    employeeId: req.auth.staff.EmployeeID,
    slackUserId: req.slackUserId,
    channelId: req.channelId,
    threadTs: req.threadTs,
    operation: customProject ? 'create_custom_project' : 'submit_day_timesheet',
    payload: { date, entries },
    warnings: guard.warnings,
    summaryText: summary,
    requireKeyword: customProject ? 'CREATE PROJECT' : undefined,
  });
  state.pendingWriteId = pending.id;
  state.draft = undefined;
  await saveConversation(state);
  return { text: summary };
}

async function executePending(
  req: AgentRequest,
  state: ConversationState,
  pendingId: string
): Promise<AgentResponse> {
  let claimed;
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

  try {
    if (
      claimed.operation === 'clear_day_timesheet' ||
      claimed.payload.entries.length === 0
    ) {
      await timesheetTools.clear_day_timesheet(req.auth, claimed.payload.date);
    } else {
      await timesheetTools.submit_day_timesheet(
        req.auth,
        claimed.payload.date,
        claimed.payload.entries
      );
    }

    const week = await timesheetTools.get_weekly_timesheet_for_date(
      req.auth,
      claimed.payload.date
    );
    const saved = week[claimed.payload.date] || [];
    const { projects } = await timesheetTools.list_projects();
    const tasks = await timesheetTools.list_tasks();

    auditAgentWrite({
      slackUserId: req.slackUserId,
      employeeId: req.auth.staff.EmployeeID,
      operation: claimed.operation,
      date: claimed.payload.date,
      projectTaskIds: claimed.payload.entries.map((e) => `${e.projectId}|${e.taskId}`),
      result: 'success',
    });

    await completePendingWrite(pendingId, 'completed');
    state = await clearPendingFromConversation(state);
    state.context.lastDate = claimed.payload.date;
    await saveConversation(state);

    return {
      text: `Saved.\n\n${summarizeDay(claimed.payload.date, saved, projects, tasks)}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Save failed';
    auditAgentWrite({
      slackUserId: req.slackUserId,
      employeeId: req.auth.staff.EmployeeID,
      operation: claimed.operation,
      date: claimed.payload.date,
      projectTaskIds: claimed.payload.entries.map((e) => `${e.projectId}|${e.taskId}`),
      result: 'failure',
      error: msg,
    });
    await completePendingWrite(pendingId, 'cancelled');
    state = await clearPendingFromConversation(state);
    await saveConversation(state);

    // verify
    try {
      const week = await timesheetTools.get_weekly_timesheet_for_date(
        req.auth,
        claimed.payload.date
      );
      const saved = week[claimed.payload.date] || [];
      return {
        text: `Save failed: \`${msg}\`\nI reloaded your day (${saved.length} entries). Please try again after fixing the issue.`,
      };
    } catch {
      return { text: `Save failed: \`${msg}\`. Please retry later.` };
    }
  }
}
