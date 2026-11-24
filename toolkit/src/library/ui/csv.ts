// Exporting the table to CSV (a table that opens in Excel and Google Sheets)

import type { PackageInfo, Relations } from '../types';
import { allIssues } from '../relations';

/**
 * Excel opens CSV with the separator from the system settings. Where the decimal
 * separator is a comma (Poland, Ukraine, Germany...), lists are separated with ";".
 */
function delimiter(): string {
  return (1.5).toLocaleString().includes(',') ? ';' : ',';
}

function cell(value: unknown, sep: string): string {
  const s = value == null ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: PackageInfo[], relations: Map<string, Relations>, byId: Map<string, PackageInfo>): string {
  const sep = delimiter();
  const header = [
    'Title',
    'Path',
    'Folder inside ZIP',
    'Type',
    'Standard',
    'Standard detail',
    'Authoring tool',
    'Start file',
    'SCOs',
    'Files',
    'Size (bytes)',
    'Size (MB)',
    'On disk (bytes)',
    'Updated',
    'Errors',
    'Warnings',
    'Problems',
    'Duplicate of',
    'Course ID',
  ];
  const lines = [header.map((x) => cell(x, sep)).join(sep)];
  for (const p of rows) {
    const rel = relations.get(p.id);
    const issues = allIssues(p, rel);
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    const record = [
      p.title,
      p.path,
      p.inner?.replace(/\/$/, '') ?? '',
      p.kind === 'zip' ? 'ZIP' : 'Folder',
      p.standard,
      p.standardDetail ?? '',
      p.tool,
      p.launch ?? '',
      p.scoCount,
      p.fileCount,
      p.totalBytes,
      (p.totalBytes / 1024 / 1024).toFixed(1).replace('.', sep === ';' ? ',' : '.'),
      p.diskBytes,
      p.updated ? new Date(p.updated).toISOString().slice(0, 10) : '',
      errors,
      warnings,
      issues
        .filter((i) => i.severity !== 'info')
        .map((i) => i.message)
        .join(' | '),
      (rel?.duplicates ?? []).map((id) => byId.get(id)?.path ?? id).join(' | '),
      p.identifier ?? '',
    ];
    lines.push(record.map((x) => cell(x, sep)).join(sep));
  }
  // A BOM at the start — so Excel reads UTF-8 correctly (Cyrillic, Polish letters)
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'library';
}
