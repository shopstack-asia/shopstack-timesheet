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
  wasEventProcessed,
} from '@/lib/timesheet-agent/conversation-state';

function basePending(overrides: Partial<Parameters<typeof createPendingWrite>[0]> = {}) {
  return createPendingWrite({
    employeeId: 'S1',
    slackUserId: 'U1',
    channelId: 'C1',
    threadTs: '123.456',
    operation: 'submit_day_timesheet',
    operationType: 'add',
    targetEntryKey: '1|1',
    targetEntry: { projectId: '1', taskId: '1', hours: 2 },
    baseSnapshot: [],
    payload: { date: '2026-07-14', entries: [{ projectId: '1', taskId: '1', hours: 2 }] },
    warnings: [],
    summaryText: 'sum',
    requireKeyword: 'YES',
    ...overrides,
  });
}

describe('atomic confirmation claim', () => {
  beforeEach(() => {
    store.clear();
  });

  it('concurrent claims: exactly one succeeds', async () => {
    const p = await basePending();
    const results = await Promise.all([
      claimPendingWrite(p.id, 'U1'),
      claimPendingWrite(p.id, 'U1'),
      claimPendingWrite(p.id, 'U1'),
    ]);
    const successes = results.filter((r) => r !== null);
    expect(successes).toHaveLength(1);
    expect(successes[0]?.status).toBe('executing');
  });

  it('wrong user confirmation', async () => {
    const p = await basePending();
    await expect(claimPendingWrite(p.id, 'U2')).rejects.toThrow('WRONG_USER');
  });

  it('expired / completed pending cannot claim', async () => {
    const p = await basePending();
    await completePendingWrite(p.id, 'cancelled');
    const again = await claimPendingWrite(p.id, 'U1');
    expect(again).toBeNull();
    expect(await getPendingWrite(p.id)).toBeNull();
  });

  it('dedupes slack event_id', async () => {
    expect(await wasEventProcessed('Ev123')).toBe(false);
    expect(await wasEventProcessed('Ev123')).toBe(true);
  });
});
