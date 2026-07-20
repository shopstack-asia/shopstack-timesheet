import { resolveSlackIdentity } from '@/lib/slack/identity';
import type { ResolvedIdentity } from '@/lib/conversation/context/types';

export type IdentityResolver = {
  resolveEmployee(slackUserId: string): Promise<ResolvedIdentity>;
};

export class IdentityResolutionError extends Error {
  readonly code = 'identity_resolution_failed' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IdentityResolutionError';
  }
}

export type IdentityResolverDeps = {
  /** Injectable Slack→Zoho identity lookup (defaults to resolveSlackIdentity). */
  lookup?: (
    slackUserId: string
  ) => Promise<
    | {
        ok: true;
        auth: {
          staff: {
            EmployeeID: string;
            Email: string;
            FirstName?: string;
            LastName?: string;
            Position?: string;
          };
          slackUserId?: string;
        };
      }
    | { ok: false; message: string }
  >;
};

/**
 * Resolve Slack user → email → Zoho Employee ID.
 * Business tools must never call this directly — use getConversationContext().
 */
export function createIdentityResolver(
  deps: IdentityResolverDeps = {}
): IdentityResolver {
  const lookup = deps.lookup ?? resolveSlackIdentity;

  return {
    async resolveEmployee(slackUserId: string): Promise<ResolvedIdentity> {
      const id = slackUserId?.trim();
      if (!id) {
        throw new IdentityResolutionError('Missing Slack user id');
      }

      const result = await lookup(id);
      if (!result.ok) {
        throw new IdentityResolutionError(result.message);
      }

      const employeeId = result.auth.staff.EmployeeID?.trim();
      const slackEmail = result.auth.staff.Email?.trim().toLowerCase();
      if (!employeeId || !slackEmail) {
        throw new IdentityResolutionError(
          'Employee identity incomplete after Zoho lookup'
        );
      }

      const firstName = result.auth.staff.FirstName?.trim() || '';
      const lastName = result.auth.staff.LastName?.trim() || '';
      const position = result.auth.staff.Position?.trim() || '';
      const employeeName = `${firstName} ${lastName}`.trim() || undefined;

      return {
        slackUserId: id,
        slackEmail,
        employeeId,
        employeeName,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(position ? { position } : {}),
      };
    },
  };
}

let defaultResolver: IdentityResolver | null = null;

export function getDefaultIdentityResolver(): IdentityResolver {
  if (!defaultResolver) {
    defaultResolver = createIdentityResolver();
  }
  return defaultResolver;
}

export function resetDefaultIdentityResolver(): void {
  defaultResolver = null;
}
