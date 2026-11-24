// Start screen and scanning screen

import type { ScanResult } from '../types';
import type { ScanProgress } from '../scan';
import { config } from '../../config';
import { supportsInputDirectory, supportsPicker } from '../fs/access';
import { formatDay, formatNumber, plural } from '../util';
import { h, icon, mount } from './dom';
import { strata } from './strata';

export interface StartOptions {
  saved?: ScanResult;
  /** The saved folder can be opened again with one click (Chrome/Edge only) */
  canReopen: boolean;
  onOpen: () => void;
  onReopen: () => void;
  onShowSaved: () => void;
}

/** An example result — shows what you get after scanning */
function examplePanel(): HTMLElement {
  const gb = 1024 ** 3;
  return h(
    'aside',
    { class: 'example', 'aria-label': 'Example of a scanned archive' },
    h('p', { class: 'example-label' }, 'Example result'),
    h('p', { class: 'example-title' }, '143 courses, 18.4 GB'),
    h('p', { class: 'example-verdict' }, "12 won't work in a modern LMS and 15 need a check. 9 are copies of other courses."),
    strata(
      { video: 9.1 * gb, images: 3.4 * gb, audio: 1.9 * gb, code: 1.2 * gb, flash: 2.1 * gb, other: 0.7 * gb },
      18.4 * gb,
      'What the archive is made of',
    ),
  );
}

export function renderStart(container: HTMLElement, opts: StartOptions): void {
  const canPick = supportsPicker || supportsInputDirectory;
  const saved = opts.saved;

  mount(
    container,
    h(
      'section',
      { class: 'start' },
      h(
        'div',
        { class: 'start-main' },
        h('h1', { class: 'start-title' }, 'Take stock of your SCORM archive'),
        h(
          'p',
          { class: 'lede' },
          'Open a folder and see every course in it, zipped or unpacked: SCORM version, authoring tool, size, and anything that will break in a modern LMS.',
        ),
        canPick
          ? h(
              'div',
              { class: 'start-actions' },
              h('button', { type: 'button', class: 'button button-primary', on: { click: opts.onOpen } }, icon('folder'), h('span', null, 'Open folder')),
              h('p', { class: 'hint' }, 'or drop a folder anywhere on this page'),
            )
          : h('p', { class: 'banner banner-warning' }, "This browser can't open folders. Use Chrome, Edge or Firefox on a computer."),

        saved
          ? h(
              'div',
              { class: 'resume' },
              h(
                'p',
                null,
                `Last scan: “${saved.rootName}”, ${plural(saved.packages.length, 'course')}, ${formatDay(saved.scannedAt)}.`,
              ),
              h(
                'div',
                { class: 'resume-actions' },
                opts.canReopen
                  ? h('button', { type: 'button', class: 'button button-quiet', on: { click: opts.onReopen } }, icon('refresh'), h('span', null, `Scan “${saved.rootName}” again`))
                  : null,
                h('button', { type: 'button', class: 'button button-quiet', on: { click: opts.onShowSaved } }, h('span', null, 'Show saved results')),
              ),
            )
          : null,

        h(
          'ul',
          { class: 'promises' },
          h(
            'li',
            null,
            icon('lock'),
            h('div', null, h('h2', null, 'Nothing is uploaded'), h('p', null, 'The page is not allowed to send data anywhere. Files are read here, in your browser.')),
          ),
          h(
            'li',
            null,
            icon('zip'),
            h('div', null, h('h2', null, 'ZIPs stay as they are'), h('p', null, 'Archives are read in place. Nothing is unpacked, copied or changed.')),
          ),
          h(
            'li',
            null,
            icon('code'),
            h(
              'div',
              null,
              h('h2', null, 'Open source'),
              config.githubUrl
                ? h('p', null, 'Read the code to check these claims: ', h('a', { href: config.githubUrl, target: '_blank', rel: 'noopener' }, 'source on GitHub'), '.')
                : h('p', null, 'The code is public, so anyone can check these claims.'),
            ),
          ),
        ),
        h(
          'p',
          { class: 'browser-note' },
          supportsPicker
            ? 'Chrome and Edge can remember the folder, so next time it takes one click.'
            : "This browser can't remember the folder between visits, so you'll pick it again next time. Chrome and Edge can remember it.",
        ),
        h('p', { class: 'mobile-note' }, 'Open this page on a computer: phones and tablets don’t let websites read folders.'),
      ),
      examplePanel(),
    ),
  );
}

export interface ScanningView {
  update(p: ScanProgress): void;
}

export function renderScanning(container: HTMLElement, rootName: string, onStop: () => void): ScanningView {
  const status = h('p', { class: 'scan-status', 'aria-live': 'polite' }, 'Looking for courses…');
  const bar = h('progress', { class: 'scan-bar', 'aria-label': 'Scan progress' });
  const current = h('p', { class: 'path scan-current' });
  const stop = h('button', { type: 'button', class: 'button button-quiet', on: { click: onStop } }, 'Stop scan');

  mount(
    container,
    h('section', { class: 'scanning' }, h('h1', null, `Scanning “${rootName}”`), status, bar, current, stop),
  );
  stop.focus();

  let lastAnnounce = 0;
  return {
    update(p) {
      if (p.phase === 'discover') {
        bar.removeAttribute('value');
        status.textContent = `Looking for courses: ${plural(p.found, 'candidate')} in ${plural(p.folders, 'folder')}`;
        return;
      }
      bar.max = Math.max(1, p.total);
      bar.value = p.done;
      // A screen reader must not read out every change — update the text at most once a second
      const now = performance.now();
      if (now - lastAnnounce > 1000 || p.done === p.total) {
        status.textContent = p.total ? `Reading ${formatNumber(p.done)} of ${formatNumber(p.total)}` : 'No candidates found';
        lastAnnounce = now;
      }
      current.textContent = p.current ?? '';
    },
  };
}
