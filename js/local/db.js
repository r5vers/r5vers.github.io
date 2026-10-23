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

// outbox: changes not yet sent to the cloud; stamps: when each synced thing last changed
export const STORES = ['meta', 'datasets', 'chunks', 'aggs', 'profiles', 'photos', 'sessions', 'kv', 'strategies', 'settings', 'downloads', 'outbox', 'stamps'];
const DB_NAME = 'rv-local';
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
    await db._open();
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
        const out = fn(t.objectStore(store));
        const value = await (out instanceof IDBRequest ? req(out) : out);
        if (mode === 'readwrite') await done(t);
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
