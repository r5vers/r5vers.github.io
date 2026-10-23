// A dataset's candles on the device: the base series in chunks of up to
// CHUNK rows (24-byte records), so a phone never holds 15 years in memory -
// a query loads the chunks it touches, recently used ones stay cached.
//
// The dataset record keeps the chunk list: { key, n, t0, t1, tag }, in time
// order. `tag` groups the chunks of one downloaded file (a pack's year), so
// a newer copy of that file replaces exactly them.
import { parseTf, HOUR } from '../core/timeframes.js';
import { colsToRecords, concatCols, emptyCols, recordsToCols, sliceCols } from './rtc.js';
import { MemRows, aggregateAll, lowerBound, rollUp, upperBound } from './query.js';

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
  const rows = new ChunkRows(db, ds);
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

/** query.js source over the device storage. */
export function deviceSource(db) {
  return {
    base: async (ds) => new ChunkRows(db, ds),
    aggregated: (ds, tf) => aggregated(db, ds, tf),
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
