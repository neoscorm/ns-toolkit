// Storage in IndexedDB (a database inside the browser):
// - kv: the saved folder handle and the result of the last scan
// - cache: package analysis results, so a repeated scan is instant
// All data stays in this browser. If storage is unavailable
// (for example, private mode), the viewer simply works without it.

// The database name is kept from the earlier viewer (same address, neoscorm.com): users' saved results are not lost
const DB_NAME = 'neoscorm-scorm-viewer';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function run<T>(store: 'kv' | 'cache', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const kv = {
  get: <T>(key: string) => run<T>('kv', 'readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => run('kv', 'readwrite', (s) => s.put(value, key)),
  del: (key: string) => run('kv', 'readwrite', (s) => s.delete(key)),
};

export const cache = {
  get: <T>(key: string) => run<T>('cache', 'readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => run('cache', 'readwrite', (s) => s.put(value, key)),
  clear: () => run('cache', 'readwrite', (s) => s.clear()),
};
