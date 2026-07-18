import { AgentDecision, AgentDecisionSchema, AgentInput } from '@/lib/timesheet-agent/schemas';

export interface AgentModel {
  extractIntent(input: AgentInput): Promise<AgentDecision>;
}

function ruleBasedExtract(input: AgentInput): AgentDecision | null {
  const t = input.text.trim();
  const lower = t.toLowerCase();

  if (/^(yes|y|confirm|ok|save|ยืนยัน)$/i.test(t)) {
    return { intent: 'confirm', rawConfidence: 1 };
  }
  if (/^(cancel|no|never\s*mind|abort|ยกเลิก)$/i.test(t)) {
    return { intent: 'cancel', rawConfidence: 1 };
  }
  if (/^clear$/i.test(t) || /^CLEAR$/.test(t)) {
    return { intent: 'confirm', rawConfidence: 1 }; // keyword confirm for clear pending
  }
  if (/^override$/i.test(t) || /^OVERRIDE$/.test(t)) {
    return { intent: 'override', rawConfidence: 1 };
  }
  if (/^create\s+project$/i.test(t) || t === 'CREATE PROJECT') {
    return { intent: 'confirm', rawConfidence: 1 };
  }
  if (/help|ช่วย|commands/i.test(lower) && lower.length < 40) {
    return { intent: 'help', rawConfidence: 0.9 };
  }
  if (/who am i|my profile|โปรไฟล์/i.test(lower)) {
    return { intent: 'show_profile', rawConfidence: 0.9 };
  }
  if (/this week|สัปดาห์นี้|what did i log/i.test(lower)) {
    return { intent: 'show_week', rawConfidence: 0.85 };
  }
  if (/today|วันนี้/.test(lower) && /log|timesheet|ชั่วโมง|entries|entry/.test(lower)) {
    return { intent: 'show_today', dateText: 'today', rawConfidence: 0.8 };
  }
  if (/^show today|^today'?s timesheet/i.test(lower)) {
    return { intent: 'show_today', dateText: 'today', rawConfidence: 0.9 };
  }
  if (/list projects|show projects|โครงการ|projects\??$/i.test(lower)) {
    return { intent: 'list_projects', filterText: null, rawConfidence: 0.85 };
  }
  if (/list tasks|show tasks|งานที่มี|tasks\??$/i.test(lower)) {
    return { intent: 'list_tasks', rawConfidence: 0.85 };
  }
  if (/holiday|วันหยุด/.test(lower)) {
    return { intent: 'show_holidays', rawConfidence: 0.8 };
  }
  if (/\bleave\b|ลา\b|on leave/i.test(lower)) {
    return { intent: 'show_leave', rawConfidence: 0.8 };
  }
  if (/clear\s+(friday|monday|tuesday|wednesday|thursday|saturday|sunday|today|yesterday)/i.test(lower)) {
    const m = lower.match(/clear\s+(\w+)/);
    return { intent: 'clear_day', dateText: m?.[1] || 'today', rawConfidence: 0.85 };
  }
  if (/remove|delete|ลบ/.test(lower)) {
    return {
      intent: 'delete_entry',
      dateText: /yesterday|เมื่อวาน/.test(lower) ? 'yesterday' : /today|วันนี้/.test(lower) ? 'today' : null,
      projectQuery: null,
      taskQuery: null,
      rawConfidence: 0.6,
    };
  }
  if (/change|update|แก้|เปลี่ยน/.test(lower) && /hour|ชั่วโมง|\d/.test(lower)) {
    return { intent: 'update_entry', rawConfidence: 0.55 };
  }

  // Thai / English add hours pattern: ... N ชั่วโมง / N hours
  const hoursMatch =
    lower.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|ชั่วโมง|ชม\.?)/i) ||
    lower.match(/(?:hours?|ชั่วโมง)\s*(\d+(?:\.\d+)?)/i);
  if (hoursMatch && (/log|add|ทำ|บันทึก|entry|ทำงาน|เมื่อวาน|yesterday|today|วันนี้/.test(lower))) {
    const hours = parseFloat(hoursMatch[1]);
    let dateText: string | null = null;
    if (/yesterday|เมื่อวาน/.test(lower)) dateText = 'yesterday';
    else if (/today|วันนี้/.test(lower)) dateText = 'today';
    else if (/tomorrow|พรุ่งนี้/.test(lower)) dateText = 'tomorrow';

    let projectQuery: string | null = null;
    let taskQuery: string | null = null;

    const taskM = input.text.match(/(?:งาน|task)\s*[:\-]?\s*([^\d\n]+?)(?:\s*$|\s+\d)/i);
    if (taskM) taskQuery = taskM[1].trim();

    const projM = input.text.match(
      /(?:ทำ|on|project|โครงการ)\s+([A-Za-z0-9][A-Za-z0-9 \-_/.]+?)(?:\s+\d|\s+ชั่วโมง|\s+hours|\s+งาน|\s+task)/i
    );
    if (projM) projectQuery = projM[1].trim();

    // "เมื่อวานทำ Hertz 8 ชั่วโมง งาน Development"
    if (!projectQuery) {
      const th = input.text.match(/ทำ\s+(.+?)\s+\d+(?:\.\d+)?\s*ชั่วโมง/i);
      if (th) projectQuery = th[1].trim();
    }
    if (!taskQuery) {
      const tht = input.text.match(/งาน\s+(.+)$/i);
      if (tht) taskQuery = tht[1].trim();
    }

    return {
      intent: 'add_entry',
      dateText,
      hours,
      projectQuery,
      taskQuery,
      rawConfidence: 0.75,
    };
  }

  if (input.hasPendingWrite && /actually|make it|correction|แก้เป็น|เปลี่ยนเป็น/i.test(lower)) {
    const hm = lower.match(/(\d+(?:\.\d+)?)/);
    return {
      intent: 'correction',
      correctionField: 'hours',
      hours: hm ? parseFloat(hm[1]) : null,
      rawConfidence: 0.7,
    };
  }

  return null;
}

export class OpenAICompatibleModel implements AgentModel {
  async extractIntent(input: AgentInput): Promise<AgentDecision> {
    const ruled = ruleBasedExtract(input);
    // High-confidence meta intents — skip LLM
    if (ruled && (ruled.rawConfidence ?? 0) >= 0.85 && ['confirm', 'cancel', 'override', 'help', 'show_profile', 'show_week', 'list_projects', 'list_tasks', 'show_holidays', 'show_leave', 'show_today', 'clear_day'].includes(ruled.intent)) {
      return AgentDecisionSchema.parse(ruled);
    }

    const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, '');
    const apiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL;

    if (!baseUrl || !apiKey || !model) {
      if (ruled) return AgentDecisionSchema.parse(ruled);
      return { intent: 'unknown', rawConfidence: 0 };
    }

    const system = `You extract Timesheet AI intents. Return ONLY JSON matching:
{"intent":"show_profile|show_today|show_week|list_projects|list_tasks|show_leave|show_holidays|add_entry|update_entry|delete_entry|clear_day|confirm|cancel|correction|override|help|unknown","dateText":string|null,"projectQuery":string|null,"taskQuery":string|null,"hours":number|null,"clientQuery":string|null,"correctionField":"hours"|"project"|"task"|"date"|null,"filterText":string|null,"rawConfidence":number}
Rules: Never invent project or task IDs. dateText like today/yesterday/ISO. hours numeric.`;

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: JSON.stringify({
                text: input.text,
                hasPendingWrite: input.hasPendingWrite,
                lastDate: input.lastDate ?? null,
              }),
            },
          ],
        }),
      });

      if (!res.ok) {
        if (ruled) return AgentDecisionSchema.parse(ruled);
        return { intent: 'unknown' };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || '{}';
      const parsed = AgentDecisionSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        if (ruled) return AgentDecisionSchema.parse(ruled);
        return { intent: 'unknown' };
      }
      // Merge rule-based hours/date if model omitted
      if (ruled?.hours && parsed.data.hours == null) {
        parsed.data.hours = ruled.hours;
      }
      if (ruled?.dateText && !parsed.data.dateText) {
        parsed.data.dateText = ruled.dateText;
      }
      return parsed.data;
    } catch {
      if (ruled) return AgentDecisionSchema.parse(ruled);
      return { intent: 'unknown' };
    }
  }
}

export function getAgentModel(): AgentModel {
  return new OpenAICompatibleModel();
}
