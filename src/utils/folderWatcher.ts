import { ParsedGcodeData } from '../types';
import { parseGcodeFile, syncParsedGcodeColorsWithThumbnail } from './gcodeParser';

export interface FolderGcodeEntry {
  name: string;
  lastModified: number;
  sizeBytes: number;
  parsed: ParsedGcodeData;
}

const DB_NAME = 'elegoo_cc2_folder_db';
const STORE_NAME = 'directory_handles';
const GCODE_HANDLE_KEY = 'watched_gcode_dir';
const COST_PDF_HANDLE_KEY = 'desktop_cost_pdf_dir';

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandleToIdb(
  handle: FileSystemDirectoryHandle,
  key: string = GCODE_HANDLE_KEY
): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB storage failures
  }
}

export async function loadDirectoryHandleFromIdb(
  key: string = GCODE_HANDLE_KEY
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearDirectoryHandleFromIdb(
  key: string = GCODE_HANDLE_KEY
): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export { GCODE_HANDLE_KEY, COST_PDF_HANDLE_KEY };

export function isGcodeFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.gcode') || lower.endsWith('.gco') || lower.endsWith('.g');
}

export async function scanDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle
): Promise<FolderGcodeEntry[]> {
  const entries: FolderGcodeEntry[] = [];
  const asyncIterable = dirHandle as unknown as {
    values: () => AsyncIterable<FileSystemHandle>;
  };

  for await (const entry of asyncIterable.values()) {
    if (entry.kind === 'file' && isGcodeFileName(entry.name)) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.text();
      const rawParsed = parseGcodeFile(content, file.name, file.size);
      const parsed = await syncParsedGcodeColorsWithThumbnail(rawParsed);
      entries.push({
        name: file.name,
        lastModified: file.lastModified,
        sizeBytes: file.size,
        parsed
      });
    }
  }

  entries.sort((a, b) => b.lastModified - a.lastModified);
  return entries;
}

export async function parseFileListToFolderEntries(files: FileList): Promise<FolderGcodeEntry[]> {
  const entries: FolderGcodeEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isGcodeFileName(file.name)) {
      const content = await file.text();
      const rawParsed = parseGcodeFile(content, file.name, file.size);
      const parsed = await syncParsedGcodeColorsWithThumbnail(rawParsed);
      entries.push({
        name: file.name,
        lastModified: file.lastModified,
        sizeBytes: file.size,
        parsed
      });
    }
  }
  entries.sort((a, b) => b.lastModified - a.lastModified);
  return entries;
}
