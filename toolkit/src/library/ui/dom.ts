// A minimal helper for creating DOM elements without a framework.
// Styles are set only through the style property (CSSOM), not as an attribute,
// so as not to violate the page's Content Security Policy (CSP).

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = {
  class?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  style?: Partial<Record<string, string>>;
  [attr: string]: unknown;
};

export function append(el: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'on') {
        for (const [ev, fn] of Object.entries(value as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
      } else if (key === 'style') {
        for (const [prop, v] of Object.entries(value as Record<string, string>)) el.style.setProperty(prop, v);
      } else if (typeof value === 'boolean' || key === 'value') {
        // DOM properties: hidden, disabled, value, selected, open...
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, kids);
  return el;
}

/** Clears the container and inserts new content */
export function mount(container: Element, ...kids: Child[]): void {
  container.replaceChildren();
  append(container, kids);
}

// --- icons (outline, 24×24) ---

const ICONS: Record<string, string> = {
  folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l1.8 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  error: 'M12 3.5l9 16H3zM12 10v4.5M12 17.2v.3',
  warning: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5v5.5M12 16v.3',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5.5M12 7.7v.3',
  ok: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8 12.2l2.7 2.7L16.2 9.4',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  zip: 'M6 3h9l4 4v14H6zM11 3v2h2v2h-2v2h2v2h-2v3h2',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  play: 'M8 5.5v13l10.5-6.5z',
  back: 'M19 12H5m0 0l6-6m-6 6l6 6',
};

export function icon(name: keyof typeof ICONS | string, label?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.info);
  svg.appendChild(path);
  return svg;
}
