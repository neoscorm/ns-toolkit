// Service Worker of the sandbox (sandbox.neoscorm.com).
// Intercepts course requests to /content/<session>/<path> and answers with files from the package.
// The files themselves are held by the sandbox shell (the page): the worker asks it for them
// through a MessageChannel. This way no data is lost when the browser puts the worker to sleep.

const CONTENT = /^\/content\/([^/]+)\/(.*)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    // A course request to the open internet: do not interfere, only report it to the log
    event.waitUntil(reportExternal(event, url));
    return;
  }
  const match = CONTENT.exec(url.pathname);
  if (match) event.respondWith(serve(event.request, match[1], match[2]));
});

/** Windows of the sandbox shell (not the courses themselves) */
async function shells() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((c) => !new URL(c.url).pathname.startsWith('/content/'));
}

/** Asks a shell window for a file; the answer "not my session" counts as a failure */
function ask(client, msg) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('timeout')), 20000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data && e.data.status !== 'not-mine') resolve(e.data);
      else reject(new Error('not-mine'));
    };
    client.postMessage(msg, [channel.port2]);
  });
}

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function serve(request, session, rawPath) {
  let path;
  try {
    path = rawPath.split('/').map(decodeURIComponent).join('/');
  } catch {
    path = rawPath;
  }
  if (path === '' || path.endsWith('/')) path += 'index.html';

  let reply;
  try {
    const targets = await shells();
    reply = await Promise.any(targets.map((c) => ask(c, { type: 'file', session, path })));
  } catch {
    return text(410, 'This course session has ended. Open the course again in neoScorm toolkit.');
  }
  if (reply.status !== 200) return text(reply.status === 404 ? 404 : 500, `Not found in the package: ${path}`);

  const blob = reply.blob;
  const headers = { 'Content-Type': reply.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };

  // Partial-content (Range) requests: video and audio need them for seeking
  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start;
    let end;
    if (m[1] === '') {
      start = Math.max(0, blob.size - Number(m[2]));
      end = blob.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), blob.size - 1) : blob.size - 1;
    }
    if (start >= blob.size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
    }
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(blob, { status: 200, headers: { ...headers, 'Content-Length': String(blob.size) } });
}

async function reportExternal(event, url) {
  const id = event.clientId || event.resultingClientId;
  if (!id) return;
  const client = await self.clients.get(id);
  if (!client) return;
  const match = CONTENT.exec(new URL(client.url).pathname);
  if (!match) return;
  for (const c of await shells()) c.postMessage({ type: 'net', session: match[1], url: url.href, dest: event.request.destination });
}
