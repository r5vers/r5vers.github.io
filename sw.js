// The installed app opens without internet: every page, script and style the
// site loads is kept here as it last came from the network. Online, the
// network always wins (a new release shows at once); offline, the kept copy
// answers. Candles and profiles are not here - they live in IndexedDB, and
// the data files (/data/) pass straight through: keeping a second copy of
// hundreds of megabytes here filled phones (iPhone) before IndexedDB could
// hold the candles. A new name clears the old cache, data files and all.
const CACHE = 'rv-app-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // the start page of the installed app
      if (req.mode === 'navigate') {
        const start = await cache.match('/profiles.html');
        if (start) return start;
      }
      throw err;
    }
  })());
});
