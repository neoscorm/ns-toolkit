# Protocol: toolkit ↔ sandbox

Protocol name: `neoscorm-sandbox/1`. TypeScript types: [`shared/protocol.ts`](../shared/protocol.ts).

## 1. Why there are two pages

A course is somebody else's code. The toolkit keeps your saved results and a handle to your folder, so the course must never run on the same origin (scheme + host + port) as the toolkit. The toolkit and the sandbox are two separate pages on two separate origins; the browser itself blocks access between them.

```
toolkit (neoscorm.com/toolkit)                    sandbox (sandbox.neoscorm.com)
──────────────────────────────                    ──────────────────────────────
reads your folder, parses packages                shell: the SCORM API (API, API_1484_11)
keeps scan results and saved progress             Service Worker serves the course files
        │                                          iframe with the course
        ├──── commands: open, goto, close ───────►
        ◄──── events: log, status, attempt, … ────┘
```

The toolkit sends `File` objects with the `open` command. When the course asks for a file, the Service Worker asks the shell, and the shell reads it from those objects. Nothing leaves the browser.

## 2. Security

1. Both sides check `e.origin` against a list and `e.source` against the expected window (the parent for the sandbox, the embedded frame for the toolkit). Everything else is dropped silently.
2. Every message is checked for shape before it is used. An unknown `type` is dropped.
3. The toolkit renders strings that come from the sandbox as text only (`textContent`).
4. The embedded window uses the `sandbox` attribute without `allow-top-navigation`. The `frame-ancestors` header of the sandbox allows only the toolkit origins.
5. Both pages ship with `connect-src 'none'`: the toolkit and the sandbox shell cannot make network requests. Course pages are served by the Service Worker without that restriction, like an LMS would serve them. Network requests made by a course are shown in the log.

## 3. Message format

```ts
interface Envelope { protocol: 'neoscorm-sandbox/1'; type: string; id?: number }
// id is present on a request that waits for an answer:
{ protocol, type: 'reply', id, ok: true, data?: unknown }
{ protocol, type: 'reply', id, ok: false, error: { code: string; message: string } }
```

No answer within 5 seconds means the request failed (`code: 'timeout'`).

## 4. Commands: toolkit → sandbox

| type | Fields | Reply | What it does |
|---|---|---|---|
| `open` | `session, title, declared, files, scos, start, attempt?` | yes | Open a course. `declared` is the SCORM version from the manifest (`scorm12`, `scorm2004` or `none` for xAPI and cmi5). `attempt` is saved progress |
| `goto` | `index` | no | Go to another SCO (a launchable unit of the course) |
| `close` | — | no | Close the course and free memory |

## 5. Events: sandbox → toolkit

| type | Fields | When |
|---|---|---|
| `ready` | `capabilities: string[]` | The shell has loaded and its Service Worker is running |
| `log` | `entries: LogEntry[]` | API calls, file requests, network requests and notes |
| `status` | `status: StatusSummary` | A short summary of what the course has told the LMS |
| `attempt` | `attempt: SavedAttempt` | Progress to be saved by the toolkit |
| `sco` | `index` | The open SCO changed |
| `closed` | — | The course was closed |
| `error` | `message` | The shell could not start or open the course |

## 6. Example

```
toolkit  → open {session, title, declared:'scorm12', files, scos, start:0}   ← reply ok
sandbox  ← sco {index:0}
sandbox  ← log {entries:[ LMSInitialize("") → "true", … ]}
sandbox  ← status {status:{completion:'incomplete', …}}
sandbox  ← attempt {attempt:{…}}              (toolkit saves it in the browser)
toolkit  → close
sandbox  ← closed
```
