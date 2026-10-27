// Chart indicator definitions: what to compute and how to draw it.
import * as ta from '../core/indicators.js?v=44e476acc5';
import { tradingDay } from '../core/timeframes.js?v=44e476acc5';

const cols = (bars) => {
  const n = bars.length;
  const c = { time: new Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    c.time[i] = b.time; c.open[i] = b.open; c.high[i] = b.high; c.low[i] = b.low; c.close[i] = b.close; c.volume[i] = b.volume;
  }
  return c;
};

// Each output: { key, values, color, kind: 'line' | 'histogram', width?, style? }
export const INDICATORS = {
  sessions: {
    name: 'Seanslar / ICT kill zone', overlay: true, primitive: true, params: { mode: 1 }, colors: ['#9598a1'],
    label: (p) => (Math.round(p.mode) === 0 ? 'Seanslar (NY saati)' : 'Kill zone (NY saati)'),
    help: 'mode 0: Asya / Londra / New York seansları, mode 1: ICT kill zone (New York saati: Asia 20:00-00:00, London 02:00-05:00, NY AM 07:00-10:00, London Close 10:00-12:00, NY PM 13:30-16:00). 1 saat ve altı grafiklerde görünür.',
    compute: () => [],
  },
  sma: {
    name: 'SMA', overlay: true, params: { len: 20 }, colors: ['#f5c542'],
    label: (p) => `SMA ${p.len}`,
    compute: (c, p, col) => [{ key: 'sma', values: ta.sma(c.close, p.len), color: col[0] }],
  },
  ema: {
    name: 'EMA', overlay: true, params: { len: 50 }, colors: ['#4aa3ff'],
    label: (p) => `EMA ${p.len}`,
    compute: (c, p, col) => [{ key: 'ema', values: ta.ema(c.close, p.len), color: col[0] }],
  },
  bb: {
    name: 'Bollinger Bantları', overlay: true, params: { len: 20, mult: 2 }, colors: ['#9c6ade'],
    label: (p) => `BB ${p.len} ${p.mult}`,
    compute: (c, p, col) => {
      const b = ta.bollinger(c.close, p.len, p.mult);
      return [
        { key: 'basis', values: b.basis, color: col[0], style: 2 },
        { key: 'upper', values: b.upper, color: col[0] },
        { key: 'lower', values: b.lower, color: col[0] },
      ];
    },
  },
  donchian: {
    name: 'Donchian Kanalı', overlay: true, params: { len: 20 }, colors: ['#26c6da'],
    label: (p) => `DC ${p.len}`,
    compute: (c, p, col) => [
      { key: 'upper', values: ta.highest(c.high, p.len), color: col[0] },
      { key: 'lower', values: ta.lowest(c.low, p.len), color: col[0] },
    ],
  },
  vwap: {
    name: 'VWAP (günlük)', overlay: true, params: {}, colors: ['#ff9800'],
    label: () => 'VWAP',
    compute: (c, p, col, ctx) => [{ key: 'vwap', values: ta.vwap(c.time, c.high, c.low, c.close, c.volume, (t) => tradingDay(t, ctx.align)), color: col[0] }],
  },
  rsi: {
    name: 'RSI', overlay: false, params: { len: 14 }, colors: ['#b388ff'], levels: [30, 70],
    label: (p) => `RSI ${p.len}`,
    compute: (c, p, col) => [{ key: 'rsi', values: ta.rsi(c.close, p.len), color: col[0] }],
  },
  macd: {
    name: 'MACD', overlay: false, params: { fast: 12, slow: 26, signal: 9 }, colors: ['#2962ff', '#ff6d00'],
    label: (p) => `MACD ${p.fast} ${p.slow} ${p.signal}`,
    compute: (c, p, col) => {
      const m = ta.macd(c.close, p.fast, p.slow, p.signal);
      return [
        { key: 'hist', values: m.hist, kind: 'histogram', color: 'rgba(38,166,154,0.6)', negColor: 'rgba(239,83,80,0.6)' },
        { key: 'macd', values: m.macd, color: col[0] },
        { key: 'signal', values: m.signal, color: col[1] },
      ];
    },
  },
  atr: {
    name: 'ATR', overlay: false, params: { len: 14 }, colors: ['#ef5350'],
    label: (p) => `ATR ${p.len}`,
    compute: (c, p, col) => [{ key: 'atr', values: ta.atr(c.high, c.low, c.close, p.len), color: col[0] }],
  },
  stoch: {
    name: 'Stokastik', overlay: false, params: { len: 14, k: 3, d: 3 }, colors: ['#2962ff', '#ff6d00'], levels: [20, 80],
    label: (p) => `Stoch ${p.len} ${p.k} ${p.d}`,
    compute: (c, p, col) => {
      const s = ta.stoch(c.high, c.low, c.close, p.len, p.k, p.d);
      return [{ key: 'k', values: s.k, color: col[0] }, { key: 'd', values: s.d, color: col[1] }];
    },
  },
};

export function computeIndicator(def, bars, params, colors, ctx) {
  return def.compute(cols(bars), { ...def.params, ...params }, colors || def.colors, ctx);
}
