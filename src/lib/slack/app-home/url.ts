/**
 * Safe Weekly Timesheet URL for App Home link buttons.
 * No identity, tokens, or query params.
 */

/**
 * Returns an HTTPS (production) or http/https (non-prod) `/timesheet` URL,
 * or undefined when config is missing/unsafe.
 */
export function getSafeAppHomeTimesheetUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  try {
    const raw =
      env.NEXT_PUBLIC_APP_URL?.trim() ||
      env.APP_URL?.trim() ||
      env.NEXTAUTH_URL?.trim() ||
      '';
    if (!raw) return undefined;

    const url = new URL(raw);
    // Normalize to origin + /timesheet only
    const timesheet = new URL('/timesheet', url.origin);

    if (timesheet.search || timesheet.hash) {
      return undefined;
    }
    const isProd =
      (env.NODE_ENV || '').trim() === 'production' ||
      (env.VERCEL_ENV || '').trim() === 'production';
    if (isProd && timesheet.protocol !== 'https:') {
      return undefined;
    }
    if (timesheet.protocol !== 'http:' && timesheet.protocol !== 'https:') {
      return undefined;
    }
    return `${timesheet.origin}/timesheet`;
  } catch {
    return undefined;
  }
}
