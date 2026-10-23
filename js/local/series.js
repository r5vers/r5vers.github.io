// A dataset's candles on the device: the base series in chunks of up to
// CHUNK rows (24-byte records), so a phone never holds 15 years in memory -
// a query loads the chunks it touches, recently used ones stay cached.
//
// The dataset record keeps the chunk list: { key, n, t0, t1, tag }, in time
// order. `tag` groups the chunks of one downloaded file (a pack's year), so
// a newer copy of that file replaces exactly them.
//
// A pack can also be read straight from the site, without downloading it
// first (StreamRows): a query fetches the years it touches, keeps them here
// when the device has room, and works on without when it has not. That is
// how every pack is ready at once on every device, phones included.
import { parseTf, HOUR } from '../core/timeframes.js?v=1f79c2a121';
import { colsToRecords, concatCols, emptyCols, parseFile, recordsToCols, sliceCols } from './rtc.js?v=1f79c2a121';
import { MemRows, aggregateAll, lowerBound, rollUp, upperBound } from './query.js?v=1f79c2a121';
import { DATA_URL, fetchFile, getManifest, sha256, within } from './net.js?v=1f79c2a121';

export const CHUNK = 1 << 16;
const FIELDS = ['t', 'o', 'h', 'l', 'c', 'v'];
const CACHE_BYTES = 96 * 2 ** 20;

// "<db>/<chunk key>" -> { cols, bytes }, least recently used first
const cache = new Map();
let cached = 0;
const dbIds = new WeakMap();
let dbCount = 0;
const cacheKey = (db, key) => {
  if (!dbIds.has(db)) dbIds.set(db, ++dbCount);
  return `${dbIds.get(db)}/${key}`;
};
function remember(key, cols) {
  const bytes = cols.t.length * 24;
  cache.set(key, { cols, bytes });
  cached += bytes;
  for (const [k, v] of cache) {
    if (cached <= CACHE_BYTES) break;
    cache.delete(k);
    cached -= v.bytes;
  }
}
function forget(key) {
  const v = cache.get(key);
  if (v) { cache.delete(key); cached -= v.bytes; }
}

/** The base series of a dataset record, as query.js "rows". */
export class ChunkRows {
  constructor(db, ds) {
    this.db = db;
    this.chunks = ds.series?.chunks || [];
    this.scale = ds.series?.scale ?? 0;
    this.offsets = [];
    let n = 0;
    for (const c of this.chunks) { this.offsets.push(n); n += c.n; }
    this.n = n;
    this.t1s = this.chunks.map((c) => c.t1);
  }
  async _chunk(k) {
    const meta = this.chunks[k];
    const ck = cacheKey(this.db, meta.key);
    const hit = cache.get(ck);
    if (hit) { cache.delete(ck); cache.set(ck, hit); return hit.cols; }
    const buf = await this.db.get('chunks', meta.key);
    if (!buf) throw Object.assign(new Error('mum verisi eksik: veri setini yeniden indirin'), { status: 409 });
    const cols = recordsToCols(buf);
    remember(ck, cols);
    return cols;
  }
  _chunkOf(i) { return Math.max(0, upperBound(this.offsets, i) - 1); }
  async search(x, side = 'left') {
    const k = side === 'left' ? lowerBound(this.t1s, x) : upperBound(this.t1s, x);
    if (k >= this.chunks.length) return this.n;
    const t = (await this._chunk(k)).t;
    return this.offsets[k] + (side === 'left' ? lowerBound(t, x) : upperBound(t, x));
  }
  async tAt(i) {
    const k = this._chunkOf(i);
    return (await this._chunk(k)).t[i - this.offsets[k]];
  }
  async slice(i, j) {
    i = Math.max(0, i); j = Math.min(this.n, j);
    if (j <= i) return emptyCols(0);
    const k0 = this._chunkOf(i), k1 = this._chunkOf(j - 1);
    const parts = [];
    for (let k = k0; k <= k1; k++) {
      const cols = await this._chunk(k);
      const a = k === k0 ? i - this.offsets[k] : 0;
      const b = k === k1 ? j - this.offsets[k] : cols.t.length;
      parts.push(sliceCols(cols, a, b));
    }
    return parts.length === 1 ? parts[0] : concatCols(parts);
  }
}

function summary(chunks) {
  const n = chunks.reduce((s, c) => s + c.n, 0);
  return { bar_count: n, first_ts: n ? chunks[0].t0 : null, last_ts: n ? chunks[chunks.length - 1].t1 : null };
}

async function putChunks(db, ds, cols, tag) {
  const out = [];
  for (let s = 0; s < cols.t.length; s += CHUNK) {
    const part = sliceCols(cols, s, Math.min(cols.t.length, s + CHUNK));
    const key = `${ds.id}:${await db.nextId('chunk')}`;
    await db.put('chunks', key, colsToRecords(part));
    out.push({ key, n: part.t.length, t0: part.t[0], t1: part.t[part.t.length - 1], tag });
  }
  return out;
}

async function dropChunks(db, chunks) {
  for (const c of chunks) { await db.del('chunks', c.key); forget(cacheKey(db, c.key)); }
}

/** After the candles changed: new counts, a new version, no stale caches. */
async function finish(db, ds, chunks, scale) {
  const next = { ...ds, ...summary(chunks), series: { scale, chunks }, version: (ds.version || 0) + 1, updated_at: Math.floor(Date.now() / 1000) };
  await db.put('datasets', String(ds.id), next);
  await db.delPrefix('aggs', `${ds.id}:`);
  aggMemo.clear();
  return next;
}

/** Replace all candles of `ds` (integer columns at `scale`). */
export async function replaceSeries(db, ds, cols, scale) {
  const old = ds.series?.chunks || [];
  const chunks = await putChunks(db, ds, cols, null);
  await dropChunks(db, old);
  return finish(db, ds, chunks, scale);
}

/** Put the candles of one downloaded file (a pack's year) in place of an
 *  earlier copy of that file. The files of a pack do not overlap in time. */
export async function putPart(db, ds, tag, cols, scale) {
  if (ds.series?.chunks?.length && ds.series.scale !== scale) throw new Error(`ölçek uyuşmuyor (${ds.series.scale} / ${scale})`);
  const keep = (ds.series?.chunks || []).filter((c) => c.tag !== tag);
  const fresh = cols.t.length ? await putChunks(db, ds, cols, tag) : [];
  const chunks = [...keep, ...fresh].sort((a, b) => a.t0 - b.t0);
  await dropChunks(db, (ds.series?.chunks || []).filter((c) => c.tag === tag));
  return finish(db, ds, chunks, scale);
}

/** All candles of a dataset as one set of columns (small datasets: CSV). */
export async function readAll(db, ds) {
  const rows = await deviceSource(db).base(ds);
  return { cols: await rows.slice(0, rows.n), scale: rows.scale };
}

export async function deleteSeries(db, ds) {
  await dropChunks(db, ds.series?.chunks || []);
  await db.delPrefix('aggs', `${ds.id}:`);
  aggMemo.clear();
}

// cached timeframes (1h and longer), per dataset version
const aggMemo = new Map();

/** { rows, starts } of a cached timeframe; computed once, kept on the device.
 *  Longer timeframes roll up from 1h when the base divides an hour: their
 *  bars are unions of hour bars in both alignments (tests check this). */
export async function aggregated(db, ds, tf) {
  const key = `${ds.id}:${ds.version}:${ds.align}:${tf.id}`;
  if (aggMemo.has(key)) return aggMemo.get(key);
  let stored = await db.get('aggs', key);
  if (!stored) {
    const base = parseTf(ds.base_tf);
    const viaHour = tf.id !== '1h' && base.kind === 'intraday' && HOUR % base.seconds === 0 && base.seconds < HOUR
      && (tf.kind !== 'intraday' || tf.seconds % HOUR === 0);
    let agg;
    if (viaHour) {
      const hour = await aggregated(db, ds, parseTf('1h'));
      agg = rollUp(hour.rows.cols, hour.starts, tf, ds.align);
    } else {
      agg = await aggregateAll(new ChunkRows(db, ds), tf, ds.align);
    }
    stored = { records: colsToRecords(agg.cols), starts: agg.starts };
    await db.put('aggs', key, stored);
  }
  const out = { rows: new MemRows(recordsToCols(stored.records), ds.series?.scale ?? 0), starts: stored.starts };
  aggMemo.set(key, out);
  if (aggMemo.size > 24) aggMemo.delete(aggMemo.keys().next().value);
  return out;
}

// ── packs read from the site ──────────────────────────────────────────────
/** A pack dataset not (fully) on the device: read from the site. */
export const isStream = (ds) => !!ds?.meta?.stream && !ds?.meta?.complete;

let savedBuilt = null;
/** The site's manifest; the last one seen is kept, so what was read before
 *  still opens offline. */
export async function manifestOf(db) {
  try {
    const m = await getManifest();
    if (m.built_at !== savedBuilt) { savedBuilt = m.built_at; db.put('meta', 'manifest', m).catch(() => {}); }
    return m;
  } catch (e) {
    const m = await db.get('meta', 'manifest').catch(() => null);
    if (m) return m;
    throw Object.assign(new Error('veri için internet gerekli (bu piyasa cihaza indirilmedi)'), { status: 503 });
  }
}

async function streamEntry(db, ds) {
  const entry = (await manifestOf(db)).packs?.[ds.meta.pack]?.tfs?.[ds.base_tf];
  if (!entry) throw Object.assign(new Error(`${ds.meta.pack} ${ds.base_tf} sitede yok`), { status: 404 });
  return entry;
}

const loading = new Map();

/** One year of a pack: from memory, from the device (read before, or part
 *  of a download that did not finish), or from the site. */
async function loadFile(db, f, ds) {
  const key = `file:${f.sha256}`;
  const ck = cacheKey(db, key);
  const hit = cache.get(ck);
  if (hit) { cache.delete(ck); cache.set(ck, hit); return hit.cols; }
  if (loading.has(ck)) return loading.get(ck);
  const p = (async () => {
    const kept = await within(db.get('chunks', key), 15_000, 'cihaz depolaması yanıt vermedi').catch(() => null);
    const part = ds?.meta?.files?.[f.tag] === f.sha256 ? (ds.series?.chunks || []).filter((c) => c.tag === f.tag) : [];
    let cols = null;
    if (kept) cols = recordsToCols(kept);
    else if (part.length) {
      const bufs = await Promise.all(part.map((c) => within(db.get('chunks', c.key), 15_000, '').catch(() => null)));
      if (bufs.every(Boolean)) cols = concatCols(bufs.map((b) => recordsToCols(b)));
    }
    if (!cols) {
      const raw = await fetchFile(`${DATA_URL}${f.path}`, {});
      if (f.sha256 && (await sha256(raw)) !== f.sha256) throw Object.assign(new Error(`${f.tag} bozuk indi, tekrar deneyin`), { status: 502 });
      cols = parseFile(raw).cols;
      // kept for next time if there is room; reading does not wait for it
      within(db.put('chunks', key, colsToRecords(cols)), 60_000, 'kaydedilemedi').catch(() => {});
    }
    if (cols.t.length !== f.bars) throw Object.assign(new Error(`${f.tag}: beklenmeyen bar sayısı`), { status: 502 });
    remember(ck, cols);
    return cols;
  })().finally(() => loading.delete(ck));
  loading.set(ck, p);
  return p;
}

/** A pack's base series over its year files (manifest order), as query.js rows. */
export class StreamRows extends ChunkRows {
  constructor(db, entry, ds = null) {
    super(db, { series: { scale: entry.scale, chunks: entry.files.map((f) => ({ key: `file:${f.sha256}`, n: f.bars, t0: f.first_ts, t1: f.last_ts })) } });
    this.files = entry.files;
    this.ds = ds;
  }
  async _chunk(k) { return loadFile(this.db, this.files[k], this.ds); }
  // the first and last times are in the manifest: no year fetched for them
  async tAt(i) {
    if (i === 0 && this.files.length) return this.files[0].first_ts;
    if (i === this.n - 1 && this.files.length) return this.files[this.files.length - 1].last_ts;
    return super.tAt(i);
  }
}

/** "RVA1" (tools/publish_agg.mjs): hour bars and where each starts in the base. */
export function decodeAgg(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x52 || u8[1] !== 0x56 || u8[2] !== 0x41 || u8[3] !== 0x31) throw new Error('saatlik veri dosyası tanınmadı');
  const dv = new DataView(buf);
  const scale = dv.getInt32(8, true), n = dv.getUint32(12, true);
  const cols = recordsToCols(buf, 16, n * 24);
  const starts = new Float64Array(n);
  for (let k = 0; k < n; k++) starts[k] = dv.getUint32(16 + n * 24 + k * 4, true);
  return { cols, starts, scale };
}

/** Cached timeframes of a pack read from the site: the hour bars come ready
 *  made from the site (one small file), longer ones roll up from them. */
async function streamAggregated(db, ds, tf) {
  const m = await manifestOf(db);
  const entry = m.packs?.[ds.meta.pack]?.tfs?.[ds.base_tf];
  if (!entry) throw Object.assign(new Error(`${ds.meta.pack} ${ds.base_tf} sitede yok`), { status: 404 });
  const hourFile = entry.agg?.['1h'];
  const packAlign = m.packs[ds.meta.pack].fields?.align || 'utc';
  const key = `s:${ds.meta.pack}:${ds.base_tf}:${hourFile?.sha256 || m.built_at}:${ds.align}:${tf.id}`;
  if (aggMemo.has(key)) return aggMemo.get(key);
  let stored = await within(db.get('aggs', key), 15_000, '').catch(() => null);
  if (!stored) {
    let agg;
    const base = parseTf(ds.base_tf);
    const viaHour = tf.id !== '1h' && base.kind === 'intraday' && HOUR % base.seconds === 0 && base.seconds < HOUR
      && (tf.kind !== 'intraday' || tf.seconds % HOUR === 0);
    if (tf.id === '1h' && hourFile && ds.align === packAlign) {
      const raw = await fetchFile(`${DATA_URL}${hourFile.path}`, {});
      if (hourFile.sha256 && (await sha256(raw)) !== hourFile.sha256) throw Object.assign(new Error('saatlik veri bozuk indi, tekrar deneyin'), { status: 502 });
      agg = decodeAgg(raw);
    } else if (viaHour) {
      const hour = await streamAggregated(db, ds, parseTf('1h'));
      agg = rollUp(hour.rows.cols, hour.starts, tf, ds.align);
    } else {
      agg = await aggregateAll(new StreamRows(db, entry, ds), tf, ds.align);
    }
    stored = { records: colsToRecords(agg.cols), starts: agg.starts };
    within(db.put('aggs', key, stored), 60_000, '').catch(() => {});
  }
  const out = { rows: new MemRows(recordsToCols(stored.records), entry.scale), starts: stored.starts };
  aggMemo.set(key, out);
  if (aggMemo.size > 24) aggMemo.delete(aggMemo.keys().next().value);
  return out;
}

/** query.js source over the device storage (and the site, for packs read from it). */
export function deviceSource(db) {
  return {
    base: async (ds) => (isStream(ds) ? new StreamRows(db, await streamEntry(db, ds), ds) : new ChunkRows(db, ds)),
    aggregated: (ds, tf) => (isStream(ds) ? streamAggregated(db, ds, tf) : aggregated(db, ds, tf)),
  };
}

/** Merge new integer columns into old ones; new bars win on equal times. */
export function mergeCols(old, neu) {
  const a = old.t, b = neu.t;
  const pick = [];                       // [source, index] in time order
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) pick.push([old, i++]);
    else { if (i < a.length && a[i] === b[j]) i++; pick.push([neu, j++]); }
  }
  const out = emptyCols(pick.length);
  pick.forEach(([src, k], n) => { for (const f of FIELDS) out[f][n] = src[f][k]; });
  return out;
}
