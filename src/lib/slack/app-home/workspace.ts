/**
 * Exact Slack workspace (team) access checks for App Home.
 * No substring, case-fold, domain, or fuzzy matching.
 */

export type WorkspaceAccessOutcome =
  | 'allowed'
  | 'mismatch'
  | 'missing_workspace';

export type WorkspaceAccessResult =
  | { outcome: 'allowed'; workspaceId: string }
  | { outcome: 'mismatch'; actualWorkspaceId?: string }
  | { outcome: 'missing_workspace' };

/**
 * Evaluate whether a Slack request may proceed for App Home.
 *
 * - When `allowedWorkspaceId` is set: actual must exist and exactly equal it.
 * - When unset: request may proceed; `workspaceId` is the actual id or `''`
 *   (caller builds an explicit `unscoped` Conversation Context key).
 */
export function evaluateWorkspaceAccess(input: {
  actualWorkspaceId?: string | null;
  allowedWorkspaceId?: string | null;
}): WorkspaceAccessResult {
  const allowed = (input.allowedWorkspaceId ?? '').trim();
  const actual = (input.actualWorkspaceId ?? '').trim();

  if (allowed) {
    if (!actual) {
      return { outcome: 'missing_workspace' };
    }
    if (actual !== allowed) {
      return { outcome: 'mismatch', actualWorkspaceId: actual };
    }
    return { outcome: 'allowed', workspaceId: actual };
  }

  // No allow-list configured — preserve current multi/unrestricted deploy policy
  return { outcome: 'allowed', workspaceId: actual };
}

/** Resolve configured allow-list from Slack config / env (no secrets logged). */
export function resolveConfiguredAllowedWorkspace(env: {
  workspace?: string;
} | null): string | undefined {
  const fromConfig = env?.workspace?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.SLACK_ALLOWED_WORKSPACE?.trim();
  return fromEnv || undefined;
}
