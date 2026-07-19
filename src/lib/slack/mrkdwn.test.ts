import { describe, expect, it } from 'vitest';
import { normalizeSlackMrkdwn } from '@/lib/slack/mrkdwn';

describe('normalizeSlackMrkdwn', () => {
  it('converts GitHub bold to Slack bold', () => {
    expect(normalizeSlackMrkdwn('**รวมเวลา:** 10 ชั่วโมง')).toBe(
      '*รวมเวลา:* 10 ชั่วโมง'
    );
  });

  it('converts headings and list markers', () => {
    expect(
      normalizeSlackMrkdwn('### Summary\n- Hertz\n- Mitrphol')
    ).toBe('*Summary*\n• Hertz\n• Mitrphol');
  });

  it('leaves existing Slack bold unchanged', () => {
    expect(normalizeSlackMrkdwn('*10 ชั่วโมง*')).toBe('*10 ชั่วโมง*');
  });

  it('preserves inline code content', () => {
    expect(normalizeSlackMrkdwn('`const value = "**test**"`')).toBe(
      '`const value = "**test**"`'
    );
  });

  it('preserves fenced code blocks', () => {
    const input = 'Before\n```\n**keep**\n- list\n```\nAfter **bold**';
    expect(normalizeSlackMrkdwn(input)).toBe(
      'Before\n```\n**keep**\n- list\n```\nAfter *bold*'
    );
  });

  it('preserves URLs and Slack mentions', () => {
    const input = 'See <https://example.com|site> and <@U123456>';
    expect(normalizeSlackMrkdwn(input)).toBe(input);
  });

  it('converts underscore bold', () => {
    expect(normalizeSlackMrkdwn('__Total__ 10')).toBe('*Total* 10');
  });
});
