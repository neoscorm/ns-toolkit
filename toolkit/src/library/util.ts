// Small helper functions

/** Runs fn for every item, with at most limit tasks at once */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Size in human-readable form: 1.4 MB */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const digits = i === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** A date like "Mar 2019" */
export function formatMonth(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** A date like "5 Nov 2026" */
export function formatDay(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** SHA-256 of a string, the first 16 hexadecimal characters */
export async function shortHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Package path for display: for a course in a ZIP subfolder — "archive.zip › folder" */
export function displayPath(p: { path: string; inner?: string }): string {
  return p.inner ? `${p.path} › ${p.inner.replace(/\/$/, '')}` : p.path;
}
