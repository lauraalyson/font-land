// Shared storage. All extension pages + the service worker share one origin,
// so they all talk to the same database.

const DB_NAME = 'type-library';
const STORE = 'fonts';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let out;
        try {
          out = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function saveFont(record) {
  return tx('readwrite', (store) => store.put(record));
}

export function deleteFont(id) {
  return tx('readwrite', (store) => store.delete(id));
}

export async function allFonts() {
  const rows = await tx('readonly', (store) => store.getAll());
  return (rows || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function countFonts() {
  const n = await tx('readonly', (store) => store.count());
  return n || 0;
}
