// SCORM runtime (what an LMS normally does): the API object a course looks for,
// storage of cmi.* values, error codes and a log of every call.

import type { LogEntry, ScoState, StatusSummary } from '../../../shared/protocol';
import { ERRORS_12, ERRORS_2004, arrayChain, findDef, isPersistent, type ApiVersion, type ElementDef } from './model';
import { formatDuration, formatTimespan12, parseDuration, parseTimespan12 } from './time';

export interface RuntimeOptions {
  version: ApiVersion;
  sco: number;
  saved?: ScoState;
  hasNext: boolean;
  hasPrevious: boolean;
  log: (entry: Omit<LogEntry, 't'>) => void;
  onChange: (status: StatusSummary) => void;
  onPersist: (state: ScoState) => void;
  /** The course finished the session; nav — the requested SCORM 2004 navigation (continue, previous...) */
  onTerminate: (nav: string) => void;
}

const LEARNER_ID = 'toolkit';
const LEARNER_NAME = 'Toolkit, neoScorm';

/** Calls that are not written to the log: courses make them after every step */
const QUIET = new Set(['LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic', 'GetLastError', 'GetErrorString', 'GetDiagnostic']);

type Outcome = { result: string; code: number; note?: string; warn?: string };

export class ScormRuntime {
  private data = new Map<string, string>();
  private counts = new Map<string, number>();
  private state: 'new' | 'running' | 'terminated' = 'new';
  private lastError = 0;
  private lastDiagnostic = '';
  private baseSeconds = 0;
  private calls = 0;
  private errors = 0;
  private readonly v: ApiVersion;

  constructor(private readonly opts: RuntimeOptions) {
    this.v = opts.version;
  }

  // ---------- public API objects ----------

  /** window.API for SCORM 1.2 */
  api12() {
    return {
      LMSInitialize: (arg?: unknown) => this.call('LMSInitialize', [arg], () => this.initialize(arg)),
      LMSFinish: (arg?: unknown) => this.call('LMSFinish', [arg], () => this.terminate(arg)),
      LMSGetValue: (el?: unknown) => this.call('LMSGetValue', [el], () => this.getValue(el)),
      LMSSetValue: (el?: unknown, val?: unknown) => this.call('LMSSetValue', [el, val], () => this.setValue(el, val)),
      LMSCommit: (arg?: unknown) => this.call('LMSCommit', [arg], () => this.commit(arg)),
      LMSGetLastError: () => this.call('LMSGetLastError', [], () => ({ result: String(this.lastError), code: this.lastError }), false),
      LMSGetErrorString: (code?: unknown) => this.call('LMSGetErrorString', [code], () => ({ result: this.errorText(Number(code)), code: this.lastError }), false),
      LMSGetDiagnostic: (code?: unknown) => this.call('LMSGetDiagnostic', [code], () => ({ result: this.diagnostic(code), code: this.lastError }), false),
    };
  }

  /** window.API_1484_11 for SCORM 2004 */
  api2004() {
    return {
      version: '1.0',
      Initialize: (arg?: unknown) => this.call('Initialize', [arg], () => this.initialize(arg)),
      Terminate: (arg?: unknown) => this.call('Terminate', [arg], () => this.terminate(arg)),
      GetValue: (el?: unknown) => this.call('GetValue', [el], () => this.getValue(el)),
      SetValue: (el?: unknown, val?: unknown) => this.call('SetValue', [el, val], () => this.setValue(el, val)),
      Commit: (arg?: unknown) => this.call('Commit', [arg], () => this.commit(arg)),
      GetLastError: () => this.call('GetLastError', [], () => ({ result: String(this.lastError), code: this.lastError }), false),
      GetErrorString: (code?: unknown) => this.call('GetErrorString', [code], () => ({ result: this.errorText(Number(code)), code: this.lastError }), false),
      GetDiagnostic: (code?: unknown) => this.call('GetDiagnostic', [code], () => ({ result: this.diagnostic(code), code: this.lastError }), false),
    };
  }

  get initialized(): boolean {
    return this.state !== 'new';
  }

  get terminated(): boolean {
    return this.state === 'terminated';
  }

  /** Close the SCO without LMSFinish/Terminate (the course was unloaded without ending the session) */
  abandon(): void {
    if (this.state === 'running') {
      this.opts.log({
        kind: 'note',
        level: 'warn',
        sco: this.opts.sco,
        text:
          this.v === '1.2'
            ? 'The course was closed without calling LMSFinish. An LMS keeps only what was saved by the last LMSCommit.'
            : 'The course was closed without calling Terminate. An LMS keeps only what was saved by the last Commit.',
      });
    }
  }

  // ---------- common call handler ----------

  private call(fn: string, rawArgs: unknown[], body: () => Outcome, setsError = true): string {
    this.calls++;
    let out: Outcome;
    try {
      out = body();
    } catch (e) {
      out = { result: 'false', code: 101, note: e instanceof Error ? e.message : String(e) };
    }
    if (setsError) {
      this.lastError = out.code;
      this.lastDiagnostic = out.note ?? '';
    }
    if (!QUIET.has(fn)) {
      // 403 in SCORM 2004 ("value not initialized") is normal on the first launch
      const level = out.code === 0 ? (out.warn ? 'warn' : 'ok') : this.v === '2004' && out.code === 403 ? 'info' : 'error';
      if (level === 'error') this.errors++;
      this.opts.log({
        kind: 'call',
        level,
        sco: this.opts.sco,
        fn,
        args: rawArgs.slice(0, fn.endsWith('SetValue') ? 2 : 1).map((a) => clip(a === undefined ? '' : String(a))),
        result: clip(out.result),
        code: out.code,
        text: out.code ? `${this.errorText(out.code)}${out.note ? `. ${out.note}` : ''}` : out.warn,
      });
      this.opts.onChange(this.summary());
    }
    return out.result;
  }

  private errorText(code: number): string {
    const table = this.v === '1.2' ? ERRORS_12 : ERRORS_2004;
    return table[code] ?? '';
  }

  private diagnostic(code: unknown): string {
    const c = code === undefined || code === '' ? this.lastError : Number(code);
    return c === this.lastError && this.lastDiagnostic ? this.lastDiagnostic : this.errorText(c);
  }

  // ---------- error codes that differ between 1.2 and 2004 ----------

  private stateError(op: 'get' | 'set' | 'commit' | 'terminate'): number | null {
    if (this.state === 'running') return null;
    if (this.v === '1.2') return 301;
    const before = { get: 122, set: 132, commit: 142, terminate: 112 }[op];
    const after = { get: 123, set: 133, commit: 143, terminate: 113 }[op];
    return this.state === 'new' ? before : after;
  }

  // ---------- Initialize / Terminate / Commit ----------

  private initialize(arg: unknown): Outcome {
    if (arg !== '' && arg !== undefined && arg !== null) return { result: 'false', code: 201, note: 'The argument must be an empty string' };
    if (this.state === 'running') return { result: 'false', code: this.v === '1.2' ? 101 : 103, note: 'Already initialized' };
    if (this.state === 'terminated') return { result: 'false', code: this.v === '1.2' ? 101 : 104, note: 'This session has already ended' };

    const saved = this.opts.saved;
    let entry = 'ab-initio';
    if (saved) {
      const resume = saved.exit === 'suspend';
      if (this.v === '2004' && !resume) {
        // SCORM 2004: without suspend the previous attempt is finished — a new one begins
        this.opts.log({
          kind: 'note',
          level: 'info',
          sco: this.opts.sco,
          text: `New attempt: the previous session ended with cmi.exit = "${saved.exit || '(empty)'}", so saved data is not restored.`,
        });
      } else {
        for (const [k, val] of Object.entries(saved.data)) this.data.set(k, val);
        this.baseSeconds = saved.totalSeconds;
        entry = resume ? 'resume' : '';
      }
    }
    this.rebuildCounts();

    if (this.v === '1.2') {
      this.defaults({
        'cmi.core.student_id': LEARNER_ID,
        'cmi.core.student_name': LEARNER_NAME,
        'cmi.core.credit': 'credit',
        'cmi.core.lesson_mode': 'normal',
        'cmi.core.lesson_status': this.data.get('cmi.core.lesson_status') ?? 'not attempted',
        'cmi.launch_data': '',
        'cmi.comments_from_lms': '',
      });
      this.data.set('cmi.core.entry', entry);
      this.data.set('cmi.core.total_time', formatTimespan12(this.baseSeconds));
    } else {
      this.defaults({
        'cmi._version': '1.0',
        'cmi.learner_id': LEARNER_ID,
        'cmi.learner_name': LEARNER_NAME,
        'cmi.credit': 'credit',
        'cmi.mode': 'normal',
        'cmi.completion_status': this.data.get('cmi.completion_status') ?? 'unknown',
        'cmi.success_status': this.data.get('cmi.success_status') ?? 'unknown',
        'cmi.time_limit_action': 'continue,no message',
        'adl.nav.request': '_none_',
      });
      this.data.set('cmi.entry', entry);
      this.data.set('cmi.total_time', formatDuration(this.baseSeconds));
    }
    this.state = 'running';
    return { result: 'true', code: 0, warn: entry === 'resume' ? 'Resuming the saved session' : undefined };
  }

  private defaults(values: Record<string, string>): void {
    for (const [k, val] of Object.entries(values)) this.data.set(k, val);
  }

  private terminate(arg: unknown): Outcome {
    if (arg !== '' && arg !== undefined && arg !== null) return { result: 'false', code: 201, note: 'The argument must be an empty string' };
    const err = this.stateError('terminate');
    if (err) return { result: 'false', code: err };

    const sessionKey = this.v === '1.2' ? 'cmi.core.session_time' : 'cmi.session_time';
    const raw = this.data.get(sessionKey);
    const session = raw ? (this.v === '1.2' ? parseTimespan12(raw) : parseDuration(raw)) ?? 0 : 0;
    if (!raw) {
      this.opts.log({ kind: 'note', level: 'warn', sco: this.opts.sco, text: `The course didn't report ${sessionKey}, so this session adds no time to total_time.` });
    }
    const statusKey = this.v === '1.2' ? 'cmi.core.lesson_status' : 'cmi.completion_status';
    const status = this.data.get(statusKey);
    if (status === 'not attempted' || status === 'unknown') {
      this.opts.log({ kind: 'note', level: 'warn', sco: this.opts.sco, text: `The session ended with ${statusKey} = "${status}". Many LMSs will show this course as not started.` });
    }

    this.baseSeconds += session;
    this.persist();
    this.state = 'terminated';
    const nav = this.v === '2004' ? this.data.get('adl.nav.request') ?? '_none_' : '_none_';
    queueMicrotask(() => this.opts.onTerminate(nav));
    return { result: 'true', code: 0 };
  }

  private commit(arg: unknown): Outcome {
    if (arg !== '' && arg !== undefined && arg !== null) return { result: 'false', code: 201, note: 'The argument must be an empty string' };
    const err = this.stateError('commit');
    if (err) return { result: 'false', code: err };
    this.persist();
    return { result: 'true', code: 0 };
  }

  private persist(): void {
    const data: Record<string, string> = {};
    for (const [k, val] of this.data) if (isPersistent(this.v, k)) data[k] = val;
    const exit = this.data.get(this.v === '1.2' ? 'cmi.core.exit' : 'cmi.exit') ?? '';
    this.opts.onPersist({ data, exit, totalSeconds: this.baseSeconds });
  }

  // ---------- GetValue / SetValue ----------

  private getValue(rawEl: unknown): Outcome {
    const err = this.stateError('get');
    if (err) return { result: '', code: err };
    const el = rawEl === undefined || rawEl === null ? '' : String(rawEl);
    if (!el) return { result: '', code: this.v === '1.2' ? 201 : 301, note: 'No element name' };

    const def = findDef(this.v, el);
    if (!def) return { result: '', ...this.unknownElement(el) };
    if (def.access === 'w') return { result: '', code: this.v === '1.2' ? 404 : 405 };
    if (def.children !== undefined) return { result: def.children, code: 0 };
    if (def.count) return { result: String(this.counts.get(el.replace(/\._count$/, '')) ?? 0), code: 0 };

    if (el === 'adl.nav.request_valid.continue') return { result: String(this.opts.hasNext), code: 0 };
    if (el === 'adl.nav.request_valid.previous') return { result: String(this.opts.hasPrevious), code: 0 };
    if (el.startsWith('adl.nav.request_valid.')) return { result: 'unknown', code: 0 };

    // An array element whose number is greater than the number of elements in the array
    for (const { prefix, index } of arrayChain(el)) {
      if (index >= (this.counts.get(prefix) ?? 0)) {
        return { result: '', code: this.v === '1.2' ? 201 : 301, note: `${prefix} has only ${this.counts.get(prefix) ?? 0} items` };
      }
    }

    const value = this.data.get(el);
    if (value === undefined) {
      return this.v === '1.2' ? { result: '', code: 0 } : { result: '', code: 403 };
    }
    return { result: value, code: 0 };
  }

  private unknownElement(el: string): Pick<Outcome, 'code' | 'note'> {
    if (el.endsWith('._children')) return { code: this.v === '1.2' ? 202 : 301, note: `${el.slice(0, -10)} has no children` };
    if (el.endsWith('._count')) return { code: this.v === '1.2' ? 203 : 301, note: `${el.slice(0, -7)} is not an array` };
    return { code: 401, note: `"${el}" is not part of the SCORM ${this.v} data model` };
  }

  private setValue(rawEl: unknown, rawVal: unknown): Outcome {
    const err = this.stateError('set');
    if (err) return { result: 'false', code: err };
    const el = rawEl === undefined || rawEl === null ? '' : String(rawEl);
    const value = rawVal === undefined || rawVal === null ? '' : String(rawVal);
    if (!el) return { result: 'false', code: this.v === '1.2' ? 201 : 351, note: 'No element name' };

    const def = findDef(this.v, el);
    if (!def) {
      return { result: 'false', ...this.unknownElement(el) };
    }
    if (def.children !== undefined || def.count) return { result: 'false', code: this.v === '1.2' ? 402 : 404 };
    if (def.access === 'r') return { result: 'false', code: this.v === '1.2' ? 403 : 404 };

    // Arrays are filled in order: you can write to an existing element or to the next new one
    const chain = arrayChain(el);
    for (const { prefix, index } of chain) {
      const count = this.counts.get(prefix) ?? 0;
      if (index > count) {
        return { result: 'false', code: this.v === '1.2' ? 201 : 351, note: `${prefix}.${index} skips items: the array has ${count}` };
      }
    }
    // SCORM 2004: the id of the array element must be set first
    if (this.v === '2004') {
      const dep = this.missingId(el);
      if (dep) return { result: 'false', code: 408, note: `Set ${dep} first` };
    }

    const fail = def.check?.(value);
    if (fail) {
      const code = this.v === '1.2' ? 405 : fail === 'range' ? 407 : 406;
      return { result: 'false', code, note: `"${clip(value, 60)}" is not a valid value for ${el}` };
    }

    this.data.set(el, value);
    for (const { prefix, index } of chain) {
      if (index === (this.counts.get(prefix) ?? 0)) this.counts.set(prefix, index + 1);
    }
    return { result: 'true', code: 0, warn: this.softWarning(el, value, def) };
  }

  /** For SCORM 2004: an array element without an id set */
  private missingId(el: string): string | null {
    const m = /^(cmi\.(?:interactions|objectives)\.\d+)\.(.+)$/.exec(el);
    if (!m || m[2] === 'id') return null;
    return this.data.has(`${m[1]}.id`) ? null : `${m[1]}.id`;
  }

  private softWarning(el: string, value: string, def: ElementDef): string | undefined {
    if (def.limit && value.length > def.limit) {
      const hint = /suspend_data$/.test(el)
        ? ' Some LMSs cut longer values, and learners lose their progress.'
        : ' Some LMSs reject or cut longer values.';
      return `${value.length.toLocaleString('en-US')} characters: SCORM ${this.v} allows ${def.limit.toLocaleString('en-US')}.${hint}`;
    }
    if (this.v === '1.2' && /^cmi\.core\.score\.(raw|min|max)$/.test(el) && value !== '') {
      const n = Number(value);
      if (n < 0 || n > 100) return 'SCORM 1.2 expects scores from 0 to 100. Some LMSs reject other values.';
    }
    if (this.v === '1.2' && el === 'cmi.core.lesson_status' && value === 'not attempted') {
      return 'Only the LMS should use "not attempted". Courses are expected to set incomplete, completed, passed or failed.';
    }
    return undefined;
  }

  private rebuildCounts(): void {
    this.counts.clear();
    for (const key of this.data.keys()) {
      for (const { prefix, index } of arrayChain(key)) {
        if (index + 1 > (this.counts.get(prefix) ?? 0)) this.counts.set(prefix, index + 1);
      }
    }
  }

  // ---------- summary for the viewer panel ----------

  summary(): StatusSummary {
    const g = (k: string) => this.data.get(k) ?? '';
    const v12 = this.v === '1.2';
    const raw = g(v12 ? 'cmi.core.score.raw' : 'cmi.score.raw');
    const max = g(v12 ? 'cmi.core.score.max' : 'cmi.score.max');
    const scaled = v12 ? '' : g('cmi.score.scaled');
    let score = raw ? (max ? `${raw} / ${max}` : raw) : '';
    if (scaled) score = score ? `${score} (scaled ${scaled})` : `scaled ${scaled}`;
    const sessionRaw = g(v12 ? 'cmi.core.session_time' : 'cmi.session_time');
    return {
      api: this.v,
      sco: this.opts.sco,
      initialized: this.state !== 'new',
      terminated: this.state === 'terminated',
      completion: g(v12 ? 'cmi.core.lesson_status' : 'cmi.completion_status'),
      success: v12 ? '' : g('cmi.success_status'),
      score,
      location: g(v12 ? 'cmi.core.lesson_location' : 'cmi.location'),
      suspendLength: g('cmi.suspend_data').length,
      suspendLimit: v12 ? 4096 : 64000,
      sessionTime: sessionRaw,
      totalTime: v12 ? formatTimespan12(this.baseSeconds) : formatDuration(this.baseSeconds),
      interactions: this.counts.get('cmi.interactions') ?? 0,
      objectives: this.counts.get('cmi.objectives') ?? 0,
      calls: this.calls,
      errors: this.errors,
    };
  }
}

/** Truncates long values for the log (suspend_data can be tens of thousands of characters) */
function clip(s: string, max = 400): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length.toLocaleString('en-US')} characters)` : s;
}
