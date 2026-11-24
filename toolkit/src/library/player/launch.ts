// Preparing to launch a course: whether it can be played, the list of SCOs and the package files

import type { Root } from '../fs/access';
import type { DirNode, FileNode } from '../fs/nodes';
import type { OutlineItem, PackageInfo } from '../types';
import type { PackageFiles, ScoRef, Tracking } from '../../../../shared/protocol';
import { mapLimit } from '../util';

export type Playability = { ok: true; tracking: Tracking } | { ok: false; reason: string };

export function playability(pkg: PackageInfo): Playability {
  const has = (code: string) => pkg.issues.some((i) => i.code === code);
  if (has('encrypted')) return { ok: false, reason: 'The ZIP is password-protected, so it can’t be opened.' };
  if (pkg.standard === 'AICC') return { ok: false, reason: 'AICC courses can’t be played here yet.' };
  if (has('flash-launch')) return { ok: false, reason: 'This course needs Flash, which browsers no longer run.' };
  if (has('launch-external')) return { ok: false, reason: 'The course lives on another website, so there is nothing to play here.' };
  if (!pkg.launch || has('launch-none') || has('launch-missing') || has('manifest-invalid')) {
    return { ok: false, reason: 'The package has no start file to open.' };
  }
  if (pkg.standard === 'SCORM 2004') return { ok: true, tracking: 'scorm2004' };
  if (pkg.standard === 'xAPI' || pkg.standard === 'cmi5') return { ok: true, tracking: 'none' };
  return { ok: true, tracking: 'scorm12' };
}

/** Launchable parts of the course in order; if the manifest has none — a single launch file */
export function scoList(pkg: PackageInfo): ScoRef[] {
  const out: ScoRef[] = [];
  const walk = (items: OutlineItem[]) => {
    for (const it of items) {
      if (it.href) out.push({ title: it.title, href: it.href });
      walk(it.children);
    }
  };
  walk(pkg.outline);
  return out.length ? out : [{ title: pkg.title, href: pkg.launch ?? 'index.html' }];
}

/** Finds a file or folder by a path relative to the chosen folder */
async function resolve(root: Root, path: string): Promise<FileNode | DirNode | null> {
  if (path === root.name) return root.node;
  const parts = path.split('/');
  let dir: DirNode = root.node;
  for (let i = 0; i < parts.length; i++) {
    const { dirs, files } = await dir.list();
    if (i === parts.length - 1) return files.find((f) => f.name === parts[i]) ?? dirs.find((d) => d.name === parts[i]) ?? null;
    const next = dirs.find((d) => d.name === parts[i]);
    if (!next) return null;
    dir = next;
  }
  return null;
}

/**
 * Collects the package files for the player. File references (File objects) are passed:
 * the browser does not copy their contents and sends nothing to the network.
 */
export async function collectFiles(root: Root, pkg: PackageInfo): Promise<PackageFiles> {
  const node = await resolve(root, pkg.path);
  if (!node) throw new Error(`“${pkg.path}” is no longer in this folder. Scan it again.`);
  if (pkg.kind === 'zip') {
    if (node.kind !== 'file') throw new Error(`“${pkg.path}” is not a ZIP file any more.`);
    return { kind: 'zip', file: await node.getFile(), base: pkg.inner ?? '' };
  }
  if (node.kind !== 'dir') throw new Error(`“${pkg.path}” is not a folder any more.`);
  const files: { path: string; file: File }[] = [];
  const walk = async (d: DirNode, prefix: string): Promise<void> => {
    const { dirs, files: list } = await d.list();
    await mapLimit(list, 16, async (f) => {
      files.push({ path: prefix + f.name, file: await f.getFile() });
    });
    for (const sub of dirs) await walk(sub, `${prefix}${sub.name}/`);
  };
  await walk(node, '');
  return { kind: 'folder', files };
}
