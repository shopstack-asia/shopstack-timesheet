import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check if Slack is configured
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Slack is not configured. Please set SLACK_BOT_TOKEN and SLACK_CHANNEL_ID in environment variables.',
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

    // Prepare message
    const message = customMessage || 
      `🧪 Test Notification from Timesheet System\n\nThis is a test message sent at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}.\n\nIf you receive this message, Slack integration is working correctly! ✅`;

    // Send message to Slack
    const result = await slack.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      text: message,
    });

    return NextResponse.json<ApiResponse<{
      configured: boolean;
      messageSent: boolean;
      channel: string;
      timestamp: string;
      message: string;
    }>>({
      success: true,
      data: {
        configured: true,
        messageSent: true,
        channel: process.env.SLACK_CHANNEL_ID,
        timestamp: result.ts || '',
        message: message,
      },
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
        errorMessage = 'Slack channel not found. Please check SLACK_CHANNEL_ID.';
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
  try {
    // Check if Slack is configured
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Slack is not configured. Please set SLACK_BOT_TOKEN and SLACK_CHANNEL_ID in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Initialize Slack client
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

    // Prepare default test message
    const message = `🧪 Test Notification from Timesheet System\n\nThis is a test message sent at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}.\n\nIf you receive this message, Slack integration is working correctly! ✅`;

    // Send message to Slack
    const result = await slack.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      text: message,
    });

    return NextResponse.json<ApiResponse<{
      configured: boolean;
      messageSent: boolean;
      channel: string;
      timestamp: string;
      message: string;
    }>>({
      success: true,
      data: {
        configured: true,
        messageSent: true,
        channel: process.env.SLACK_CHANNEL_ID,
        timestamp: result.ts || '',
        message: message,
      },
    });
  } catch (error) {
    console.error('Error sending Slack test notification:', error);
    
    let errorMessage = 'Failed to send Slack notification';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (error.message.includes('invalid_auth')) {
        errorMessage = 'Invalid Slack Bot Token. Please check SLACK_BOT_TOKEN.';
      } else if (error.message.includes('channel_not_found')) {
        errorMessage = 'Slack channel not found. Please check SLACK_CHANNEL_ID.';
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

