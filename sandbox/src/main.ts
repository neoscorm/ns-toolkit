// Sandbox shell (sandbox.neoscorm.com): a player for SCORM courses (docs/API.md).
// Lives in an iframe inside the toolkit. Accepts the course files, hands them to the Service Worker,
// gives the course the SCORM API (window.API and window.API_1484_11), forwards the log and progress.
// The sandbox never touches files on disk: only the toolkit reads them.

import './style.css';
import {
  PROTOCOL,
  type FromSandboxBody,
  type LogEntry,
  type ReplyError,
  type SavedAttempt,
  type ScoRef,
  type StatusSummary,
  type ToSandbox,
  type Tracking,
} from '../../shared/protocol';
import { config } from './config';
import { openSource, mimeOf, type FileSource } from './files';
import { ScormRuntime } from './scorm/runtime';
import type { ApiVersion } from './scorm/model';

const stage = document.getElementById('stage')!;
const message = document.getElementById('message')!;

interface Session {
  id: string;
  title: string;
  declared: Tracking;
  files: FileSource;
  scos: ScoRef[];
  index: number;
  attempt: SavedAttempt;
  startedAt: number;
  runtimes: Partial<Record<ApiVersion, ScormRuntime>>;
  frame?: HTMLIFrameElement;
  /** Number of the course window. Grows on every SCO open, including a reload of the same SCO:
   *  the finish signal from an old window (the course sends it when the window is removed) must not close the new one */
  generation: number;
  watchdog?: number;
  reportedNet: Set<string>;
}

let session: Session | null = null;
let hostOrigin: string | null = null;

// ---------- link with the toolkit ----------

function post(body: FromSandboxBody): void {
  const msg = { protocol: PROTOCOL, ...body };
  if (hostOrigin) {
    window.parent.postMessage(msg, hostOrigin);
  } else {
    // Until the first message from the toolkit its address is unknown: send to every allowed one.
    // The browser delivers the message only to the one whose origin matches.
    for (const origin of config.hostOrigins) window.parent.postMessage(msg, origin);
  }
}

function reply(id: number, data?: unknown): void {
  post({ type: 'reply', id, ok: true, ...(data === undefined ? {} : { data }) });
}

function replyError(id: number, code: ReplyError['code'], text: string): void {
  post({ type: 'reply', id, ok: false, error: { code, message: text } });
}

let logBuffer: LogEntry[] = [];
let lastStatus: StatusSummary | null = null;
let flushTimer = 0;

function scheduleFlush(): void {
  if (!flushTimer) flushTimer = window.setTimeout(flush, 150);
}

function flush(): void {
  flushTimer = 0;
  if (logBuffer.length) post({ type: 'log', entries: logBuffer });
  logBuffer = [];
  if (lastStatus) post({ type: 'status', status: lastStatus });
  lastStatus = null;
}

function log(entry: Omit<LogEntry, 't'>): void {
  const t = session ? Math.round(performance.now() - session.startedAt) : 0;
  logBuffer.push({ t, ...entry });
  scheduleFlush();
}

// ---------- checking the shape of incoming messages ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks the shape of a command. Unknown or malformed — null */
function parse(data: unknown): ToSandbox | null {
  if (!isObj(data) || data.protocol !== PROTOCOL || !isStr(data.type)) return null;
  const d = data;
  switch (d.type) {
    case 'open':
      return isNum(d.id) && isStr(d.session) && /^[\w-]{1,64}$/.test(d.session) && isStr(d.title) &&
        Array.isArray(d.scos) && d.scos.length > 0 && isNum(d.start) && isObj(d.files)
        ? (d as unknown as ToSandbox)
        : null;
    case 'goto':
      return isNum(d.index) ? (d as unknown as ToSandbox) : null;
    case 'close':
      return d as unknown as ToSandbox;
    default:
      return null;
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  // Accept commands only from the parent window at an allowed origin
  if (e.source !== window.parent || !config.hostOrigins.includes(e.origin)) return;
  const msg = parse(e.data);
  if (!msg) {
    const id = isObj(e.data) && isNum(e.data.id) ? e.data.id : null;
    if (id !== null) replyError(id, 'bad-request', 'Malformed command.');
    return;
  }
  hostOrigin = e.origin;
  handle(msg);
});

function handle(msg: ToSandbox): void {
  switch (msg.type) {
    case 'open':
      void open(msg).then(
        () => reply(msg.id),
        (err) => {
          fail(err);
          replyError(msg.id, 'failed', errorText(err));
        },
      );
      return;
    case 'goto':
      return goto(msg.index);
    case 'close':
      return close();
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fail(err: unknown): void {
  const text = errorText(err);
  showMessage(`Couldn't open the course. ${text}`);
  post({ type: 'error', message: text });
}

function showMessage(text: string): void {
  message.textContent = text;
  message.hidden = false;
}

// ---------- starting a course ----------

async function open(msg: Extract<ToSandbox, { type: 'open' }>): Promise<void> {
  if (session) await endSession();
  const files = await openSource(msg.files);
  session = {
    id: msg.session,
    title: msg.title,
    declared: msg.declared,
    files,
    scos: msg.scos,
    index: 0,
    attempt: msg.attempt ?? { v: 1, api: msg.declared === 'scorm2004' ? '2004' : '1.2', scos: {}, updatedAt: Date.now() },
    startedAt: performance.now(),
    runtimes: {},
    generation: 0,
    reportedNet: new Set(),
  };
  document.title = `${msg.title} · neoScorm sandbox`;
  if (msg.declared === 'none') {
    log({
      kind: 'note',
      level: 'info',
      text: 'This package uses xAPI or cmi5. The course runs, but the sandbox does not record its progress.',
    });
  }
  openSco(Math.max(0, Math.min(msg.start, msg.scos.length - 1)));
}

/** Encodes a path for a URL, keeping ?parameters and the #anchor */
function contentUrl(id: string, href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut >= 0 ? href.slice(0, cut) : href;
  const suffix = cut >= 0 ? href.slice(cut) : '';
  return `/content/${id}/${path.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}

function openSco(index: number): void {
  const s = session;
  if (!s) return;
  unloadFrame();
  s.index = index;
  s.runtimes = {};
  s.generation += 1;
  const sco = s.scos[index];
  message.hidden = true;

  const frame = document.createElement('iframe');
  frame.title = sco.title;
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write';
  frame.src = contentUrl(s.id, sco.href);
  frame.addEventListener('load', () => watchInitialize(s, index), { once: true });
  stage.replaceChildren(frame);
  s.frame = frame;

  post({ type: 'sco', index });
  if (s.scos.length > 1) log({ kind: 'note', level: 'info', sco: index, text: `Opened part ${index + 1} of ${s.scos.length}: ${sco.title}` });
}

/** If the course has not called Initialize within 8 seconds, it most likely did not find the API */
function watchInitialize(s: Session, index: number): void {
  window.clearTimeout(s.watchdog);
  if (s.declared === 'none') return;
  s.watchdog = window.setTimeout(() => {
    if (session !== s || s.index !== index) return;
    const started = Object.values(s.runtimes).some((r) => r?.initialized);
    if (!started) {
      log({
        kind: 'note',
        level: 'warn',
        sco: index,
        text: "The course hasn't called LMSInitialize or Initialize after 8 seconds. It may not have found the LMS API, or it waits for a click to start.",
      });
    }
  }, 8000);
}

/** Removes the course iframe. At this moment the course usually calls LMSFinish/Terminate itself */
function unloadFrame(): void {
  const s = session;
  if (!s?.frame) return;
  window.clearTimeout(s.watchdog);
  s.frame.remove();
  s.frame = undefined;
  for (const r of Object.values(s.runtimes)) r?.abandon();
}

function goto(index: number): void {
  if (!session || index < 0 || index >= session.scos.length) return;
  openSco(index);
}

async function endSession(): Promise<void> {
  unloadFrame();
  const s = session;
  session = null;
  await s?.files.close().catch(() => {});
}

function close(): void {
  void endSession().finally(() => {
    flush();
    post({ type: 'closed' });
    stage.replaceChildren();
  });
}

// ---------- SCORM API for the course ----------

function runtime(version: ApiVersion): ScormRuntime | null {
  const s = session;
  if (!s) return null;
  const existing = s.runtimes[version];
  if (existing) return existing;

  const index = s.index;
  const generation = s.generation;
  const declared = s.declared === 'scorm2004' ? '2004' : s.declared === 'scorm12' ? '1.2' : null;
  if (declared && declared !== version) {
    log({
      kind: 'note',
      level: 'warn',
      sco: index,
      text: `The course calls the SCORM ${version} API, but its manifest declares SCORM ${declared}. An LMS that trusts the manifest won't track it.`,
    });
  }
  // Saved state fits only if it comes from the same API version
  const saved = s.attempt.api === version ? s.attempt.scos[String(index)] : undefined;

  const rt = new ScormRuntime({
    version,
    sco: index,
    saved,
    hasNext: index < s.scos.length - 1,
    hasPrevious: index > 0,
    log,
    onChange: (status) => {
      lastStatus = status;
      scheduleFlush();
    },
    onPersist: (state) => {
      if (session !== s) return;
      if (s.attempt.api !== version) s.attempt = { v: 1, api: version, scos: {}, updatedAt: Date.now() };
      s.attempt.scos[String(index)] = state;
      s.attempt.updatedAt = Date.now();
      post({ type: 'attempt', attempt: s.attempt });
    },
    onTerminate: (nav) => onTerminate(s, generation, nav),
  });
  s.runtimes[version] = rt;
  return rt;
}

/** Navigation after a SCO finishes (SCORM 2004 navigation requests) */
function onTerminate(s: Session, generation: number, nav: string): void {
  if (session !== s || s.generation !== generation) return;
  const index = s.index;
  setTimeout(() => {
    if (session !== s || s.generation !== generation) return;
    if (nav === 'continue' && index < s.scos.length - 1) return openSco(index + 1);
    if (nav === 'previous' && index > 0) return openSco(index - 1);
    if (/^(exit|exitAll|suspendAll|abandon|abandonAll)$/.test(nav) || s.scos.length === 1) {
      unloadFrame();
      showMessage('The course has ended its session. You can open it again from the toolkit.');
      return;
    }
    if (nav !== '_none_') {
      log({ kind: 'note', level: 'info', sco: index, text: `Navigation request "${nav}" is not supported here. Pick a part in the list instead.` });
    }
  }, 0);
}

// The API objects are permanent: a course may keep a reference to them from load time.
// Every call is forwarded to the runtime of the current SCO.
type ApiMethods = Record<string, (...args: unknown[]) => string>;

function apiObject(version: ApiVersion, names: string[], make: (r: ScormRuntime) => ApiMethods): ApiMethods & { version?: string } {
  const api: ApiMethods & { version?: string } = {};
  for (const name of names) {
    api[name] = (...args: unknown[]) => {
      const rt = runtime(version);
      return rt ? make(rt)[name](...args) : 'false';
    };
  }
  if (version === '2004') api.version = '1.0';
  return api;
}

const w = window as unknown as Record<string, unknown>;
w.API = apiObject(
  '1.2',
  ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic'],
  (r) => r.api12() as ApiMethods,
);
w.API_1484_11 = apiObject(
  '2004',
  ['Initialize', 'Terminate', 'GetValue', 'SetValue', 'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic'],
  (r) => r.api2004() as unknown as ApiMethods,
);

// ---------- Service Worker requests ----------

navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; session?: string; path?: string; url?: string; dest?: string };
  const port = e.ports[0];
  const s = session;

  if (msg?.type === 'file' && port) {
    if (!s || msg.session !== s.id) return port.postMessage({ status: 'not-mine' });
    const path = msg.path ?? '';
    s.files
      .get(path)
      .then((blob) => {
        if (blob) return port.postMessage({ status: 200, blob, type: mimeOf(path) });
        const alt = s.files.caseMatch(path);
        log({
          kind: 'file',
          level: 'error',
          sco: s.index,
          text: alt
            ? `404 ${path}: the package has "${alt}". Letter case differs, so this works on Windows but not on an LMS server.`
            : `404 ${path}: no such file in the package`,
        });
        port.postMessage({ status: 404 });
      })
      .catch((err) => {
        log({ kind: 'file', level: 'error', sco: s.index, text: `Couldn't read ${path}: ${errorText(err)}` });
        port.postMessage({ status: 500 });
      });
    return;
  }

  if (msg?.type === 'net' && s && msg.session === s.id && msg.url) {
    // Log each site address only once
    const origin = new URL(msg.url).origin;
    if (s.reportedNet.has(origin)) return;
    s.reportedNet.add(origin);
    log({
      kind: 'net',
      level: 'warn',
      sco: s.index,
      text: `Loads files from ${origin} (first: ${msg.url.slice(0, 160)}). In an LMS without internet access, or with strict security, this part may not load.`,
    });
  }
});

// ---------- start ----------

async function start(): Promise<void> {
  if (window.parent === window) {
    document.body.classList.add('standalone');
    const link = document.createElement('a');
    link.href = config.toolkitUrl;
    link.textContent = 'Open neoScorm toolkit';
    message.replaceChildren('This page shows courses for neoScorm toolkit. ', link);
    message.hidden = false;
    return;
  }
  if (!('serviceWorker' in navigator)) {
    fail(new Error('This browser has no service workers, which the sandbox needs. Private windows in some browsers turn them off.'));
    return;
  }
  try {
    // Without a time limit the sandbox could hang silently: the toolkit would get neither ready nor error
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('it did not start within 10 seconds')), 10000),
    );
    await Promise.race([
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready),
      timeout,
    ]);
  } catch (err) {
    fail(new Error(`The sandbox couldn't start its service worker (${errorText(err)}). Private windows in some browsers block it.`));
    return;
  }
  post({ type: 'ready', capabilities: ['play'] });
}

void start();
