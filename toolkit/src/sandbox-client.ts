// The toolkit side of the neoscorm-sandbox/1 protocol (docs/API.md).
// Creates the sandbox window, sends commands, waits for replies and delivers events to subscribers.
// Everything that comes from the sandbox is checked: the sender's origin, the sender window, the shape.

import {
  PROTOCOL,
  REPLY_TIMEOUT,
  type FromSandbox,
  type PackageFiles,
  type SavedAttempt,
  type ToSandboxBody,
  type Tracking,
} from '../../shared/protocol';

type EventOf<T extends FromSandbox['type']> = Extract<FromSandbox, { type: T }>;
type Listener<T extends FromSandbox['type']> = (event: EventOf<T>) => void;

export class SandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface OpenOptions {
  title: string;
  files: PackageFiles;
  scos?: { title: string; href: string }[];
  declared?: Tracking;
  /** Saved progress */
  attempt?: SavedAttempt;
}

export class SandboxClient {
  readonly frame: HTMLIFrameElement;
  private nextId = 1;
  private pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private listeners = new Map<string, Set<(e: FromSandbox) => void>>();
  private ready: Promise<void>;

  constructor(
    container: HTMLElement,
    private readonly origin: string,
  ) {
    this.frame = document.createElement('iframe');
    this.frame.title = 'Course';
    // Without allow-top-navigation: a course cannot take the toolkit tab away
    this.frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation',
    );
    this.frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write';
    window.addEventListener('message', this.onMessage);
    this.ready = new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new SandboxError('timeout', `The course window did not start. Is the sandbox running at ${origin}?`)),
        15000,
      );
      const off = this.on('ready', () => {
        window.clearTimeout(timer);
        off();
        resolve();
      });
      this.on('error', (e) => {
        window.clearTimeout(timer);
        reject(new SandboxError('failed', e.message));
      });
    });
    this.frame.src = `${origin}/`;
    container.replaceChildren(this.frame);
  }

  on<T extends FromSandbox['type']>(type: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener as (e: FromSandbox) => void);
    return () => set!.delete(listener as (e: FromSandbox) => void);
  }

  async open(options: OpenOptions): Promise<void> {
    await this.ready;
    await this.request({
      type: 'open',
      id: 0,
      session: Math.random().toString(36).slice(2, 12),
      title: options.title,
      declared: options.declared ?? 'scorm12',
      files: options.files,
      scos: options.scos ?? [{ title: options.title, href: 'index.html' }],
      start: 0,
      ...(options.attempt ? { attempt: options.attempt } : {}),
    });
  }

  goto(index: number): void {
    this.send({ type: 'goto', index });
  }

  close(): void {
    this.send({ type: 'close' });
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) {
      window.clearTimeout(p.timer);
      p.reject(new SandboxError('closed', 'The course window was closed.'));
    }
    this.pending.clear();
    this.frame.remove();
  }

  // ---------- internals ----------

  private send(body: ToSandboxBody): void {
    this.frame.contentWindow?.postMessage({ protocol: PROTOCOL, ...body }, this.origin);
  }

  private request(body: ToSandboxBody): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new SandboxError('timeout', 'The course window did not answer.'));
      }, REPLY_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...body, id } as ToSandboxBody);
    });
  }

  private readonly onMessage = (e: MessageEvent): void => {
    if (e.source !== this.frame.contentWindow || e.origin !== this.origin) return;
    const m = e.data as FromSandbox;
    if (!m || typeof m !== 'object' || m.protocol !== PROTOCOL || typeof m.type !== 'string') return;
    if (m.type === 'reply') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      window.clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new SandboxError(String(m.error?.code), String(m.error?.message)));
      return;
    }
    for (const listener of this.listeners.get(m.type) ?? []) listener(m);
  };
}
