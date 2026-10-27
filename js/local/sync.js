// Everything but candles lives in the cloud: profiles (name, colour, PIN,
// photo), every kv key (look, themes, chart layout, drawings...), replay
// sessions and backtests, strategies. A device joins the group once with
// its password; from then on what changes on one device reaches the others
// within seconds, and a device opening the site gets the latest.
//
// The group is one Firebase account (cloud.js); its items:
//   { kind: 'profile' | 'kv' | 'session' | 'strategy', gid, key, value, deleted, updated_at, sv }
// `gid` names a profile on every device (local ids differ per device). Of two
// copies of an item the later `updated_at` (ms) wins.
//
// Candles stay per device: a session carries `dataset_key` ("pack:EURUSD:1m")
// and finds the device's own copy of that data.
import { Cloud } from './cloud.js?v=184b95d359';

export const GROUP = 'RV Grup';
const FLUSH_DELAY = 1500;
const BIG = 200_000;            // values above this many characters are gzipped
const MAX_DOC = 900_000;        // Firestore keeps up to 1 MiB per document
// A replay saves itself every few seconds while it plays; the cloud gets it
// at most this often (and whenever the page is left), so a group of devices
// stays well inside Firebase's free daily writes and reads.
export const SESSION_EVERY = 120_000;
const sentAt = new Map();       // outbox key -> when it last went up (this page)

const ok = (gid, kind, key) => `${gid}|${kind}|${key}`;

let fetchImpl = null;
let client = null;
export function useFetch(fn) { fetchImpl = fn; client = null; }
const newCloud = (session = null) => new Cloud({ session, ...(fetchImpl ? { fetchFn: fetchImpl } : {}) });

async function group(db) { return db.get('meta', 'group'); }
async function cloudOf(db) {
  const g = await group(db);
  if (!g?.session) return null;
  if (!client || client.session?.uid !== g.uid) client = newCloud(g.session);
  return client;
}
async function saveGroup(db, patch) {
  const g = await group(db);
  if (!g) return;
  await db.put('meta', 'group', { ...g, ...patch, ...(client?.session ? { session: client.session } : {}) });
}

export function newGid() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── values ────────────────────────────────────────────────────────────────
export async function pack(value) {
  const text = JSON.stringify(value);
  if (text.length <= BIG || typeof CompressionStream === 'undefined') return text;
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const u8 = new Uint8Array(gz);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `gz:${btoa(s)}`;
}
async function unpack(text) {
  if (!text.startsWith('gz:')) return JSON.parse(text);
  const bin = atob(text.slice(3));
  const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (typeof DecompressionStream === 'undefined') {           // Safari before 16.4
    const { gunzipSync } = await import('../../vendor/fflate.js?v=184b95d359');
    return JSON.parse(new TextDecoder().decode(gunzipSync(u8)));
  }
  return JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

// ── datasets by key, so a session finds its data on another device ────────
export async function datasetKey(db, id) {
  if (id == null) return null;
  const ds = await db.get('datasets', String(id));
  if (!ds) return null;
  return ds.meta?.pack ? `pack:${ds.meta.pack}:${ds.base_tf}` : `ds:${ds.symbol}:${ds.base_tf}:${ds.name}`;
}
export async function datasetByKey(db, key) {
  if (!key) return null;
  const all = (await db.all('datasets')).map(([, d]) => d);
  const [kind, a, b, ...rest] = key.split(':');
  // a pack session finds that pack at its own resolution, else the pack at
  // another one (1m first: it shows every chart timeframe a 5m copy does)
  if (kind === 'pack') {
    const same = all.filter((d) => d.meta?.pack === a);
    return same.find((d) => d.base_tf === b) || same.find((d) => d.base_tf === '1m') || same[0] || null;
  }
  return all.find((d) => d.symbol === a && d.base_tf === b && d.name === rest.join(':')) || null;
}

// ── profiles: local id <-> gid ────────────────────────────────────────────
async function profiles(db) { return (await db.all('profiles')).map(([, p]) => p); }
async function byGid(db, gid) { return (await profiles(db)).find((p) => p.gid === gid) || null; }

// ── local changes ─────────────────────────────────────────────────────────
let timer = null;

/** A change's time: after the thing's last one, even in the same millisecond
 *  (otherwise the other devices take a delete right after a save as old). */
async function stampNow(db, sk) {
  const prev = await db.get('stamps', sk);
  return Math.max(Date.now(), prev != null ? prev + 1 : 0);
}

/** A synced thing of local profile `pid` changed on this device. Call it
 *  before a profile is deleted (its gid is still known then). */
export async function touch(db, pid, kind, key = '') {
  const p = await db.get('profiles', String(pid));
  if (!p?.gid) return;
  const t = await stampNow(db, ok(p.gid, kind, key));
  await db.put('stamps', ok(p.gid, kind, key), t);
  await db.put('outbox', ok(p.gid, kind, key), t);
  if (!(await group(db))) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(db).catch(() => {}); }, FLUSH_DELAY);
  timer?.unref?.();                      // (Node, in tests: do not hold the process)
}

/** A setting the whole group shares (the OANDA key for live charts). */
export async function touchShared(db, key) {
  const t = await stampNow(db, ok('*', 'setting', key));
  await db.put('stamps', ok('*', 'setting', key), t);
  await db.put('outbox', ok('*', 'setting', key), t);
  if (!(await group(db))) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(db).catch(() => {}); }, FLUSH_DELAY);
  timer?.unref?.();
}

/** Everything on this device as changed now (joining a group). */
export async function touchAll(db) {
  const t = Date.now();
  const mark = async (gid, kind, key) => { await db.put('stamps', ok(gid, kind, key), t); await db.put('outbox', ok(gid, kind, key), t); };
  if (await db.get('settings', 'oanda')) await mark('*', 'setting', 'oanda');
  for (const p of await profiles(db)) {
    if (!p.gid) { p.gid = newGid(); await db.put('profiles', String(p.id), p); }
    await mark(p.gid, 'profile', '');
    for (const [k] of await db.all('kv', `${p.id}:`)) await mark(p.gid, 'kv', k.slice(String(p.id).length + 1));
    for (const [, s] of await db.all('sessions')) if (s.profile_id === p.id) await mark(p.gid, 'session', s.id);
    for (const [, s] of await db.all('strategies', `${p.id}:`)) await mark(p.gid, 'strategy', s.name);
  }
}

/** The current local copy of one thing, as an item (or a deletion). */
async function itemOf(db, gid, kind, key, stamp) {
  const p = await byGid(db, gid);
  let value;
  if (kind === 'setting') value = await db.get('settings', key);
  else if (p && kind === 'profile') {
    const photo = await db.get('photos', String(p.id));
    value = { name: p.name, color: p.color, avatar: p.avatar || '', pin: p.pin || null, photo: photo && photo.length < 600_000 ? photo : null, created_at: p.created_at };
  } else if (p && kind === 'kv') value = await db.get('kv', `${p.id}:${key}`);
  else if (p && kind === 'session') {
    const s = await db.get('sessions', key);
    if (s && s.profile_id === p.id) {
      const { profile_id, ...rest } = s;
      value = { ...rest, dataset_key: rest.dataset_key || (await datasetKey(db, s.dataset_id)) };
    }
  } else if (p && kind === 'strategy') value = await db.get('strategies', `${p.id}:${key}`);
  if (value === undefined) return { kind, gid, key, value: '', deleted: true, updated_at: stamp };
  return { kind, gid, key, value: await pack(value), deleted: false, updated_at: stamp };
}

/** Send what changed on this device; a replay that went up a moment ago
 *  waits for its turn unless `force` (leaving the page, an explicit sync). */
export async function flush(db, { force = false } = {}) {
  const cloud = await cloudOf(db);
  if (!cloud) return 0;
  const now = Date.now();
  const pending = (await db.all('outbox')).filter(([k]) => force || k.split('|')[1] !== 'session' || now - (sentAt.get(k) || 0) >= SESSION_EVERY);
  if (!pending.length) return 0;
  const items = [], tooBig = [];
  for (const [k, stamp] of pending) {
    const [gid, kind, ...rest] = k.split('|');
    const it = await itemOf(db, gid, kind, rest.join('|'), stamp);
    if (it.value.length > MAX_DOC) { tooBig.push(it.key || kind); continue; }
    items.push(it);
  }
  if (items.length) await cloud.putItems(items);
  // sent: off the list, unless it changed again meanwhile
  for (const [k, stamp] of pending) {
    sentAt.set(k, now);
    if ((await db.get('outbox', k)) === stamp) await db.del('outbox', k);
  }
  await saveGroup(db, { error: tooBig.length ? `buluta sığmadı: ${tooBig.join(', ')}` : null });
  return items.length;
}

// ── changes from the cloud ────────────────────────────────────────────────
async function dropProfile(db, p) {
  for (const [k, s] of await db.all('sessions')) if (s.profile_id === p.id) await db.del('sessions', k);
  await db.delPrefix('strategies', `${p.id}:`);
  await db.delPrefix('kv', `${p.id}:`);
  await db.del('photos', String(p.id));
  await db.del('profiles', String(p.id));
  if ((await db.get('meta', 'current_profile')) === p.id) await db.del('meta', 'current_profile');
}

async function apply(db, it) {
  const sk = ok(it.gid, it.kind, it.key);
  const mine = await db.get('stamps', sk);
  if (mine != null && mine >= it.updated_at) return false;           // ours is newer
  const value = it.deleted ? undefined : await unpack(it.value);
  if (it.kind === 'setting') {
    if (value === undefined) await db.del('settings', it.key); else await db.put('settings', it.key, value);
    await db.put('stamps', sk, it.updated_at);
    await db.del('outbox', sk);
    return true;
  }
  let p = await byGid(db, it.gid);
  if (it.kind === 'profile') {
    if (value === undefined) { if (p) await dropProfile(db, p); }
    else {
      const t = Math.floor(Date.now() / 1000);
      p = { ...(p || { id: await db.nextId('profile'), gid: it.gid, created_at: value.created_at || t }),
        name: value.name, color: value.color, avatar: value.avatar || '', pin: value.pin || null, updated_at: t };
      await db.put('profiles', String(p.id), p);
      if (value.photo) await db.put('photos', String(p.id), value.photo);
      else await db.del('photos', String(p.id));
    }
  } else {
    if (!p) return false;                // its profile is gone (or not here yet)
    if (it.kind === 'kv') {
      if (value === undefined) await db.del('kv', `${p.id}:${it.key}`);
      else await db.put('kv', `${p.id}:${it.key}`, value);
    } else if (it.kind === 'session') {
      if (value === undefined) await db.del('sessions', it.key);
      else {
        // this device's copy of the session's data, or none yet (until downloaded)
        const ds = await datasetByKey(db, value.dataset_key);
        await db.put('sessions', it.key, { ...value, dataset_id: ds ? ds.id : null, profile_id: p.id });
      }
    } else if (it.kind === 'strategy') {
      if (value === undefined) await db.del('strategies', `${p.id}:${it.key}`);
      else await db.put('strategies', `${p.id}:${it.key}`, value);
    } else return false;
  }
  await db.put('stamps', sk, it.updated_at);
  await db.del('outbox', sk);
  return true;
}

/** Bring what changed elsewhere. Returns what was updated: [{ kind, key, gid }]. */
export async function pull(db, { full = false } = {}) {
  const cloud = await cloudOf(db);
  if (!cloud) return [];
  const g = await group(db);
  const { items, last } = await cloud.itemsSince(full ? null : g.cursor);
  // profiles first: the rest of a batch may belong to a profile new here
  items.sort((a, b) => (a.kind === 'profile' ? 0 : 1) - (b.kind === 'profile' ? 0 : 1));
  const changed = [];
  for (const it of items) {
    if (await apply(db, it)) changed.push({ kind: it.kind, key: it.key, gid: it.gid });
  }
  await saveGroup(db, { cursor: last || (full ? null : g.cursor), last_sync: Date.now(), error: null });
  return changed;
}

let running = null;
/** Send, then bring; one at a time. */
export function sync(db, opts = {}) {
  if (running) return running;
  running = (async () => {
    try {
      await flush(db, { force: !!opts.force });
      const changed = await pull(db, opts);
      // pages that are open hear about it
      if (changed.length) globalThis.dispatchEvent?.(new CustomEvent('rv-synced', { detail: { changed } }));
      return changed;
    } catch (e) {
      await saveGroup(db, { error: e.message }).catch(() => {});
      throw e;
    } finally { running = null; }
  })();
  return running;
}

// ── joining the group ─────────────────────────────────────────────────────
/** Join the group with its password (or set it up: `create`). What this
 *  device already has goes up, then everything comes down. */
export async function connect(db, password, { create = false } = {}) {
  const cloud = newCloud();
  if (create) await cloud.signUp(GROUP, password);
  else await cloud.signIn(GROUP, password);
  client = cloud;
  await db.put('meta', 'group', { uid: cloud.session.uid, session: cloud.session, cursor: null, last_sync: null, error: null });
  await touchAll(db);
  return sync(db, { full: true });
}

export async function disconnect(db) {
  client = null;
  await db.del('meta', 'group');
  await db.delPrefix('outbox', '');
}

export async function status(db) {
  const g = await group(db);
  const pending = (await db.all('outbox')).length;
  if (!g) return { enabled: newCloud().enabled, linked: false, pending };
  return { enabled: true, linked: true, last_sync: g.last_sync || null, error: g.error || null, pending };
}

// ── the move from the server site (Railway) ───────────────────────────────
/** Items for everything in a server export (GET /api/export, Python
 *  Store.export_profiles); a profile's gid comes from its server id, so a
 *  second move writes the same documents again. */
export async function exportItems(exp, now = Date.now()) {
  const items = [];
  const add = async (kind, gid, key, value) => items.push({ kind, gid, key, value: await pack(value), deleted: false, updated_at: now });
  for (const p of exp.profiles) {
    const gid = `srv${p.id}`;
    await add('profile', gid, '', { name: p.name, color: p.color, avatar: p.avatar || '', pin: p.pin || null, photo: p.photo || null, created_at: p.created_at });
    for (const [k, v] of Object.entries(p.kv || {})) await add('kv', gid, k, v);
    for (const s of p.sessions || []) await add('session', gid, s.id, { ...s, dataset_id: null });
    for (const s of p.strategies || []) await add('strategy', gid, s.name, s);
  }
  return items;
}

/** Put a server export into the group's cloud (the server site's button). */
export async function pushExport(exp, password) {
  const cloud = newCloud();
  try { await cloud.signIn(GROUP, password); } catch (e) {
    // no group yet: this sets it up with this password
    if (e.status !== 403) throw e;
    try { await cloud.signUp(GROUP, password); } catch (e2) {
      if (/kullanılıyor/.test(e2.message)) throw Object.assign(new Error('grup şifresi yanlış'), { status: 403 });
      throw e2;
    }
  }
  const items = (await exportItems(exp)).filter((it) => it.value.length <= MAX_DOC);
  await cloud.putItems(items);
  return { profiles: exp.profiles.length, items: items.length };
}
