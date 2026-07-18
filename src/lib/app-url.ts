/**
 * Resolve the public application base URL without trusting Host headers.
 * Fails closed when configuration is missing.
 */
export function getConfiguredAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    '';

  if (!raw) {
    throw new Error(
      'Application URL is not configured. Set NEXT_PUBLIC_APP_URL or APP_URL.'
    );
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
    return url.origin;
  } catch {
    throw new Error(
      'Application URL is invalid. Set NEXT_PUBLIC_APP_URL or APP_URL to an absolute http(s) URL.'
    );
  }
}

export function getConfiguredTimesheetUrl(): string {
  return `${getConfiguredAppBaseUrl()}/timesheet`;
}
