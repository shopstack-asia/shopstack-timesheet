/** Prefer Slack envelope event_id; fall back only when unavailable. */
export function resolveSlackDedupeId(
  event: {
    client_msg_id?: string;
    event_ts?: string;
    channel?: string;
    ts?: string;
    user?: string;
  },
  envelopeEventId?: string
): string {
  return (
    envelopeEventId ||
    event.client_msg_id ||
    event.event_ts ||
    `${event.channel}:${event.ts}:${event.user}`
  );
}
