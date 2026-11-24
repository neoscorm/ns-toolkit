// Shared data types of the viewer

export type Standard =
  | 'SCORM 1.2'
  | 'SCORM 2004'
  | 'SCORM 1.1'
  | 'SCORM'
  | 'xAPI'
  | 'cmi5'
  | 'AICC';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  /** A short statement of the problem */
  message: string;
  /** Explanation: what it means and what to do */
  detail?: string;
}

/** Content categories for the "what the package is made of" diagram */
export type Category =
  | 'video'
  | 'audio'
  | 'images'
  | 'code'
  | 'fonts'
  | 'documents'
  | 'flash'
  | 'other';

/** An item of the course structure from the manifest */
export interface OutlineItem {
  title: string;
  /** Launch address of the item (for a SCO): a path from the package root with parameters */
  href?: string;
  children: OutlineItem[];
}

export interface PackageInfo {
  /** Unique key: the path, and for a ZIP with several courses — path + subfolder */
  id: string;
  /** Path relative to the chosen folder */
  path: string;
  /** Subfolder inside the ZIP if the course is not at the archive root */
  inner?: string;
  name: string;
  kind: 'zip' | 'folder';
  title: string;
  identifier?: string;
  standard: Standard;
  standardDetail?: string;
  tool: string;
  launch?: string;
  scoCount: number;
  outline: OutlineItem[];
  fileCount: number;
  /** Size when unpacked */
  totalBytes: number;
  /** Size on disk (for a ZIP — the archive size) */
  diskBytes: number;
  composition: Partial<Record<Category, number>>;
  /** Date of the newest file inside the package, ms */
  updated?: number;
  issues: Issue[];
  /** A content "fingerprint" for finding duplicates */
  fingerprint: string;
  /** Key for finding versions of one course: manifest ID + title */
  versionKey?: string;
}

/** Links between packages, computed after scanning the whole folder */
export interface Relations {
  duplicates: string[];
  versions: string[];
}

export interface SkippedItem {
  path: string;
  reason: string;
}

export interface ScanResult {
  rootName: string;
  scannedAt: number;
  packages: PackageInfo[];
  skipped: SkippedItem[];
  /** false if the scan was stopped manually */
  complete: boolean;
}
