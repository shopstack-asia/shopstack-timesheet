export function auditAgentWrite(meta: {
  slackUserId: string;
  employeeId: string;
  operation: string;
  date: string;
  projectTaskIds: string[];
  result: 'success' | 'failure' | 'cancelled';
  error?: string;
}) {
  console.info(
    JSON.stringify({
      type: 'timesheet_agent_audit',
      ts: new Date().toISOString(),
      ...meta,
    })
  );
}
