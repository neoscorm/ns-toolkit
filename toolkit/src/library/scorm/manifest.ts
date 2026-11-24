// Parsing the package descriptor files:
// imsmanifest.xml (SCORM), tincan.xml (xAPI), cmi5.xml (cmi5), *.crs (AICC).

import type { OutlineItem, Standard } from '../types';

export type DescriptorType = 'scorm' | 'cmi5' | 'tincan' | 'aicc';

export interface ManifestData {
  /** The XML was parsed without errors */
  ok: boolean;
  standard: Standard;
  standardDetail?: string;
  title?: string;
  identifier?: string;
  outline: OutlineItem[];
  /** Launch file relative to the package root, without parameters */
  launch?: string;
  /** External launch address (http...) — such packages only link to a course on the internet */
  externalLaunch?: string;
  scoCount: number;
  /** All local files mentioned in the descriptor */
  referenced: string[];
}

// --- helper functions for XML with any namespace prefixes ---

const all = (parent: Document | Element, name: string) => [...parent.getElementsByTagNameNS('*', name)];

const kids = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);

const kid = (el: Element | undefined, name: string) => (el ? kids(el, name)[0] : undefined);

/** Attribute by local name, ignoring prefix and case (adlcp:scormType = scormtype) */
function attr(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const lower = name.toLowerCase();
  for (const a of el.attributes) if (a.localName.toLowerCase() === lower) return a.value.trim();
  return undefined;
}

const text = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() || undefined;

function parseXml(source: string): Document | null {
  const doc = new DOMParser().parseFromString(source.replace(/^﻿/, ''), 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/** Joins the base path and a link, expands %20, ./ and ../ ; external links → null */
export function resolvePath(base: string, href: string): string | null {
  if (!href || isExternal(href)) return null;
  let h = href.split(/[?#]/)[0];
  try {
    h = decodeURIComponent(h);
  } catch {
    // a link with broken encoding — leave as is
  }
  h = h.replace(/\\/g, '/');
  const parts = h.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const seg of h.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/') || null;
}

const joinBase = (a: string, b: string) => {
  if (!b) return a;
  if (isExternal(b) || b.startsWith('/')) return b;
  return (a && !a.endsWith('/') ? `${a}/` : a) + b;
};

/** The part of a link after the path: ?parameters and the #anchor */
const suffixOf = (href: string) => {
  const i = href.search(/[?#]/);
  return i >= 0 ? href.slice(i) : '';
};

/** Appends launch parameters from the parameters attribute to the address (IMS Content Packaging rules) */
function withParameters(href: string, params?: string): string {
  const p = params?.trim();
  if (!p) return href;
  if (p.startsWith('#')) return href.includes('#') ? href : href + p;
  const query = p.replace(/^[?&]/, '');
  return href + (href.includes('?') ? '&' : '?') + query;
}

const empty = (standard: Standard): ManifestData => ({
  ok: false,
  standard,
  outline: [],
  scoCount: 0,
  referenced: [],
});

// --- SCORM: imsmanifest.xml ---

function detectScormVersion(doc: Document, source: string): { standard: Standard; detail?: string } {
  const sv = text(all(doc, 'schemaversion')[0]) ?? '';
  if (/^1\.2$/.test(sv)) return { standard: 'SCORM 1.2' };
  if (/^1\.1$/.test(sv)) return { standard: 'SCORM 1.1' };
  if (/2004|CAM\s*1\.3/i.test(sv)) {
    const ed = sv.match(/(\d)\s*(st|nd|rd|th)\s+edition/i);
    return { standard: 'SCORM 2004', detail: ed ? `${ed[1]}${ed[2].toLowerCase()} edition` : sv };
  }
  // No version specified — look at the namespaces
  if (source.includes('adlcp_rootv1p2')) return { standard: 'SCORM 1.2' };
  if (/adlcp_v1p3|imsss|adlseq/.test(source)) return { standard: 'SCORM 2004' };
  return { standard: 'SCORM' };
}

/** Title from LOM metadata: general/title/langstring (1.2) or string (2004) */
function lomTitle(doc: Document): string | undefined {
  const general = all(doc, 'general')[0];
  const title = kid(general, 'title');
  if (!title) return undefined;
  return text(all(title, 'langstring')[0] ?? all(title, 'string')[0] ?? title);
}

export function parseScorm(source: string): ManifestData {
  const doc = parseXml(source);
  if (!doc) return empty(source.includes('adlcp_rootv1p2') ? 'SCORM 1.2' : 'SCORM');
  const { standard, detail } = detectScormVersion(doc, source);

  // Resources: the course files and an indication of which one to launch
  const resourcesEl = all(doc, 'resources')[0];
  const rootBase = attr(resourcesEl, 'base') ?? '';
  const resources = new Map<string, { href?: string; launch?: string; external?: string; sco: boolean }>();
  const referenced = new Set<string>();
  let scoCount = 0;

  for (const r of all(doc, 'resource')) {
    const base = joinBase(rootBase, attr(r, 'base') ?? '');
    const href = attr(r, 'href');
    const sco = (attr(r, 'scormtype') ?? '').toLowerCase() === 'sco';
    if (sco) scoCount++;
    const resolved = href ? resolvePath(base, href) : null;
    if (resolved) referenced.add(resolved);
    for (const f of kids(r, 'file')) {
      const fh = attr(f, 'href');
      const p = fh ? resolvePath(base, fh) : null;
      if (p) referenced.add(p);
    }
    const id = attr(r, 'identifier');
    if (id) {
      resources.set(id, {
        href: resolved ?? undefined,
        // The launch address keeps the resource's original ?parameters
        launch: resolved && href ? resolved + suffixOf(href) : undefined,
        external: href && isExternal(joinBase(base, href)) ? joinBase(base, href) : undefined,
        sco,
      });
    }
  }

  // Course structure: the default organization and its items
  const orgsEl = all(doc, 'organizations')[0];
  const orgs = orgsEl ? kids(orgsEl, 'organization') : [];
  const defaultId = attr(orgsEl, 'default');
  const org = orgs.find((o) => attr(o, 'identifier') === defaultId) ?? orgs[0];

  let launch: string | undefined;
  let externalLaunch: string | undefined;
  const walk = (el: Element): OutlineItem[] =>
    kids(el, 'item').map((item) => {
      const ref = attr(item, 'identifierref');
      const res = ref ? resources.get(ref) : undefined;
      if (res && !launch && !externalLaunch) {
        if (res.href) launch = res.href;
        else if (res.external) externalLaunch = res.external;
      }
      const href = res?.launch ? withParameters(res.launch, attr(item, 'parameters')) : undefined;
      return { title: text(kid(item, 'title')) ?? 'Untitled', href, children: walk(item) };
    });
  const outline = org ? walk(org) : [];

  // Fallback: the first SCO resource, then any resource with a launch file
  if (!launch && !externalLaunch) {
    const list = [...resources.values()];
    const pick = list.find((r) => r.sco && (r.href || r.external)) ?? list.find((r) => r.href || r.external);
    launch = pick?.href;
    externalLaunch = pick?.href ? undefined : pick?.external;
  }

  return {
    ok: true,
    standard,
    standardDetail: detail,
    title: text(kid(org, 'title')) ?? lomTitle(doc),
    identifier: attr(doc.documentElement, 'identifier'),
    outline,
    launch,
    externalLaunch,
    scoCount,
    referenced: [...referenced],
  };
}

// --- xAPI (Tin Can): tincan.xml ---

export function parseTincan(source: string): ManifestData {
  const doc = parseXml(source);
  if (!doc) return empty('xAPI');
  const activities = all(doc, 'activity');
  // A course is an activity with a launch file specified
  const course = activities.find((a) => kid(a, 'launch')) ?? activities[0];
  const launchRaw = text(kid(course, 'launch'));
  const launch = launchRaw ? resolvePath('', launchRaw) ?? undefined : undefined;
  return {
    ok: true,
    standard: 'xAPI',
    title: text(kid(course, 'name')),
    identifier: attr(course, 'id'),
    outline: [],
    launch,
    externalLaunch: launchRaw && !launch ? launchRaw : undefined,
    scoCount: 0,
    referenced: launch ? [launch] : [],
  };
}

// --- cmi5: cmi5.xml ---

export function parseCmi5(source: string): ManifestData {
  const doc = parseXml(source);
  if (!doc) return empty('cmi5');
  const titleOf = (el: Element | undefined) => {
    const t = kid(el, 'title');
    return t ? text(all(t, 'langstring')[0] ?? t) : undefined;
  };
  const course = all(doc, 'course')[0];
  const aus = all(doc, 'au');
  const urls = aus.map((au) => text(kid(au, 'url'))).filter((u): u is string => !!u);
  const local = urls.map((u) => resolvePath('', u)).filter((u): u is string => !!u);
  return {
    ok: true,
    standard: 'cmi5',
    title: titleOf(course),
    identifier: attr(course, 'id'),
    outline: aus.map((au) => {
      const url = text(kid(au, 'url'));
      const local = url ? resolvePath('', url) : null;
      return { title: titleOf(au) ?? 'Untitled', href: local ? local + suffixOf(url!) : undefined, children: [] };
    }),
    launch: local[0],
    externalLaunch: !local.length ? urls[0] : undefined,
    scoCount: aus.length,
    referenced: local,
  };
}

// --- AICC: a .crs file in INI format ---

export function parseAicc(source: string): ManifestData {
  const title = source.match(/^\s*course_title\s*=\s*(.+)$/im)?.[1]?.trim();
  const id = source.match(/^\s*course_id\s*=\s*(.+)$/im)?.[1]?.trim();
  return {
    ok: true,
    standard: 'AICC',
    title: title?.replace(/^"|"$/g, ''),
    identifier: id,
    outline: [],
    scoCount: 0,
    referenced: [],
  };
}

export function parseDescriptor(type: DescriptorType, source: string): ManifestData {
  switch (type) {
    case 'scorm':
      return parseScorm(source);
    case 'tincan':
      return parseTincan(source);
    case 'cmi5':
      return parseCmi5(source);
    case 'aicc':
      return parseAicc(source);
  }
}

/** Descriptor file name → its type; order matters: if there are several, take the first */
export const DESCRIPTOR_FILES: [string, DescriptorType][] = [
  ['imsmanifest.xml', 'scorm'],
  ['cmi5.xml', 'cmi5'],
  ['tincan.xml', 'tincan'],
];

export function descriptorTypeOf(fileName: string): DescriptorType | undefined {
  const lower = fileName.toLowerCase();
  const hit = DESCRIPTOR_FILES.find(([n]) => n === lower);
  if (hit) return hit[1];
  if (lower.endsWith('.crs')) return 'aicc';
  return undefined;
}

export const DESCRIPTOR_RANK: Record<DescriptorType, number> = { scorm: 0, cmi5: 1, tincan: 2, aicc: 3 };
