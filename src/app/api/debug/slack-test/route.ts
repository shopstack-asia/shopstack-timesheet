import { NextRequest, NextResponse } from 'next/server';
import { assertDebugAccess } from '@/lib/debug-auth';
import { WebClient } from '@slack/web-api';
import { ApiResponse } from '@/types';
import { getConfiguredTimesheetUrl } from '@/lib/app-url';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'debug-slack',
    limit: 10,
    windowSeconds: 60,
    failOpen: false,
  });
  if (!limited.ok) return limited.response;

  try {
    if (!process.env.SLACK_BOT_TOKEN) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Slack is not configured.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    const channelIds = process.env.SLACK_CHANNEL_IDS
      ? process.env.SLACK_CHANNEL_IDS.split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : process.env.SLACK_CHANNEL_ID
        ? [process.env.SLACK_CHANNEL_ID.trim()]
        : [];

    if (channelIds.length === 0) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'No Slack channels configured.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    let timesheetUrl: string;
    try {
      timesheetUrl = getConfiguredTimesheetUrl();
    } catch {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Application URL is not configured' },
        { status: 500 }
      );
    }

    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    const message = `Test notification from Timesheet System.\n<${timesheetUrl}|Open Timesheet>`;

    const results = await Promise.allSettled(
      channelIds.map((channelId) =>
        slack.chat.postMessage({
          channel: channelId,
          text: message,
        })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;

    return NextResponse.json<ApiResponse<{ configured: boolean; sent: number; failed: number }>>({
      success: failed === 0,
      data: {
        configured: true,
        sent: results.length - failed,
        failed,
      },
      ...(failed > 0 ? { error: 'Failed to send to one or more channels' } : {}),
    });
  } catch (error) {
    console.error('Error sending Slack test notification:', error);
    return NextResponse.json<ApiResponse<{ configured: boolean }>>(
      {
        success: false,
        error: 'Failed to send Slack notification',
        data: { configured: true },
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
