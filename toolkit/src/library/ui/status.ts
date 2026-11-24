// Overall status of a package based on its problems

import type { Issue } from '../types';

export type Status = 'broken' | 'check' | 'ok';

export function statusOf(issues: Issue[]): Status {
  if (issues.some((i) => i.severity === 'error')) return 'broken';
  if (issues.some((i) => i.severity === 'warning')) return 'check';
  return 'ok';
}

export const STATUS_LABEL: Record<Status, string> = {
  broken: 'Broken',
  check: 'Needs a check',
  ok: 'OK',
};

/** For sorting: the most problematic first */
export function statusScore(issues: Issue[]): number {
  let score = 0;
  for (const i of issues) score += i.severity === 'error' ? 100 : i.severity === 'warning' ? 10 : 0;
  return score;
}

/** The most important problem — for the label in the table row */
export function topIssue(issues: Issue[]): Issue | undefined {
  return issues.find((i) => i.severity === 'error') ?? issues.find((i) => i.severity === 'warning');
}
