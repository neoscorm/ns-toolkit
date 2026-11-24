// A single interface for walking folders.
// Two sources: real folder access (File System Access API in Chrome/Edge)
// and a "virtual tree" built from a list of files (fallback mode for Firefox/Safari).

export interface FileNode {
  kind: 'file';
  name: string;
  /** Path relative to the chosen folder */
  path: string;
  getFile(): Promise<File>;
}

export interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  list(): Promise<{ dirs: DirNode[]; files: FileNode[] }>;
}

/** A file with a path — this is how files arrive from <input webkitdirectory> and drag & drop */
export interface LooseFile {
  path: string;
  file: File;
}

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Walking a real folder through a handle */
export function fromHandle(handle: FileSystemDirectoryHandle, path = ''): DirNode {
  return {
    kind: 'dir',
    name: handle.name,
    path,
    async list() {
      const dirs: DirNode[] = [];
      const files: FileNode[] = [];
      for await (const child of handle.values()) {
        const childPath = join(path, child.name);
        if (child.kind === 'directory') {
          dirs.push(fromHandle(child as FileSystemDirectoryHandle, childPath));
        } else {
          const fh = child as FileSystemFileHandle;
          files.push({ kind: 'file', name: child.name, path: childPath, getFile: () => fh.getFile() });
        }
      }
      return { dirs, files };
    },
  };
}

interface VDir {
  dirs: Map<string, VDir>;
  files: Map<string, File>;
}

/** A virtual tree from a flat list of files with paths */
export function fromFiles(rootName: string, items: LooseFile[]): DirNode {
  const root: VDir = { dirs: new Map(), files: new Map() };
  for (const { path, file } of items) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (const part of parts.slice(0, -1)) {
      let next = cur.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: new Map() };
        cur.dirs.set(part, next);
      }
      cur = next;
    }
    cur.files.set(parts[parts.length - 1], file);
  }

  const make = (v: VDir, name: string, path: string): DirNode => ({
    kind: 'dir',
    name,
    path,
    async list() {
      return {
        dirs: [...v.dirs].map(([n, child]) => make(child, n, join(path, n))),
        files: [...v.files].map(([n, f]) => ({
          kind: 'file' as const,
          name: n,
          path: join(path, n),
          getFile: async () => f,
        })),
      };
    },
  });

  return make(root, rootName, '');
}
