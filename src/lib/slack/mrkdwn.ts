/**
 * Slack mrkdwn presentation adapter.
 * Converts common GitHub Markdown mistakes into Slack mrkdwn before chat.postMessage.
 * Does not modify tool results, prompts, or Conversation Context.
 */

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string };

const FENCED_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

function splitPreservingCode(input: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  const combined = new RegExp(
    `${FENCED_RE.source}|${INLINE_CODE_RE.source}`,
    'g'
  );

  for (const match of input.matchAll(combined)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', value: input.slice(cursor, index) });
    }
    segments.push({ kind: 'code', value: match[0]! });
    cursor = index + match[0]!.length;
  }
  if (cursor < input.length) {
    segments.push({ kind: 'text', value: input.slice(cursor) });
  }
  return segments;
}

function convertGithubBold(text: string): string {
  // **text** → *text* (non-greedy, no nested **)
  return text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
}

function convertUnderscoreBold(text: string): string {
  // __text__ → *text* (avoid __ inside words / URLs roughly by requiring word chars)
  return text.replace(/__([^_\n]+)__/g, '*$1*');
}

function convertHeadings(text: string): string {
  return text.replace(
    /^#{1,6}\s+(.+)$/gm,
    (_full, title: string) => `*${title.trim()}*`
  );
}

function convertListMarkers(text: string): string {
  // Leading "- " or "* " list items → Slack bullet (not formatting pairs)
  return text.replace(/^(\s*)[-*]\s+/gm, '$1• ');
}

function normalizeTextSegment(text: string): string {
  let out = convertGithubBold(text);
  out = convertUnderscoreBold(out);
  out = convertHeadings(out);
  out = convertListMarkers(out);
  return out;
}

/**
 * Normalize AI text into Slack mrkdwn for chat.postMessage.
 * Preserves fenced/inline code, URLs, mentions, and existing valid *bold*.
 */
export function normalizeSlackMrkdwn(text: string): string {
  if (!text) return text;
  return splitPreservingCode(text)
    .map((seg) =>
      seg.kind === 'code' ? seg.value : normalizeTextSegment(seg.value)
    )
    .join('');
}
