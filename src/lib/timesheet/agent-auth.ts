/**
 * Agent auth context — binds a verified StaffProfile without forging NextAuth cookies.
 */
import { StaffProfile } from '@/types';

export type AgentAuthContext = {
  staff: StaffProfile;
  source: 'slack' | 'session';
  slackUserId?: string;
};

export function assertAgentAuth(ctx: AgentAuthContext | null | undefined): AgentAuthContext {
  if (!ctx?.staff?.EmployeeID?.trim()) {
    throw new AgentAuthError('Employee identity is not bound');
  }
  if (!ctx.staff.Email?.toLowerCase().endsWith('@shopstack.asia')) {
    throw new AgentAuthError('Employee email must be @shopstack.asia');
  }
  return ctx;
}

export class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentAuthError';
  }
}
