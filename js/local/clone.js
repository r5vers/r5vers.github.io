// The test copy of the site (r5vers.github.io/next/): it keeps its own
// storage - the database "rv-next" and localStorage keys under "nx" - so
// nothing tried here can touch the main site's. On its first visit it
// brings a copy of the main site's profiles, sessions, looks and settings;
// it never joins the group's cloud (what is done here stays here).
//
// And the other way, once the test copy's design is the main site: what was
// made in the test copy on a device joins the main site there, once
// (carryFromTestCopy).
import { snapshotCodec } from './db.js?v=184b95d359';
import { MAX_PROFILES } from './server.js?v=184b95d359';
import { datasetByKey, touch } from './sync.js?v=184b95d359';

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

// ── the test copy's work, into the main site ─────────────────────────────
const TEST_DB = 'rv-next';
const TEST_LIGHT_KEY = 'nx-light-db';
const CARRIED = 'carried-from-next';

/** A database that is there already, or null (opening one that is not
 *  would create it: the upgrade is stopped). */
function openExisting(name) {
  return new Promise((ok) => {
    let r;
    try { r = indexedDB.open(name); } catch { ok(null); return; }
    r.onupgradeneeded = (e) => { if (e.oldVersion === 0) r.transaction.abort(); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(null);
    r.onblocked = () => ok(null);
    setTimeout(() => ok(null), 8000);
  });
}

/** Where this device keeps the test copy's things: its database, its
 *  localStorage snapshot (light mode), both or neither. Each reads
 *  `all(store)` as [[key, value], ...]. */
async function testCopySources(storage = globalThis.localStorage) {
  const out = [];
  if (typeof indexedDB !== 'undefined') {
    const idb = await openExisting(TEST_DB);
    if (idb) out.push({ all: (store) => readAll(idb, store), close: () => idb.close() });
  }
  let raw = null;
  try { raw = storage?.getItem(TEST_LIGHT_KEY); } catch { raw = null; }
  if (raw) {
    try {
      const text = raw.startsWith('z:') ? snapshotCodec(await import('../../vendor/fflate.js?v=184b95d359')).unpack(raw) : raw;
      const snap = JSON.parse(text);
      if (snap?.v === 1) out.push({ all: async (store) => snap.data?.[store] || [] });
    } catch { /* unreadable: nothing to bring */ }
  }
  return out;
}

/** Bring what was made in the test copy into this (the main site's)
 *  database, once per device: profiles opened there, sessions, drawings and
 *  looks (kv), strategies. Nothing here is lost or deleted: of a thing both
 *  have, the later change stays (the test copy's only when it changed it
 *  after this site last did); a thing deleted here stays deleted. What comes
 *  over goes to the group's cloud like any change. Returns the counts, or
 *  null when it was done before. */
export async function carryFromTestCopy(db, sources = null) {
  if (await db.get('meta', CARRIED)) return null;
  const list = sources || await testCopySources();
  const counts = {};
  try {
    for (const src of list) await carryFrom(db, src, counts);
  } finally {
    for (const src of list) src.close?.();
  }
  await db.put('meta', CARRIED, Date.now());
  return counts;
}

async function carryFrom(db, src, counts) {
  const add = (kind) => { counts[kind] = (counts[kind] || 0) + 1; };
  const theirs = new Map(await src.all('stamps'));
  // the test copy's version wins when it changed the thing after this site
  // did; one it never touched comes only when this site never had it
  const wanted = async (sk, have) => {
    const t = theirs.get(sk), m = await db.get('stamps', sk);
    if (t != null) return m == null || t > m;
    return !have && m == null;
  };
  // a profile is the same on both sides by its gid (both started as one copy)
  const mine = (await db.all('profiles')).map(([, p]) => p);
  const photos = new Map(await src.all('photos'));
  const to = new Map();                      // the test copy's profile id -> this site's profile
  for (const [, tp] of await src.all('profiles')) {
    let mp = mine.find((p) => (tp.gid ? p.gid === tp.gid : p.id === tp.id && p.created_at === tp.created_at));
    if (!mp) {
      if (mine.length >= MAX_PROFILES || !tp.gid) continue;
      mp = { ...tp, id: await db.nextId('profile') };
      mine.push(mp);
    } else if (!(await wanted(`${mp.gid}|profile|`, true))) {
      to.set(tp.id, mp);
      continue;
    } else mp = { ...mp, name: tp.name, color: tp.color, avatar: tp.avatar || '', pin: tp.pin || null, updated_at: tp.updated_at };
    await db.put('profiles', String(mp.id), mp);
    const photo = photos.get(String(tp.id));
    if (photo) await db.put('photos', String(mp.id), photo);
    await touch(db, mp.id, 'profile');
    to.set(tp.id, mp);
    add('profiles');
  }
  for (const [id, s] of await src.all('sessions')) {
    const mp = to.get(s.profile_id);
    if (!mp) continue;
    const here = await db.get('sessions', id);
    if (here && here.profile_id !== mp.id) continue;
    if (!(await wanted(`${mp.gid}|session|${id}`, !!here))) continue;
    // this device's copy of the session's market, found by its key
    const ds = await datasetByKey(db, s.dataset_key);
    await db.put('sessions', id, { ...s, profile_id: mp.id, dataset_id: ds ? ds.id : here?.dataset_id ?? null });
    await touch(db, mp.id, 'session', id);
    add('sessions');
  }
  for (const [store, kind] of [['kv', 'kv'], ['strategies', 'strategy']]) {
    for (const [k, v] of await src.all(store)) {
      const i = k.indexOf(':');
      const mp = to.get(Number(k.slice(0, i)));
      if (!mp) continue;
      const key = store === 'kv' ? k.slice(i + 1) : v?.name ?? k.slice(i + 1);
      const here = await db.get(store, `${mp.id}:${key}`);
      if (!(await wanted(`${mp.gid}|${kind}|${key}`, here !== undefined))) continue;
      await db.put(store, `${mp.id}:${key}`, v);
      await touch(db, mp.id, kind, key);
      add(store);
    }
  }
}
