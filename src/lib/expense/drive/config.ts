/**
 * Naming and scope contract for a future Google Drive adapter.
 * No Drive client is constructed here, and no folders are created.
 *
 * Reuse the existing service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` and
 * `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) on the server only. Do not add this
 * scope to the Google Sheets client.
 *
 * Shared Drive files created by the app are not visible again under `drive.file`,
 * so later lookup and delete need the full Drive scope. The service account
 * must be a member of the company Shared Drive.
 */
export const EXPENSE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export const EXPENSE_DRIVE_ENV = {
  sharedDriveId: 'GOOGLE_DRIVE_SHARED_DRIVE_ID',
  expensesRootFolderId: 'GOOGLE_DRIVE_EXPENSES_ROOT_FOLDER_ID',
} as const;

export type ExpenseDriveConfig = {
  implemented: boolean;
  scope: typeof EXPENSE_DRIVE_SCOPE;
  sharedDriveId?: string;
  expensesRootFolderId?: string;
};

export function readExpenseDriveConfig(
  env: Record<string, string | undefined> = process.env
): ExpenseDriveConfig {
  const sharedDriveId = env[EXPENSE_DRIVE_ENV.sharedDriveId]?.trim();
  const expensesRootFolderId = env[EXPENSE_DRIVE_ENV.expensesRootFolderId]?.trim();

  return {
    implemented: Boolean(sharedDriveId && expensesRootFolderId),
    scope: EXPENSE_DRIVE_SCOPE,
    sharedDriveId: sharedDriveId || undefined,
    expensesRootFolderId: expensesRootFolderId || undefined,
  };
}
