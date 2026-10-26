// The test copy of the site (r5vers.github.io/next/): it keeps its own
// storage - the database "rv-next" and localStorage keys under "nx" - so
// nothing tried here can touch the main site's. On its first visit it
// brings a copy of the main site's profiles, sessions, looks and settings;
// it never joins the group's cloud (what is done here stays here).
export const MAIN_DB = 'rv-local';
const MAIN_LIGHT_KEY = 'rv-light-db';
const COPY = ['meta', 'profiles', 'photos', 'sessions', 'kv', 'strategies', 'settings'];
// the cloud link and the main site's list of files stay behind
const SKIP_META = new Set(['group', 'manifest']);
const DONE = 'nx-imported';

/** localStorage: the main site's per-profile caches and looks, once. */
export function importLocalStorage(storage = globalThis.localStorage) {
  try {
    if (!storage || storage.getItem(DONE)) return 0;
    let n = 0;
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    for (const k of keys) {
      let to = null;
      if (k.startsWith('rt:') && !k.endsWith('__unsent')) to = `nx:${k.slice(3)}`;
      else if (k === 'rt-last-look' || k === 'rt-gate-look' || k === 'rt-gate-bg') to = `nx-${k.slice(3)}`;
      else if (k.startsWith('rt-device:')) to = `nx-device:${k.slice('rt-device:'.length)}`;
      if (to && storage.getItem(to) == null) { storage.setItem(to, storage.getItem(k)); n++; }
    }
    storage.setItem(DONE, String(Date.now()));
    return n;
  } catch { return 0; }
}

const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

/** The main site's database, or null when this browser has none (opening
 *  one that does not exist would create it: the upgrade is stopped). */
function openMain() {
  return new Promise((ok) => {
    let r;
    try { r = indexedDB.open(MAIN_DB); } catch { ok(null); return; }
    r.onupgradeneeded = (e) => { if (e.oldVersion === 0) r.transaction.abort(); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(null);
    r.onblocked = () => ok(null);
    setTimeout(() => ok(null), 8000);
  });
}

async function readAll(idb, store) {
  if (!idb.objectStoreNames.contains(store)) return [];
  const s = idb.transaction(store, 'readonly').objectStore(store);
  const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
  return keys.map((k, i) => [k, values[i]]);
}

async function readOne(idb, store, key) {
  if (!idb.objectStoreNames.contains(store)) return undefined;
  return req(idb.transaction(store, 'readonly').objectStore(store).get(key));
}

/** A market read from the site keeps its row; its downloaded files do not
 *  come along (they are read from the site again), nor do other copies. */
function datasetCopy(ds) {
  if (!ds?.meta?.pack) return ds;
  if (ds.base_tf !== '1m') return null;
  const { series, ...rest } = ds;
  return { ...rest, meta: { ...ds.meta, files: {}, stream: true, complete: false, partial: false } };
}

/** Fill `db` (this copy's, empty) from the main site's database, once. */
export async function importFromMain(db) {
  if (await db.get('meta', DONE)) return null;
  const counts = {};
  if (db.light) {
    // iPhone: the main site keeps its small things in localStorage
    let raw = null;
    try { raw = globalThis.localStorage.getItem(MAIN_LIGHT_KEY); } catch { raw = null; }
    if (raw) {
      try {
        const text = raw.startsWith('z:') && db.codec ? db.codec.unpack(raw) : raw;
        const snap = JSON.parse(text);
        if (snap?.v === 1) {
          for (const store of [...COPY, 'datasets']) {
            for (const [k, v] of snap.data?.[store] || []) {
              if (store === 'meta' && SKIP_META.has(k)) continue;
              const value = store === 'datasets' ? datasetCopy(v) : v;
              if (value == null) continue;
              await db.put(store, k, value);
              counts[store] = (counts[store] || 0) + 1;
            }
          }
        }
      } catch { /* unreadable: start empty */ }
    }
  } else {
    const main = await openMain();
    if (main) {
      try {
        for (const store of COPY) {
          for (const [k, v] of await readAll(main, store)) {
            if (store === 'meta' && SKIP_META.has(k)) continue;
            await db.put(store, k, v);
            counts[store] = (counts[store] || 0) + 1;
          }
        }
        // the markets: own data (CSV) comes with its candles
        for (const [k, ds] of await readAll(main, 'datasets')) {
          const value = datasetCopy(ds);
          if (!value) continue;
          await db.put('datasets', k, value);
          counts.datasets = (counts.datasets || 0) + 1;
          if (!ds.meta?.pack) {
            for (const c of ds.series?.chunks || []) {
              const buf = await readOne(main, 'chunks', c.key);
              if (buf !== undefined) await db.put('chunks', c.key, buf);
            }
          }
        }
      } finally { main.close(); }
    }
  }
  await db.put('meta', DONE, Date.now());
  return counts;
}
