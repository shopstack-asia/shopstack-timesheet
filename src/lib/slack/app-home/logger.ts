/**
 * Structured logging for Slack App Home (no PII / identity fields).
 */

import { createSlackRequestLogger } from '@/lib/slack/logger';

export function createAppHomeLogger(base: {
  requestId?: string;
  eventId?: string;
  handler?: string;
  action?: string;
  slackUserId?: string;
}) {
  return createSlackRequestLogger({
    scope: 'slack-app-home',
    requestId: base.requestId,
    eventId: base.eventId,
    handler: base.handler,
    action: base.action,
    // Trusted Slack principal only — never employeeId/email
    slackUserId: base.slackUserId,
  });
}
