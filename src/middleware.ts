export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/timesheet/:path*', '/api/timesheet/:path*', '/api/master/:path*', '/api/staff/:path*'],
};

