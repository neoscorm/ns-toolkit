// Course files for the Service Worker: from a ZIP (not unpacked to disk) or from a list of folder files

import { BlobReader, BlobWriter, ZipReader, configure, type FileEntry } from '@zip.js/zip.js/index-native.js';
import type { PackageFiles } from '../../shared/protocol';

// Browser built-in decompression, no WebAssembly and no background threads
configure({ useWebWorkers: false });

export interface FileSource {
  /** File contents by path from the course root; null — no such file */
  get(path: string): Promise<Blob | null>;
  /** A file with the same name but different letter case (for a hint in the log) */
  caseMatch(path: string): string | undefined;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  xsd: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
  swf: 'application/x-shockwave-flash',
  wasm: 'application/wasm',
};

export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/** How many unpacked files to keep in memory */
const CACHE_LIMIT = 300 * 1024 * 1024;

const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');

export async function openSource(files: PackageFiles): Promise<FileSource> {
  return files.kind === 'zip' ? zipSource(files.file, files.base) : folderSource(files.files);
}

function folderSource(list: { path: string; file: File }[]): FileSource {
  const map = new Map(list.map(({ path, file }) => [normalize(path), file]));
  const lower = new Map([...map.keys()].map((k) => [k.toLowerCase(), k]));
  return {
    get: async (path) => map.get(path) ?? null,
    caseMatch: (path) => lower.get(path.toLowerCase()),
    close: async () => {},
  };
}

async function zipSource(file: File, base: string): Promise<FileSource> {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const map = new Map<string, FileEntry>();
  for (const e of entries) {
    if (e.directory) continue;
    const p = normalize(e.filename);
    if (p.startsWith(base)) map.set(p.slice(base.length), e);
  }
  const lower = new Map([...map.keys()].map((k) => [k.toLowerCase(), k]));

  // Cache of unpacked files: Map keeps insertion order — the oldest are evicted first
  const cache = new Map<string, Promise<Blob>>();
  const sizes = new Map<string, number>();
  let cached = 0;

  async function extract(e: FileEntry): Promise<Blob> {
    const method = (e as unknown as { compressionMethod?: number }).compressionMethod;
    if (method === 0 && !e.encrypted) {
      // The file is stored uncompressed (video is often packed this way): serve a slice of the ZIP itself without copying.
      // The data starts after the local header: 30 bytes + name + extra field.
      const head = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      if (head.getUint32(0, true) === 0x04034b50) {
        const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        return file.slice(start, start + e.compressedSize);
      }
    }
    return e.getData(new BlobWriter());
  }

  return {
    async get(path) {
      const entry = map.get(path);
      if (!entry) return null;
      let pending = cache.get(path);
      if (!pending) {
        pending = extract(entry);
        cache.set(path, pending);
        let blob: Blob;
        try {
          blob = await pending;
        } catch (e) {
          cache.delete(path);
          throw e;
        }
        sizes.set(path, blob.size);
        cached += blob.size;
        for (const [key] of cache) {
          if (cached <= CACHE_LIMIT || key === path) break;
          cached -= sizes.get(key) ?? 0;
          cache.delete(key);
          sizes.delete(key);
        }
      }
      return pending;
    },
    caseMatch: (path) => lower.get(path.toLowerCase()),
    close: () => reader.close(),
  };
}
