import { NextRequest, NextResponse } from 'next/server';
import { assertDebugAccess } from '@/lib/debug-auth';
import axios from 'axios';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'debug-zoho-token',
    limit: 5,
    windowSeconds: 60,
  });
  if (!limited.ok) return limited.response;

  try {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json(
        { success: false, error: 'Zoho credentials are not configured' },
        { status: 400 }
      );
    }

    const response = await axios.post(
      'https://accounts.zoho.com/oauth/v2/token',
      null,
      {
        params: {
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        },
      }
    );

    if (!response.data.access_token) {
      console.error('[Zoho Token Test] No access token in response');
      return NextResponse.json(
        { success: false, error: 'Token refresh failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Token refreshed successfully',
      expiresIn: response.data.expires_in ?? null,
    });
  } catch (error) {
    console.error('[Zoho Token Test] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Token refresh failed' },
      { status: 500 }
    );
  }
}
