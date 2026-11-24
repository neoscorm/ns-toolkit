// Toolkit entry point: folder choice, scanning, the course list and the player.
// Courses open in the sandbox at another address (docs/API.md). Only the toolkit reads files.

import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/inter/standard.css';
import './library/styles.css';

import { ensurePermission, pickDirectory, pickWithInput, readDrop, supportsPicker, type Root } from './library/fs/access';
import { fromHandle } from './library/fs/nodes';
import { scan } from './library/scan';
import { kv } from './library/store/db';
import type { PackageInfo, ScanResult } from './library/types';
import { config } from './config';
import { renderStart, renderScanning } from './library/ui/screens';
import { confirmFolderAccess } from './library/ui/folder-notice';
import { renderLibrary } from './library/ui/library';
import { collectFiles, playability, scoList } from './library/player/launch';
import { renderPlayer } from './library/player/view';

const view = document.getElementById('view')!;
const playerRoot = document.getElementById('player-root')!;

let scanning = false;
/** The player is open: dropping a folder and a second launch do not work meanwhile */
let busy = false;
/** The folder currently open — needed to get the course files for the player */
let currentRoot: Root | undefined;

// The saved folder's name is stored separately, and the handle itself is read only on a click.
// Reason: in incognito mode Chromium can close the tab when a handle is read
// from IndexedDB — this way a failure will not stop the page from opening.
async function savedState() {
  const saved = await kv.get<ScanResult>('snapshot');
  const rootName = supportsPicker ? await kv.get<string>('rootName') : undefined;
  return { saved, rootName };
}

async function reopenSaved(): Promise<void> {
  const handle = await kv.get<FileSystemDirectoryHandle>('root');
  if (handle) await reopen(handle);
  else await openFolder();
}

async function showStart(): Promise<void> {
  const { saved, rootName } = await savedState();
  renderStart(view, {
    saved,
    canReopen: !!saved && rootName === saved.rootName,
    onOpen: openFolder,
    onReopen: reopenSaved,
    onShowSaved: () => saved && showLibrary(saved, true),
  });
  focusMain();
}

function showLibrary(result: ScanResult, savedOnly: boolean, root?: Root): void {
  renderLibrary(view, result, {
    savedOnly,
    onRescan: async () => {
      if (root) return startScan(root);
      const { rootName } = await savedState();
      if (rootName === result.rootName) return reopenSaved();
      return openFolder();
    },
    onOpenAnother: openFolder,
    onPlay: (pkg) => void play(pkg, result),
  });
  focusMain();
}

/** Restores access to the folder if it was opened before (Chrome/Edge remember the handle) */
async function regainRoot(rootName: string): Promise<Root | undefined> {
  const { rootName: saved } = await savedState();
  if (saved !== rootName) return undefined;
  const handle = await kv.get<FileSystemDirectoryHandle>('root');
  if (!handle || !(await ensurePermission(handle))) return undefined;
  currentRoot = { name: handle.name, node: fromHandle(handle), handle };
  return currentRoot;
}

/** The folder the list is shown from; null — it must be opened again */
async function rootFor(result: ScanResult, action: string): Promise<Root | null> {
  const root = currentRoot?.name === result.rootName ? currentRoot : await regainRoot(result.rootName);
  if (root) return root;
  notify(`To ${action} courses, open “${result.rootName}” again.`);
  await openFolder();
  return null;
}

// --- the list page is hidden while the player runs (filters and scroll position are kept) ---

function hidePage(): () => void {
  busy = true;
  const scrollY = window.scrollY;
  const page = [...document.querySelectorAll<HTMLElement>('.site-header, #view, .site-footer, .skip-link')];
  page.forEach((el) => (el.hidden = true));
  return () => {
    page.forEach((el) => (el.hidden = false));
    window.scrollTo({ top: scrollY });
    busy = false;
  };
}

// --- player ---

async function play(pkg: PackageInfo, result: ScanResult): Promise<void> {
  const check = playability(pkg);
  if (!check.ok || busy) return;
  const root = await rootFor(result, 'play');
  if (!root) return;
  try {
    const files = await collectFiles(root, pkg);
    const showPage = hidePage();
    playerRoot.hidden = false;
    renderPlayer(playerRoot, {
      pkg,
      files,
      tracking: check.tracking,
      scos: scoList(pkg),
      onClose: () => {
        playerRoot.hidden = true;
        playerRoot.replaceChildren();
        showPage();
      },
    });
  } catch (e) {
    alertError(e);
  }
}

// --- folder choice and scanning ---

async function openFolder(): Promise<void> {
  try {
    // First we explain what the browser will ask; the system window opens only after a click
    if (supportsPicker && !(await confirmFolderAccess())) return;
    const root = supportsPicker ? await pickDirectory() : await pickWithInput();
    if (root) await startScan(root);
  } catch (e) {
    alertError(e);
  }
}

async function reopen(handle: FileSystemDirectoryHandle): Promise<void> {
  // The permission request must come right after the user's click
  if (await ensurePermission(handle)) {
    await startScan({ name: handle.name, node: fromHandle(handle), handle });
  } else {
    openFolder();
  }
}

async function startScan(root: Root): Promise<void> {
  if (scanning) return;
  scanning = true;
  const controller = new AbortController();
  const ui = renderScanning(view, root.name, () => controller.abort());
  try {
    currentRoot = root;
    if (root.handle) {
      await kv.set('root', root.handle);
      await kv.set('rootName', root.handle.name);
    }
    const result = await scan(root, { useCache: true, signal: controller.signal, onProgress: ui.update });
    await kv.set('snapshot', result);
    showLibrary(result, false, root);
  } catch (e) {
    alertError(e);
    await showStart();
  } finally {
    scanning = false;
  }
}

function notify(text: string): void {
  const box = document.getElementById('error-box')!;
  box.textContent = text;
  box.hidden = false;
  setTimeout(() => (box.hidden = true), 8000);
}

function alertError(e: unknown): void {
  notify(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
}

function focusMain(): void {
  // Move focus to the heading of the new screen — so a screen reader announces the screen change
  const heading = view.querySelector<HTMLElement>('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0 });
}

// --- dragging a folder anywhere on the page ---
const overlay = document.getElementById('drop-overlay')!;
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || scanning || busy) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  if (!e.dataTransfer || scanning || busy) return;
  readDrop(e.dataTransfer)
    .then((root) => root && startScan(root))
    .catch(alertError);
});

// --- header links ---
const gh = document.getElementById('github-link') as HTMLAnchorElement | null;
if (gh && config.githubUrl) {
  gh.href = config.githubUrl;
  gh.hidden = false;
}

showStart();
