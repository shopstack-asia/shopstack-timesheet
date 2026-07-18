/**
 * Next.js instrumentation — runs once when the Node server starts.
 * Validates Slack env when Slack is configured for this deployment.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  const { assertSlackConfigOnStartup } = await import('@/lib/slack/config');
  try {
    assertSlackConfigOnStartup();
  } catch (error) {
    // Re-throw with message only (no secret values are included in SlackConfigError)
    console.error(
      '[startup] Slack configuration validation failed:',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
