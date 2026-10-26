// Strategy tester: runs user code over chart-timeframe bars while the broker
// fills orders on every base bar inside them (intrabar SL / TP accuracy).
//
// User code defines `strategy`:
//   const strategy = {
//     params: { fast: 9, slow: 21 },
//     setup(s, ta, p) { return { fast: ta.ema(s.close, p.fast), slow: ta.ema(s.close, p.slow) }; },
//     plots: { fast: '#f5c542', slow: '#4aa3ff' },
//     onBar(ctx) { if (ctx.crossover(ctx.ind.fast, ctx.ind.slow)) ctx.buy({ slPips: 20, rr: 2, riskPct: 1 }); },
//   };
// ctx.close is the bar's close price; ctx.closePosition(id) closes a position.
// onBar runs when a chart bar closes. Its series are views that end at that
// bar, so peeking at the future is impossible. Market orders fill at the next
// bar's open.

import { Broker, lotsForRisk } from './broker.js?v=f80c737c90';
import * as ta from './indicators.js?v=f80c737c90';
import { computeStats } from './stats.js?v=f80c737c90';
import { bucket } from './timeframes.js?v=f80c737c90';

export function compileStrategy(code) {
  // eslint-disable-next-line no-new-func
  // ctx.close is the closing price: older code that called it to close a
  // position means closePosition
  code = String(code).replace(/\bctx\.close\s*\(/g, 'ctx.closePosition(');
  const factory = new Function('ta', `"use strict";\n${code}\n;return typeof strategy !== 'undefined' ? strategy : undefined;`);
  const strat = factory(ta);
  if (!strat || typeof strat.onBar !== 'function') {
    throw new Error('Kod `const strategy = { onBar(ctx) { ... } }` biçiminde bir strategy nesnesi tanımlamalı');
  }
  return strat;
}

function chartSeries(base, tf, align) {
  const n = base.t.length;
  const ends = [];
  const labels = [];
  let prev = null;
  for (let k = 0; k < n; k++) {
    const lab = bucket(base.t[k], tf, align);
    if (lab !== prev) {
      if (prev !== null) ends.push(k - 1);
      labels.push(lab);
      prev = lab;
    }
  }
  if (n) ends.push(n - 1);
  const m = labels.length;
  const s = {
    time: new Float64Array(labels), open: new Float64Array(m), high: new Float64Array(m),
    low: new Float64Array(m), close: new Float64Array(m), volume: new Float64Array(m),
  };
  let start = 0;
  for (let i = 0; i < m; i++) {
    const end = ends[i];
    let hi = -Infinity, lo = Infinity, v = 0;
    for (let k = start; k <= end; k++) {
      if (base.h[k] > hi) hi = base.h[k];
      if (base.l[k] < lo) lo = base.l[k];
      v += base.v[k];
    }
    s.open[i] = base.o[start]; s.high[i] = hi; s.low[i] = lo; s.close[i] = base.c[end]; s.volume[i] = v;
    start = end + 1;
  }
  return { s, ends };
}

const view = (arr, i) => (arr && typeof arr.subarray === 'function' ? arr.subarray(0, i + 1) : arr.slice(0, i + 1));

export function runStrategy({ code, base, tf, align = 'utc', broker: cfg = {}, params = {}, from = null, onProgress = null }) {
  const strat = compileStrategy(code);
  const p = { ...(strat.params || {}), ...params };
  const { s, ends } = chartSeries(base, tf, align);
  const n = s.time.length;
  const ind = strat.setup ? (strat.setup(s, ta, p) || {}) : {};
  for (const [k, v] of Object.entries(ind)) {
    if (!v || typeof v.length !== 'number') throw new Error(`setup() "${k}" bir dizi döndürmeli`);
    if (v.length !== n) throw new Error(`setup() "${k}" uzunluğu ${v.length}, bar sayısı ${n}`);
  }

  const broker = new Broker(cfg);
  const logs = [];
  const equity = [];
  const pip = broker.cfg.pipSize;

  const order = (side, o = {}) => {
    const type = o.type || 'market';
    const ref = type === 'market' ? (side === 'buy' ? broker.ask() : broker.bid()) : Number(o.price);
    const sign = side === 'buy' ? 1 : -1;
    let sl = o.sl ?? (o.slPips != null ? ref - sign * o.slPips * pip : null);
    let tp = o.tp ?? (o.tpPips != null ? ref + sign * o.tpPips * pip : null);
    if (tp == null && o.rr != null && sl != null) tp = ref + sign * o.rr * Math.abs(ref - sl);
    let qty = o.qty;
    if (qty == null && sl != null) {
      qty = lotsForRisk({ balance: broker.equity(), riskPct: o.riskPct ?? p.riskPct ?? 1, entry: ref, sl, contractSize: broker.cfg.contractSize, quoteConv: broker.cfg.quoteConv, lotStep: broker.cfg.lotStep });
    }
    if (qty == null) qty = p.qty ?? 1;
    const res = broker.placeOrder({ side, type: type === 'market' ? 'next' : type, qty, price: type === 'market' ? null : ref, sl, tp, comment: o.comment || '' });
    if (!res.ok && logs.length < 500) logs.push({ time: broker.time, msg: `emir reddedildi: ${res.error}` });
    return res.ok ? (res.order || res.position).id : null;
  };

  const ctx = {
    p, ta, pip,
    i: -1, time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0,
    series: null, ind: null,
    get position() { return broker.positions[0] || null; },
    get positions() { return broker.positions; },
    get orders() { return broker.orders; },
    get balance() { return broker.balance; },
    get equity() { return broker.equity(); },
    buy: (o) => order('buy', o),
    sell: (o) => order('sell', o),
    closePosition: (id) => { const pos = id == null ? broker.positions[0] : broker.positions.find((x) => x.id === id); if (pos) broker.queueClose(pos.id); },
    closeAll: () => { for (const pos of broker.positions) broker.queueClose(pos.id); },
    cancel: (id) => broker.cancelOrder(id).ok,
    cancelAll: () => broker.cancelAll(),
    setStops: (id, stops) => broker.modifyPosition(id, stops).ok,
    crossover: (a, b) => { const i = a.length - 1; return i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i]; },
    crossunder: (a, b) => { const i = a.length - 1; return i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i]; },
    log: (...msg) => { if (logs.length < 500) logs.push({ time: ctx.time, msg: msg.join(' ') }); },
  };

  let k = 0;
  const step = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    for (; k <= ends[i]; k++) broker.onBar({ t: base.t[k], o: base.o[k], h: base.h[k], l: base.l[k], c: base.c[k] });
    if (from == null || s.time[i] >= from) {
      ctx.i = i;
      ctx.time = s.time[i]; ctx.open = s.open[i]; ctx.high = s.high[i]; ctx.low = s.low[i];
      ctx.close = s.close[i]; ctx.volume = s.volume[i];
      ctx.series = {
        time: view(s.time, i), open: view(s.open, i), high: view(s.high, i), low: view(s.low, i),
        close: view(s.close, i), volume: view(s.volume, i),
      };
      const iv = {};
      for (const key in ind) iv[key] = view(ind[key], i);
      ctx.ind = iv;
      strat.onBar(ctx);
      equity.push({ time: s.time[i], value: broker.equity() });
    }
    if (onProgress && i % step === 0) onProgress(i / n);
  }
  if (broker.last) {
    broker.cancelAll();
    broker.closeAll('end');
  }

  const trades = broker.trades;
  const markers = [];
  for (const t of trades) {
    const buy = t.side === 'buy';
    markers.push({ time: bucket(t.entryTime, tf, align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#26a69a' : '#ef5350', shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'AL' : 'SAT'} ${t.qty}` });
    markers.push({ time: bucket(t.exitTime, tf, align), position: buy ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#26a69a' : '#ef5350', shape: 'circle', text: `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` });
  }
  markers.sort((a, b) => a.time - b.time);

  const plots = [];
  const plotDefs = Array.isArray(strat.plots) ? strat.plots
    : Object.entries(strat.plots || {}).map(([key, color]) => ({ key, color }));
  for (const d of plotDefs) {
    const arr = ind[d.key];
    if (!arr) continue;
    const data = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(arr[i])) data.push({ time: s.time[i], value: arr[i] });
    plots.push({ key: d.key, title: d.title || d.key, color: d.color || '#f5c542', data });
  }

  return {
    name: strat.name || 'Strateji',
    params: p,
    bars: n,
    trades,
    stats: computeStats(trades, { initial: broker.cfg.balance, tz: cfg.tz || 'UTC' }),
    maxDrawdownEquity: broker.maxDrawdown,
    maxDrawdownEquityPct: broker.maxDrawdownPct,
    equity,
    markers,
    plots,
    logs,
  };
}
