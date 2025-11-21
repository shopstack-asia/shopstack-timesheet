import { NextRequest, NextResponse } from 'next/server';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { WebClient } from '@slack/web-api';
import nodemailer from 'nodemailer';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

// Verify cron secret (set in environment variables)
const CRON_SECRET = process.env.CRON_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Get all employees from Zoho People
    const zohoService = getZohoPeopleService();
    const employees = await zohoService.getAllEmployees();

    // Filter employees with valid email addresses
    const employeesWithEmail = employees.filter(
      (emp) => emp.Email && emp.Email.endsWith('@shopstack.asia')
    );

    // Send email reminders
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
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
            <p>Thank you!</p>
            <p>Shopstack Team</p>
          `,
        });
      });

      await Promise.allSettled(emailPromises);
    }

    // Send Slack notification
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

      await slack.chat.postMessage({
        channel: process.env.SLACK_CHANNEL_ID,
        text: `📅 Weekly Timesheet Reminder\n\nThis is a reminder for all Shopstack employees to submit their timesheets for this week (Monday - Friday).\n\nPlease log in to the timesheet system and complete your entries.`,
      });
    }

    return NextResponse.json<ApiResponse<void>>({
      success: true,
    });
  } catch (error) {
    console.error('Error sending Friday reminders:', error);
    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send reminders',
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}

