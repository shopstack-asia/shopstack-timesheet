import { describe, expect, it } from 'vitest';
import { expenseBusyLabel } from '@/components/expense/prototype/fields';

describe('expense action loading labels', () => {
  it('names every save and status action while it is running', () => {
    expect(expenseBusyLabel('save')).toBe('Saving…');
    expect(expenseBusyLabel('submit')).toBe('Submitting…');
    expect(expenseBusyLabel('cancel')).toBe('Cancelling…');
    expect(expenseBusyLabel('delete')).toBe('Deleting…');
    expect(expenseBusyLabel('paid')).toBe('Marking paid…');
    expect(expenseBusyLabel('generate')).toBe('Generating…');
    expect(expenseBusyLabel('download')).toBe('Downloading…');
    expect(expenseBusyLabel('print')).toBe('Printing…');
  });
});
