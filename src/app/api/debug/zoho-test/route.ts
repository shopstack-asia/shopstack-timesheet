import { NextRequest, NextResponse } from 'next/server';
import { getZohoPeopleService } from '@/lib/zoho-people';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get('email');

  try {
    if (!email) {
      return NextResponse.json({
        error: 'Please provide email parameter: ?email=test@shopstack.asia',
      }, { status: 400 });
    }

    // Test Zoho connection
    const zohoService = getZohoPeopleService();
    const staffProfile = await zohoService.getEmployeeByEmail(email);

    if (!staffProfile) {
      return NextResponse.json({
        success: false,
        message: `Employee not found in Zoho People for email: ${email}`,
        email: email,
        isShopstackDomain: email.endsWith('@shopstack.asia'),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Employee found in Zoho People',
      profile: {
        EmployeeID: staffProfile.EmployeeID,
        FirstName: staffProfile.FirstName,
        LastName: staffProfile.LastName,
        Email: staffProfile.Email,
        Position: staffProfile.Position,
      },
    });
  } catch (error: any) {
    console.error('Zoho test error:', error);
    
    let errorMessage = 'Unknown error';
    let errorDetails: any = {};
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = {
        message: error.message,
        stack: error.stack,
      };
    }
    
    if (error.response) {
      errorDetails.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      };
    }
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      troubleshooting: {
        checkCredentials: 'Verify ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in .env',
        checkDomain: `Current ZOHO_API_DOMAIN: ${process.env.ZOHO_API_DOMAIN || 'https://people.zoho.com'}`,
        checkEmail: email ? `Email tested: ${email}` : 'No email parameter provided',
      },
    }, { status: 500 });
  }
}

