// Library screen: archive totals, filters, the package table, skipped files

import type { Category, Issue, PackageInfo, ScanResult } from '../types';
import { allIssues, computeRelations } from '../relations';
import { displayPath, formatBytes, formatDay, formatMonth, formatNumber, plural } from '../util';
import { h, icon, mount } from './dom';
import { miniStrata, strata } from './strata';
import { openDetails } from './details';
import { STATUS_LABEL, statusOf, statusScore, topIssue, type Status } from './status';
import { buildCsv, downloadText, safeFileName } from './csv';

export interface LibraryOptions {
  /** Saved results are shown, the folder is not open now */
  savedOnly: boolean;
  onRescan: () => void;
  onOpenAnother: () => void;
  onPlay: (pkg: PackageInfo) => void;
}

interface Row {
  p: PackageInfo;
  issues: Issue[];
  status: Status;
  score: number;
  haystack: string;
  dup: boolean;
  versions: boolean;
  flash: boolean;
}

type SortKey = 'title' | 'standard' | 'tool' | 'size' | 'files' | 'updated' | 'status';

const YEAR = 365.25 * 24 * 3600 * 1000;

function countBy<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function verdict(rows: Row[], redundant: number): string {
  const broken = rows.filter((r) => r.status === 'broken').length;
  const check = rows.filter((r) => r.status === 'check').length;
  const parts: string[] = [];
  if (broken) parts.push(`${formatNumber(broken)} won't work in a modern LMS`);
  if (check) parts.push(`${formatNumber(check)} ${check === 1 ? 'needs' : 'need'} a check`);
  let s = parts.length ? `${parts.join(' and ')}.` : 'Nothing looks broken.';
  if (redundant) s += redundant === 1 ? ' 1 is a copy of another course.' : ` ${formatNumber(redundant)} are copies of other courses.`;
  return s;
}

export function renderLibrary(container: HTMLElement, result: ScanResult, opts: LibraryOptions): void {
  const relations = computeRelations(result.packages);
  const byId = new Map(result.packages.map((p) => [p.id, p]));
  const rows: Row[] = result.packages.map((p) => {
    const rel = relations.get(p.id);
    const issues = allIssues(p, rel);
    return {
      p,
      issues,
      status: statusOf(issues),
      score: statusScore(issues),
      haystack: [p.title, p.path, p.inner, p.tool, p.identifier, p.standard].join(' ').toLowerCase(),
      dup: !!rel?.duplicates.length,
      versions: !!rel?.versions.length,
      flash: issues.some((i) => i.code.startsWith('flash')),
    };
  });

  // --- archive totals ---
  const totalBytes = rows.reduce((n, r) => n + r.p.totalBytes, 0);
  const composition: Partial<Record<Category, number>> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.p.composition)) {
      composition[k as Category] = (composition[k as Category] ?? 0) + (v ?? 0);
    }
  }
  const redundant = rows.length - new Set(rows.map((r) => r.p.fingerprint)).size;
  const years = rows.map((r) => r.p.updated).filter((d): d is number => !!d).map((d) => new Date(d).getFullYear());
  const standards = countBy(rows, (r) => r.p.standard);
  const tools = countBy(rows, (r) => r.p.tool);

  // --- filter state ---
  const state = {
    q: '',
    standard: '',
    tool: '',
    status: '',
    age: '',
    sort: { key: 'title' as SortKey, dir: 1 },
  };

  const select = (label: string, key: 'standard' | 'tool' | 'status' | 'age', options: [string, string][]) => {
    const id = `filter-${key}`;
    const el = h(
      'select',
      { id, on: { change: () => { state[key] = el.value; update(); } } },
      options.map(([value, text]) => h('option', { value }, text)),
    );
    return { el, wrap: h('div', { class: 'field' }, h('label', { for: id }, label), el) };
  };

  const standardSel = select('Standard', 'standard', [['', 'All'], ...standards.map(([s, n]): [string, string] => [s, `${s} (${n})`])]);
  const toolSel = select('Authoring tool', 'tool', [['', 'All'], ...tools.map(([t, n]): [string, string] => [t, `${t} (${n})`])]);
  const statusSel = select('Status', 'status', [
    ['', 'All'],
    ['broken', 'Broken'],
    ['check', 'Needs a check'],
    ['ok', 'OK'],
    ['flash', 'Uses Flash'],
    ['dup', 'Duplicates'],
    ['versions', 'Has other versions'],
  ]);
  const ageSel = select('Last updated', 'age', [
    ['', 'Any time'],
    ['3', 'More than 3 years ago'],
    ['5', 'More than 5 years ago'],
    ['10', 'More than 10 years ago'],
  ]);

  const search = h('input', {
    id: 'filter-q',
    type: 'search',
    placeholder: 'Title, folder, tool or course ID',
    autocomplete: 'off',
  });
  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.q = search.value.trim().toLowerCase();
      update();
    }, 120);
  });

  const countLine = h('p', { class: 'count', 'aria-live': 'polite' });
  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'link-button',
      hidden: true,
      on: {
        click: () => {
          Object.assign(state, { q: '', standard: '', tool: '', status: '', age: '' });
          search.value = '';
          for (const s of [standardSel, toolSel, statusSel, ageSel]) s.el.value = '';
          update();
        },
      },
    },
    'Clear filters',
  );
  const exportBtn = h('button', { type: 'button', class: 'button button-quiet' }, icon('download'), h('span', null, 'Export CSV'));

  // Quick filters from the summary: a click on a value sets the matching filter
  const quick = (sel: { el: HTMLSelectElement }, key: 'standard' | 'tool', value: string, text: string, n: number) =>
    h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          on: {
            click: () => {
              state[key] = state[key] === value ? '' : value;
              sel.el.value = state[key];
              update();
              document.getElementById('library-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
        },
        h('span', null, text),
        h('span', { class: 'chip-count' }, formatNumber(n)),
      ),
    );

  // --- table ---
  const columns: { key: SortKey; label: string; cls?: string }[] = [
    { key: 'title', label: 'Course' },
    { key: 'standard', label: 'Standard' },
    { key: 'tool', label: 'Authoring tool' },
    { key: 'size', label: 'Size', cls: 'num' },
    { key: 'files', label: 'Files', cls: 'num' },
    { key: 'updated', label: 'Updated' },
    { key: 'status', label: 'Status' },
  ];
  const headCells = columns.map((c) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'sort-button',
        on: {
          click: () => {
            state.sort = state.sort.key === c.key ? { key: c.key, dir: -state.sort.dir } : { key: c.key, dir: c.key === 'size' || c.key === 'files' || c.key === 'status' || c.key === 'updated' ? -1 : 1 };
            update();
          },
        },
      },
      c.label,
      h('span', { class: 'sort-mark', 'aria-hidden': 'true' }),
    );
    return { c, th: h('th', { scope: 'col', class: c.cls }, btn) };
  });
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'library-table', id: 'library-table' },
    h('caption', { class: 'visually-hidden' }, `Courses in ${result.rootName}`),
    h('thead', null, h('tr', null, headCells.map((x) => x.th))),
    tbody,
  );
  const emptyFiltered = h('p', { class: 'empty-filtered', hidden: true }, 'No courses match these filters.');

  const ctx = { byId, relations, onPlay: opts.onPlay };

  const rowEl = (r: Row) => {
    const p = r.p;
    const top = topIssue(r.issues);
    const open = () => openDetails(p, ctx);
    const btn = h('button', { type: 'button', class: 'row-button', on: { click: open } }, p.title);
    const tr = h(
      'tr',
      { class: `row row-${r.status}` },
      h('td', { class: 'col-title', 'data-label': 'Course' }, btn, h('span', { class: 'path' }, displayPath(p))),
      h('td', { 'data-label': 'Standard' }, p.standard),
      h('td', { 'data-label': 'Authoring tool', class: p.tool === 'Unknown' ? 'muted' : undefined }, p.tool),
      h('td', { class: 'num col-size', 'data-label': 'Size' }, h('span', null, formatBytes(p.totalBytes)), miniStrata(p.composition, p.totalBytes)),
      h('td', { class: 'num', 'data-label': 'Files' }, formatNumber(p.fileCount)),
      h('td', { 'data-label': 'Updated', title: formatDay(p.updated) }, formatMonth(p.updated)),
      h(
        'td',
        { class: 'col-status', 'data-label': 'Status' },
        h('span', { class: `status status-${r.status}` }, icon(r.status === 'broken' ? 'error' : r.status === 'check' ? 'warning' : 'ok'), STATUS_LABEL[r.status]),
        top ? h('span', { class: 'status-note' }, top.message) : null,
        r.dup ? h('span', { class: 'tag' }, 'Duplicate') : null,
      ),
    );
    // A click anywhere in the row works like a click on the title (for the mouse); the keyboard uses the button
    tr.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) open();
    });
    return tr;
  };

  const compare = (a: Row, b: Row): number => {
    const d = state.sort.dir;
    const k = state.sort.key;
    const by = (x: number | string, y: number | string) =>
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    let v = 0;
    if (k === 'title') v = by(a.p.title, b.p.title);
    else if (k === 'standard') v = by(a.p.standard, b.p.standard);
    else if (k === 'tool') v = by(a.p.tool, b.p.tool);
    else if (k === 'size') v = by(a.p.totalBytes, b.p.totalBytes);
    else if (k === 'files') v = by(a.p.fileCount, b.p.fileCount);
    else if (k === 'updated') v = by(a.p.updated ?? 0, b.p.updated ?? 0);
    else if (k === 'status') v = by(a.score, b.score);
    return v * d || a.p.title.localeCompare(b.p.title);
  };

  let visible: Row[] = rows;

  function update() {
    const now = Date.now();
    visible = rows.filter((r) => {
      if (state.q && !r.haystack.includes(state.q)) return false;
      if (state.standard && r.p.standard !== state.standard) return false;
      if (state.tool && r.p.tool !== state.tool) return false;
      if (state.status) {
        if (state.status === 'flash' && !r.flash) return false;
        if (state.status === 'dup' && !r.dup) return false;
        if (state.status === 'versions' && !r.versions) return false;
        if (['broken', 'check', 'ok'].includes(state.status) && r.status !== state.status) return false;
      }
      if (state.age) {
        if (!r.p.updated || now - r.p.updated < Number(state.age) * YEAR) return false;
      }
      return true;
    });
    visible.sort(compare);
    tbody.replaceChildren(...visible.map(rowEl));

    for (const { c, th } of headCells) {
      th.setAttribute('aria-sort', state.sort.key === c.key ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    const filtered = !!(state.q || state.standard || state.tool || state.status || state.age);
    countLine.textContent = filtered
      ? `Showing ${formatNumber(visible.length)} of ${plural(rows.length, 'course')}`
      : `${plural(rows.length, 'course')}`;
    resetBtn.hidden = !filtered;
    emptyFiltered.hidden = visible.length > 0;
    table.hidden = visible.length === 0;
    exportBtn.lastElementChild!.textContent = filtered ? `Export ${formatNumber(visible.length)} to CSV` : 'Export CSV';
    document.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => {
      const label = chip.firstElementChild?.textContent ?? '';
      chip.setAttribute('aria-pressed', String(label === state.standard || label === state.tool));
    });
  }

  exportBtn.addEventListener('click', () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`scorm-library-${safeFileName(result.rootName)}-${date}.csv`, buildCsv(visible.map((r) => r.p), relations, byId));
  });

  // --- assembling the screen ---
  const banners = [
    opts.savedOnly
      ? h(
          'p',
          { class: 'banner' },
          `Saved results from ${formatDay(result.scannedAt)}. Scan again to see changes since then.`,
        )
      : null,
    !result.complete
      ? h('p', { class: 'banner banner-warning' }, 'The scan was stopped early, so this list may be incomplete.')
      : null,
  ];

  const actions = h(
    'div',
    { class: 'library-actions' },
    h('button', { type: 'button', class: 'button button-quiet', on: { click: opts.onRescan } }, icon('refresh'), h('span', null, `Scan “${result.rootName}” again`)),
    h('button', { type: 'button', class: 'button button-quiet', on: { click: opts.onOpenAnother } }, icon('folder'), h('span', null, 'Open another folder')),
  );

  if (!rows.length) {
    mount(
      container,
      h(
        'section',
        { class: 'library library-empty' },
        banners,
        h('h1', { class: 'library-title' }, `No courses found in “${result.rootName}”`),
        h(
          'p',
          { class: 'lede' },
          'The toolkit looks for ZIP files and folders that contain imsmanifest.xml (SCORM), cmi5.xml, tincan.xml (xAPI) or an AICC .crs file. Check that you opened the folder that holds your course exports.',
        ),
        actions,
        skippedBlock(),
      ),
    );
    return;
  }

  function skippedBlock() {
    if (!result.skipped.length) return null;
    return h(
      'details',
      { class: 'skipped' },
      h('summary', null, `${plural(result.skipped.length, 'item')} skipped`),
      h(
        'ul',
        null,
        result.skipped.map((s) => h('li', null, h('span', { class: 'path' }, s.path), h('span', null, s.reason))),
      ),
    );
  }

  const yearText = years.length
    ? Math.min(...years) === Math.max(...years)
      ? String(years[0])
      : `${Math.min(...years)} to ${Math.max(...years)}`
    : 'Unknown';

  mount(
    container,
    h(
      'section',
      { class: 'library' },
      banners,
      h(
        'header',
        { class: 'library-head' },
        h('p', { class: 'library-folder' }, icon('folder'), h('span', null, result.rootName)),
        h('h1', { class: 'library-title' }, `${plural(rows.length, 'course')}, ${formatBytes(totalBytes)}`),
        h('p', { class: 'library-verdict' }, verdict(rows, redundant)),
      ),
      h(
        'div',
        { class: 'overview' },
        strata(composition, totalBytes, 'What the archive is made of'),
        h(
          'dl',
          { class: 'overview-facts' },
          h('div', null, h('dt', null, 'Standards'), h('dd', null, h('ul', { class: 'chips' }, standards.map(([s, n]) => quick(standardSel, 'standard', s, s, n))))),
          h('div', null, h('dt', null, 'Authoring tools'), h('dd', null, h('ul', { class: 'chips' }, tools.map(([t, n]) => quick(toolSel, 'tool', t, t, n))))),
          h('div', null, h('dt', null, 'Updated'), h('dd', { class: 'overview-years' }, yearText)),
        ),
      ),
      actions,
      h(
        'div',
        { class: 'toolbar', role: 'search' },
        h('div', { class: 'field field-search' }, h('label', { for: 'filter-q' }, 'Search'), search),
        standardSel.wrap,
        toolSel.wrap,
        statusSel.wrap,
        ageSel.wrap,
      ),
      h('div', { class: 'table-meta' }, countLine, resetBtn, h('span', { class: 'spacer' }), exportBtn),
      h('div', { class: 'table-wrap' }, table, emptyFiltered),
      skippedBlock(),
    ),
  );
  update();
}
