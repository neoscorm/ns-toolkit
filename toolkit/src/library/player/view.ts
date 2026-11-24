// Player screen in the toolkit: the course in the sandbox (sandbox.neoscorm.com),
// on the right — what the course reports to the LMS and a log of all calls. Exchange — through SandboxClient (docs/API.md).

import type { PackageInfo } from '../types';
import type { LogEntry, PackageFiles, SavedAttempt, ScoRef, StatusSummary, Tracking } from '../../../../shared/protocol';
import { config } from '../../config';
import { SandboxClient } from '../../sandbox-client';
import { h, icon, mount } from '../ui/dom';
import { downloadText, safeFileName } from '../ui/csv';
import { attempts, isAttempt } from './attempts';
import { formatNumber } from '../util';

export interface PlayerOptions {
  pkg: PackageInfo;
  files: PackageFiles;
  tracking: Tracking;
  scos: ScoRef[];
  onClose: () => void;
}

/** How many log lines to keep on screen */
const MAX_ROWS = 2000;

const READ_CALLS = new Set(['LMSGetValue', 'GetValue']);

function stamp(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

const quote = (s: string) => JSON.stringify(s);

/** Long values (suspend_data) are shortened on screen; in the exported log they are fuller */
function short(s: string): string {
  if (s.length <= 140) return s;
  const size = /\(([\d,]+) characters\)$/.exec(s)?.[1];
  return `${s.slice(0, 100)}…${size ? ` (${size} characters)` : ''}`;
}

/** Text of a log entry in one line — for the screen and for export */
function entryText(e: LogEntry): string {
  if (e.kind === 'call') {
    const call = `${e.fn}(${(e.args ?? []).map(quote).join(', ')}) → ${quote(e.result ?? '')}`;
    return e.code ? `${call}  [${e.code}] ${e.text ?? ''}` : e.text ? `${call}  ${e.text}` : call;
  }
  return e.text ?? '';
}

/** Messages come from the player, where third-party code runs: check the shape */
function cleanEntries(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 1000).flatMap((e): LogEntry[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as Record<string, unknown>;
    const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const kind = ['call', 'file', 'net', 'note'].includes(x.kind as string) ? (x.kind as LogEntry['kind']) : 'note';
    const level = ['ok', 'warn', 'error', 'info'].includes(x.level as string) ? (x.level as LogEntry['level']) : 'info';
    return [
      {
        t: typeof x.t === 'number' ? x.t : 0,
        kind,
        level,
        sco: typeof x.sco === 'number' ? x.sco : undefined,
        fn: str(x.fn, 40),
        args: Array.isArray(x.args) ? x.args.slice(0, 2).map((a) => str(a) ?? '') : undefined,
        result: str(x.result),
        code: typeof x.code === 'number' ? x.code : undefined,
        text: str(x.text),
      },
    ];
  });
}

export function renderPlayer(container: HTMLElement, opts: PlayerOptions): void {
  const { pkg, scos } = opts;
  const log: LogEntry[] = [];
  let currentSco = 0;
  let closing = false;

  // --- sandbox window ---
  const frameBox = h('div', { class: 'player-frame-box' });
  const client = new SandboxClient(frameBox, config.sandboxOrigin);
  const frame = client.frame;
  frame.classList.add('player-frame');
  frame.title = `Course: ${pkg.title}`;
  const stageNote = h('p', { class: 'player-stage-note', hidden: true });

  function showNote(text: string): void {
    stageNote.textContent = text.slice(0, 300);
    stageNote.hidden = false;
  }

  async function load(fresh: boolean): Promise<void> {
    const attempt = fresh ? undefined : await attempts.get(pkg);
    try {
      await client.open({ title: pkg.title, declared: opts.tracking, files: opts.files, scos, attempt });
    } catch (e) {
      showNote(e instanceof Error ? e.message : String(e));
    }
  }

  // --- the "what the course reports to the LMS" panel ---
  const statusList = h('dl', { class: 'lms-facts' });
  const statusEmpty = h(
    'p',
    { class: 'muted lms-empty' },
    opts.tracking === 'none' ? 'This package uses xAPI or cmi5. It plays here, but its progress is not recorded.' : 'Waiting for the course to connect to the LMS…',
  );

  function renderStatus(s: StatusSummary): void {
    statusEmpty.hidden = true;
    const v12 = s.api === '1.2';
    const rows: [string, string | Node][] = [
      ['API', `SCORM ${s.api}${s.terminated ? ', session ended' : s.initialized ? ', connected' : ''}`],
      [v12 ? 'Lesson status' : 'Completion', s.completion || '—'],
    ];
    if (!v12) rows.push(['Success', s.success || '—']);
    rows.push(['Score', s.score || '—'], ['Location', s.location || '—']);
    const over = s.suspendLength > s.suspendLimit;
    const meter = h('span', { class: `meter${over ? ' meter-over' : ''}`, 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.min(100, (s.suspendLength / s.suspendLimit) * 100)}%` } }));
    rows.push([
      'Saved state',
      h('span', null, `${formatNumber(s.suspendLength)} of ${formatNumber(s.suspendLimit)} characters`, meter),
    ]);
    rows.push(['Session time', s.sessionTime || '—'], ['Total time', s.totalTime]);
    if (s.interactions) rows.push(['Interactions', formatNumber(s.interactions)]);
    if (s.objectives) rows.push(['Objectives', formatNumber(s.objectives)]);
    rows.push(['API calls', `${formatNumber(s.calls)}${s.errors ? `, ${formatNumber(s.errors)} with errors` : ''}`]);
    statusList.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', { class: k === 'Saved state' && over ? 'over' : undefined }, v)]));
  }

  // --- list of course parts ---
  const scoButtons = scos.map((sco, i) =>
    h('button', { type: 'button', class: 'sco-button', on: { click: () => client.goto(i) } }, h('span', { class: 'sco-num' }, String(i + 1)), h('span', null, sco.title)),
  );
  function markSco(index: number): void {
    currentSco = index;
    scoButtons.forEach((b, i) => (i === index ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  }

  // --- log ---
  const list = h('ol', { class: 'log-list', 'data-filter': 'all', 'aria-label': 'Log of calls between the course and the LMS' });
  const counter = h('span', { class: 'log-count' }, '0');
  const filter = h(
    'select',
    {
      id: 'log-filter',
      on: { change: () => list.setAttribute('data-filter', filter.value) },
    },
    h('option', { value: 'all' }, 'Everything'),
    h('option', { value: 'writes' }, 'Without reads'),
    h('option', { value: 'problems' }, 'Problems only'),
  );
  let problems = 0;

  function addEntries(entries: LogEntry[]): void {
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    for (const e of entries) {
      log.push(e);
      if (e.level === 'warn' || e.level === 'error') problems++;
      const li = h(
        'li',
        {
          class: `log-row log-${e.level} log-kind-${e.kind}`,
          'data-level': e.level,
          'data-read': String(e.kind === 'call' && READ_CALLS.has(e.fn ?? '')),
        },
        h('span', { class: 'log-time' }, stamp(e.t)),
        e.kind === 'call'
          ? h(
              'span',
              { class: 'log-body' },
              h(
                'code',
                { class: 'log-call' },
                `${e.fn}(${(e.args ?? []).map((a) => quote(short(a))).join(', ')})`,
                h('span', { class: 'log-result' }, ` → ${quote(short(e.result ?? ''))}`),
              ),
              e.code ? h('span', { class: 'log-text' }, `Error ${e.code}: ${e.text ?? ''}`) : e.text ? h('span', { class: 'log-text' }, e.text) : null,
            )
          : h('span', { class: 'log-body' }, h('span', { class: 'log-tag' }, e.kind === 'file' ? 'File' : e.kind === 'net' ? 'Internet' : 'Note'), h('span', { class: 'log-text' }, e.text ?? '')),
      );
      list.appendChild(li);
    }
    while (list.childElementCount > MAX_ROWS) list.firstElementChild?.remove();
    counter.textContent = problems ? `${formatNumber(log.length)} entries, ${formatNumber(problems)} problems` : `${formatNumber(log.length)} entries`;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  function downloadLog(): void {
    const lines = [
      `neoScorm toolkit log`,
      `Course: ${pkg.title}`,
      `Package: ${pkg.path}${pkg.inner ? ` > ${pkg.inner}` : ''}`,
      `Standard (manifest): ${pkg.standard}`,
      `Saved: ${new Date().toISOString()}`,
      '',
      ...log.map((e) => `[${stamp(e.t)}]${scos.length > 1 && e.sco !== undefined && e.sco >= 0 ? ` part ${e.sco + 1}` : ''} ${e.level.toUpperCase().padEnd(5)} ${entryText(e)}`),
    ];
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`scorm-log-${safeFileName(pkg.title)}-${date}.txt`, lines.join('\r\n'), 'text/plain;charset=utf-8');
  }

  // --- sandbox events (the sender's origin and window are checked by SandboxClient, the shape — here) ---
  client.on('log', (m) => addEntries(cleanEntries(m.entries)));
  client.on('status', (m) => {
    if (m.status && typeof m.status === 'object') renderStatus(m.status);
  });
  client.on('attempt', (m) => {
    if (isAttempt(m.attempt)) void attempts.save(pkg, m.attempt as SavedAttempt);
  });
  client.on('sco', (m) => {
    if (typeof m.index === 'number') markSco(m.index);
  });
  client.on('error', (m) => showNote(String(m.message)));
  client.on('closed', () => finishClose());
  void load(false);

  // --- closing ---
  let closeTimer = 0;
  let closed = false;
  function close(): void {
    if (closing) return;
    closing = true;
    // Give the course a chance to call LMSFinish/Terminate and save progress
    client.close();
    closeTimer = window.setTimeout(finishClose, 1500);
  }
  function finishClose(): void {
    if (closed) return;
    closed = true;
    window.clearTimeout(closeTimer);
    document.removeEventListener('keydown', onKey);
    client.destroy();
    opts.onClose();
  }
  function onKey(e: KeyboardEvent): void {
    // Escape closes the player only if focus is not inside the course
    if (e.key === 'Escape' && document.activeElement !== frame) close();
  }
  document.addEventListener('keydown', onKey);

  async function startOver(): Promise<void> {
    await attempts.clear(pkg);
    log.length = 0;
    problems = 0;
    list.replaceChildren();
    counter.textContent = '0';
    statusList.replaceChildren();
    statusEmpty.hidden = false;
    addEntries([{ t: 0, kind: 'note', level: 'info', text: 'Saved progress deleted. The course starts from the beginning.' }]);
    void load(true);
  }

  const meta = [pkg.standard, pkg.tool !== 'Unknown' ? pkg.tool : null].filter(Boolean).join(', ');

  mount(
    container,
    h(
      'section',
      { class: 'player', 'aria-labelledby': 'player-title' },
      h(
        'header',
        { class: 'player-bar' },
        h('button', { type: 'button', class: 'button button-quiet', on: { click: close } }, icon('back'), h('span', null, 'Back to library')),
        h('div', { class: 'player-heading' }, h('h1', { id: 'player-title' }, pkg.title), h('p', { class: 'path' }, meta)),
        h(
          'div',
          { class: 'player-actions' },
          h(
            'button',
            { type: 'button', class: 'button button-quiet', title: 'Delete saved progress and start the course again', on: { click: () => void startOver() } },
            icon('refresh'),
            h('span', null, 'Start over'),
          ),
          h('button', { type: 'button', class: 'button button-quiet', on: { click: downloadLog } }, icon('download'), h('span', null, 'Download log')),
        ),
      ),
      h(
        'div',
        { class: 'player-body' },
        h('div', { class: 'player-stage' }, frameBox, stageNote),
        h(
          'aside',
          { class: 'lms-panel', 'aria-label': 'What the course reports to the LMS' },
          h('section', { class: 'lms-section' }, h('h2', null, 'What the course reports'), statusEmpty, statusList),
          scos.length > 1
            ? h('section', { class: 'lms-section' }, h('h2', null, `Parts (${scos.length})`), h('ol', { class: 'sco-list' }, scoButtons.map((b) => h('li', null, b))))
            : null,
          h(
            'section',
            { class: 'lms-section lms-log' },
            h('div', { class: 'log-head' }, h('h2', null, 'Log'), counter, h('label', { class: 'visually-hidden', for: 'log-filter' }, 'Show'), filter),
            list,
          ),
        ),
      ),
    ),
  );
  markSco(currentSco);
  container.querySelector<HTMLElement>('h1')?.focus();
}
