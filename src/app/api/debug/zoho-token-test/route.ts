import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json({
        success: false,
        error: 'Missing Zoho credentials',
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken,
      }, { status: 400 });
    }

    console.log('[Zoho Token Test] Attempting to refresh token...');
    console.log('[Zoho Token Test] Client ID:', clientId.substring(0, 20) + '...');
    console.log('[Zoho Token Test] Refresh Token:', refreshToken.substring(0, 20) + '...');

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
      return NextResponse.json({
        success: false,
        error: 'No access token in response',
        response: response.data,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Token refreshed successfully',
      tokenPreview: response.data.access_token.substring(0, 20) + '...',
      expiresIn: response.data.expires_in,
      scope: response.data.scope || 'Not provided in response',
      apiDomain: response.data.api_domain || 'Not provided in response',
      warning: response.data.scope ? 
        'Check if scope includes ZohoPeople.employee.ALL or ZohoPeople.employees.READ' : 
        'No scope information in token response',
    });
  } catch (error: any) {
    console.error('[Zoho Token Test] Error:', error);
    
    let errorDetails: any = {
      message: error.message,
    };

    if (error.response) {
      errorDetails.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      };
    }

    return NextResponse.json({
      success: false,
      error: 'Failed to refresh token',
      details: errorDetails,
      troubleshooting: {
        checkRefreshToken: 'Verify ZOHO_REFRESH_TOKEN is correct and not expired',
        checkClientId: 'Verify ZOHO_CLIENT_ID matches the app that generated the refresh token',
        checkClientSecret: 'Verify ZOHO_CLIENT_SECRET is correct',
        regenerateToken: 'You may need to regenerate the refresh token from Zoho API Console',
      },
    }, { status: 500 });
  }
}

