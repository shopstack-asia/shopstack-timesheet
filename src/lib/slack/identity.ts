import { getSlackClient } from '@/lib/slack/client';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { AgentAuthContext, AgentAuthError } from '@/lib/timesheet/agent-auth';

export type SlackIdentityResult =
  | { ok: true; auth: AgentAuthContext }
  | { ok: false; message: string };

/**
 * Slack User ID → email → @shopstack.asia → Zoho StaffProfile → EmployeeID
 */
export async function resolveSlackIdentity(
  slackUserId: string
): Promise<SlackIdentityResult> {
  try {
    const slack = getSlackClient();
    const info = await slack.users.info({ user: slackUserId });
    if (!info.ok || !info.user) {
      return {
        ok: false,
        message:
          'I couldn’t read your Slack profile. Ask an admin to grant `users:read` and `users:read.email`.',
      };
    }
    if (info.user.is_bot || info.user.id === 'USLACKBOT') {
      return { ok: false, message: 'Bot users cannot use Timesheet AI.' };
    }

    const email =
      info.user.profile?.email?.trim().toLowerCase() ||
      (info.user as { email?: string }).email?.trim().toLowerCase();

    if (!email) {
      return {
        ok: false,
        message:
          'Your Slack account has no email visible to the bot. Enable email visibility and `users:read.email`.',
      };
    }

    if (!email.endsWith('@shopstack.asia')) {
      return {
        ok: false,
        message: `Slack email \`${email}\` is not @shopstack.asia. Timesheet AI is only for Shopstack employees.`,
      };
    }

    const zoho = getZohoPeopleService();
    const staff = await zoho.getEmployeeByEmail(email);
    if (!staff?.EmployeeID?.trim()) {
      return {
        ok: false,
        message: `No Zoho People employee found for \`${email}\`. You can’t use Timesheet until your profile exists in Zoho.`,
      };
    }

    const auth: AgentAuthContext = {
      staff,
      source: 'slack',
      slackUserId,
    };

    return { ok: true, auth };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Identity lookup failed';
    if (error instanceof AgentAuthError) {
      return { ok: false, message: error.message };
    }
    console.error('[SlackIdentity]', msg);
    return {
      ok: false,
      message: 'Could not verify your employee identity. Please try again later.',
    };
  }
}
