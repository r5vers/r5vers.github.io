// The site's data folder over the network: the manifest and the gzip files
// of the packs (tools/publish_data.py, tools/publish_agg.mjs), for the
// downloader (packs.js) and for reading packs straight from the site
// (series.js, StreamRows).

// next to the site itself (GitHub Pages: r5vers.github.io/data/); same
// address, so no cross-site rules apply
export const DATA_URL = '/data/';
const MANIFEST_TTL = 10 * 60 * 1000;

let manifest = null, manifestAt = 0;
export async function getManifest(fetchFn = null, force = false) {
  if (!force && manifest && Date.now() - manifestAt < MANIFEST_TTL) return manifest;
  let buf;
  try { buf = await getBytes(`${DATA_URL}manifest.json`, { fetchFn, fresh: true }); } catch (e) {
    throw Object.assign(new Error(`veri deposuna ulaşılamadı (${e.message})`), { status: 502, retry: e.status !== 404 });
  }
  manifest = JSON.parse(new TextDecoder().decode(buf));
  manifestAt = Date.now();
  return manifest;
}

let defaultFetch = null;
/** Tests: answer every request of this module with `fn` (fetch's signature). */
export function useFetch(fn) { defaultFetch = fn; manifest = null; }

export const STALL_MS = 25_000;
export const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t?.unref?.(); });

/** The bytes at `url`. In the browser over XMLHttpRequest, not fetch's
 *  streams: Safari 26 can hold back the last piece of a streamed body until
 *  more arrives (WebKit bug 322545), and for a file that piece never comes,
 *  so the download sat at 0%. XHR also says how far it got, and a transfer
 *  that goes quiet for STALL_MS (a phone that slept, a lost network) is
 *  dropped, to be tried again. `fetchFn` (tests) takes fetch's place. */
export function getBytes(url, { fetchFn = null, fresh = false, onProgress = null } = {}) {
  fetchFn ||= defaultFetch;
  if (fetchFn || typeof XMLHttpRequest === 'undefined') {
    return (fetchFn || fetch)(url, fresh ? { cache: 'no-cache' } : undefined).then((r) => {
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r.arrayBuffer();
    });
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let last = Date.now(), over = false;
    const end = (fn, v) => { if (over) return; over = true; clearInterval(watch); fn(v); };
    const watch = setInterval(() => {
      if (Date.now() - last > STALL_MS) { end(reject, Object.assign(new Error('bağlantı durdu'), { retry: true })); x.abort(); }
    }, 2000);
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    if (fresh) x.setRequestHeader('Cache-Control', 'no-cache');
    x.onprogress = (e) => { last = Date.now(); onProgress?.(e.loaded); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? end(resolve, x.response) : end(reject, Object.assign(new Error(`HTTP ${x.status}`), { status: x.status, retry: x.status >= 500 })));
    x.onerror = () => end(reject, Object.assign(new Error('bağlantı koptu'), { retry: true }));
    x.onabort = () => end(reject, Object.assign(new Error('bağlantı durdu'), { retry: true }));
    x.send();
  });
}

/** gzip, unpacked in JavaScript (fflate): the same on every browser, with no
 *  stream in between that a browser could stall. */
let fflate = null;
export async function gunzip(buf) {
  fflate ||= await import('../../vendor/fflate.js?v=4a4bde5db4');
  const out = fflate.gunzipSync(new Uint8Array(buf));
  return out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? out.buffer : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

export async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One data file, tried again after a dropped or stalled connection; a
 *  missing file is not tried again. */
export async function fetchFile(url, opts, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await gunzip(await getBytes(url, opts));
    } catch (e) {
      if (e.status === 404 || i >= tries) throw Object.assign(e, { message: `indirilemedi (${e.message})` });
    }
    await sleep(1500 * i);
  }
}

/** `p`, or an error once `ms` pass without it (storage that stopped answering). */
export function within(p, ms, message) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(message), { retry: true })), ms); t?.unref?.(); })]).finally(() => clearTimeout(t));
}

