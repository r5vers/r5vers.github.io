// Data packs on the device: 15 years per instrument, downloaded from the
// site's data folder (one gzip file per year, see tools/publish_data.py)
// straight into IndexedDB. A pack fetches only the years it lacks or that
// changed, so pressing the button again tops it up, and a download cut short
// (the page was closed) carries on where it stopped.
import { emptyCols, parseFile } from './rtc.js';
import { aggregated, putPart, replaceSeries } from './series.js';
import { parseTf } from '../core/timeframes.js';
import { createDataset, datasetJson, listDatasets } from './server.js';
import { storageEstimate } from './db.js';

// next to the site itself (GitHub Pages: r5vers.github.io/data/, laid out
// by tools/publish_data.py); same address, so no cross-site rules apply
export const DATA_URL = '/data/';
export const YEARS = 15;
export const RESOLUTIONS = ['1m', '5m'];
const MARGIN = 200 * 2 ** 20;           // leave the device this much
const MANIFEST_TTL = 10 * 60 * 1000;

export const PACKS = [
  { id: 'EURUSD', name: 'EUR/USD', title: 'Euro / Dolar', kind: 'Forex', session: 'fx' },
  { id: 'NAS100', name: 'NASDAQ 100', title: 'ABD teknoloji endeksi', kind: 'Endeks', session: 'cfd' },
  { id: 'XAUUSD', name: 'XAU/USD', title: 'Altın / Dolar', kind: 'Emtia', session: 'cfd' },
  { id: 'GBPUSD', name: 'GBP/USD', title: 'Sterlin / Dolar', kind: 'Forex', session: 'fx' },
  { id: 'USDCAD', name: 'USD/CAD', title: 'Dolar / Kanada doları', kind: 'Forex', session: 'fx' },
  { id: 'SPX500', name: 'S&P 500', title: 'ABD 500 endeksi', kind: 'Endeks', session: 'cfd' },
];
const BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));
const MINUTES_PER_YEAR = { fx: 52 * 5 * 1440, cfd: 52 * 5 * 1380 };

export function historyStart(years = YEARS, t = Date.now() / 1000) {
  return Math.floor((Math.floor(t) - Math.floor(years * 365.25 * 86400)) / 86400) * 86400;
}

function estimateBytes(pack, tf) {
  const minutes = MINUTES_PER_YEAR[pack.session] * YEARS;
  return Math.floor((minutes / (tf === '1m' ? 1 : 5)) * 24 * 1.03);
}

/** Download sources for the "other symbols" form: none without a server
 *  (OANDA, Dukascopy & co. do not answer browsers); packs and CSV remain. */
export function providers() {
  return [];
}

// ── the data repository ───────────────────────────────────────────────────
let manifest = null, manifestAt = 0;
export async function getManifest(fetchFn = fetch, force = false) {
  if (!force && manifest && Date.now() - manifestAt < MANIFEST_TTL) return manifest;
  const r = await fetchFn(`${DATA_URL}manifest.json`, { cache: 'no-cache' });
  if (!r.ok) throw Object.assign(new Error(`veri deposuna ulaşılamadı (HTTP ${r.status})`), { status: 502 });
  manifest = await r.json();
  manifestAt = Date.now();
  return manifest;
}

async function gunzip(response) {
  if (typeof DecompressionStream !== 'undefined' && response.body) {
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  // Safari before 16.4: unpacked in JavaScript
  const { gunzipSync } = await import('../../vendor/fflate.js');
  const out = gunzipSync(new Uint8Array(await response.arrayBuffer()));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** One data file, tried again after a dropped connection (a phone switching
 *  networks or waking up); a missing file is not tried again. */
async function fetchFile(fetchFn, url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetchFn(url);
      if (r.ok) return { raw: await gunzip(r) };
      if (r.status === 404 || i >= tries) throw Object.assign(new Error(`indirilemedi (HTTP ${r.status})`), { final: true });
    } catch (e) {
      if (e.final || i >= tries) throw e;
    }
    await new Promise((res) => setTimeout(res, 1500 * i));
  }
}

/** What went wrong, said for the person in front of the screen. */
async function explain(e) {
  if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
    const est = await storageEstimate();
    const free = est.quota ? Math.max(0, (est.quota - (est.usage || 0)) / 1e6) : null;
    return `cihazda yer kalmadı${free != null ? ` (siteye ayrılan boş alan ~${Math.round(free)} MB)` : ''}: daha az paket ya da 5m indirin, telefonda boş alan açın`;
  }
  if (e instanceof TypeError && /network|load failed|fetch/i.test(e?.message || '')) return 'bağlantı koptu: sayfa açıkken kaldığı yerden devam eder';
  return e?.message || String(e);
}

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The pack's dataset for `tf` on this device (or none yet). */
export async function packDataset(db, id, tf) {
  return (await listDatasets(db)).find((d) => d.meta?.pack === id && d.base_tf === tf) || null;
}

// ── jobs (one queue per page's worker) ────────────────────────────────────
const jobList = new Map();
let running = null;
const queue = [];

export function jobs() { return [...jobList.values()].sort((a, b) => b.created_at - a.created_at).map((j) => ({ ...j })); }
export function job(id) {
  const j = jobList.get(id);
  if (!j) throw Object.assign(new Error(`job ${id} not found`), { status: 404 });
  return { ...j };
}
export function cancel(id) {
  const j = jobList.get(id);
  if (j && (j.status === 'queued' || j.status === 'running')) j.cancelled = true;
}

function newJob(pack, tf) {
  const id = Math.random().toString(16).slice(2, 14);
  const j = {
    id, provider: 'github', symbol: pack.id, tf, start: historyStart(), end: Math.floor(Date.now() / 1000), dataset_id: null,
    status: 'queued', progress: 0, bars: 0, message: '', label: `${pack.name} · ${YEARS} yıl · ${tf}`, pack: pack.id,
    ranges: [], eta: null, created_at: Date.now() / 1000, started_at: null, finished_at: null,
  };
  jobList.set(id, j);
  return j;
}

/** Queue downloads of `ids` at `tf`; returns the jobs started. */
export async function download(db, ids, tf, { fetchFn = fetch } = {}) {
  if (!RESOLUTIONS.includes(tf)) throw Object.assign(new Error(`çözünürlük ${RESOLUTIONS.join(', ')} olmalı`), { status: 400 });
  const unknown = ids.filter((i) => !BY_ID[i]);
  if (unknown.length || !ids.length) throw Object.assign(new Error(`bilinmeyen paket: ${unknown.join(', ') || '-'}`), { status: 400 });
  const active = new Set([...jobList.values()].filter((j) => j.status === 'queued' || j.status === 'running').map((j) => `${j.pack}:${j.tf}`));
  const started = [];
  for (const id of ids) {
    if (active.has(`${id}:${tf}`)) continue;
    const j = newJob(BY_ID[id], tf);
    queue.push({ db, j, fetchFn });
    started.push({ ...j });
  }
  // remember what was asked for: a page opened later carries on with it
  const pending = new Set((await db.get('downloads', 'pending')) || []);
  ids.forEach((id) => pending.add(`${id}:${tf}`));
  await db.put('downloads', 'pending', [...pending]);
  pump();
  return started;
}

/** Called when the worker starts: unfinished downloads continue. */
export async function resume(db, { fetchFn = fetch } = {}) {
  const pending = (await db.get('downloads', 'pending')) || [];
  // a full device does not get fuller by itself: those wait for a click
  const full = new Set([...jobList.values()].filter((j) => j.full).map((j) => `${j.pack}:${j.tf}`));
  for (const key of pending) {
    if (full.has(key)) continue;
    const [id, tf] = key.split(':');
    if (BY_ID[id] && RESOLUTIONS.includes(tf)) await download(db, [id], tf, { fetchFn }).catch(() => {});
  }
}

function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  const { db, j, fetchFn } = running;
  const work = () => runJob(db, j, fetchFn);
  // only one page downloads at a time; the others see its progress in the data
  const locked = globalThis.navigator?.locks ? navigator.locks.request('rv-pack-download', work) : work();
  Promise.resolve(locked).finally(() => { running = null; pump(); });
}

async function runJob(db, j, fetchFn) {
  j.status = 'running';
  j.started_at = Date.now() / 1000;
  try {
    const m = await getManifest(fetchFn);
    const entry = m.packs?.[j.pack]?.tfs?.[j.tf];
    if (!entry) throw new Error(`${j.pack} ${j.tf} veri deposunda henüz yok`);
    const fields = m.packs[j.pack].fields || {};
    let ds = await packDataset(db, j.pack, j.tf);
    if (!ds) {
      const { symbol, name, source, base_tf, align, decimals, pip_size, contract_size, quote_conv, price_type, currency } = fields;
      ds = await createDataset(db, {
        symbol: symbol || j.pack, name: name || j.label, source: source || 'github', base_tf: j.tf,
        meta: { pack: j.pack, files: {} },
        ...Object.fromEntries(Object.entries({ align, decimals, pip_size, contract_size, quote_conv, price_type, currency }).filter(([, v]) => v !== undefined)),
      });
    }
    j.dataset_id = ds.id;
    // a different storage scale (a rebuilt pack): start the pack over
    if (ds.bar_count && ds.series?.scale !== entry.scale) {
      ds = await replaceSeries(db, ds, emptyCols(0), entry.scale);
      ds = { ...ds, meta: { ...ds.meta, files: {} } };
    }
    const have = ds.meta?.files || {};
    const wanted = new Set(entry.files.map((f) => f.tag));
    const todo = entry.files.filter((f) => have[f.tag] !== f.sha256);
    const total = todo.reduce((s, f) => s + (f.gz_bytes || 1), 0) || 1;
    let done = 0;
    const t0 = Date.now();
    // years the repository no longer has
    for (const tag of Object.keys(have)) {
      if (!wanted.has(tag)) {
        ds = await putPart(db, ds, tag, emptyCols(0), ds.series?.scale ?? entry.scale);
        delete have[tag];
      }
    }
    for (const f of todo) {
      if (j.cancelled) { j.status = 'cancelled'; return; }
      const { raw } = await fetchFile(fetchFn, `${DATA_URL}${f.path}`).catch((e) => { throw Object.assign(e, { message: `${f.path}: ${e.message}` }); });
      if (f.sha256 && (await sha256(raw)) !== f.sha256) throw new Error(`${f.path} bozuk indi, tekrar deneyin`);
      const { scale, cols } = parseFile(raw);
      ds = await putPart(db, ds, f.tag, cols, scale);
      have[f.tag] = f.sha256;
      ds = { ...ds, meta: { ...ds.meta, pack: j.pack, files: { ...have } } };
      await db.put('datasets', String(ds.id), ds);
      j.bars += cols.t.length;
      done += f.gz_bytes || 1;
      j.progress = Math.min(1, done / total);
      const rate = done / Math.max(1, Date.now() - t0);
      j.eta = rate > 0 ? Math.round((total - done) / rate / 1000) : null;
    }
    // build the hour bars now, so opening 1h / 4h / 1D later is instant
    if (todo.length) await aggregated(db, ds, parseTf('1h')).catch(() => {});
    j.status = 'done';
    j.progress = 1;
    j.message = `${j.bars.toLocaleString('tr-TR')} bar indirildi`;
    const pending = new Set((await db.get('downloads', 'pending')) || []);
    pending.delete(`${j.pack}:${j.tf}`);
    await db.put('downloads', 'pending', [...pending]);
  } catch (e) {
    j.status = 'error';
    // the years already in are kept; the download stays asked for, so it
    // carries on from there when the page is back (resume)
    j.message = await explain(e);
    j.full = /yer kalmadı/.test(j.message);
  } finally {
    j.finished_at = Date.now() / 1000;
    j.eta = null;
  }
}

// ── status (the Data tab) ─────────────────────────────────────────────────
export async function status(db) {
  const t = Math.floor(Date.now() / 1000);
  const start = historyStart(YEARS, t);
  const span = t - start;
  const est = await storageEstimate();
  const total = est.quota || 0, used = est.usage || 0;
  let persisted = false;
  try { persisted = !!(await navigator.storage?.persisted?.()); } catch { /* not offered */ }
  let m = null;
  try { m = await getManifest(); } catch { /* offline: estimates only */ }
  const recent = {};
  for (const j of jobs()) if (!recent[j.pack]) recent[j.pack] = j;
  const out = [];
  let need1m = 0;
  for (const pack of PACKS) {
    const item = { id: pack.id, name: pack.name, title: pack.title, kind: pack.kind, datasets: [] };
    for (const tf of RESOLUTIONS) {
      const ds = await packDataset(db, pack.id, tf);
      if (!ds) continue;
      let covered = 0;
      if (ds.first_ts != null) covered = Math.max(0, Math.min(1, (Math.min(ds.last_ts, t) - Math.max(ds.first_ts, start)) / span));
      item.datasets.push({ id: ds.id, tf, source: ds.source, first_ts: ds.first_ts, last_ts: ds.last_ts, bar_count: ds.bar_count, bytes: datasetJson(ds).bytes, coverage: Math.round(covered * 1e4) / 1e4 });
    }
    item.estimate = Object.fromEntries(RESOLUTIONS.map((tf) => [tf, m?.packs?.[pack.id]?.tfs?.[tf]?.bytes ?? estimateBytes(pack, tf)]));
    const have1m = item.datasets.find((d) => d.tf === '1m');
    need1m += Math.floor(item.estimate['1m'] * (1 - (have1m?.coverage || 0)));
    item.job = recent[pack.id] || null;
    item.available = m ? Object.keys(m.packs?.[pack.id]?.tfs || {}) : null;
    out.push(item);
  }
  return {
    years: YEARS, start, packs: out,
    disk: { total, used, free: Math.max(0, total - used), railway: false, persistent: persisted, device: true },
    mirror: { enabled: false }, provider: 'github', local: true,
    recommended: total - used - MARGIN > need1m ? '1m' : '5m',
  };
}

/** CSV upload, parsed on the device. */
export async function importCsv(db, query, body) {
  const { importCsvFile } = await import('./csvimport.js');
  return importCsvFile(db, query, body);
}
