export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/timesheet/:path*',
    '/dashboard/:path*',
    '/expense/:path*',
    '/settings/:path*',
    '/api/timesheet/:path*',
    '/api/master/:path*',
    '/api/staff/:path*',
    '/api/expense/:path*',
    '/api/workspace/:path*',
    '/api/settings/:path*',
  ],
};

