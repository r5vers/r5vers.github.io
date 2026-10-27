// The terminal's REST API answered on the device (no server): the same
// paths, parameters and replies as server/app.py, over IndexedDB.
//
// handle(db, { method, path, query, body }) -> { status, json } | { status, bytes, headers }
// `body` is the request body as an ArrayBuffer, a JSON string, or undefined.
import { canAggregate, parseTf, CHART_TFS } from '../core/timeframes.js?v=5cd63cafc3';
import { aggregateCols } from './query.js?v=5cd63cafc3';
import { barsAnswer, replayAnswer } from './candles.js?v=5cd63cafc3';
import { ChunkRows, deleteSeries, deviceSource, readAll, replaceSeries } from './series.js?v=5cd63cafc3';
import * as packs from './packs.js?v=5cd63cafc3';
import * as live from './live.js?v=5cd63cafc3';
import * as sync from './sync.js?v=5cd63cafc3';

const KV_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_MAX_BYTES = 1024 * 1024;
export const MAX_PROFILES = 8;
const PROFILE_COLORS = ['#8b7cf6', '#e07a8b', '#3fb39b', '#d9a441', '#4f8fd9', '#d9734e', '#8fae5a', '#b06bc4'];
const EDITABLE = ['symbol', 'name', 'align', 'decimals', 'pip_size', 'contract_size', 'quote_conv', 'price_type', 'currency'];

export class HttpError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}
const notFound = (what) => new HttpError(404, `${what} not found`);
const bad = (msg) => new HttpError(400, msg);
const now = () => Math.floor(Date.now() / 1000);
const text = (buf) => (typeof buf === 'string' ? buf : buf ? new TextDecoder().decode(buf) : '');
const json = (buf) => { const s = text(buf); return s ? JSON.parse(s) : {}; };
const int = (x) => (x === undefined || x === null || x === '' ? null : Number(x));

// ── datasets ──────────────────────────────────────────────────────────────
async function getDs(db, id) {
  const ds = await db.get('datasets', String(id));
  if (!ds) throw notFound(`dataset ${id}`);
  return ds;
}
export async function listDatasets(db) {
  return (await db.all('datasets')).map(([, d]) => d).filter((d) => d && d.id != null && d.base_tf).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function datasetJson(ds) {
  const { series, ...d } = ds;
  const base = parseTf(ds.base_tf);
  d.timeframes = CHART_TFS.filter((tf) => canAggregate(base, parseTf(tf)));
  // read from the site: nothing of it is counted as on the device
  d.stream = !!ds.meta?.stream && !ds.meta?.complete;
  d.bytes = d.stream ? 0 : (ds.bar_count || 0) * 24;
  return d;
}

export function validateFields(fields) {
  const out = {};
  for (const [k, v0] of Object.entries(fields)) {
    let v = v0;
    if (!EDITABLE.includes(k)) throw bad(`field '${k}' is not editable`);
    if (k === 'align' && !['utc', 'fx'].includes(v)) throw bad("align must be one of ('utc', 'fx')");
    if (k === 'quote_conv' && !['none', 'divide'].includes(v)) throw bad("quote_conv must be one of ('none', 'divide')");
    if (k === 'price_type' && !['bid', 'mid', 'last'].includes(v)) throw bad("price_type must be one of ('bid', 'mid', 'last')");
    if (k === 'decimals') { v = Math.trunc(Number(v)); if (!(v >= 0 && v <= 10)) throw bad('decimals must be between 0 and 10'); }
    if (k === 'pip_size' || k === 'contract_size') { v = Number(v); if (!(v > 0)) throw bad(`${k} must be positive`); }
    if (['symbol', 'name', 'currency'].includes(k)) { v = String(v).trim(); if (!v) throw bad(`${k} must not be empty`); }
    out[k] = v;
  }
  return out;
}

export async function createDataset(db, { symbol, name, source, base_tf, meta = {}, ...fields }) {
  parseTf(base_tf);
  const t = now();
  const ds = {
    id: await db.nextId('dataset'), symbol, name, source, base_tf, align: 'utc', decimals: 5, pip_size: 0.0001,
    contract_size: 100000, quote_conv: 'none', price_type: 'bid', currency: 'USD', first_ts: null, last_ts: null,
    bar_count: 0, version: 0, meta, created_at: t, updated_at: t, ...validateFields(fields), series: { scale: 0, chunks: [] },
  };
  await db.put('datasets', String(ds.id), ds);
  return ds;
}

async function patchDataset(db, id, patch) {
  const fields = validateFields(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined)));
  const before = await getDs(db, id);
  if (!Object.keys(fields).length) return before;
  let ds = { ...before, ...fields, updated_at: now() };
  await db.put('datasets', String(id), ds);
  if (fields.align !== undefined && fields.align !== before.align) {
    // re-bucket the base series (store._realign); hour-dividing bases keep their bars
    const base = parseTf(ds.base_tf);
    const { cols, scale } = await readAll(db, ds);
    const rebucket = cols.t.length && (base.kind !== 'intraday' || 3600 % base.seconds);
    ds = await replaceSeries(db, ds, rebucket ? aggregateCols(cols, base, ds.align).cols : cols, scale);
  }
  return ds;
}

async function deleteDataset(db, id) {
  const ds = await getDs(db, id);
  await deleteSeries(db, ds);
  await db.del('datasets', String(id));
}

// ── candles: in the data worker, so the page never freezes on them ───────
let worker = null, broken = false, seq = 0;
const waiting = new Map();
function dataWorker() {
  if (broken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/data.worker.js?v=5cd63cafc3', import.meta.url), { type: 'module' });
    } catch { broken = true; return null; }
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      clearTimeout(w.timer);
      if (e.data.ok) w.ok(e.data.r); else w.no(new HttpError(e.data.status, e.data.message));
    };
    // a worker that cannot start (an old browser): the page does it instead
    worker.onerror = () => {
      broken = true;
      worker = null;
      for (const w of waiting.values()) { clearTimeout(w.timer); w.no(Object.assign(new Error('worker'), { fallback: true })); }
      waiting.clear();
    };
  }
  return worker;
}
async function candles(db, op, ds, q) {
  const w = dataWorker();
  if (w) {
    try {
      return await new Promise((ok, no) => {
        const id = ++seq;
        const timer = setTimeout(() => { waiting.delete(id); no(new HttpError(504, 'veri hazırlanamadı (3 dk)')); }, 180_000);
        waiting.set(id, { ok, no, timer });
        w.postMessage({ id, op, ds, q, light: !!db.light });
      });
    } catch (e) {
      if (!e.fallback) throw e;
    }
  }
  return op === 'replay' ? replayAnswer(db, ds, q) : barsAnswer(db, ds, q);
}

async function bars(db, id, q) { return candles(db, 'bars', await getDs(db, id), q); }
async function replay(db, id, q) { return candles(db, 'replay', await getDs(db, id), q); }

// ── profiles ──────────────────────────────────────────────────────────────
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function pbkdf2(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256));
}
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${hex(salt)}$${await pbkdf2(pin, salt)}`;
}
async function pinMatches(stored, pin) {
  if (!stored) return true;
  const [saltHex, digest] = stored.split('$');
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return (await pbkdf2(pin || '', salt)) === digest;
}
function cleanPin(pin) {
  if (pin === undefined || pin === null || pin === '') return null;
  pin = String(pin).trim();
  if (!/^\d{4,8}$/.test(pin)) throw bad('PIN 4-8 haneli bir sayı olmalı');
  return pin;
}
function cleanName(name) {
  name = String(name ?? '').split(/\s+/).filter(Boolean).join(' ');
  if (!name) throw bad('profil adı boş olamaz');
  if (name.length > 24) throw bad('profil adı en fazla 24 karakter');
  return name;
}

async function profileRow(db, pid) {
  const p = await db.get('profiles', String(pid));
  if (!p) throw notFound(`profile ${pid}`);
  return p;
}
async function profileJson(db, p) {
  const { pin, gid, ...d } = p;
  d.locked = !!pin;
  const photo = await db.get('photos', String(p.id));
  d.photo = photo ? `data:image/jpeg;base64,${photo}` : null;
  return d;
}
async function listProfiles(db) {
  const rows = (await db.all('profiles')).map(([, p]) => p).sort((a, b) => a.id - b.id);
  return Promise.all(rows.map((p) => profileJson(db, p)));
}
export async function currentProfile(db) {
  const pid = await db.get('meta', 'current_profile');
  if (pid == null) return null;
  const p = await db.get('profiles', String(pid));
  // the PIN changed since this device signed in: out (like the signed cookie)
  if (!p || (p.pin || '') !== ((await db.get('meta', 'current_pin')) || '')) return null;
  return pid;
}
async function needProfile(db) {
  const pid = await currentProfile(db);
  if (pid == null) throw new HttpError(409, 'profil seçilmedi');
  return pid;
}

const failures = [];
function throttled() {
  const t = Date.now();
  while (failures.length && t - failures[0] > 60_000) failures.shift();
  return failures.length >= 10;
}
async function authorize(db, pid, pin) {
  const p = await profileRow(db, pid);
  if (!p.pin || (await currentProfile(db)) === pid) return;
  if (throttled()) throw new HttpError(429, 'çok fazla deneme, bir dakika bekleyin');
  if (!(await pinMatches(p.pin, pin))) { failures.push(Date.now()); throw new HttpError(403, 'bu profil PIN ile kilitli'); }
}

async function createProfile(db, body) {
  const name = cleanName(body.name);
  const pin = cleanPin(body.pin);
  const count = (await db.all('profiles')).length;
  if (count >= MAX_PROFILES) throw bad(`en fazla ${MAX_PROFILES} profil açılabilir`);
  const t = now();
  const p = { id: await db.nextId('profile'), gid: sync.newGid(), name, color: body.color || PROFILE_COLORS[count % PROFILE_COLORS.length], avatar: String(body.avatar || '').slice(0, 8), pin: pin ? await hashPin(pin) : null, created_at: t, updated_at: t };
  await db.put('profiles', String(p.id), p);
  await sync.touch(db, p.id, 'profile');
  return profileJson(db, p);
}

async function updateProfile(db, pid, body) {
  await authorize(db, pid, body.current_pin);
  const p = await profileRow(db, pid);
  const wasCurrent = (await currentProfile(db)) === pid;
  if (body.name != null) p.name = cleanName(body.name);
  if (body.color != null) p.color = String(body.color).slice(0, 16);
  if (body.avatar != null) p.avatar = String(body.avatar).slice(0, 8);
  if (body.clear_pin) p.pin = null;
  else if (body.pin) p.pin = await hashPin(cleanPin(body.pin));
  p.updated_at = now();
  await db.put('profiles', String(pid), p);
  // changing your own PIN keeps you signed in on this device
  if (wasCurrent) await db.put('meta', 'current_pin', p.pin || '');
  await sync.touch(db, pid, 'profile');
  return profileJson(db, p);
}

async function deleteProfile(db, pid, pin) {
  await authorize(db, pid, pin);
  await profileRow(db, pid);
  await sync.touch(db, pid, 'profile');
  for (const [k, s] of await db.all('sessions')) if (s.profile_id === pid) await db.del('sessions', k);
  await db.delPrefix('strategies', `${pid}:`);
  await db.delPrefix('kv', `${pid}:`);
  await db.del('photos', String(pid));
  await db.del('profiles', String(pid));
  if ((await db.get('meta', 'current_profile')) === pid) await db.del('meta', 'current_profile');
}

async function selectProfile(db, pid, pin) {
  const p = await profileRow(db, pid);
  if (p.pin) {
    if (throttled()) throw new HttpError(429, 'çok fazla deneme, bir dakika bekleyin');
    if (!(await pinMatches(p.pin, pin))) { failures.push(Date.now()); throw new HttpError(403, 'PIN yanlış'); }
  }
  await db.put('meta', 'current_profile', pid);
  await db.put('meta', 'current_pin', p.pin || '');
  return { ok: true, profile: await profileJson(db, await profileRow(db, pid)) };
}

function toBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── sessions ──────────────────────────────────────────────────────────────
async function getSession(db, sid, pid) {
  const s = await db.get('sessions', sid);
  if (!s || s.profile_id !== pid) throw notFound(`session ${sid}`);
  return resolveDataset(db, s);
}
/** A session from another device: its data on this one, once downloaded. */
async function resolveDataset(db, s) {
  if (s.dataset_key && (s.dataset_id == null || !(await db.get('datasets', String(s.dataset_id))))) {
    const ds = await sync.datasetByKey(db, s.dataset_key);
    if (ds && ds.id !== s.dataset_id) { s.dataset_id = ds.id; await db.put('sessions', s.id, s); }
  }
  return s;
}
const sessionJson = (s) => ({ ...s });
// what a save answers: its state is what the page just sent (a long test's
// trades, back again, were parsed twice for nothing)
const savedJson = ({ state, ...s }) => s;

// ── kv, strategies, settings ──────────────────────────────────────────────
async function kvProfile(db, q) {
  const pid = await needProfile(db);
  if (q.profile != null && q.profile !== '' && Number(q.profile) !== pid) throw new HttpError(409, 'bu sekme başka bir profile ait');
  return pid;
}

const mask = (t) => (t ? `••••${t.slice(-4)}` : null);
async function settingsJson(db) {
  const o = (await db.get('settings', 'oanda')) || {};
  return {
    auth: false,
    oanda: { configured: !!o.token, token: mask(o.token), env: o.env || 'practice', price: o.price || 'bid', accounts: o.accounts || [], from_env: false },
  };
}

// ── routing ───────────────────────────────────────────────────────────────
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`), fn });
const ok = (j) => ({ status: 200, json: j });

route('GET', '/health', () => ok({ ok: true, local: true }));
route('POST', '/login', () => ok({ ok: true }));
route('POST', '/logout', () => ok({ ok: true }));
route('GET', '/providers', () => ok(packs.providers()));
route('GET', '/settings', async (db) => ok(await settingsJson(db)));
route('PUT', '/settings/oanda', async (db, { body }) => {
  const b = json(body);
  if (!['practice', 'live'].includes(b.env || 'practice')) throw bad('env practice ya da live olmalı');
  if (!['bid', 'mid', 'ask'].includes(b.price || 'bid')) throw bad('price bid, mid ya da ask olmalı');
  const before = (await db.get('settings', 'oanda')) || {};
  // the masked key comes back unchanged when only the price or account changes
  const typed = String(b.token || '').trim();
  const token = typed && !typed.includes('•') ? typed : before.token;
  if (!token || token.length < 10) throw bad('geçersiz anahtar');
  const checked = typed === token ? await live.checkOanda(token, b.env || 'practice') : { env: b.env || before.env || 'practice', accounts: before.accounts || [] };
  await db.put('settings', 'oanda', { token, env: checked.env, price: b.price || 'bid', accounts: checked.accounts });
  // every device of the group gets it (sync.js, the group's own cloud)
  await sync.touchShared(db, 'oanda');
  return ok(await settingsJson(db));
});
route('DELETE', '/settings/oanda', async (db) => { await db.del('settings', 'oanda'); await sync.touchShared(db, 'oanda'); return ok(await settingsJson(db)); });
route('GET', '/live/timeframes', (db, { query }) => ok(live.timeframes(query.provider)));
route('GET', '/live', async (db, { query: q }) => ok(await live.candles(await db.get('settings', 'oanda'), q.provider, String(q.symbol || ''), q.tf, int(q.count) ?? 500, int(q.to))));

route('GET', '/datasets', async (db) => {
  // every pack is there at once, read from the site until downloaded
  await packs.ensureStreams(db, 4000).catch(() => {});
  // one record that cannot be read (a write cut short) never hides the rest
  const out = [];
  for (const ds of await listDatasets(db)) { try { out.push(datasetJson(ds)); } catch { /* skipped */ } }
  return ok(out);
});
route('GET', '/datasets/{id}', async (db, { p }) => ok(datasetJson(await getDs(db, p.id))));
route('PATCH', '/datasets/{id}', async (db, { p, body }) => ok(datasetJson(await patchDataset(db, Number(p.id), json(body)))));
route('DELETE', '/datasets/{id}', async (db, { p }) => { await deleteDataset(db, Number(p.id)); return ok({ ok: true }); });
route('GET', '/datasets/{id}/bars', (db, { p, query }) => bars(db, Number(p.id), query));
route('GET', '/datasets/{id}/replay', (db, { p, query }) => replay(db, Number(p.id), query));
route('POST', '/datasets/import', async (db, { query, body }) => ok(await packs.importCsv(db, query, body)));
route('POST', '/datasets/download', () => { throw new HttpError(501, 'bu sürümde veri paketleri ve CSV kullanılır'); });

route('GET', '/packs', async (db) => { await packs.ensureStreams(db, 4000); return ok(await packs.status(db)); });
route('POST', '/packs/download', async (db, { body }) => {
  if (db.light) throw new HttpError(400, 'bu cihaz hafif modda: veriler siteden okunur, indirme gerekmez'); const b = json(body); return ok({ jobs: await packs.download(db, b.ids || [], b.tf || '1m'), ...(await packs.status(db)) }); });
route('GET', '/mirror', () => ok({ enabled: false }));
route('POST', '/mirror/restore', () => ok({ enabled: false }));
route('GET', '/jobs', () => ok(packs.jobs()));
route('GET', '/jobs/{id}', (db, { p }) => ok(packs.job(p.id)));
route('POST', '/jobs/{id}/cancel', (db, { p }) => { packs.cancel(p.id); return ok({ ok: true }); });

route('GET', '/profiles', async (db) => ok({ profiles: await listProfiles(db), current: await currentProfile(db), max: MAX_PROFILES }));
route('GET', '/me', async (db) => {
  const pid = await currentProfile(db);
  const listed = await listProfiles(db);
  return ok({
    profile: pid != null ? await profileJson(db, await profileRow(db, pid)) : null,
    first: pid != null && pid === Math.min(...listed.map((x) => x.id)),
    count: listed.length, auth: false, ephemeral: false, local: true,
  });
});
route('POST', '/profiles', async (db, { body }) => ok(await createProfile(db, json(body))));
route('PATCH', '/profiles/{id}', async (db, { p, body }) => ok(await updateProfile(db, Number(p.id), json(body))));
route('DELETE', '/profiles/{id}', async (db, { p, query }) => { await deleteProfile(db, Number(p.id), query.pin); return ok({ ok: true }); });
route('PUT', '/profiles/{id}/photo', async (db, { p, query, body }) => {
  const pid = Number(p.id);
  await authorize(db, pid, query.pin);
  if (!body || typeof body === 'string' || body.byteLength > PHOTO_MAX_BYTES) throw new HttpError(413, 'fotoğraf çok büyük (en fazla 1 MB)');
  const u8 = new Uint8Array(body);
  if (!(u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff)) throw bad('JPEG bekleniyor');
  await db.put('photos', String(pid), toBase64(body));
  await sync.touch(db, pid, 'profile');
  return ok(await profileJson(db, await profileRow(db, pid)));
});
route('DELETE', '/profiles/{id}/photo', async (db, { p, query }) => {
  const pid = Number(p.id);
  await authorize(db, pid, query.pin);
  await db.del('photos', String(pid));
  await sync.touch(db, pid, 'profile');
  return ok(await profileJson(db, await profileRow(db, pid)));
});
route('POST', '/profiles/{id}/select', async (db, { p, body }) => ok(await selectProfile(db, Number(p.id), json(body).pin)));
route('POST', '/profiles/leave', async (db) => { await db.del('meta', 'current_profile'); return ok({ ok: true }); });

route('GET', '/sessions', async (db) => {
  const pid = await needProfile(db);
  const mine = (await db.all('sessions')).map(([, s]) => s).filter((s) => s.profile_id === pid);
  for (const s of mine) await resolveDataset(db, s);
  const rows = mine.sort((a, b) => b.updated_at - a.updated_at)
    .map(({ id, name, dataset_id, dataset_key, kind, summary, created_at, updated_at }) => ({ id, name, dataset_id, dataset_key: dataset_key || null, kind, summary, created_at, updated_at }));
  return ok(rows);
});
route('POST', '/sessions', async (db, { body }) => {
  const pid = await needProfile(db);
  const b = json(body);
  const id = hex(crypto.getRandomValues(new Uint8Array(6)));
  const t = now();
  const s = { id, name: b.name, dataset_id: b.dataset_id ?? null, kind: b.kind || 'replay', state: b.state ?? {}, summary: b.summary || {}, created_at: t, updated_at: t, profile_id: pid };
  s.dataset_key = await sync.datasetKey(db, s.dataset_id);
  await db.put('sessions', id, s);
  await sync.touch(db, pid, 'session', id);
  return ok(savedJson(s));
});
route('GET', '/sessions/{id}', async (db, { p }) => ok(sessionJson(await getSession(db, p.id, await needProfile(db)))));
route('PUT', '/sessions/{id}', async (db, { p, body }) => {
  const pid = await needProfile(db);
  const s = await getSession(db, p.id, pid);
  const b = json(body);
  if (b.name != null) s.name = b.name;
  if (b.state != null) s.state = b.state;
  if (b.summary != null) s.summary = b.summary;
  s.updated_at = now();
  await db.put('sessions', s.id, s);
  await sync.touch(db, pid, 'session', s.id);
  return ok(savedJson(s));
});
route('DELETE', '/sessions/{id}', async (db, { p }) => {
  const pid = await needProfile(db);
  await getSession(db, p.id, pid);
  await db.del('sessions', p.id);
  await sync.touch(db, pid, 'session', p.id);
  return ok({ ok: true });
});

route('GET', '/kv', async (db, { query }) => {
  const pid = await kvProfile(db, query);
  return ok(Object.fromEntries((await db.all('kv', `${pid}:`)).map(([k, v]) => [k.slice(String(pid).length + 1), v])));
});
route('PUT', '/kv', async (db, { query, body }) => {
  const pid = await kvProfile(db, query);
  if (body && (body.byteLength ?? body.length) > KV_MAX_BYTES) throw new HttpError(413, 'kaydedilecek veri çok büyük');
  let values;
  try { values = json(body); } catch { throw bad('geçersiz JSON'); }
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).every((k) => k.length > 0 && k.length <= 120)) throw bad('anahtar/değer sözlüğü bekleniyor');
  for (const [k, v] of Object.entries(values)) {
    if (v === null) await db.del('kv', `${pid}:${k}`);
    else await db.put('kv', `${pid}:${k}`, v);
    await sync.touch(db, pid, 'kv', k);
  }
  return ok({ ok: true });
});

route('GET', '/strategies', async (db) => {
  const pid = await needProfile(db);
  return ok((await db.all('strategies', `${pid}:`)).map(([, s]) => s).sort((a, b) => (a.name < b.name ? -1 : 1)));
});
route('PUT', '/strategies/{name}', async (db, { p, body }) => {
  const pid = await needProfile(db);
  const name = decodeURIComponent(p.name).trim();
  if (!name) throw bad('strategy name must not be empty');
  const s = { name, code: json(body).code, updated_at: now() };
  await db.put('strategies', `${pid}:${name}`, s);
  await sync.touch(db, pid, 'strategy', name);
  return ok({ name, code: s.code });
});
route('DELETE', '/strategies/{name}', async (db, { p }) => {
  const pid = await needProfile(db);
  const key = `${pid}:${decodeURIComponent(p.name)}`;
  if (!(await db.get('strategies', key))) throw notFound(`strategy '${decodeURIComponent(p.name)}'`);
  await db.del('strategies', key);
  await sync.touch(db, pid, 'strategy', decodeURIComponent(p.name));
  return ok({ ok: true });
});

// ── the group's cloud (sync.js) ───────────────────────────────────────────
route('GET', '/cloud/status', async (db) => ok(await sync.status(db)));
// the test copy stays off the group's cloud: it brought a copy of this
// device's profiles once (clone.js) and keeps what is done here to itself
route('POST', '/cloud/connect', () => { throw new HttpError(403, 'Test sürümü buluta bağlanmaz: veriler ana siteden bir kez kopyalandı ve burada kalır'); });
route('POST', '/cloud/sync', async (db) => ok({ ...(await sync.status(db)), changed: 0 }));
route('POST', '/cloud/disconnect', async (db) => { await sync.disconnect(db); return ok(await sync.status(db)); });

/** Answer one API request. `path` is without the /api prefix. */
export async function handle(db, { method, path, query = {}, body }) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    try {
      return await r.fn(db, { p: m.groups || {}, query, body });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return { status, json: { detail: e.message || String(e) } };
    }
  }
  return { status: 404, json: { detail: 'Not Found' } };
}

