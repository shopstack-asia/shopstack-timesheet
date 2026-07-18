import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { ApiResponse } from '@/types';
import { assertDebugAccess } from '@/lib/debug-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'debug-email',
    limit: 10,
    windowSeconds: 60,
  });
  if (!limited.ok) return limited.response;

  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Email is not configured.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    let toEmail: string | null = null;
    try {
      const body = await request.json();
      toEmail = typeof body.to === 'string' ? body.to : null;
    } catch {
      // no body
    }

    if (!toEmail || !toEmail.toLowerCase().endsWith('@shopstack.asia')) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'A @shopstack.asia recipient is required in the "to" field.',
        },
        { status: 400 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const emailSubject = 'Test Email from Timesheet System';
    const emailMessage = `
      <h2>Test Email from Timesheet System</h2>
      <p>This is a fixed-template test email.</p>
    `;

    await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: toEmail,
      subject: emailSubject,
      html: emailMessage,
    });

    return NextResponse.json<ApiResponse<{ configured: boolean; emailSent: boolean }>>({
      success: true,
      data: { configured: true, emailSent: true },
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    return NextResponse.json<ApiResponse<{ configured: boolean }>>(
      {
        success: false,
        error: 'Failed to send email',
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
