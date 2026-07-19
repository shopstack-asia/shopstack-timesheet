/**
 * Deterministic Slack App Home Block Kit builder.
 * No fetching, identity resolution, OpenAI, or writes.
 */

import {
  APP_HOME_ACTION,
  APP_HOME_BLOCK,
  APP_HOME_MAX_BLOCKS,
  APP_HOME_MAX_SECTION_TEXT,
  APP_HOME_VALUE,
} from '@/lib/slack/app-home/constants';
import type { AppHomeViewModel } from '@/lib/slack/app-home/types';
import { formatHoursDisplay } from '@/lib/slack/app-home/week';

type SlackBlock = Record<string, unknown>;

export type SlackHomeView = {
  type: 'home';
  blocks: SlackBlock[];
};

function truncateText(text: string, max = APP_HOME_MAX_SECTION_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Escape Slack mrkdwn specials lightly (& < >). */
export function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function section(blockId: string, text: string): SlackBlock {
  return {
    type: 'section',
    block_id: blockId,
    text: {
      type: 'mrkdwn',
      text: truncateText(text),
    },
  };
}

function header(blockId: string, text: string): SlackBlock {
  return {
    type: 'header',
    block_id: blockId,
    text: {
      type: 'plain_text',
      text: text.slice(0, 150),
      emoji: true,
    },
  };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

function actionsBlock(
  blockId: string,
  elements: SlackBlock[]
): SlackBlock {
  return {
    type: 'actions',
    block_id: blockId,
    elements: elements.slice(0, 5),
  };
}

function button(opts: {
  actionId: string;
  text: string;
  value?: string;
  url?: string;
  style?: 'primary' | 'danger';
}): SlackBlock {
  const el: SlackBlock = {
    type: 'button',
    action_id: opts.actionId,
    text: {
      type: 'plain_text',
      text: opts.text.slice(0, 75),
      emoji: true,
    },
  };
  if (opts.value !== undefined) {
    el.value = opts.value;
  }
  if (opts.url) {
    el.url = opts.url;
  }
  if (opts.style) {
    el.style = opts.style;
  }
  return el;
}

const COMMAND_EXAMPLES = [
  'เมื่อวานฉันทำอะไร',
  'สรุปสัปดาห์นี้',
  'ฉันรับผิดชอบโปรเจกต์อะไรบ้าง',
  'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
  'แก้เวลางาน RMS วันนี้เป็น 5 ชั่วโมง',
  'ลบรายการ RMS วันนี้',
  'Employee ID ของฉันคืออะไร',
];

function buildActionElements(timesheetUrl?: string): SlackBlock[] {
  const elements: SlackBlock[] = [
    button({
      actionId: APP_HOME_ACTION.refresh,
      text: 'รีเฟรช',
      value: APP_HOME_VALUE.refresh,
      style: 'primary',
    }),
  ];
  if (timesheetUrl) {
    elements.push(
      button({
        actionId: APP_HOME_ACTION.openTimesheet,
        text: 'เปิด Weekly Timesheet',
        url: timesheetUrl,
      })
    );
  }
  elements.push(
    button({
      actionId: APP_HOME_ACTION.help,
      text: 'วิธีใช้งาน',
      value: APP_HOME_VALUE.help,
    })
  );
  return elements;
}

function buildRetryActions(): SlackBlock[] {
  return [
    button({
      actionId: APP_HOME_ACTION.retry,
      text: 'ลองใหม่',
      value: APP_HOME_VALUE.retry,
      style: 'primary',
    }),
  ];
}

function buildDashboardBlocks(model: Extract<AppHomeViewModel, { kind: 'dashboard' }>): SlackBlock[] {
  const name = model.displayName?.trim();
  const greeting = name
    ? `สวัสดีครับ คุณ ${escapeSlackMrkdwn(name)} 👋\nนี่คือภาพรวม Timesheet ของคุณ`
    : 'สวัสดีครับ 👋\nนี่คือภาพรวม Timesheet ของคุณ';

  const blocks: SlackBlock[] = [
    header(APP_HOME_BLOCK.header, 'AI Timesheet'),
    section(APP_HOME_BLOCK.greeting, greeting),
    divider(),
  ];

  // Week summary
  if (model.timesheet.status === 'error') {
    blocks.push(
      section(
        APP_HOME_BLOCK.weekSummary,
        '*สัปดาห์นี้*\nยังไม่สามารถโหลดข้อมูล Timesheet ได้ในขณะนี้\nกรุณากดลองใหม่อีกครั้ง'
      )
    );
  } else if (model.timesheet.status === 'empty') {
    blocks.push(
      section(
        APP_HOME_BLOCK.weekSummary,
        `*สัปดาห์นี้*\nสัปดาห์นี้ยังไม่มีรายการลงเวลา\n${escapeSlackMrkdwn(model.timesheet.weekLabel)}`
      )
    );
  } else {
    const hours = formatHoursDisplay(model.timesheet.totalHours);
    blocks.push(
      section(
        APP_HOME_BLOCK.weekSummary,
        `*สัปดาห์นี้*\nสัปดาห์นี้ลงเวลาแล้ว *${hours}* ชั่วโมง\n${escapeSlackMrkdwn(model.timesheet.weekLabel)}`
      )
    );
  }

  // Daily hours (only when we have day rows)
  if (model.timesheet.days.length > 0 && model.timesheet.status !== 'error') {
    const lines = model.timesheet.days.map((day) => {
      const h = formatHoursDisplay(day.hours);
      const label = `• ${day.weekdayLabel} ${day.dateLabel} — ${h} ชั่วโมง`;
      if (day.isToday) {
        return `*${label} (วันนี้)*`;
      }
      return label;
    });
    blocks.push(
      section(
        APP_HOME_BLOCK.dailyHours,
        `*รายวัน*\n${lines.join('\n')}`
      )
    );
  }

  blocks.push(divider());

  // Projects
  if (model.projects.status === 'error') {
    blocks.push(
      section(
        APP_HOME_BLOCK.projects,
        '*โปรเจกต์ที่รับผิดชอบ*\nยังไม่สามารถโหลดข้อมูลโปรเจกต์ได้ในขณะนี้'
      )
    );
  } else if (model.projects.status === 'empty') {
    blocks.push(
      section(
        APP_HOME_BLOCK.projects,
        '*โปรเจกต์ที่รับผิดชอบ*\nยังไม่พบโปรเจกต์ที่ได้รับมอบหมาย'
      )
    );
  } else {
    const lines = model.projects.projects.map(
      (p) =>
        `• ${escapeSlackMrkdwn(p.clientName)} — ${escapeSlackMrkdwn(p.projectName)}`
    );
    let body = lines.join('\n');
    if (model.projects.extraCount > 0) {
      body += `\nและอีก ${model.projects.extraCount} โปรเจกต์`;
    }
    blocks.push(
      section(
        APP_HOME_BLOCK.projects,
        `*โปรเจกต์ที่รับผิดชอบ*\n${body}`
      )
    );
  }

  blocks.push(divider());

  const commandLines = COMMAND_EXAMPLES.map((c) => `• ${c}`).join('\n');
  const commandsText = model.showHelpExpanded
    ? `*วิธีใช้งาน — ลองส่งข้อความหา AI Timesheet*\n${commandLines}\n\nเปิดแท็บ Messages แล้วพิมพ์คำสั่งด้านบนได้เลย`
    : `*ลองส่งข้อความหา AI Timesheet*\n${commandLines}`;
  blocks.push(section(APP_HOME_BLOCK.commands, commandsText));

  blocks.push(
    section(
      APP_HOME_BLOCK.safety,
      '_การเพิ่ม แก้ไข หรือลบ Timesheet ต้องยืนยันก่อนบันทึกทุกครั้ง_'
    )
  );

  blocks.push(
    actionsBlock(APP_HOME_BLOCK.actions, buildActionElements(model.timesheetUrl))
  );

  return blocks.slice(0, APP_HOME_MAX_BLOCKS);
}

function buildIdentityErrorBlocks(timesheetUrl?: string): SlackBlock[] {
  return [
    header(APP_HOME_BLOCK.header, 'AI Timesheet'),
    section(
      APP_HOME_BLOCK.error,
      '*ไม่สามารถเชื่อมโยงบัญชี Slack กับข้อมูลพนักงานได้*\nกรุณาติดต่อผู้ดูแลระบบ หรือลองเปิดหน้านี้ใหม่อีกครั้ง'
    ),
    actionsBlock(APP_HOME_BLOCK.actions, [
      ...buildRetryActions(),
      ...buildActionElements(timesheetUrl).filter(
        (el) => el.action_id !== APP_HOME_ACTION.refresh
      ),
    ]),
  ].slice(0, APP_HOME_MAX_BLOCKS);
}

function buildDependencyErrorBlocks(timesheetUrl?: string): SlackBlock[] {
  return [
    header(APP_HOME_BLOCK.header, 'AI Timesheet'),
    section(
      APP_HOME_BLOCK.error,
      'ยังไม่สามารถโหลดข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้งครับ'
    ),
    actionsBlock(APP_HOME_BLOCK.actions, [
      ...buildRetryActions(),
      ...buildActionElements(timesheetUrl).filter(
        (el) => el.action_id !== APP_HOME_ACTION.refresh
      ),
    ]),
  ].slice(0, APP_HOME_MAX_BLOCKS);
}

function buildLoadingBlocks(): SlackBlock[] {
  return [
    header(APP_HOME_BLOCK.header, 'AI Timesheet'),
    section(
      APP_HOME_BLOCK.loading,
      'กำลังโหลดข้อมูล Timesheet ของคุณ…'
    ),
  ];
}

/** Build a Slack Home tab view from a presentation model. */
export function buildAppHomeView(model: AppHomeViewModel): SlackHomeView {
  let blocks: SlackBlock[];
  if (model.kind === 'loading') {
    blocks = buildLoadingBlocks();
  } else if (model.kind === 'identity_error') {
    blocks = buildIdentityErrorBlocks(model.timesheetUrl);
  } else if (model.kind === 'dependency_error') {
    blocks = buildDependencyErrorBlocks(model.timesheetUrl);
  } else if (model.kind === 'dashboard') {
    blocks = buildDashboardBlocks(model);
  } else {
    blocks = buildDependencyErrorBlocks();
  }

  return {
    type: 'home',
    blocks,
  };
}

/** Modal view for Help (deterministic, no OpenAI). */
export function buildAppHomeHelpModal(): {
  type: 'modal';
  callback_id: string;
  title: { type: 'plain_text'; text: string };
  close: { type: 'plain_text'; text: string };
  blocks: SlackBlock[];
} {
  const commandLines = COMMAND_EXAMPLES.map((c) => `• ${c}`).join('\n');
  return {
    type: 'modal',
    callback_id: 'app_home_help_modal',
    title: { type: 'plain_text', text: 'วิธีใช้งาน' },
    close: { type: 'plain_text', text: 'ปิด' },
    blocks: [
      section(
        'app_home_help_body',
        `*ลองส่งข้อความหา AI Timesheet*\n${commandLines}\n\n_การเพิ่ม แก้ไข หรือลบ Timesheet ต้องยืนยันก่อนบันทึกทุกครั้ง_`
      ),
    ],
  };
}

/** Assert view has no identity leakage in button values / metadata. */
export function assertAppHomeViewSafe(view: SlackHomeView): void {
  const raw = JSON.stringify(view);
  if (raw.includes('private_metadata')) {
    throw new Error('App Home view must not use private_metadata');
  }
  const forbidden = [
    'employeeId',
    'EmployeeID',
    'staffId',
    'Staff ID',
    '@shopstack.asia',
  ];
  for (const f of forbidden) {
    if (raw.toLowerCase().includes(f.toLowerCase()) && f.includes('@')) {
      throw new Error(`App Home view must not embed ${f}`);
    }
  }
  // Scan action values
  for (const block of view.blocks) {
    if (block.type !== 'actions') continue;
    const elements = (block.elements as SlackBlock[]) || [];
    for (const el of elements) {
      const value = typeof el.value === 'string' ? el.value : '';
      if (
        value &&
        value !== APP_HOME_VALUE.refresh &&
        value !== APP_HOME_VALUE.help &&
        value !== APP_HOME_VALUE.retry
      ) {
        throw new Error(`Unsafe App Home button value: ${value}`);
      }
    }
  }
}
