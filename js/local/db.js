// Storage for the in-browser server: a few named stores of string keys.
// IndexedDB in the browser; an in-memory copy with the same calls for tests.
//
//   await db.get(store, key)            value or undefined
//   await db.put(store, key, value)
//   await db.del(store, key)
//   await db.all(store, prefix?)        [[key, value], ...] sorted by key
//   await db.delPrefix(store, prefix)
//   await db.nextId(name)               1, 2, 3, ... (per name)
//   await db.tx(fn)                     run fn(db) - one transaction where possible

import { LOCAL_NAMES } from './site.js?v=d93fdedfec';

// outbox: changes not yet sent to the cloud; stamps: when each synced thing last changed
export const STORES = ['meta', 'datasets', 'chunks', 'aggs', 'profiles', 'photos', 'sessions', 'kv', 'strategies', 'settings', 'downloads', 'outbox', 'stamps'];
const DB_NAME = LOCAL_NAMES.db;
const DB_VERSION = 2;

const range = (prefix) => [prefix, `${prefix}\uffff`];

export class MemoryDb {
  constructor() { this.data = Object.fromEntries(STORES.map((s) => [s, new Map()])); }
  async get(store, key) { const v = this.data[store].get(key); return v === undefined ? undefined : structuredClone(v); }
  async put(store, key, value) { this.data[store].set(key, structuredClone(value)); }
  async del(store, key) { this.data[store].delete(key); }
  async all(store, prefix = '') {
    const [lo, hi] = range(prefix);
    return [...this.data[store].entries()].filter(([k]) => k >= lo && k <= hi)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, structuredClone(v)]);
  }
  async delPrefix(store, prefix) {
    const [lo, hi] = range(prefix);
    for (const k of [...this.data[store].keys()]) if (k >= lo && k <= hi) this.data[store].delete(k);
  }
  async nextId(name) {
    const n = ((await this.get('meta', `seq:${name}`)) || 0) + 1;
    await this.put('meta', `seq:${name}`, n);
    return n;
  }
  async tx(fn) { return fn(this); }
}

// ── light mode (iPhone): no IndexedDB ───────────────────────────────────
// Safari's IndexedDB on iPhone hung, half-wrote and broke the site for good.
// In light mode the device keeps its small things (profiles, looks,
// sessions, the group link) in localStorage - plain, synchronous, and kept
// in step with the cloud - and candles only in memory (and the browser's
// file cache, net.js). Nothing here can hang.
const LIGHT_KEY = LOCAL_NAMES.light;
const PERSIST = ['meta', 'datasets', 'profiles', 'photos', 'sessions', 'kv', 'strategies', 'settings', 'downloads', 'outbox', 'stamps'];

/** Text <-> a compact string for localStorage (zlib + base64), given
 *  fflate: JSON shrinks about tenfold, so years of tests and drawings fit. */
export function snapshotCodec({ zlibSync, unzlibSync, strToU8, strFromU8 }) {
  return {
    pack: (text) => {
      const z = zlibSync(strToU8(text), { level: 6 });
      let s = '';
      for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode(...z.subarray(i, i + 0x8000));
      return `z:${btoa(s)}`;
    },
    unpack: (packed) => strFromU8(unzlibSync(Uint8Array.from(atob(packed.slice(2)), (c) => c.charCodeAt(0)))),
  };
}

export class LightDb extends MemoryDb {
  constructor(storage = globalThis.localStorage, codec = null) {
    super();
    this.light = true;
    this.storage = storage;
    this.codec = codec;
    this._timer = 0;
    try {
      const raw = storage?.getItem(LIGHT_KEY) || 'null';
      const snap = JSON.parse(raw.startsWith('z:') && codec ? codec.unpack(raw) : raw);
      if (snap?.v === 1) for (const s of PERSIST) for (const [k, v] of snap.data?.[s] || []) this.data[s].set(k, v);
    } catch { /* nothing kept, or unreadable: start empty, the cloud refills it */ }
  }
  _changed(store) {
    if (!PERSIST.includes(store)) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), 600);
    this._timer?.unref?.();
  }
  async put(store, key, value) { await super.put(store, key, value); this._changed(store); }
  async del(store, key) { await super.del(store, key); this._changed(store); }
  async delPrefix(store, prefix) { await super.delPrefix(store, prefix); this._changed(store); }

  /** Write the snapshot now. Too big for localStorage: the photos stay out,
   *  then everything but the group link and the profiles; what stays out
   *  comes from the cloud on the next visit (its cursor starts over). */
  save() {
    clearTimeout(this._timer);
    this._timer = 0;
    if (!this.storage) return false;
    const snapshot = (keep, refetch) => {
      const data = Object.fromEntries(keep.map((s) => [s, [...this.data[s]]]));
      if (refetch && data.meta) data.meta = data.meta.map(([k, v]) => (k === 'group' && v ? [k, { ...v, cursor: null }] : [k, v]));
      return JSON.stringify({ v: 1, data });
    };
    const tries = [[PERSIST, false], [PERSIST.filter((s) => s !== 'photos'), true], [['meta', 'datasets', 'profiles', 'outbox', 'stamps'], true]];
    for (const [keep, refetch] of tries) {
      try {
        const text = snapshot(keep, refetch);
        this.storage.setItem(LIGHT_KEY, this.codec ? this.codec.pack(text) : text);
        return true;
      } catch { /* too big: keep less */ }
    }
    return false;
  }
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** A write is kept only once its transaction commits: a full disk shows up
 *  as the transaction aborting, after the request itself succeeded. */
const done = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onabort = t.onerror = () => reject(t.error || new DOMException('IndexedDB yazılamadı', 'AbortError'));
});

/** Errors that mean the connection is gone, not the request: Safari on
 *  iPhone drops it when the app goes to the background ("Connection to
 *  Indexed Database server lost"), another tab may close it to upgrade. */
const lost = (e) => e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(e.message || ''));

export class IdbDb {
  static async open() {
    const db = new IdbDb();
    // a device whose storage does not answer says so instead of a page that waits for good
    await Promise.race([db._open(), new Promise((_, no) => setTimeout(() => no(new Error('cihaz depolaması açılmadı (10 sn)')), 10000))]);
    return db;
  }
  async _open() {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    const idb = await req(r);
    // another tab upgrading the schema: let it, this one reopens on next use
    idb.onversionchange = () => { idb.close(); if (this.idb === idb) this.idb = null; };
    idb.onclose = () => { if (this.idb === idb) this.idb = null; };
    this.idb = idb;
  }
  /** Run `fn(transaction)` on `store`, reconnecting once if the connection was lost. */
  async _run(store, mode, fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!this.idb) await (this._opening ||= this._open().finally(() => { this._opening = null; }));
        const t = this.idb.transaction(store, mode);
        // listen for the commit before anything else: Safari can finish the
        // transaction before code after the request's success runs, and a
        // listener added then waits for good (writes hung on iPhone)
        const committed = mode === 'readwrite' ? done(t) : null;
        committed?.catch(() => {});
        const out = fn(t.objectStore(store));
        const value = await (out instanceof IDBRequest ? req(out) : out);
        // and should the commit never be heard of, the write went through
        // all the same (its request succeeded): no request hangs for it
        if (committed) await Promise.race([committed, new Promise((r) => { const t = setTimeout(r, 8000); t?.unref?.(); })]);
        return value;
      } catch (e) {
        if (attempt || !lost(e)) throw e;
        try { this.idb?.close(); } catch { /* already gone */ }
        this.idb = null;
      }
    }
  }
  async get(store, key) { return this._run(store, 'readonly', (s) => s.get(key)); }
  async put(store, key, value) { await this._run(store, 'readwrite', (s) => s.put(value, key)); }
  async del(store, key) { await this._run(store, 'readwrite', (s) => s.delete(key)); }
  async all(store, prefix = '') {
    return this._run(store, 'readonly', async (s) => {
      const keyRange = IDBKeyRange.bound(...range(prefix));
      const [keys, values] = await Promise.all([req(s.getAllKeys(keyRange)), req(s.getAll(keyRange))]);
      return keys.map((k, i) => [k, values[i]]);
    });
  }
  async delPrefix(store, prefix) { await this._run(store, 'readwrite', (s) => s.delete(IDBKeyRange.bound(...range(prefix)))); }
  async nextId(name) {
    // one readwrite transaction: two tabs never get the same id
    const key = `seq:${name}`;
    return this._run('meta', 'readwrite', async (s) => {
      const n = ((await req(s.get(key))) || 0) + 1;
      await req(s.put(n, key));
      return n;
    });
  }
  async tx(fn) { return fn(this); }
}

/** Ask the browser not to clear this site's storage under pressure. */
export async function persistStorage() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}

export async function storageEstimate() {
  try { return (await navigator.storage?.estimate?.()) || {}; } catch { return {}; }
}
