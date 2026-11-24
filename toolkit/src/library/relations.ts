// Links between packages: exact duplicates and different versions of the same course.
// Recomputed after every scan, not stored in the cache.

import type { Issue, PackageInfo, Relations } from './types';
import { plural } from './util';

export function computeRelations(packages: PackageInfo[]): Map<string, Relations> {
  const byPrint = new Map<string, string[]>();
  const byVersion = new Map<string, PackageInfo[]>();
  for (const p of packages) {
    byPrint.set(p.fingerprint, [...(byPrint.get(p.fingerprint) ?? []), p.id]);
    if (p.versionKey) byVersion.set(p.versionKey, [...(byVersion.get(p.versionKey) ?? []), p]);
  }
  const out = new Map<string, Relations>();
  for (const p of packages) {
    const duplicates = (byPrint.get(p.fingerprint) ?? []).filter((id) => id !== p.id);
    const versions = (p.versionKey ? byVersion.get(p.versionKey) ?? [] : [])
      .filter((o) => o.id !== p.id && o.fingerprint !== p.fingerprint)
      .map((o) => o.id);
    out.set(p.id, { duplicates, versions });
  }
  return out;
}

/** Package problems together with notes about duplicates and versions */
export function allIssues(p: PackageInfo, rel?: Relations): Issue[] {
  const extra: Issue[] = [];
  if (rel?.duplicates.length) {
    extra.push({
      code: 'duplicate',
      severity: 'info',
      message: 'Exact duplicate',
      detail: `Same content as ${plural(rel.duplicates.length, 'other package')} in this folder.`,
    });
  }
  if (rel?.versions.length) {
    extra.push({
      code: 'versions',
      severity: 'info',
      message: 'Other versions found',
      detail: `${plural(rel.versions.length, 'package')} ${rel.versions.length === 1 ? 'has' : 'have'} the same course ID and title but different content.`,
    });
  }
  return [...p.issues, ...extra];
}
