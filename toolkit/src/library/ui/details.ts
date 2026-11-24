// Package card: opens over the table in a native <dialog>

import type { Issue, OutlineItem, PackageInfo, Relations } from '../types';
import { allIssues } from '../relations';
import { config } from '../../config';
import { displayPath, formatBytes, formatDay, formatNumber, plural } from '../util';
import { h, icon, mount } from './dom';
import { strata } from './strata';
import { STATUS_LABEL, statusOf } from './status';
import { playability } from '../player/launch';

export interface DetailsContext {
  byId: Map<string, PackageInfo>;
  relations: Map<string, Relations>;
  /** Launching the course in the player */
  onPlay: (pkg: PackageInfo) => void;
}

let dialog: HTMLDialogElement | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  dialog = h('dialog', { class: 'drawer', 'aria-labelledby': 'pkg-title' });
  // A click on the darkened background around the panel closes it
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog!.close();
  });
  document.body.appendChild(dialog);
  return dialog;
}

function issueItem(i: Issue): HTMLElement {
  return h(
    'li',
    { class: `issue issue-${i.severity}` },
    icon(i.severity, i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Note'),
    h('div', null, h('p', { class: 'issue-message' }, i.message), i.detail && h('p', { class: 'issue-detail' }, i.detail)),
  );
}

function outlineList(items: OutlineItem[]): HTMLElement {
  return h(
    'ul',
    { class: 'outline' },
    items.map((it) => h('li', null, it.title, it.children.length ? outlineList(it.children) : null)),
  );
}

function countItems(items: OutlineItem[]): number {
  return items.reduce((n, it) => n + 1 + countItems(it.children), 0);
}

function fact(label: string, value: string | Node | undefined | null): HTMLElement[] | null {
  if (value == null || value === '') return null;
  return [h('dt', null, label), h('dd', null, value)];
}

export function openDetails(pkg: PackageInfo, ctx: DetailsContext): void {
  const dlg = ensureDialog();
  const rel = ctx.relations.get(pkg.id);
  const issues = allIssues(pkg, rel);
  const status = statusOf(issues);
  const problems = issues.filter((i) => i.severity !== 'info');
  const notes = issues.filter((i) => i.severity === 'info');
  const hasFlash = issues.some((i) => i.code.startsWith('flash'));

  const related = (ids: string[], label: string) =>
    ids.length
      ? h(
          'section',
          { class: 'drawer-section' },
          h('h3', null, label),
          h(
            'ul',
            { class: 'related' },
            ids.map((id) => {
              const other = ctx.byId.get(id);
              if (!other) return null;
              return h(
                'li',
                null,
                h(
                  'button',
                  { type: 'button', class: 'link-button', on: { click: () => openDetails(other, ctx) } },
                  other.title,
                ),
                h('span', { class: 'path' }, displayPath(other)),
              );
            }),
          ),
        )
      : null;

  const outlineCount = countItems(pkg.outline);
  const play = playability(pkg);
  const playBlock = play.ok
    ? h(
        'div',
        { class: 'play-block' },
        h(
          'button',
          {
            type: 'button',
            class: 'button button-primary',
            on: {
              click: () => {
                dlg.close();
                ctx.onPlay(pkg);
              },
            },
          },
          icon('play'),
          h('span', null, 'Play course'),
        ),
        h(
          'p',
          { class: 'hint' },
          play.tracking === 'none'
            ? 'Opens here. xAPI and cmi5 progress is not recorded.'
            : 'Opens here, with a log of everything the course reports to the LMS.',
        ),
      )
    : h('p', { class: 'play-blocked' }, icon('info'), h('span', null, play.reason));

  mount(
    dlg,
    h(
      'div',
      { class: 'drawer-body' },
      h(
        'header',
        { class: 'drawer-head' },
        h(
          'div',
          null,
          h('p', { class: `status-pill status-${status}` }, STATUS_LABEL[status]),
          h('h2', { id: 'pkg-title' }, pkg.title),
          h('p', { class: 'path' }, displayPath(pkg)),
          playBlock,
        ),
        h(
          'button',
          { type: 'button', class: 'icon-button', autofocus: true, on: { click: () => dlg.close() } },
          icon('close'),
          h('span', { class: 'visually-hidden' }, 'Close'),
        ),
      ),

      h(
        'section',
        { class: 'drawer-section' },
        h('h3', null, problems.length ? plural(problems.length, 'problem') : 'Problems'),
        problems.length
          ? h('ul', { class: 'issues' }, problems.map(issueItem))
          : h('p', { class: 'muted' }, 'Nothing here should stop this course from working in a modern LMS.'),
        notes.length ? h('ul', { class: 'issues issues-notes' }, notes.map(issueItem)) : null,
      ),

      problems.length
        ? h(
            'aside',
            { class: 'offer' },
            h('h3', null, hasFlash ? 'This course can be rebuilt in HTML5' : 'This course can be rebuilt cleanly'),
            h(
              'p',
              null,
              'neoScorm rebuilds old SCORM courses as modern HTML5 packages that play in any LMS and any browser, without depending on one authoring tool.',
            ),
            h('a', { class: 'button button-secondary', href: config.contactUrl, target: '_blank', rel: 'noopener' }, 'Talk to neoScorm'),
          )
        : null,

      h(
        'section',
        { class: 'drawer-section' },
        h('h3', null, 'Package'),
        h(
          'dl',
          { class: 'facts' },
          fact('Standard', pkg.standardDetail ? `${pkg.standard}, ${pkg.standardDetail}` : pkg.standard),
          fact('Authoring tool', pkg.tool),
          fact('Start file', pkg.launch),
          fact('SCOs', pkg.scoCount ? formatNumber(pkg.scoCount) : null),
          fact('Files', formatNumber(pkg.fileCount)),
          fact(
            'Size',
            pkg.kind === 'zip' && pkg.diskBytes !== pkg.totalBytes
              ? `${formatBytes(pkg.totalBytes)} unpacked, ${formatBytes(pkg.diskBytes)} as ZIP`
              : formatBytes(pkg.totalBytes),
          ),
          fact('Newest file', formatDay(pkg.updated)),
          fact('Course ID', pkg.identifier),
        ),
      ),

      pkg.totalBytes > 0
        ? h('section', { class: 'drawer-section' }, strata(pkg.composition, pkg.totalBytes, 'What it is made of'))
        : null,

      outlineCount
        ? h(
            'section',
            { class: 'drawer-section' },
            h(
              'details',
              { open: outlineCount <= 12 },
              h('summary', null, h('h3', null, `Structure, ${plural(outlineCount, 'item')}`)),
              outlineList(pkg.outline),
            ),
          )
        : null,

      related(rel?.duplicates ?? [], 'Exact duplicates'),
      related(rel?.versions ?? [], 'Other versions'),
    ),
  );

  if (!dlg.open) dlg.showModal();
  dlg.querySelector<HTMLElement>('.drawer-body')?.scrollTo({ top: 0 });
}
