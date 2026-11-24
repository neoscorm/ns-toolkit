// SCORM time formats.
// SCORM 1.2: CMITimespan «HHHH:MM:SS.SS» (session_time, total_time).
// SCORM 2004: ISO 8601 interval "PT1H2M3.5S".

/** "0012:03:04.5" → seconds; null — invalid format */
export function parseTimespan12(v: string): number | null {
  const m = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(v);
  if (!m) return null;
  const min = Number(m[2]);
  const sec = Number(m[3] + (m[4] ?? ''));
  if (min > 59 || sec >= 60) return null;
  return Number(m[1]) * 3600 + min * 60 + sec;
}

export function formatTimespan12(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return `${String(Math.min(h, 9999)).padStart(4, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

/** Time of day CMITime "HH:MM:SS(.SS)" — for interactions.n.time in 1.2 */
export function isTime12(v: string): boolean {
  const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(v);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 60;
}

const ISO_DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,2})?)S)?)?$/;

/** "PT1H2M3.5S" → seconds; null — invalid format */
export function parseDuration(v: string): number | null {
  const m = ISO_DURATION.exec(v);
  if (!m || v === 'P' || v.endsWith('T')) return null;
  const [, y, mo, d, h, mi, s] = m;
  return (
    Number(y ?? 0) * 31_536_000 +
    Number(mo ?? 0) * 2_592_000 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3600 +
    Number(mi ?? 0) * 60 +
    Number(s ?? 0)
  );
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round((s - h * 3600 - m * 60) * 100) / 100;
  return `PT${h}H${m}M${sec}S`;
}

/** ISO 8601 timestamp ("2026-11-05T10:15:30Z" and shorter) — checked without excess strictness */
export function isTimestamp(v: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d{1,2})?)?)?(Z|[+-]\d{2}(:\d{2})?)?)?)?)?$/.test(v);
}

/** Short form for people: "3 min 12 s" */
export function humanDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
