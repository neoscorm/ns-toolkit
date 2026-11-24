// "Strata" — a bar showing what a package or the whole archive is made of by volume

import type { Category } from '../types';
import { CATEGORIES } from '../scorm/composition';
import { formatBytes } from '../util';
import { h } from './dom';

type Composition = Partial<Record<Category, number>>;

function segments(comp: Composition, total: number) {
  return CATEGORIES.map((c) => ({ ...c, bytes: comp[c.key] ?? 0 }))
    .filter((s) => s.bytes > 0)
    .map((s) => ({ ...s, share: total > 0 ? s.bytes / total : 0 }));
}

const pct = (share: number) => {
  const v = share * 100;
  if (v > 0 && v < 1) return '<1%';
  return `${Math.round(v)}%`;
};

/** A thin bar for a table row — decorative, the data is duplicated in the card */
export function miniStrata(comp: Composition, total: number): HTMLElement {
  return h(
    'span',
    { class: 'strata strata-mini', 'aria-hidden': 'true' },
    segments(comp, total).map((s) => h('span', { class: `layer layer-${s.key}`, style: { 'flex-grow': String(s.bytes) } })),
  );
}

/** A bar with labels: used in the archive summary and in the package card */
export function strata(comp: Composition, total: number, caption: string): HTMLElement {
  const segs = segments(comp, total);
  return h(
    'figure',
    { class: 'strata-block' },
    h('figcaption', { class: 'strata-caption' }, caption),
    h(
      'div',
      { class: 'strata strata-large', 'aria-hidden': 'true' },
      segs.map((s) =>
        h('span', { class: `layer layer-${s.key}`, style: { 'flex-grow': String(s.bytes) }, title: `${s.label}: ${formatBytes(s.bytes)}` }),
      ),
    ),
    h(
      'ul',
      { class: 'strata-legend' },
      segs.map((s) =>
        h(
          'li',
          { class: `legend-item legend-${s.key}` },
          h('span', { class: `swatch layer-${s.key}`, 'aria-hidden': 'true' }),
          h('span', { class: 'legend-label' }, s.label),
          h('span', { class: 'legend-value' }, `${formatBytes(s.bytes)}, ${pct(s.share)}`),
        ),
      ),
    ),
  );
}
