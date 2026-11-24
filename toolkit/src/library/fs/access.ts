// Getting access to the user's folder: the picker dialog, permissions,
// a fallback through <input webkitdirectory> and drag & drop.

import { fromFiles, fromHandle, type DirNode, type LooseFile } from './nodes';

/** The chosen scan root */
export interface Root {
  name: string;
  node: DirNode;
  /** Only in Chrome/Edge — it can be saved so the folder need not be chosen again */
  handle?: FileSystemDirectoryHandle;
}

export const supportsPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export const supportsInputDirectory =
  typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');

/** The system folder-picker dialog (read-only). null — the user closed the dialog */
export async function pickDirectory(): Promise<Root | null> {
  try {
    const handle = await window.showDirectoryPicker!({ id: 'scorm-library', mode: 'read' });
    return { name: handle.name, node: fromHandle(handle), handle };
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** Checks, and if needed asks for, permission to read the saved folder */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  try {
    if ((await handle.queryPermission?.(opts)) === 'granted') return true;
    return (await handle.requestPermission?.(opts)) === 'granted';
  } catch {
    return false;
  }
}

/** Fallback folder choice for browsers without showDirectoryPicker */
export function pickWithInput(): Promise<Root | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.addEventListener('change', () => {
      const list = [...(input.files ?? [])];
      if (!list.length) return resolve(null);
      // webkitRelativePath looks like "Courses/sub/file.zip": the first segment is the folder name
      const rootName = list[0].webkitRelativePath.split('/')[0] || 'Selected folder';
      const items: LooseFile[] = list.map((file) => ({
        path: file.webkitRelativePath.split('/').slice(1).join('/'),
        file,
      }));
      resolve({ name: rootName, node: fromFiles(rootName, items) });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    // readEntries returns the contents in batches until it returns an empty array
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function collectEntry(entry: FileSystemEntry, prefix: string, out: LooseFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries(entry as FileSystemDirectoryEntry)) {
      await collectEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/**
 * Parses dropped items. Important: dataTransfer.items must be accessed
 * synchronously, in the drop event handler itself — afterwards they become unavailable.
 */
export function readDrop(dt: DataTransfer): Promise<Root | null> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  if (!items.length) return Promise.resolve(null);

  // Chrome/Edge: a single dropped directory gives a real handle that can be remembered
  const handlePromise =
    items.length === 1 && 'getAsFileSystemHandle' in items[0]
      ? items[0].getAsFileSystemHandle!()
      : null;
  const entries = items.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);

  return (async () => {
    if (handlePromise) {
      try {
        const handle = await handlePromise;
        if (handle?.kind === 'directory') {
          const dir = handle as FileSystemDirectoryHandle;
          return { name: dir.name, node: fromHandle(dir), handle: dir };
        }
      } catch {
        // fall back to the method below
      }
    }
    const out: LooseFile[] = [];
    if (entries.length === 1 && entries[0].isDirectory) {
      const dir = entries[0] as FileSystemDirectoryEntry;
      for (const child of await readAllEntries(dir)) await collectEntry(child, '', out);
      return { name: dir.name, node: fromFiles(dir.name, out) };
    }
    for (const e of entries) await collectEntry(e, '', out);
    if (!out.length) return null;
    const name = 'Dropped files';
    return { name, node: fromFiles(name, out) };
  })();
}
