// Runs before anything else on every page. Served by the Python server (it
// marks its pages with window.RV_SERVER) nothing changes. Served as plain
// files (Vercel, the installed app) the site has no server: requests to
// /api/... are answered here, on the device, from IndexedDB - so the rest of
// the app works the same in both.
import { IdbDb, LightDb, persistStorage } from './db.js?v=64b6fa7342';
import { handle } from './server.js?v=64b6fa7342';
import { flush, sync } from './sync.js?v=64b6fa7342';

export const LOCAL = typeof window !== 'undefined' && !window.RV_SERVER;
// the page's scripts loaded and linked: the safety net in the page stands down
if (typeof window !== 'undefined') window.__rvBooted = true;

/** The last errors on this device, for the check-up page (tani.html). */
export function logError(where, err) {
  try {
    const list = JSON.parse(localStorage.getItem('rv-errors') || '[]');
    list.push({ at: new Date().toISOString(), page: location.pathname, where, msg: String(err?.message || err).slice(0, 400), stack: String(err?.stack || '').slice(0, 600) });
    localStorage.setItem('rv-errors', JSON.stringify(list.slice(-20)));
  } catch { /* storage blocked */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => logError('error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
}

/** Light mode (db.js LightDb): iPhones and iPads, a device whose database
 *  does not open, or by choice (?mode=light / ?mode=full, remembered). */
function wantLight() {
  try {
    const asked = new URLSearchParams(location.search).get('mode');
    if (asked === 'light' || asked === 'full') localStorage.setItem('rv-mode', asked);
    const kept = localStorage.getItem('rv-mode');
    if (kept) return kept === 'light';
  } catch { /* storage blocked */ }
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function lightDb() {
  const db = new LightDb();
  // what changed goes into localStorage before the page goes away
  addEventListener('pagehide', () => db.save());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') db.save(); });
  return db;
}

let dbPromise = null;
export function localDb() {
  if (!dbPromise) {
    const opened = LOCAL && wantLight()
      ? Promise.resolve(lightDb())
      : IdbDb.open().then((db) => { persistStorage(); return db; }, (e) => {
        // the database will not open here: light mode instead of a dead site
        logError('database', e);
        return lightDb();
      });
    dbPromise = opened.then((db) => {
      // (no download carries on by itself: packs are read from the site, a
      // full download is only for using them offline, and starts on a click)
      keepInSync(db);
      return db;
    });
  }
  return dbPromise;
}

const SYNC_EVERY = 30_000;

/** In the group's cloud: bring what changed on other devices every half
 *  minute while the page is in view and when it comes back; send before
 *  leaving. (Pages that need the latest at once ask /api/cloud/sync.) */
function keepInSync(db) {
  const tick = async () => {
    if (document.visibilityState === 'visible' && (await db.get('meta', 'group'))) sync(db).catch(() => {});
  };
  setTimeout(tick, 4000);
  setInterval(tick, SYNC_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
    } else flush(db, { force: true }).catch(() => {});
  });
}

async function bodyBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return new TextEncoder().encode(body).buffer;
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  if (body instanceof Blob) return body.arrayBuffer();
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).buffer;
  throw new Error('desteklenmeyen istek gövdesi');
}

async function answer(url, init) {
  const req = {
    method: (init.method || 'GET').toUpperCase(),
    path: url.pathname.slice(4),
    query: Object.fromEntries(url.searchParams),
    body: await bodyBuffer(init.body),
  };
  let res;
  try {
    // an answer that never comes (this device's storage stuck) ends in an
    // error and an offer to start the device clean, never a page that waits
    res = await Promise.race([
      (async () => handle(await localDb(), req))(),
      // (reads are quick; joining the group or a CSV import may take a while)
      new Promise((_, no) => setTimeout(() => no(new Error('cihaz depolaması yanıt vermiyor')), req.method === 'GET' ? 20000 : 180000)),
    ]);
  } catch (e) {
    // no IndexedDB (a private window on an old browser), storage stuck, and the like
    res = { status: 503, json: { detail: `${e.message || e}: “Cihazı sıfırla” ile temiz başla (bulut verisi silinmez)` } };
    globalThis.__rvShowFail?.(res.json.detail);
  }
  if (res.status >= 409) logError(`${req.method} /api${req.path} ${res.status}`, res.json?.detail);
  if (res.bytes) return new Response(res.bytes, { status: res.status, headers: res.headers });
  return new Response(JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

if (LOCAL) {
  // works offline once installed (see /sw.js)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    if (input instanceof Request) init = { method: input.method, body: input.body, ...init };
    return answer(url, init);
  };
}
