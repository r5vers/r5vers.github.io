// Bar queries over a base series, as server/store.py answers them
// (bar_rows, _select, _window) - the same bars, label for label.
//
// A series is reached through a "rows" object, so the same code runs over
// columns in memory and over chunks kept in IndexedDB:
//   rows.n, rows.scale
//   await rows.search(x, side)   first index with t >= x ("left") / t > x ("right")
//   await rows.tAt(i)
//   await rows.slice(i, j)       columns of rows [i, j)
import { bucket, canAggregate, parseTf, HOUR } from '../core/timeframes.js?v=446247be79';
import { concatCols, emptyCols, sliceCols } from './rtc.js?v=446247be79';

export function lowerBound(arr, x, lo = 0, hi = arr.length) {
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
export function upperBound(arr, x, lo = 0, hi = arr.length) {
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Columns held in memory. */
export class MemRows {
  constructor(cols, scale) { this.cols = cols; this.scale = scale; this.n = cols.t.length; }
  async search(x, side = 'left') { return side === 'left' ? lowerBound(this.cols.t, x) : upperBound(this.cols.t, x); }
  async tAt(i) { return this.cols.t[i]; }
  async slice(i, j) { return sliceCols(this.cols, Math.max(0, i), Math.min(this.n, j)); }
}

/** Hour and longer get a cached aggregation; shorter ones are built per request. */
export function cachedTf(baseTf, tf) {
  return tf.id !== baseTf.id && (tf.kind !== 'intraday' || tf.seconds >= HOUR);
}

/** Aggregate base columns into `tf` bars (candlestore.aggregate_range).
 *  Returns { cols, starts } - starts[k]: index in `part` where bar k begins
 *  (plus `offset`). */
export function aggregateCols(part, tf, align, offset = 0) {
  const n = part.t.length;
  if (!n) return { cols: emptyCols(0), starts: new Float64Array(0) };
  const labels = new Float64Array(n);
  let groups = 1;
  labels[0] = bucket(part.t[0], tf, align);
  for (let i = 1; i < n; i++) {
    labels[i] = bucket(part.t[i], tf, align);
    if (labels[i] !== labels[i - 1]) groups++;
  }
  const out = emptyCols(groups);
  const starts = new Float64Array(groups);
  let g = -1;
  for (let i = 0; i < n; i++) {
    if (i === 0 || labels[i] !== labels[i - 1]) {
      g++;
      out.t[g] = labels[i];
      out.o[g] = part.o[i];
      out.h[g] = part.h[i];
      out.l[g] = part.l[i];
      out.v[g] = part.v[i];
      starts[g] = offset + i;
    } else {
      if (part.h[i] > out.h[g]) out.h[g] = part.h[i];
      if (part.l[i] < out.l[g]) out.l[g] = part.l[i];
      out.v[g] = Math.fround(out.v[g] + part.v[i]);   // float32 sums, like numpy
    }
    out.c[g] = part.c[i];
  }
  return { cols: out, starts };
}

/** Roll an aggregated series (cols + starts into the base) up into a
 *  coarser `tf` whose buckets are unions of its buckets (1h -> 4h / 1D / 1W / 1M). */
export function rollUp(src, srcStarts, tf, align) {
  const { cols, starts } = aggregateCols(src, tf, align);
  const abs = new Float64Array(starts.length);
  for (let k = 0; k < starts.length; k++) abs[k] = srcStarts[starts[k]];
  return { cols, starts: abs };
}

async function select(agg, starts, base, tf, align, q) {
  const { to, before, after, start, end, lim } = q;
  if (to != null) {
    const label = bucket(to, tf, align);
    const i = await agg.search(label, 'left');
    const j = await base.search(to, 'right');
    let k;
    if (i < agg.n && (await agg.tAt(i)) === label) k = starts == null ? i : starts[i];
    else k = j;
    let from = 0;
    if (lim != null) from = Math.max(0, i - (j > k ? lim - 1 : lim));
    const closed = await agg.slice(from, i);
    if (j > k) {
      const forming = aggregateCols(await base.slice(k, j), tf, align).cols;
      return concatCols([closed, forming]);
    }
    return closed;
  }
  if (before != null) {
    const i = await agg.search(before, 'left');
    return agg.slice(lim ? Math.max(0, i - lim) : 0, i);
  }
  if (after != null) {
    const i = await agg.search(after, 'right');
    return agg.slice(i, lim ? i + lim : agg.n);
  }
  if (start != null || end != null) {
    const i = start != null ? await agg.search(start, 'left') : 0;
    const j = end != null ? await agg.search(end, 'right') : agg.n;
    return agg.slice(i, lim ? Math.min(j, i + lim) : j);
  }
  return agg.slice(lim ? Math.max(0, agg.n - lim) : 0, agg.n);
}

async function windowed(base, tf, baseTf, align, q) {
  const { to, before, after, start, end, lim } = q;
  const n = base.n;
  const ratio = Math.max(1, Math.floor(tf.seconds / baseTf.seconds));
  const agg = async (i, j) => aggregateCols(await base.slice(i, j), tf, align).cols;

  const snap = async (i) => {
    if (i <= 0 || i >= n) return Math.min(Math.max(i, 0), n);
    return base.search(bucket(await base.tAt(i), tf, align), 'left');
  };
  const firstLabel = async (x, side) => {
    const j0 = await base.search(x, side);
    const look = (await base.slice(j0, j0 + ratio + 1)).t;
    let count = 0;
    for (let i = 0; i < look.length; i++) {
      const lab = bucket(look[i], tf, align);
      if (side === 'left' ? lab < x : lab <= x) count++;
    }
    return j0 + count;
  };
  const tail = (cols, m) => sliceCols(cols, Math.max(0, cols.t.length - m), cols.t.length);
  const head = (cols, m) => sliceCols(cols, 0, Math.min(cols.t.length, m));

  const back = async (j) => {
    if (lim == null) return agg(0, j);
    let span = (lim + 1) * ratio;
    for (;;) {
      const i = await snap(Math.max(0, j - span));
      const rows = await agg(i, j);
      if (rows.t.length >= lim || i === 0) return tail(rows, lim);
      span *= 2;
    }
  };
  const forward = async (i, jEnd) => {
    if (lim == null) return agg(i, jEnd);
    let span = (lim + 1) * ratio;
    for (;;) {
      let j = Math.min(jEnd, i + span);
      if (j < jEnd) j = await snap(j);
      const rows = await agg(i, j);
      if (rows.t.length >= lim || j >= jEnd) return head(rows, lim);
      span *= 2;
    }
  };

  if (to != null) return back(await base.search(to, 'right'));
  if (before != null) return back(await firstLabel(before, 'left'));
  if (after != null) return forward(await firstLabel(after, 'right'), n);
  if (start != null || end != null) {
    const i = start != null ? await firstLabel(start, 'left') : 0;
    const j = end != null ? await firstLabel(end, 'right') : n;
    return forward(i, j);
  }
  return back(n);
}

/**
 * Columns of `tfId` bars for dataset `ds`, selected by one of to / before /
 * after / start+end (see store.bar_rows). `source` provides:
 *   base(ds)            -> rows of the base series
 *   aggregated(ds, tf)  -> { rows, starts } of a cached timeframe
 */
export async function barRows(ds, tfId, query, source) {
  const tf = parseTf(tfId);
  const baseTf = parseTf(ds.base_tf);
  if (!canAggregate(baseTf, tf)) throw Object.assign(new Error(`${ds.base_tf} data cannot be shown as ${tf.id}`), { status: 400 });
  const num = (x) => (x === undefined || x === null || x === '' ? null : Number(x));
  const lim = query.limit && Number(query.limit) > 0 ? Number(query.limit) : null;
  const q = { to: num(query.to), before: num(query.before), after: num(query.after), start: num(query.start), end: num(query.end), lim };
  const base = await source.base(ds);
  let cols;
  if (tf.id === baseTf.id) cols = await select(base, null, base, tf, ds.align, q);
  else if (cachedTf(baseTf, tf)) {
    const { rows, starts } = await source.aggregated(ds, tf);
    cols = await select(rows, starts, base, tf, ds.align, q);
  } else cols = await windowed(base, tf, baseTf, ds.align, q);
  return { cols, scale: base.scale, tf };
}

/** The whole aggregation of a cached timeframe, from the base rows in
 *  chunks (candlestore.aggregate_chunks: a bar across chunks is carried). */
export async function aggregateAll(base, tf, align, chunk = 1 << 18) {
  const parts = [], startParts = [];
  let carry = null;
  for (let s = 0; s < base.n; s += chunk) {
    const { cols, starts } = aggregateCols(await base.slice(s, Math.min(base.n, s + chunk)), tf, align, s);
    if (!cols.t.length) continue;
    if (carry) {
      if (carry.cols.t[0] === cols.t[0]) {
        cols.o[0] = carry.cols.o[0];
        if (carry.cols.h[0] > cols.h[0]) cols.h[0] = carry.cols.h[0];
        if (carry.cols.l[0] < cols.l[0]) cols.l[0] = carry.cols.l[0];
        cols.v[0] = Math.fround(carry.cols.v[0] + cols.v[0]);
        starts[0] = carry.start;
      } else {
        parts.push(carry.cols);
        startParts.push(Float64Array.of(carry.start));
      }
    }
    const last = cols.t.length - 1;
    if (last > 0) {
      parts.push(sliceCols(cols, 0, last));
      startParts.push(starts.subarray(0, last));
    }
    carry = { cols: concatCols([sliceCols(cols, last, last + 1)]), start: starts[last] };
  }
  if (carry) { parts.push(carry.cols); startParts.push(Float64Array.of(carry.start)); }
  const cols = concatCols(parts);
  const starts = new Float64Array(cols.t.length);
  let at = 0;
  for (const s of startParts) { starts.set(s, at); at += s.length; }
  return { cols, starts };
}
