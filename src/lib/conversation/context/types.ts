import type { WorkContext } from '@/lib/tools/business/types';

export type SelectedRef = {
  id: string;
  name: string;
};

/**
 * Ephemeral per-conversation state. Never persisted to Redis/DB.
 * Lives only in the in-process conversation context store (TTL).
 */
export type ConversationContext = {
  conversationId: string;
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  /** Optional display name captured when identity was first resolved */
  employeeName?: string;
  /** Zoho StaffProfile fields for Time Log denormalized columns */
  firstName?: string;
  lastName?: string;
  position?: string;
  workContext?: WorkContext;
  selectedClient?: SelectedRef;
  selectedProject?: SelectedRef;
  selectedRole?: SelectedRef;
  loadedAt: Date;
};

export type ResolvedIdentity = {
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  /** Optional display name from Zoho */
  employeeName?: string;
  /** Zoho StaffProfile fields for Time Log denormalized columns */
  firstName?: string;
  lastName?: string;
  position?: string;
};

export type GetConversationContextOptions = {
  /** When true, load/cache WorkContext via Business API if missing */
  ensureWorkContext?: boolean;
  /** When true, reload WorkContext from Timesheet API and clear selection */
  forceRefreshWorkContext?: boolean;
};
