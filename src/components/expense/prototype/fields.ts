/** Closed control, matching `SearchableSelect` in the timesheet form. */
export function expenseInputClass(options?: {
  disabled?: boolean;
  invalid?: boolean;
  fullWidth?: boolean;
}): string {
  const disabled = options?.disabled ?? false;
  const invalid = options?.invalid ?? false;
  const width = options?.fullWidth === false ? '' : 'w-full';
  const state = disabled
    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed border-gray-300 dark:border-gray-700'
    : invalid
      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-red-500 dark:border-red-600 focus:ring-red-500 dark:focus:ring-red-600 focus:border-red-500'
      : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-600 focus:border-blue-500 dark:focus:border-blue-600';
  return `${width} px-3 py-2 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 [color-scheme:light] dark:[color-scheme:dark] ${state}`;
}

/** Matches the timesheet Submit Week button. */
export const expensePrimaryButtonClass =
  'px-6 py-3 bg-green-600 dark:bg-green-700 text-white font-semibold rounded-lg hover:bg-green-700 dark:hover:bg-green-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed shadow-md transition-colors text-sm';

/** Matches the timesheet Add Entry button. */
export const expenseSecondaryButtonClass =
  'px-3 py-2 text-sm rounded border bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-blue-200 dark:border-blue-800 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed';

export type ExpenseActionName = 'save' | 'submit' | 'cancel' | 'delete' | 'paid' | 'generate' | 'download' | 'print';

/** Label shown while that action is in flight, so the button cannot be read as ready. */
export function expenseBusyLabel(action: ExpenseActionName): string {
  switch (action) {
    case 'save':
      return 'Saving…';
    case 'submit':
      return 'Submitting…';
    case 'cancel':
      return 'Cancelling…';
    case 'delete':
      return 'Deleting…';
    case 'paid':
      return 'Marking paid…';
    case 'generate':
      return 'Generating…';
    case 'download':
      return 'Downloading…';
    case 'print':
      return 'Printing…';
  }
}

/** Matches an unselected timesheet day button. */
export const expenseNeutralButtonClass =
  'px-3 py-2 text-sm rounded-lg border font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors';
