// A "package source" — a single way to read course contents,
// whether it is a ZIP archive or an unpacked folder.

import { BlobReader, TextWriter, ZipReader, configure, type Entry, type FileEntry } from '@zip.js/zip.js/index-native.js';
import type { DirNode, FileNode } from './nodes';
import { mapLimit } from '../util';

// The index-native build uses the browser's built-in decompression (DecompressionStream)
// instead of WebAssembly: the strict Content Security Policy (CSP) of the page forbids WASM.
// Web workers (background threads) are not needed either: we read only the archive's table of contents
// and a couple of small text files.
configure({ useWebWorkers: false });

export interface SrcEntry {
  /** Path inside the package, always with forward slashes */
  path: string;
  size: number;
  /** Modification date, ms */
  date?: number;
}

export interface PackageSource {
  entries: SrcEntry[];
  /** Inside a ZIP the paths are written with a backslash (\) */
  backslashes: boolean;
  /** The archive is password-protected */
  encrypted: boolean;
  diskBytes: number;
  /** Reads a text file entirely; null — no such file or it is over the limit */
  readText(path: string, limit?: number): Promise<string | null>;
  close(): Promise<void>;
}

const DEFAULT_LIMIT = 4 * 1024 * 1024;

const isFileEntry = (e: Entry): e is FileEntry => !e.directory;

/**
 * Opens a ZIP without unpacking: zip.js reads only the table of contents at the end of the archive
 * (central directory) and extracts the needed files one by one.
 */
export async function openZip(file: File): Promise<PackageSource> {
  const reader = new ZipReader(new BlobReader(file));
  const raw = await reader.getEntries();
  const byPath = new Map<string, FileEntry>();
  const entries: SrcEntry[] = [];
  let backslashes = false;
  let encrypted = false;

  for (const e of raw) {
    if (!isFileEntry(e)) continue;
    let p = e.filename;
    if (p.includes('\\')) {
      backslashes = true;
      p = p.replace(/\\/g, '/');
    }
    p = p.replace(/^(\.\/|\/)+/, '');
    if (!p || p.endsWith('/')) continue;
    if (e.encrypted) encrypted = true;
    entries.push({ path: p, size: e.uncompressedSize, date: e.lastModDate?.getTime() });
    byPath.set(p, e);
  }

  return {
    entries,
    backslashes,
    encrypted,
    diskBytes: file.size,
    async readText(path, limit = DEFAULT_LIMIT) {
      const e = byPath.get(path);
      if (!e || e.encrypted || e.uncompressedSize > limit) return null;
      return e.getData(new TextWriter());
    },
    close: () => reader.close(),
  };
}

/** Opens an unpacked course folder: walks all nested files */
export async function openFolder(dir: DirNode): Promise<PackageSource> {
  const entries: SrcEntry[] = [];
  const nodes = new Map<string, FileNode>();
  let diskBytes = 0;

  const walk = async (d: DirNode, prefix: string): Promise<void> => {
    const { dirs, files } = await d.list();
    // The file size is available only through getFile(), so we request in parallel batches
    await mapLimit(files, 16, async (f) => {
      const file = await f.getFile();
      const p = prefix + f.name;
      entries.push({ path: p, size: file.size, date: file.lastModified });
      nodes.set(p, f);
      diskBytes += file.size;
    });
    for (const sub of dirs) await walk(sub, `${prefix}${sub.name}/`);
  };
  await walk(dir, '');

  return {
    entries,
    backslashes: false,
    encrypted: false,
    diskBytes,
    async readText(path, limit = DEFAULT_LIMIT) {
      const node = nodes.get(path);
      if (!node) return null;
      const file = await node.getFile();
      if (file.size > limit) return null;
      return file.text();
    },
    close: async () => {},
  };
}
