import { NextRequest, NextResponse } from 'next/server';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { WebClient } from '@slack/web-api';
import nodemailer from 'nodemailer';
import { ApiResponse } from '@/types';
import { refreshHolidayCache } from '@/lib/holiday-cache';
import { assertCronAuth } from '@/lib/cron-auth';
import { getConfiguredTimesheetUrl } from '@/lib/app-url';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function runFridayReminder(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'cron-friday-reminder',
    limit: 5,
    windowSeconds: 60,
  });
  if (!limited.ok) return limited.response;

  try {
    let timesheetUrl: string;
    try {
      timesheetUrl = getConfiguredTimesheetUrl();
    } catch (error) {
      console.error('[Friday Reminder] App URL configuration error:', error);
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Application URL is not configured',
        },
        { status: 500 }
      );
    }

    try {
      await refreshHolidayCache();
    } catch (error) {
      console.error('[Friday Reminder] Failed to refresh holiday cache:', error);
    }

    const zohoService = getZohoPeopleService();
    const employees = await zohoService.getAllEmployees();

    const employeesWithEmail = employees.filter(
      (emp) => emp.Email && emp.Email.endsWith('@shopstack.asia')
    );

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });

      const emailPromises = employeesWithEmail.map((employee) => {
        return transporter.sendMail({
          from: process.env.FROM_EMAIL || 'noreply@shopstack.asia',
          to: employee.Email,
          subject: 'Weekly Timesheet Reminder - Shopstack',
          html: `
            <h2>Weekly Timesheet Reminder</h2>
            <p>Hi ${employee.FirstName},</p>
            <p>This is a friendly reminder to submit your timesheet for this week (Monday - Friday).</p>
            <p>Please log in to the timesheet system and complete your entries.</p>
            <p><a href="${timesheetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px;">Open Timesheet System</a></p>
            <p>Thank you!</p>
            <p>Shopstack Team</p>
          `,
        });
      });

      await Promise.allSettled(emailPromises);
    }

    if (process.env.SLACK_BOT_TOKEN) {
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

      const channelIds = process.env.SLACK_CHANNEL_IDS
        ? process.env.SLACK_CHANNEL_IDS.split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : process.env.SLACK_CHANNEL_ID
          ? [process.env.SLACK_CHANNEL_ID.trim()]
          : [];

      if (channelIds.length > 0) {
        const message = `<!channel> 📅 Weekly Timesheet Reminder\n\nThis is a reminder for all Shopstack employees to submit their timesheets for this week (Monday - Friday).\n\nPlease log in to the timesheet system and complete your entries.\n\n<${timesheetUrl}|👉 Open Timesheet System>`;

        const slackPromises = channelIds.map((channelId) =>
          slack.chat
            .postMessage({
              channel: channelId,
              text: message,
            })
            .catch((error) => {
              console.error(`Failed to send Slack message to channel ${channelId}:`, error);
              return { success: false, channel: channelId, error };
            })
        );

        await Promise.allSettled(slackPromises);
      }
    }

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error sending Friday reminders:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to send reminders' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return runFridayReminder(request);
}

/**
 * Vercel Cron invokes GET. Destructive work still requires CRON_SECRET (fail closed).
 */
export async function GET(request: NextRequest) {
  return runFridayReminder(request);
}
