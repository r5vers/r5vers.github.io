// Building chart bars from base bars on the client (the replay's forming bar).
import { bucket } from './timeframes.js?v=0f8583c5e0';

/** Columns {t,o,h,l,c,v} from the API -> bar objects for the chart. */
export function columnsToBars(cols) {
  const n = cols.t.length, bars = new Array(n);
  for (let i = 0; i < n; i++) {
    bars[i] = { time: cols.t[i], open: cols.o[i], high: cols.h[i], low: cols.l[i], close: cols.c[i], volume: cols.v[i] };
  }
  return bars;
}

export function aggregateBars(base, tf, align) {
  const outBars = [];
  let cur = null;
  for (const b of base) {
    const label = bucket(b.time, tf, align);
    if (cur && cur.time === label) {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
    } else {
      cur = { time: label, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      outBars.push(cur);
    }
  }
  return outBars;
}

/**
 * Keeps `bars` (chart timeframe) current as base bars arrive. The last bar of
 * `bars` may be the one still forming.
 */
export class BarBuilder {
  constructor(tf, align, bars = []) {
    this.tf = tf;
    this.align = align;
    this.bars = bars;
  }

  label(time) { return bucket(time, this.tf, this.align); }

  /** Returns { bar, isNew } for the chart bar the base bar landed in. */
  push(b) {
    const label = this.label(b.time);
    const last = this.bars[this.bars.length - 1];
    if (last && last.time === label) {
      if (b.high > last.high) last.high = b.high;
      if (b.low < last.low) last.low = b.low;
      last.close = b.close;
      last.volume += b.volume;
      return { bar: last, isNew: false };
    }
    if (last && label < last.time) throw new Error('base bar older than the chart');
    const bar = { time: label, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    this.bars.push(bar);
    return { bar, isNew: true };
  }
}
