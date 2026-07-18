import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    async get<T>(key: string): Promise<T | null> {
      const v = store.get(key);
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    },
    async setex(key: string, _seconds: number, value: string) {
      store.set(key, value);
    },
    async setNx(key: string, value: string) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async del(key: string) {
      store.delete(key);
    },
  }),
}));

import {
  claimPendingWrite,
  completePendingWrite,
  createPendingWrite,
  getPendingWrite,
} from '@/lib/timesheet-agent/conversation-state';

describe('confirmation pending write', () => {
  beforeEach(() => {
    store.clear();
  });

  it('confirm once then second claim fails', async () => {
    const p = await createPendingWrite({
      employeeId: 'S1',
      slackUserId: 'U1',
      channelId: 'C1',
      threadTs: '123.456',
      operation: 'submit_day_timesheet',
      payload: { date: '2026-07-14', entries: [{ projectId: '1', taskId: '1', hours: 2 }] },
      warnings: [],
      summaryText: 'sum',
    });
    const first = await claimPendingWrite(p.id, 'U1');
    expect(first?.status).toBe('executing');
    const second = await claimPendingWrite(p.id, 'U1');
    expect(second).toBeNull();
  });

  it('wrong user cannot claim', async () => {
    const p = await createPendingWrite({
      employeeId: 'S1',
      slackUserId: 'U1',
      channelId: 'C1',
      threadTs: '123.456',
      operation: 'clear_day_timesheet',
      payload: { date: '2026-07-14', entries: [] },
      warnings: [],
      summaryText: 'sum',
    });
    await expect(claimPendingWrite(p.id, 'U2')).rejects.toThrow('WRONG_USER');
  });

  it('cancel completes', async () => {
    const p = await createPendingWrite({
      employeeId: 'S1',
      slackUserId: 'U1',
      channelId: 'C1',
      threadTs: '123.457',
      operation: 'submit_day_timesheet',
      payload: { date: '2026-07-14', entries: [{ projectId: '1', taskId: '1', hours: 1 }] },
      warnings: [],
      summaryText: 'sum',
    });
    await completePendingWrite(p.id, 'cancelled');
    const got = await getPendingWrite(p.id);
    expect(got).toBeNull();
  });
});
