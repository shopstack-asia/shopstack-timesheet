import { Readable } from 'stream';
import { google } from 'googleapis';
import { EXPENSE_DRIVE_SCOPE, readExpenseDriveConfig } from '@/lib/expense/drive/config';

const FOLDER_TYPE = 'application/vnd.google-apps.folder';

export function expenseDrivePath(requestNumber: string): { year: string; name: string } {
  const match = /^EXP-(\d{4})-\d{6}$/.exec(requestNumber);
  if (!match) throw new Error('Request number is invalid');
  return { year: match[1], name: requestNumber };
}

function driveFailure(action: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Google Drive request failed';
  return new Error(`Could not ${action}: ${message}`);
}

/** Ids to remove: the stored id, plus any same-named file still in the expense folder. */
export function driveFilesToRemove(input: {
  storedFileId: string;
  fileName: string;
  listed: readonly { id?: string | null; name?: string | null }[];
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(input.storedFileId);
  for (const file of input.listed) {
    if (file.name === input.fileName) add(file.id);
  }
  return ids;
}
export function isMissingDriveFile(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown; response?: { status?: unknown } };
  if (record.code === 404 || record.code === '404' || record.response?.status === 404) return true;
  return typeof record.message === 'string' && record.message.includes('File not found');
}

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Google Drive credentials are missing');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: [EXPENSE_DRIVE_SCOPE],
  });
  return google.drive({ version: 'v3', auth });
}

async function findFolder(parentId: string, name: string, sharedDriveId: string): Promise<string | null> {
  const drive = driveClient();
  const listed = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = '${FOLDER_TYPE}' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'drive',
    driveId: sharedDriveId,
    pageSize: 1,
  });
  return listed.data.files?.[0]?.id ?? null;
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const drive = driveClient();
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_TYPE, parents: [parentId] },
    supportsAllDrives: true,
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Google Drive did not return a folder id');
  return created.data.id;
}

/** Creates Expenses/YYYY/EXP-YYYY-NNNNNN when it is missing and returns that folder id. */
export async function ensureExpenseFolder(requestNumber: string): Promise<string> {
  const config = readExpenseDriveConfig();
  if (!config.implemented || !config.expensesRootFolderId || !config.sharedDriveId) {
    throw new Error('Google Drive is not configured');
  }
  const path = expenseDrivePath(requestNumber);
  try {
    const yearId =
      (await findFolder(config.expensesRootFolderId, path.year, config.sharedDriveId)) ??
      (await createFolder(config.expensesRootFolderId, path.year));
    return (
      (await findFolder(yearId, path.name, config.sharedDriveId)) ?? (await createFolder(yearId, path.name))
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not ')) throw error;
    throw driveFailure(`create folder ${requestNumber}`, error);
  }
}

export async function uploadExpenseFile(input: {
  requestNumber: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<string> {
  try {
    const folderId = await ensureExpenseFolder(input.requestNumber);
    const drive = driveClient();
    const created = await drive.files.create({
      requestBody: { name: input.fileName, parents: [folderId] },
      media: { mimeType: input.mimeType, body: Readable.from(input.bytes) },
      supportsAllDrives: true,
      fields: 'id',
    });
    if (!created.data.id) throw new Error('Google Drive did not return a file id');
    return created.data.id;
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Could not ') || error.message.startsWith('Google Drive'))) {
      throw error;
    }
    throw driveFailure(`upload ${input.fileName}`, error);
  }
}

export function isDrivePermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown; response?: { status?: unknown } };
  const denied = record.code === 403 || record.code === '403' || record.response?.status === 403;
  return denied && typeof record.message === 'string' && /permission/i.test(record.message);
}

/** Shared Drive permanent delete returns "File not found" for a Content manager, even when the item is still listed. */
export function driveDeleteNeedsTrash(error: unknown): boolean {
  return isMissingDriveFile(error) || isDrivePermissionDenied(error);
}

/** Permanently deletes a Shared Drive item. A Content manager who cannot purge it is moved to trash instead. */
async function removeDriveItem(fileId: string, action: string): Promise<void> {
  const drive = driveClient();
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (error) {
    if (!driveDeleteNeedsTrash(error)) throw driveFailure(action, error);
    try {
      await drive.files.update({
        fileId,
        supportsAllDrives: true,
        requestBody: { trashed: true },
      });
    } catch (trashError) {
      if (isMissingDriveFile(trashError)) return;
      throw driveFailure(action, trashError);
    }
  }
}

export async function deleteExpenseFile(fileId: string): Promise<void> {
  await removeDriveItem(fileId, 'delete the attachment from Google Drive');
}

/** Removes Expenses/YYYY/EXP-YYYY-NNNNNN. The year folder stays. A missing folder is already gone. */
export async function deleteExpenseFolder(requestNumber: string): Promise<void> {
  const config = readExpenseDriveConfig();
  if (!config.implemented || !config.sharedDriveId || !config.expensesRootFolderId) return;
  const path = expenseDrivePath(requestNumber);
  try {
    const yearId = await findFolder(config.expensesRootFolderId, path.year, config.sharedDriveId);
    const folderId = yearId ? await findFolder(yearId, path.name, config.sharedDriveId) : null;
    if (!folderId) return;
    await removeDriveItem(folderId, `delete folder ${path.name} from Google Drive`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not ')) throw error;
    throw driveFailure(`delete folder ${path.name} from Google Drive`, error);
  }
}

async function listNamedFiles(
  parentId: string,
  fileName: string,
  sharedDriveId: string
): Promise<Array<{ id?: string | null; name?: string | null }>> {
  const drive = driveClient();
  const safeName = fileName.replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and trashed = false`,
    fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'drive',
    driveId: sharedDriveId,
    pageSize: 20,
  });
  return listed.data.files ?? [];
}

/** Deletes the stored Drive id and any file of the same name in Expenses/YYYY/EXP-YYYY-NNNNNN. */
export async function deleteExpenseUpload(input: {
  requestNumber: string;
  fileName: string;
  fileId: string;
}): Promise<void> {
  const config = readExpenseDriveConfig();
  if (!config.implemented || !config.sharedDriveId || !config.expensesRootFolderId) {
    if (input.fileId) await deleteExpenseFile(input.fileId);
    return;
  }
  const path = expenseDrivePath(input.requestNumber);
  const yearId = await findFolder(config.expensesRootFolderId, path.year, config.sharedDriveId);
  const folderId = yearId ? await findFolder(yearId, path.name, config.sharedDriveId) : null;
  const listed = folderId ? await listNamedFiles(folderId, input.fileName, config.sharedDriveId) : [];
  const ids = driveFilesToRemove({ storedFileId: input.fileId, fileName: input.fileName, listed });
  for (const id of ids) {
    await deleteExpenseFile(id);
  }
}
