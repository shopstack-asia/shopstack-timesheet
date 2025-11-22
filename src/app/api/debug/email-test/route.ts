import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check if email is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Email is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Parse request body for custom email details (optional)
    let toEmail: string | null = null;
    let subject: string | null = null;
    let customMessage: string | null = null;
    
    try {
      const body = await request.json();
      toEmail = body.to || null;
      subject = body.subject || null;
      customMessage = body.message || null;
    } catch {
      // No body provided, use defaults
    }

    // Validate required fields
    if (!toEmail) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Email address is required. Please provide "to" field in request body.',
        },
        { status: 400 }
      );
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    // Prepare email content
    const emailSubject = subject || '🧪 Test Email from Timesheet System';
    const emailMessage = customMessage || `
      <h2>Test Email from Timesheet System</h2>
      <p>This is a test email sent at <strong>${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}</strong>.</p>
      <p>If you receive this email, email integration is working correctly! ✅</p>
      <hr>
      <p style="color: #666; font-size: 12px;">This is an automated test message from the Shopstack Timesheet System.</p>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: toEmail,
      subject: emailSubject,
      html: emailMessage,
    });

    return NextResponse.json<ApiResponse<{
      configured: boolean;
      emailSent: boolean;
      messageId: string;
      to: string;
      subject: string;
    }>>({
      success: true,
      data: {
        configured: true,
        emailSent: true,
        messageId: info.messageId || '',
        to: toEmail,
        subject: emailSubject,
      },
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Failed to send email';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check for common SMTP errors
      if (error.message.includes('Invalid login')) {
        errorMessage = 'Invalid SMTP credentials. Please check SMTP_USER and SMTP_PASSWORD.';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = `Cannot connect to SMTP server. Please check SMTP_HOST (${process.env.SMTP_HOST}) and SMTP_PORT (${process.env.SMTP_PORT || '587'}).`;
      } else if (error.message.includes('ETIMEDOUT')) {
        errorMessage = 'SMTP server connection timeout. Please check your network and SMTP settings.';
      } else if (error.message.includes('Invalid recipient')) {
        errorMessage = 'Invalid email address. Please check the "to" field.';
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

// Also support GET for easy testing (requires query params)
export async function GET(request: NextRequest) {
  try {
    // Check if email is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return NextResponse.json<ApiResponse<{ configured: boolean }>>(
        {
          success: false,
          error: 'Email is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in environment variables.',
          data: { configured: false },
        },
        { status: 400 }
      );
    }

    // Get email address from query params
    const searchParams = request.nextUrl.searchParams;
    const toEmail = searchParams.get('to');

    if (!toEmail) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Email address is required. Please provide "to" query parameter. Example: /api/debug/email-test?to=your-email@example.com',
        },
        { status: 400 }
      );
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    // Prepare email content
    const emailSubject = '🧪 Test Email from Timesheet System';
    const emailMessage = `
      <h2>Test Email from Timesheet System</h2>
      <p>This is a test email sent at <strong>${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}</strong>.</p>
      <p>If you receive this email, email integration is working correctly! ✅</p>
      <hr>
      <p style="color: #666; font-size: 12px;">This is an automated test message from the Shopstack Timesheet System.</p>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: toEmail,
      subject: emailSubject,
      html: emailMessage,
    });

    return NextResponse.json<ApiResponse<{
      configured: boolean;
      emailSent: boolean;
      messageId: string;
      to: string;
      subject: string;
    }>>({
      success: true,
      data: {
        configured: true,
        emailSent: true,
        messageId: info.messageId || '',
        to: toEmail,
        subject: emailSubject,
      },
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    
    let errorMessage = 'Failed to send email';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (error.message.includes('Invalid login')) {
        errorMessage = 'Invalid SMTP credentials. Please check SMTP_USER and SMTP_PASSWORD.';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = `Cannot connect to SMTP server. Please check SMTP_HOST (${process.env.SMTP_HOST}) and SMTP_PORT (${process.env.SMTP_PORT || '587'}).`;
      } else if (error.message.includes('ETIMEDOUT')) {
        errorMessage = 'SMTP server connection timeout. Please check your network and SMTP settings.';
      } else if (error.message.includes('Invalid recipient')) {
        errorMessage = 'Invalid email address. Please check the "to" parameter.';
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

