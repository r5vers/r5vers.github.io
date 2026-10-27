// Replay engine: holds the chart as it looked at the cursor and feeds the
// following base bars one at a time into the chart builder and the broker.
import { api } from './api.js?v=b966ffb7f9';
import { BarBuilder, columnsToBars } from './core/aggregate.js?v=b966ffb7f9';
import { parseTf } from './core/timeframes.js?v=b966ffb7f9';

const HISTORY = 3000;
const FEED_CHUNK = 5000;
const FEED_LOW_WATER = 1500;
const MAX_CHART_BARS = 20000;

export class ReplayEngine {
  constructor(ds) {
    this.ds = ds;
    this.baseTf = parseTf(ds.base_tf);
    this.align = ds.align;
    this.tf = null;
    this.cursor = null;
    this.builder = null;
    this.feed = [];
    this.pos = 0;
    this.exhausted = false;
    this._fetching = null;
    this.firstTs = ds.first_ts;
    this.lastTs = ds.last_ts;
    this.current = null; // base bar at the cursor
    // other timeframes of this market for split charts, fed the same base bars:
    // tf id -> { builder, users, from } (from: first bar changed since read)
    this.views = new Map();
  }

  get bars() { return this.builder ? this.builder.bars : []; }
  get remaining() { return this.feed.length - this.pos; }
  get atEnd() { return this.exhausted && this.remaining === 0; }

  /** Load the market as it was at base time `to`. */
  async load(tfId, to) {
    const r = await api.replay(this.ds.id, { tf: tfId, to, history: HISTORY, feed: FEED_CHUNK });
    this.tf = parseTf(r.tf);
    this.cursor = r.cursor;
    this.builder = new BarBuilder(this.tf, this.align, columnsToBars(r.bars));
    this.feed = columnsToBars(r.feed);
    this.pos = 0;
    this.exhausted = r.feed.t.length < FEED_CHUNK;
    this.current = columnsToBars(r.current)[0] || null;
    this.firstTs = r.first_ts;
    this.lastTs = r.last_ts;
    return this.bars;
  }

  async setTf(tfId) {
    const r = await api.bars(this.ds.id, { tf: tfId, to: this.cursor, limit: HISTORY });
    this.tf = parseTf(r.tf);
    this.builder = new BarBuilder(this.tf, this.align, columnsToBars(r));
    return this.bars;
  }

  /** Another timeframe of this market, as it is at the cursor, kept up to
   *  date with every base bar from now on (a second chart). Shared by the
   *  charts that show it; `dropView` when one is closed. */
  async addView(tfId) {
    const id = parseTf(tfId).id;
    const have = this.views.get(id);
    if (have) { have.users++; return have; }
    const at = this.cursor;
    const r = await api.bars(this.ds.id, { tf: id, to: at, limit: HISTORY });
    const raced = this.views.get(id);
    if (raced) { raced.users++; return raced; }
    const view = { builder: new BarBuilder(parseTf(r.tf), this.align, columnsToBars(r)), users: 1, from: Infinity };
    // base bars that came while the history was read
    if (this.cursor > at) {
      const more = columnsToBars(await api.bars(this.ds.id, { tf: this.baseTf.id, start: at + 1, end: this.cursor }));
      for (const b of more) if (b.time <= this.cursor) view.builder.push(b);
    }
    this.views.set(id, view);
    return view;
  }

  dropView(tfId) {
    const id = parseTf(tfId).id;
    const v = this.views.get(id);
    if (v && --v.users <= 0) this.views.delete(id);
  }

  /** Older bars of a view for scrolling back. */
  async loadOlderView(tfId, limit = 2000) {
    const v = this.views.get(parseTf(tfId).id);
    const first = v?.builder.bars[0];
    if (!first) return 0;
    const older = columnsToBars(await api.bars(this.ds.id, { tf: v.builder.tf.id, before: first.time, limit }));
    v.builder.bars.unshift(...older);
    return older.length;
  }

  /** Older (closed) chart bars for scrolling back. Returns how many were added. */
  async loadOlder(limit = 2000) {
    const first = this.bars[0];
    if (!first) return 0;
    const r = await api.bars(this.ds.id, { tf: this.tf.id, before: first.time, limit });
    const older = columnsToBars(r);
    this.builder.bars.unshift(...older);
    return older.length;
  }

  ensureFeed() {
    if (this.exhausted || this._fetching || this.remaining > FEED_LOW_WATER) return this._fetching;
    const last = this.feed[this.feed.length - 1];
    const after = last ? last.time : this.cursor;
    this._fetching = api.bars(this.ds.id, { tf: this.baseTf.id, after, limit: FEED_CHUNK })
      .then((r) => {
        const more = columnsToBars(r);
        // drop what was already consumed to keep memory flat
        this.feed = this.feed.slice(this.pos).concat(more);
        this.pos = 0;
        if (more.length < FEED_CHUNK) this.exhausted = true;
        this.feedError = null;
        this._feedFails = 0;
      })
      .catch((err) => {
        // a few retries, then the player stops and says why (no endless loop)
        this._feedFails = (this._feedFails || 0) + 1;
        if (this._feedFails >= 3) this.feedError = err.message || 'bağlantı hatası';
      })
      .finally(() => { this._fetching = null; });
    return this._fetching;
  }

  peek() { return this.pos < this.feed.length ? this.feed[this.pos] : null; }

  /**
   * Consume base bars while `more(bar, count)` is true (at most `max`).
   * Calls broker.onBar for each. Returns { count, firstChanged, events, trimmed }.
   */
  _advance(broker, more, max = Infinity) {
    const bars = this.builder.bars;
    let firstChanged = bars.length ? bars.length - 1 : 0;
    let count = 0;
    const events = [];
    while (count < max) {
      const b = this.peek();
      if (!b || !more(b, count)) break;
      this.pos++;
      count++;
      if (broker) {
        const ev = broker.onBar({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close });
        if (ev.length) events.push(...ev);
      }
      this.builder.push(b);
      for (const v of this.views.values()) {
        const n = v.builder.bars.length;
        v.builder.push(b);
        v.from = Math.min(v.from, Math.max(0, n - 1));
      }
      this.cursor = b.time;
      this.current = b;
    }
    for (const v of this.views.values()) {
      if (v.builder.bars.length > MAX_CHART_BARS) { v.builder.bars.splice(0, v.builder.bars.length - MAX_CHART_BARS + 6000); v.from = -1; }
    }
    let trimmed = 0;
    if (bars.length > MAX_CHART_BARS) {
      // trim in big steps: each trim redraws the whole chart
      trimmed = bars.length - MAX_CHART_BARS + 6000;
      bars.splice(0, trimmed);
      firstChanged = 0;
    }
    this.ensureFeed();
    return { count, firstChanged, events, trimmed };
  }

  /** One base bar. */
  step(broker) { return this._advance(broker, () => true, 1); }

  /** Until the current chart bar is complete (and at least one bar). */
  stepChartBar(broker) {
    // finish the chart bar the first consumed base bar lands in: the forming
    // bar if there is one, otherwise the next bar
    let started = null;
    return this._advance(broker, (b, n) => {
      const lab = this.builder.label(b.time);
      if (n === 0) started = lab;
      return lab === started;
    });
  }

  /** Every base bar up to and including time `t`. Awaits more feed as needed. */
  async advanceTo(broker, t, onChunk) {
    const total = { count: 0, firstChanged: Math.max(0, this.bars.length - 1), events: [], trimmed: 0 };
    for (;;) {
      const r = this._advance(broker, (b) => b.time <= t, 50000);
      total.count += r.count;
      total.events.push(...r.events);
      total.trimmed += r.trimmed;
      total.firstChanged = total.trimmed ? 0 : Math.min(total.firstChanged, r.firstChanged);
      onChunk?.(total);
      const next = this.peek();
      if (next && next.time > t) break;
      if (!next && this.exhausted) break;
      if (!next) await (this.ensureFeed() || Promise.resolve());
    }
    return total;
  }
}
