# neoScorm toolkit

A free in-browser tool for a folder of SCORM packages (e-learning courses): find them, check them, and play them without an LMS.
**Nothing is uploaded.** Files are read in your browser and never sent anywhere.

Live version: [neoscorm.com/toolkit](https://neoscorm.com/toolkit/)

## What it does

- **Find, inspect, check.** Scans a folder of courses (zipped or unpacked) and lists every one of them: SCORM version, authoring tool, size, contents, problems that will break in a modern LMS, duplicates. Export the list as CSV.
- **Play.** Runs any SCORM 1.2 or 2004 course in a sandbox, with a log of every call the course makes to the LMS and saved progress. xAPI and cmi5 packages open too, but their progress is not recorded.

## Your files stay with you

The toolkit page and the sandbox page ship with a Content Security Policy (a browser-enforced rule) `connect-src 'none'`, so the pages cannot make network requests. You can verify this in the built `index.html` files and in the browser's developer tools. The details are in [docs/API.md](docs/API.md), section "Security".

Folder access is read-only. In Chrome and Edge the toolkit can remember the folder, so the next time takes one click. In Firefox and Safari it works through a folder picker or drag and drop.

## Run it locally

```bash
npm install
npm run dev:sandbox   # sandbox:  http://localhost:5174
npm run dev           # toolkit:  http://localhost:5173/toolkit/   (start both)
npm run build         # type check + build into dist-toolkit/ and dist-sandbox/
```

Both servers must run: the toolkit opens every course inside the sandbox.

## How it is built

```
toolkit/src/
  main.ts            screens: start → scan → list → player
  sandbox-client.ts  toolkit side of the protocol: sandbox window, commands, replies, events
  config.ts          addresses: site, contact link, sandbox
  library/           fs/ folder access, scorm/ package parsing and checks,
                     ui/ screens and package card, player/ player screen, store/ IndexedDB
sandbox/src/
  main.ts            shell: commands, SCORM API, log, progress
  files.ts, scorm/   reading package files, SCORM 1.2 / 2004 runtime
  public/sw.js       Service Worker that serves the course its files
shared/protocol.ts   messages between the two pages (docs/API.md)
```

## Deploy your own copy

The sandbox must live on a **different origin** than the toolkit, so that course code cannot reach toolkit data.

1. Copy `.env.example` to `.env` and set `VITE_SANDBOX_ORIGIN` (where the sandbox will live) and `VITE_TOOLKIT_ORIGINS` (where the toolkit will live).
2. Change the addresses in `sandbox/public/_headers` (`frame-ancestors`), `sandbox/src/config.ts`, `toolkit/src/config.ts` and `wrangler.sandbox.toml`. They point to neoscorm.com now.
3. `npm run build`.
4. Publish `dist-sandbox/` on the sandbox address. The included `npm run deploy:sandbox` does it with Cloudflare Workers; any static host that can send the headers from `_headers` works.
5. Publish `dist-toolkit/` on the toolkit address. The toolkit is built for the path `/toolkit/` (`base` in `vite.toolkit.config.ts`).

## Feedback

Bug reports and ideas are welcome in the issues. For security problems see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Kostyantyn Sorokin. Made by [neoScorm](https://neoscorm.com/), e-learning production studio.
