import { z } from 'zod';

export const AgentDecisionSchema = z.object({
  intent: z.enum([
    'show_profile',
    'show_today',
    'show_week',
    'list_projects',
    'list_tasks',
    'show_leave',
    'show_holidays',
    'add_entry',
    'update_entry',
    'delete_entry',
    'clear_day',
    'confirm',
    'cancel',
    'correction',
    'override',
    'help',
    'unknown',
  ]),
  dateText: z.string().nullable().optional(),
  projectQuery: z.string().nullable().optional(),
  taskQuery: z.string().nullable().optional(),
  hours: z.number().nullable().optional(),
  clientQuery: z.string().nullable().optional(),
  correctionField: z.enum(['hours', 'project', 'task', 'date']).nullable().optional(),
  filterText: z.string().nullable().optional(),
  rawConfidence: z.number().min(0).max(1).optional(),
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export type AgentInput = {
  text: string;
  hasPendingWrite: boolean;
  lastDate?: string;
};
