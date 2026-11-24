// Saved course progress. Stored in the viewer (IndexedDB of this browser),
// not in the player: this way progress does not depend on the player's address and is not visible to course code.

import type { PackageInfo } from '../types';
import type { SavedAttempt } from '../../../../shared/protocol';
import { kv } from '../store/db';

const key = (pkg: PackageInfo) => `attempt|${pkg.id}|${pkg.fingerprint}`;

/** Maximum size of a saved attempt — protection against junk sent by a course */
const MAX_CHARS = 4_000_000;

export const attempts = {
  get: (pkg: PackageInfo) => kv.get<SavedAttempt>(key(pkg)),
  clear: (pkg: PackageInfo) => kv.del(key(pkg)),
  async save(pkg: PackageInfo, attempt: SavedAttempt): Promise<void> {
    if (!isAttempt(attempt)) return;
    await kv.set(key(pkg), attempt);
  },
};

/** Checking the shape of the data: the message came from the player, where third-party course code runs */
export function isAttempt(a: unknown): a is SavedAttempt {
  if (!a || typeof a !== 'object') return false;
  const x = a as SavedAttempt;
  if (x.v !== 1 || (x.api !== '1.2' && x.api !== '2004') || !x.scos || typeof x.scos !== 'object') return false;
  let size = 0;
  for (const sco of Object.values(x.scos)) {
    if (!sco || typeof sco !== 'object' || typeof sco.exit !== 'string' || typeof sco.totalSeconds !== 'number') return false;
    if (!sco.data || typeof sco.data !== 'object') return false;
    for (const [k, v] of Object.entries(sco.data)) {
      if (typeof v !== 'string') return false;
      size += k.length + v.length;
    }
  }
  return size <= MAX_CHARS;
}
