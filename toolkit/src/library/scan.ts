// Scanning the chosen folder: finding packages → analysis (with a cache) → links between packages

import type { DirNode, FileNode } from './fs/nodes';
import type { Root } from './fs/access';
import { openFolder, openZip, type SrcEntry } from './fs/sources';
import { DESCRIPTOR_FILES, DESCRIPTOR_RANK, descriptorTypeOf, type DescriptorType } from './scorm/manifest';
import { ANALYZER_VERSION, analyzePackage } from './scorm/analyze';
import type { PackageInfo, ScanResult, SkippedItem } from './types';
import { cache } from './store/db';
import { mapLimit, plural } from './util';

export interface ScanProgress {
  phase: 'discover' | 'analyze';
  found: number;
  folders: number;
  done: number;
  total: number;
  current?: string;
}

type Candidate =
  | { kind: 'zip'; path: string; name: string; file: FileNode }
  | { kind: 'folder'; path: string; name: string; dir: DirNode; descriptor: DescriptorType; descFile: FileNode };

/** Service folders we do not enter */
const SKIP_DIR = /^(\.|__macosx$|node_modules$|\$recycle\.bin$|system volume information$)/i;

/** Step 1: walking the folders. A folder with a descriptor file is a course; we do not descend into it */
async function discover(
  root: DirNode,
  onProgress: (found: number, folders: number) => void,
  signal: AbortSignal,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let folders = 0;

  const visit = async (d: DirNode): Promise<void> => {
    if (signal.aborted) return;
    folders++;
    const { dirs, files } = await d.list();
    const lower = new Map(files.map((f) => [f.name.toLowerCase(), f]));

    for (const [fileName, type] of DESCRIPTOR_FILES) {
      const f = lower.get(fileName);
      if (f) {
        out.push({ kind: 'folder', path: d.path, name: d.name, dir: d, descriptor: type, descFile: f });
        onProgress(out.length, folders);
        return;
      }
    }
    const crs = files.find((f) => /\.crs$/i.test(f.name));
    if (crs) {
      out.push({ kind: 'folder', path: d.path, name: d.name, dir: d, descriptor: 'aicc', descFile: crs });
      onProgress(out.length, folders);
      return;
    }

    for (const f of files) {
      if (/\.zip$/i.test(f.name)) out.push({ kind: 'zip', path: f.path, name: f.name, file: f });
    }
    onProgress(out.length, folders);
    for (const sub of dirs) if (!SKIP_DIR.test(sub.name)) await visit(sub);
  };

  await visit(root);
  return out;
}

/** Looks for courses inside a ZIP: at the root or (by mistake) in subfolders */
function packagesInZip(entries: SrcEntry[]): { base: string; type: DescriptorType; path: string }[] {
  const best = new Map<string, { base: string; type: DescriptorType; path: string }>();
  for (const e of entries) {
    if (/(^|\/)__macosx\//i.test(e.path)) continue;
    const name = e.path.slice(e.path.lastIndexOf('/') + 1);
    const type = descriptorTypeOf(name);
    if (!type) continue;
    const base = e.path.slice(0, e.path.length - name.length);
    const prev = best.get(base);
    if (!prev || DESCRIPTOR_RANK[type] < DESCRIPTOR_RANK[prev.type]) best.set(base, { base, type, path: e.path });
  }
  // If a descriptor exists both in the folder and deeper — the deeper ones belong to the same course
  const sorted = [...best.values()].sort((a, b) => a.base.length - b.base.length);
  const kept: typeof sorted = [];
  for (const c of sorted) if (!kept.some((k) => c.base.startsWith(k.base))) kept.push(c);
  return kept;
}

interface CacheRecord {
  v: number;
  packages: PackageInfo[];
  skipped?: string;
}

export async function scan(
  root: Root,
  opts: { useCache: boolean; signal: AbortSignal; onProgress: (p: ScanProgress) => void },
): Promise<ScanResult> {
  const { signal, onProgress } = opts;
  const packages: PackageInfo[] = [];
  const skipped: SkippedItem[] = [];

  const candidates = await discover(
    root.node,
    (found, folders) => onProgress({ phase: 'discover', found, folders, done: 0, total: 0 }),
    signal,
  );

  let done = 0;
  const total = candidates.length;
  onProgress({ phase: 'analyze', found: total, folders: 0, done, total });

  await mapLimit(
    candidates,
    4,
    async (c) => {
      const displayPath = c.path || root.name;
      try {
        // File signature: if size and date are unchanged, take the result from the cache
        const probe = c.kind === 'zip' ? await c.file.getFile() : await c.descFile.getFile();
        const cacheKey = `${root.name}|${c.path}|${c.kind}|${probe.size}:${probe.lastModified}`;
        const cached = opts.useCache ? await cache.get<CacheRecord>(cacheKey) : undefined;

        if (cached && cached.v === ANALYZER_VERSION) {
          packages.push(...cached.packages);
          if (cached.skipped) skipped.push({ path: displayPath, reason: cached.skipped });
        } else if (c.kind === 'zip') {
          const source = await openZip(probe);
          try {
            const found = packagesInZip(source.entries);
            if (!found.length) {
              const zips = source.entries.filter((e) => /\.zip$/i.test(e.path)).length;
              const reason = zips
                ? `Holds ${plural(zips, 'ZIP file')} inside. Unpack it to scan them.`
                : 'No imsmanifest.xml, cmi5.xml or tincan.xml inside, so it is not an e-learning package.';
              skipped.push({ path: displayPath, reason });
              await cache.set(cacheKey, { v: ANALYZER_VERSION, packages: [], skipped: reason } satisfies CacheRecord);
            } else {
              const result: PackageInfo[] = [];
              for (const f of found) {
                result.push(
                  await analyzePackage({
                    source,
                    path: c.path,
                    name: c.name,
                    kind: 'zip',
                    base: f.base,
                    descriptor: { type: f.type, path: f.path },
                    siblings: found.length,
                    fileDate: probe.lastModified,
                  }),
                );
              }
              packages.push(...result);
              await cache.set(cacheKey, { v: ANALYZER_VERSION, packages: result } satisfies CacheRecord);
            }
          } finally {
            await source.close();
          }
        } else {
          const source = await openFolder(c.dir);
          const info = await analyzePackage({
            source,
            // If the course turned out to be the chosen folder itself, show its name
            path: c.path || root.name,
            name: c.name,
            kind: 'folder',
            base: '',
            descriptor: { type: c.descriptor, path: c.descFile.name },
            siblings: 1,
            fileDate: probe.lastModified,
          });
          packages.push(info);
          await cache.set(cacheKey, { v: ANALYZER_VERSION, packages: [info] } satisfies CacheRecord);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        skipped.push({
          path: displayPath,
          reason:
            c.kind === 'zip'
              ? `Could not read this ZIP. It may be damaged or not a real ZIP (${msg}).`
              : `Could not read this folder (${msg}).`,
        });
      } finally {
        done++;
        onProgress({ phase: 'analyze', found: total, folders: 0, done, total, current: displayPath });
      }
    },
    signal,
  );

  packages.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { rootName: root.name, scannedAt: Date.now(), packages, skipped, complete: !signal.aborted };
}
