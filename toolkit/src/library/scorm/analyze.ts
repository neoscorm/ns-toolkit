// Analysis of one package: metadata, contents, problems

import type { Category, Issue, PackageInfo } from '../types';
import type { PackageSource, SrcEntry } from '../fs/sources';
import { parseDescriptor, type DescriptorType } from './manifest';
import { detectTool } from './detect';
import { categoryOf } from './composition';
import { baseName, extOf, formatBytes, plural, shortHash } from '../util';

/** Changes when the analysis logic changes — the old cache is then ignored */
export const ANALYZER_VERSION = 4;

/** Threshold of a "large" package */
const LARGE_BYTES = 250 * 1024 * 1024;

/** A date earlier than 1981 is the "empty" ZIP date (1980-01-01); we ignore it */
const MIN_REAL_DATE = Date.UTC(1981, 0, 1);

const JUNK = /(^|\/)(__macosx\/|\.ds_store$|thumbs\.db$|desktop\.ini$)/i;

export interface AnalyzeInput {
  source: PackageSource;
  /** Package path relative to the chosen folder */
  path: string;
  name: string;
  kind: 'zip' | 'folder';
  /** Subfolder inside the ZIP ('' — the root) */
  base: string;
  descriptor: { type: DescriptorType; path: string };
  /** How many courses were found in this ZIP */
  siblings: number;
  /** Modification date of the file/folder itself on disk — a fallback date */
  fileDate?: number;
}

const examples = (list: string[]) =>
  list
    .slice(0, 3)
    .map((p) => `"${p}"`)
    .join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');

export async function analyzePackage(input: AnalyzeInput): Promise<PackageInfo> {
  const { source, base, descriptor } = input;
  const issues: Issue[] = [];

  // Files of this course relative to its root
  const files: SrcEntry[] = source.entries
    .filter((e) => e.path.startsWith(base))
    .map((e) => ({ ...e, path: e.path.slice(base.length) }));
  const paths = files.map((f) => f.path);
  const exact = new Set(paths);
  const byLower = new Map(paths.map((p) => [p.toLowerCase(), p]));

  // --- package description ---
  const descText = (await source.readText(descriptor.path)) ?? '';
  const data = parseDescriptor(descriptor.type, descText);

  if (!data.ok) {
    issues.push({
      code: 'manifest-invalid',
      severity: 'error',
      message: `${baseName(descriptor.path)} can't be read`,
      detail:
        'The package description is not valid XML, so an LMS will reject the package. This is usually a damaged export: publish the course again from its source file.',
    });
  }

  if (base) {
    issues.push({
      code: 'manifest-nested',
      severity: 'error',
      message: 'Course is inside a subfolder of the ZIP',
      detail: `An LMS looks for ${baseName(descriptor.path)} at the top level of the ZIP, but here it is in "${base.replace(/\/$/, '')}". Zip the contents of that folder, not the folder itself.`,
    });
  }
  if (input.siblings > 1) {
    issues.push({
      code: 'multiple-packages',
      severity: 'info',
      message: `This ZIP holds ${input.siblings} courses`,
      detail: 'Each one is listed separately here. An LMS expects one course per ZIP, so they need to be uploaded one by one.',
    });
  }

  // --- launch file ---
  let launchHead = '';
  if (data.ok && data.standard !== 'AICC') {
    if (data.externalLaunch) {
      issues.push({
        code: 'launch-external',
        severity: 'info',
        message: 'Course is hosted elsewhere',
        detail: `The package only links to ${data.externalLaunch}. If that site goes offline, the course stops working.`,
      });
    } else if (!data.launch) {
      issues.push({
        code: 'launch-none',
        severity: 'error',
        message: 'No start file',
        detail: "The package description doesn't say which file opens the course, so an LMS can't launch it.",
      });
    } else if (!exact.has(data.launch)) {
      const actual = byLower.get(data.launch.toLowerCase());
      if (actual) {
        issues.push({
          code: 'launch-case',
          severity: 'warning',
          message: 'Start file name differs in letter case',
          detail: `The description says "${data.launch}", the file is "${actual}". This works on Windows but fails on most LMS servers, which run Linux and treat these as different names.`,
        });
      } else {
        issues.push({
          code: 'launch-missing',
          severity: 'error',
          message: 'Start file is missing',
          detail: `The course should open with "${data.launch}", but there is no such file in the package.`,
        });
      }
    }
    const launchPath = data.launch ? (exact.has(data.launch) ? data.launch : byLower.get(data.launch.toLowerCase())) : undefined;
    if (launchPath && /^html?$/.test(extOf(launchPath))) {
      launchHead = ((await source.readText(base + launchPath, 2 * 1024 * 1024)) ?? '').slice(0, 64 * 1024);
    }
  }

  // --- files from the descriptor that are missing in the package ---
  const missing: string[] = [];
  const caseOnly: string[] = [];
  for (const ref of data.referenced) {
    if (ref === data.launch || exact.has(ref)) continue;
    if (byLower.has(ref.toLowerCase())) caseOnly.push(ref);
    else missing.push(ref);
  }
  if (missing.length) {
    issues.push({
      code: 'files-missing',
      severity: 'warning',
      message: `${plural(missing.length, 'file')} listed in the description ${missing.length === 1 ? 'is' : 'are'} missing`,
      detail: `For example: ${examples(missing)}. Parts of the course may not load.`,
    });
  }
  if (caseOnly.length) {
    issues.push({
      code: 'files-case',
      severity: 'warning',
      message: `${plural(caseOnly.length, 'file name')} ${caseOnly.length === 1 ? 'differs' : 'differ'} in letter case`,
      detail: `For example: ${examples(caseOnly)}. Works on Windows, fails on LMS servers that run Linux.`,
    });
  }

  // --- contents and sizes ---
  const composition: Partial<Record<Category, number>> = {};
  let totalBytes = 0;
  let newest = 0;
  let junk = 0;
  let swfCount = 0;
  for (const f of files) {
    const cat = categoryOf(f.path);
    composition[cat] = (composition[cat] ?? 0) + f.size;
    totalBytes += f.size;
    if (f.date && f.date > newest && f.date > MIN_REAL_DATE) newest = f.date;
    if (JUNK.test(f.path)) junk++;
    if (extOf(f.path) === 'swf') swfCount++;
  }

  // --- Flash ---
  const launchIsFlash =
    !!data.launch && (extOf(data.launch) === 'swf' || /(^|[_/-])flash\.html?$/i.test(data.launch));
  if (launchIsFlash) {
    issues.push({
      code: 'flash-launch',
      severity: 'error',
      message: 'Built on Flash',
      detail:
        "The course starts in Flash. Browsers stopped supporting Flash at the start of 2021, so this course won't open. It has to be rebuilt in HTML5.",
    });
  } else if (swfCount) {
    issues.push({
      code: 'flash-parts',
      severity: 'warning',
      message: 'Contains Flash files',
      detail: `${plural(swfCount, '.swf file')} (${formatBytes(composition.flash ?? 0)}). Browsers no longer play Flash, so any part that relies on them won't work.`,
    });
  }

  // --- the archive itself ---
  if (source.encrypted) {
    issues.push({
      code: 'encrypted',
      severity: 'error',
      message: 'ZIP is password-protected',
      detail: "An LMS can't unpack a protected archive. Export the course again without a password.",
    });
  }
  if (source.backslashes) {
    issues.push({
      code: 'backslashes',
      severity: 'warning',
      message: 'ZIP uses Windows-style paths',
      detail:
        'File paths inside the ZIP use backslashes (\\). Some LMSs unpack them as single files with odd names, and the course breaks. Re-zip it with a standard archiver.',
    });
  }
  if (totalBytes >= LARGE_BYTES) {
    issues.push({
      code: 'large',
      severity: 'info',
      message: `Large package: ${formatBytes(totalBytes)}`,
      detail: 'Many LMSs limit upload size, so this may need a raised limit. Heavy video is the usual cause.',
    });
  }
  if (junk) {
    issues.push({
      code: 'system-files',
      severity: 'info',
      message: 'Contains system files',
      detail: `${plural(junk, 'file')} like __MACOSX, .DS_Store or Thumbs.db. Harmless, but they add clutter.`,
    });
  }

  const tool = detectTool(paths, descText, launchHead);
  const title = data.title || input.name.replace(/\.zip$/i, '');
  const fingerprint = `${await shortHash(descText)}:${files.length}:${totalBytes}`;

  return {
    id: base ? `${input.path}#${base}` : input.path,
    path: input.path,
    inner: base || undefined,
    name: input.name,
    kind: input.kind,
    title,
    identifier: data.identifier,
    standard: data.standard,
    standardDetail: data.standardDetail,
    tool,
    launch: data.launch ?? data.externalLaunch,
    scoCount: data.scoCount,
    outline: data.outline,
    fileCount: files.length,
    totalBytes,
    diskBytes: input.siblings > 1 ? totalBytes : source.diskBytes,
    composition,
    updated: newest || input.fileDate,
    issues,
    fingerprint,
    versionKey: data.identifier ? `${data.identifier}|${title.toLowerCase()}` : undefined,
  };
}
