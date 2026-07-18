import { NextRequest, NextResponse } from 'next/server';
import { assertDebugAccess } from '@/lib/debug-auth';
import { WebClient } from '@slack/web-api';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

// Helper function to get timesheet URL
function getTimesheetUrl(request: NextRequest): string {
  // Try environment variable first
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (appUrl) {
    return `${appUrl}/timesheet`;
  }
  
  // Fallback to request headers
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  if (host) {
    return `${protocol}://${host}/timesheet`;
  }
  
  // Default fallback
  return 'https://your-domain.com/timesheet';
}

export async function POST(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;
  try {
    // Check if Slack is configured
    if (!process.env.SLACK_BOT_TOKEN) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Slack is not configured. Please set SLACK_BOT_TOKEN in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Support both SLACK_CHANNEL_ID (single) and SLACK_CHANNEL_IDS (multiple, comma-separated)
    const channelIds = process.env.SLACK_CHANNEL_IDS 
      ? process.env.SLACK_CHANNEL_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
      : process.env.SLACK_CHANNEL_ID 
        ? [process.env.SLACK_CHANNEL_ID.trim()]
        : [];

    if (channelIds.length === 0) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'No Slack channels configured. Please set SLACK_CHANNEL_ID or SLACK_CHANNEL_IDS in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Parse request body for custom message (optional)
    let customMessage: string | null = null;
    try {
      const body = await request.json();
      customMessage = body.message || null;
    } catch {
      // No body provided, use default message
    }

    // Initialize Slack client
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

    // Get timesheet URL
    const timesheetUrl = getTimesheetUrl(request);

    // Prepare message
    const message = customMessage || 
      `<!channel> 🧪 Test Notification from Timesheet System\n\nThis is a test message sent at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}.\n\nIf you receive this message, Slack integration is working correctly! ✅\n\n<${timesheetUrl}|👉 Open Timesheet System>`;

    // Send message to all channels
    const results = await Promise.allSettled(
      channelIds.map((channelId) =>
        slack.chat.postMessage({
          channel: channelId,
          text: message,
        })
      )
    );

    // Process results
    const successful: Array<{ channel: string; timestamp: string }> = [];
    const failed: Array<{ channel: string; error: string }> = [];

    results.forEach((result, index) => {
      const channelId = channelIds[index];
      if (result.status === 'fulfilled') {
        successful.push({
          channel: channelId,
          timestamp: result.value.ts || '',
        });
      } else {
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failed.push({
          channel: channelId,
          error,
        });
      }
    });

    // Return response with results for all channels
    return NextResponse.json<ApiResponse<{
      configured: boolean;
      channels: Array<{ channel: string; success: boolean; timestamp?: string; error?: string }>;
      message: string;
    }>>({
      success: failed.length === 0,
      data: {
        configured: true,
        channels: [
          ...successful.map((s) => ({ channel: s.channel, success: true, timestamp: s.timestamp })),
          ...failed.map((f) => ({ channel: f.channel, success: false, error: f.error })),
        ],
        message: message,
      },
      ...(failed.length > 0 && {
        error: `Failed to send to ${failed.length} channel(s): ${failed.map(f => `${f.channel} (${f.error})`).join(', ')}`,
      }),
    });
  } catch (error) {
    console.error('Error sending Slack test notification:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Failed to send Slack notification';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check for common Slack API errors
      if (error.message.includes('invalid_auth')) {
        errorMessage = 'Invalid Slack Bot Token. Please check SLACK_BOT_TOKEN.';
      } else if (error.message.includes('channel_not_found')) {
        errorMessage = 'Slack channel not found. Please check SLACK_CHANNEL_ID or SLACK_CHANNEL_IDS.';
      } else if (error.message.includes('not_in_channel')) {
        errorMessage = 'Bot is not in the channel. Please invite the bot to the channel.';
      }
    }

    return NextResponse.json<ApiResponse<{ configured: boolean }>>(
      {
        success: false,
        error: errorMessage,
        data: { configured: true },
      },
      { status: 500 }
    );
  }
}

// Also support GET for easy testing
export async function GET(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;
  try {
    // Check if Slack is configured
    if (!process.env.SLACK_BOT_TOKEN) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Slack is not configured. Please set SLACK_BOT_TOKEN in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Support both SLACK_CHANNEL_ID (single) and SLACK_CHANNEL_IDS (multiple, comma-separated)
    const channelIds = process.env.SLACK_CHANNEL_IDS 
      ? process.env.SLACK_CHANNEL_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
      : process.env.SLACK_CHANNEL_ID 
        ? [process.env.SLACK_CHANNEL_ID.trim()]
        : [];

    if (channelIds.length === 0) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'No Slack channels configured. Please set SLACK_CHANNEL_ID or SLACK_CHANNEL_IDS in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Initialize Slack client
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

    // Get timesheet URL
    const timesheetUrl = getTimesheetUrl(request);

    // Prepare default test message
    const message = `<!channel> 🧪 Test Notification from Timesheet System\n\nThis is a test message sent at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}.\n\nIf you receive this message, Slack integration is working correctly! ✅\n\n<${timesheetUrl}|👉 Open Timesheet System>`;

    // Send message to all channels
    const results = await Promise.allSettled(
      channelIds.map((channelId) =>
        slack.chat.postMessage({
          channel: channelId,
          text: message,
        })
      )
    );

    // Process results
    const successful: Array<{ channel: string; timestamp: string }> = [];
    const failed: Array<{ channel: string; error: string }> = [];

    results.forEach((result, index) => {
      const channelId = channelIds[index];
      if (result.status === 'fulfilled') {
        successful.push({
          channel: channelId,
          timestamp: result.value.ts || '',
        });
      } else {
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failed.push({
          channel: channelId,
          error,
        });
      }
    });

    // Return response with results for all channels
    return NextResponse.json<ApiResponse<{
      configured: boolean;
      channels: Array<{ channel: string; success: boolean; timestamp?: string; error?: string }>;
      message: string;
    }>>({
      success: failed.length === 0,
      data: {
        configured: true,
        channels: [
          ...successful.map((s) => ({ channel: s.channel, success: true, timestamp: s.timestamp })),
          ...failed.map((f) => ({ channel: f.channel, success: false, error: f.error })),
        ],
        message: message,
      },
      ...(failed.length > 0 && {
        error: `Failed to send to ${failed.length} channel(s): ${failed.map(f => `${f.channel} (${f.error})`).join(', ')}`,
      }),
    });
  } catch (error) {
    console.error('Error sending Slack test notification:', error);
    
    let errorMessage = 'Failed to send Slack notification';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (error.message.includes('invalid_auth')) {
        errorMessage = 'Invalid Slack Bot Token. Please check SLACK_BOT_TOKEN.';
      } else if (error.message.includes('channel_not_found')) {
        errorMessage = 'Slack channel not found. Please check SLACK_CHANNEL_ID or SLACK_CHANNEL_IDS.';
      } else if (error.message.includes('not_in_channel')) {
        errorMessage = 'Bot is not in the channel. Please invite the bot to the channel.';
      }
    }

    return NextResponse.json<ApiResponse<{ configured: boolean }>>(
      {
        success: false,
        error: errorMessage,
        data: { configured: true },
      },
      { status: 500 }
    );
  }
}


