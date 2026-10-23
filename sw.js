// The installed app opens without internet: every page, script and style the
// site loads is kept here as it last came from the network. Online, the
// network always wins (a new release shows at once); offline, the kept copy
// answers. Candles and profiles are not here - they live in IndexedDB, and
// the data files (/data/) pass straight through: keeping a second copy of
// hundreds of megabytes here filled phones (iPhone) before IndexedDB could
// hold the candles. Each release has its own cache (tools/build_site.py
// writes BUILD), and the old one goes when the new worker takes over.
const BUILD = '1f79c2a121';
const CACHE = `rv-app-${BUILD}`;

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
      // pages always come fresh (they name this release's scripts); scripts
      // and styles carry the release in their address, so a kept copy is right
      const res = req.mode === 'navigate' ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : await fetch(req);
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
