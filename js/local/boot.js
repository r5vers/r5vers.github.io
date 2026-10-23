// Runs before anything else on every page. Served by the Python server (it
// marks its pages with window.RV_SERVER) nothing changes. Served as plain
// files (Vercel, the installed app) the site has no server: requests to
// /api/... are answered here, on the device, from IndexedDB - so the rest of
// the app works the same in both.
import { IdbDb, persistStorage } from './db.js';
import { handle } from './server.js';
import { resume } from './packs.js';
import { flush, sync } from './sync.js';

export const LOCAL = typeof window !== 'undefined' && !window.RV_SERVER;

let dbPromise = null;
export function localDb() {
  if (!dbPromise) {
    dbPromise = IdbDb.open().then((db) => {
      persistStorage();
      // downloads a closed page left unfinished carry on, once the page is up
      setTimeout(() => resume(db).catch(() => {}), 1500);
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
    if (document.visibilityState === 'visible') tick();
    else flush(db).catch(() => {});
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
    res = await handle(await localDb(), req);
  } catch (e) {
    // no IndexedDB (a private window on an old browser) and the like
    res = { status: 500, json: { detail: `cihaz depolaması açılamadı: ${e.message || e}` } };
  }
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
