// Keeping a profile the same on every device: what changes here goes to the
// cloud within seconds, what changed elsewhere comes back when the profile
// is opened and every half minute while a page is open.
//
// Synced, per profile: the card (name, color, avatar, photo), every kv key
// (look, drawings, editor, home layout...), replay sessions and backtests,
// strategies. Candles are not: each device downloads its own packs; a
// session carries `dataset_key` ("pack:EURUSD:1m") and finds the device's
// copy of its data by it.
//
// Each change gets a stamp (ms); of two copies the later stamp wins.
import { Cloud } from './cloud.js';

const FLUSH_DELAY = 1500;
const BIG = 200_000;            // values above this many characters are gzipped
const MAX_DOC = 900_000;        // Firestore keeps up to 1 MiB per document

const ik = (pid, kind, key) => `${pid}|${kind}|${key}`;

// ── which profile is linked, its signed-in cloud client ───────────────────
const clients = new Map();       // uid -> Cloud
let fetchImpl = null;
export function useFetch(fn) { fetchImpl = fn; clients.clear(); }

export function cloudFor(link) {
  if (!link?.session) return null;
  let c = clients.get(link.uid);
  if (!c) {
    c = new Cloud({ session: link.session, ...(fetchImpl ? { fetchFn: fetchImpl } : {}) });
    clients.set(link.uid, c);
  }
  return c;
}
export function newCloud() { return new Cloud(fetchImpl ? { fetchFn: fetchImpl } : {}); }

async function profile(db, pid) { return db.get('profiles', String(pid)); }

async function saveLink(db, pid, patch) {
  const p = await profile(db, pid);
  if (!p?.cloud) return;
  const c = clients.get(p.cloud.uid);
  p.cloud = { ...p.cloud, ...patch, ...(c?.session ? { session: c.session } : {}) };
  await db.put('profiles', String(pid), p);
}

// ── values ────────────────────────────────────────────────────────────────
async function pack(value) {
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
  if (kind === 'pack') return all.find((d) => d.meta?.pack === a && d.base_tf === b) || null;
  return all.find((d) => d.symbol === a && d.base_tf === b && d.name === rest.join(':')) || null;
}

// ── local changes ─────────────────────────────────────────────────────────
const timers = new Map();

/** A synced thing of profile `pid` changed on this device. */
export async function touch(db, pid, kind, key) {
  const p = await profile(db, pid);
  if (!p?.cloud) return;
  const t = Date.now();
  await db.put('stamps', ik(pid, kind, key), t);
  await db.put('outbox', ik(pid, kind, key), t);
  clearTimeout(timers.get(pid));
  const h = setTimeout(() => { timers.delete(pid); flush(db, pid).catch(() => {}); }, FLUSH_DELAY);
  h?.unref?.();                          // (Node, in tests: do not hold the process)
  timers.set(pid, h);
}

/** Everything of a profile as changed now (linking it to the cloud). */
export async function touchAll(db, pid) {
  const t = Date.now();
  const mark = async (kind, key) => { await db.put('stamps', ik(pid, kind, key), t); await db.put('outbox', ik(pid, kind, key), t); };
  await mark('card', 'card');
  for (const [k] of await db.all('kv', `${pid}:`)) await mark('kv', k.slice(String(pid).length + 1));
  for (const [, s] of await db.all('sessions')) if (s.profile_id === pid) await mark('session', s.id);
  for (const [, s] of await db.all('strategies', `${pid}:`)) await mark('strategy', s.name);
}

async function cardOf(db, p) {
  const photo = await db.get('photos', String(p.id));
  // photos are 320 px JPEGs (tens of KB); a card must stay under 1 MiB
  return { name: p.name, color: p.color, avatar: p.avatar || '', photo: photo && photo.length < 600_000 ? photo : null };
}

/** The current local copy of one thing, as an item (or a deletion). */
async function itemOf(db, pid, kind, key, stamp) {
  let value;
  if (kind === 'kv') value = await db.get('kv', `${pid}:${key}`);
  else if (kind === 'session') {
    const s = await db.get('sessions', key);
    if (s && s.profile_id === pid) {
      const { profile_id, ...rest } = s;
      value = { ...rest, dataset_key: rest.dataset_key || (await datasetKey(db, s.dataset_id)) };
    }
  } else if (kind === 'strategy') value = await db.get('strategies', `${pid}:${key}`);
  if (value === undefined) return { kind, key, value: '', deleted: true, updated_at: stamp };
  return { kind, key, value: await pack(value), deleted: false, updated_at: stamp };
}

/** Send what changed here. */
export async function flush(db, pid) {
  const p = await profile(db, pid);
  const cloud = cloudFor(p?.cloud);
  if (!cloud) return 0;
  const pending = await db.all('outbox', `${pid}|`);
  if (!pending.length) return 0;
  const items = [];
  const tooBig = [];
  let card = null;
  for (const [k, stamp] of pending) {
    const [, kind, ...rest] = k.split('|');
    const key = rest.join('|');
    if (kind === 'card') { card = { ...(await cardOf(db, p)), updated_at: stamp }; continue; }
    const it = await itemOf(db, pid, kind, key, stamp);
    if (it.value.length > MAX_DOC) { tooBig.push(key); continue; }
    items.push(it);
  }
  if (card) await cloud.putProfile(card);
  if (items.length) await cloud.putItems(items);
  // sent: off the list, unless it changed again meanwhile
  for (const [k, stamp] of pending) if ((await db.get('outbox', k)) === stamp) await db.del('outbox', k);
  await saveLink(db, pid, { error: tooBig.length ? `buluta sığmadı: ${tooBig.join(', ')}` : null });
  return items.length + (card ? 1 : 0);
}

// ── changes from the cloud ────────────────────────────────────────────────
async function apply(db, pid, it) {
  const sk = ik(pid, it.kind, it.key);
  const mine = await db.get('stamps', sk);
  if (mine != null && mine >= it.updated_at) return false;           // ours is newer
  const value = it.deleted ? undefined : await unpack(it.value);
  if (it.kind === 'kv') {
    if (value === undefined) await db.del('kv', `${pid}:${it.key}`);
    else await db.put('kv', `${pid}:${it.key}`, value);
  } else if (it.kind === 'session') {
    if (value === undefined) await db.del('sessions', it.key);
    else {
      // this device's copy of the session's data, or none yet (null until downloaded)
      const ds = await datasetByKey(db, value.dataset_key);
      await db.put('sessions', it.key, { ...value, dataset_id: ds ? ds.id : null, profile_id: pid });
    }
  } else if (it.kind === 'strategy') {
    if (value === undefined) await db.del('strategies', `${pid}:${it.key}`);
    else await db.put('strategies', `${pid}:${it.key}`, value);
  } else return false;
  await db.put('stamps', sk, it.updated_at);
  await db.del('outbox', sk);
  return true;
}

async function applyCard(db, pid, card) {
  if (!card) return false;
  const sk = ik(pid, 'card', 'card');
  const mine = await db.get('stamps', sk);
  if (mine != null && mine >= (card.updated_at || 0)) return false;
  const p = await profile(db, pid);
  p.name = card.name || p.name;
  p.color = card.color || p.color;
  p.avatar = card.avatar ?? p.avatar;
  p.updated_at = Math.floor(Date.now() / 1000);
  await db.put('profiles', String(pid), p);
  if (card.photo) await db.put('photos', String(pid), card.photo);
  else await db.del('photos', String(pid));
  await db.put('stamps', sk, card.updated_at || 0);
  return true;
}

/** Bring what changed elsewhere. Returns what was updated: [{ kind, key }]. */
export async function pull(db, pid, { full = false } = {}) {
  const p = await profile(db, pid);
  const cloud = cloudFor(p?.cloud);
  if (!cloud) return [];
  const items = await cloud.itemsSince(full ? null : p.cloud.cursor);
  const changed = [];
  let cursor = full ? null : p.cloud.cursor;
  for (const it of items) {
    if (await apply(db, pid, it)) changed.push({ kind: it.kind, key: it.key });
    if (!cursor || it.sv > cursor) cursor = it.sv;
  }
  if (await applyCard(db, pid, await cloud.getProfile(p.cloud.uid))) changed.push({ kind: 'card', key: 'card' });
  await saveLink(db, pid, { cursor, last_sync: Date.now(), error: null });
  return changed;
}

const running = new Map();
/** Send, then bring; one at a time per profile. */
export function sync(db, pid, opts) {
  if (running.has(pid)) return running.get(pid);
  const job = (async () => {
    try {
      await flush(db, pid);
      const changed = await pull(db, pid, opts);
      // pages that are open hear about it (boot.js passes it on)
      if (changed.length) globalThis.dispatchEvent?.(new CustomEvent('rv-synced', { detail: { pid, changed } }));
      return changed;
    } catch (e) {
      await saveLink(db, pid, { error: e.message }).catch(() => {});
      throw e;
    } finally { running.delete(pid); }
  })();
  running.set(pid, job);
  return job;
}

// ── linking ───────────────────────────────────────────────────────────────
/** Put a local profile in the cloud under its name and `password`. */
export async function link(db, pid, password) {
  const p = await profile(db, pid);
  if (p.cloud) throw Object.assign(new Error('bu profil zaten bulutta'), { status: 409 });
  const cloud = newCloud();
  const session = await cloud.signUp(p.name, password);
  clients.set(session.uid, cloud);
  p.cloud = { uid: session.uid, name: p.name, session, cursor: null, last_sync: null, error: null };
  await db.put('profiles', String(pid), p);
  await touchAll(db, pid);
  await flush(db, pid);
  return p.cloud;
}

/** Sign in to a cloud profile; returns its uid and session (for a profile
 *  record that link() did not make: the first time on a device). */
export async function signIn(name, password) {
  const cloud = newCloud();
  const session = await cloud.signIn(name, password);
  clients.set(session.uid, cloud);
  return { uid: session.uid, session, card: await cloud.getProfile(session.uid) };
}

export async function unlink(db, pid) {
  const p = await profile(db, pid);
  if (!p?.cloud) return;
  clients.delete(p.cloud.uid);
  delete p.cloud;
  await db.put('profiles', String(pid), p);
  await db.delPrefix('outbox', `${pid}|`);
}

export async function cloudProfiles() { return newCloud().listProfiles(); }

/** What the page shows about a profile's link. */
export async function status(db, pid) {
  const p = pid != null ? await profile(db, pid) : null;
  const pending = pid != null ? (await db.all('outbox', `${pid}|`)).length : 0;
  if (!p?.cloud) return { enabled: newCloud().enabled, linked: false, pending: 0 };
  const { uid, name, last_sync, error } = p.cloud;
  return { enabled: true, linked: true, uid, name, last_sync, error: error || null, pending };
}
