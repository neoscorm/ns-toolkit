// Protocol for messages between the toolkit (neoscorm.com/toolkit) and the sandbox
// (sandbox.neoscorm.com). Shared by both apps. Description: docs/API.md.
//
//   toolkit ──commands──► sandbox shell ──► iframe with the course
//           ◄──events──┘        ▲
//                       the Service Worker serves the course files, requesting them from the shell

export const PROTOCOL = 'neoscorm-sandbox/1';

/** Progress tracking mode */
export type Tracking = 'scorm12' | 'scorm2004' | 'none';

/** One launchable unit of a course (SCO) */
export interface ScoRef {
  title: string;
  /** Path from the package root, together with launch parameters (?a=b) */
  href: string;
}

export type PackageFiles =
  | { kind: 'zip'; file: File; /** course subfolder inside the ZIP */ base: string }
  | { kind: 'folder'; files: { path: string; file: File }[] };

/** Saved state of one SCO */
export interface ScoState {
  /** Values of the cmi.* data model at the time of the last save */
  data: Record<string, string>;
  /** How the previous session ended: suspend, logout, normal... */
  exit: string;
  /** Time accumulated over all sessions, seconds */
  totalSeconds: number;
}

/** Saved attempt at a course (stored in the toolkit) */
export interface SavedAttempt {
  v: 1;
  api: '1.2' | '2004';
  scos: Record<string, ScoState>;
  updatedAt: number;
}

export type LogLevel = 'ok' | 'warn' | 'error' | 'info';

/** A log entry: an API call, a file request, an external request or a note */
export interface LogEntry {
  /** Milliseconds from the start of the session */
  t: number;
  kind: 'call' | 'file' | 'net' | 'note';
  level: LogLevel;
  sco?: number;
  fn?: string;
  args?: string[];
  result?: string;
  code?: number;
  text?: string;
}

/** Short summary of "what the course told the LMS" */
export interface StatusSummary {
  api: '1.2' | '2004' | '';
  sco: number;
  initialized: boolean;
  terminated: boolean;
  completion: string;
  success: string;
  score: string;
  location: string;
  suspendLength: number;
  suspendLimit: number;
  sessionTime: string;
  totalTime: string;
  interactions: number;
  objectives: number;
  calls: number;
  errors: number;
}

/** Error in a reply to a request */
export interface ReplyError {
  code: 'bad-request' | 'no-session' | 'timeout' | 'failed';
  message: string;
}

// ---------- toolkit → sandbox ----------

export type ToSandbox =
  | {
      protocol: typeof PROTOCOL;
      type: 'open';
      id: number;
      session: string;
      title: string;
      /** SCORM version from the manifest — to compare with the API the course actually calls */
      declared: Tracking;
      files: PackageFiles;
      scos: ScoRef[];
      start: number;
      attempt?: SavedAttempt;
    }
  | { protocol: typeof PROTOCOL; type: 'goto'; index: number }
  | { protocol: typeof PROTOCOL; type: 'close' };

// ---------- sandbox → toolkit ----------

export type FromSandbox =
  | { protocol: typeof PROTOCOL; type: 'ready'; capabilities: string[] }
  | { protocol: typeof PROTOCOL; type: 'reply'; id: number; ok: true; data?: unknown }
  | { protocol: typeof PROTOCOL; type: 'reply'; id: number; ok: false; error: ReplyError }
  | { protocol: typeof PROTOCOL; type: 'log'; entries: LogEntry[] }
  | { protocol: typeof PROTOCOL; type: 'status'; status: StatusSummary }
  | { protocol: typeof PROTOCOL; type: 'attempt'; attempt: SavedAttempt }
  | { protocol: typeof PROTOCOL; type: 'sco'; index: number }
  | { protocol: typeof PROTOCOL; type: 'closed' }
  | { protocol: typeof PROTOCOL; type: 'error'; message: string };

/** Distributive Omit for union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type ToSandboxBody = DistributiveOmit<ToSandbox, 'protocol'>;
export type FromSandboxBody = DistributiveOmit<FromSandbox, 'protocol'>;

/** Time to wait for a reply to a request, ms */
export const REPLY_TIMEOUT = 5000;
