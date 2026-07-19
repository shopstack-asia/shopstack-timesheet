export function auditTimesheetWrite(
  event: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      scope: 'timesheet-write-audit',
      level: 'info',
      ts: new Date().toISOString(),
      ...event,
    })
  );
}
