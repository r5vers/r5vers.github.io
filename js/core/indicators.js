// Causal technical indicators: value i only uses inputs 0..i. Arrays in,
// Float64Array out, NaN while warming up.

const out = (n) => new Float64Array(n).fill(NaN);

export function sma(src, len) {
  const n = src.length, r = out(n);
  let acc = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i];
    if (Number.isNaN(x)) { acc = 0; cnt = 0; continue; }
    acc += x; cnt++;
    if (cnt > len) { acc -= src[i - len]; cnt = len; }
    if (cnt === len) r[i] = acc / len;
  }
  return r;
}

export function ema(src, len) {
  const n = src.length, r = out(n), a = 2 / (len + 1);
  let prev = NaN, seed = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i];
    if (Number.isNaN(x)) continue;
    if (Number.isNaN(prev)) {
      seed += x; cnt++;
      if (cnt === len) { prev = seed / len; r[i] = prev; }
      continue;
    }
    prev = a * x + (1 - a) * prev;
    r[i] = prev;
  }
  return r;
}

/** Wilder's moving average (RSI / ATR smoothing). */
export function rma(src, len) {
  const n = src.length, r = out(n), a = 1 / len;
  let prev = NaN, seed = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i];
    if (Number.isNaN(x)) continue;
    if (Number.isNaN(prev)) {
      seed += x; cnt++;
      if (cnt === len) { prev = seed / len; r[i] = prev; }
      continue;
    }
    prev = a * x + (1 - a) * prev;
    r[i] = prev;
  }
  return r;
}

export function wma(src, len) {
  const n = src.length, r = out(n), denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < len; k++) acc += src[i - k] * (len - k);
    r[i] = acc / denom;
  }
  return r;
}

export function stdev(src, len) {
  const n = src.length, r = out(n), m = sma(src, len);
  for (let i = len - 1; i < n; i++) {
    if (Number.isNaN(m[i])) continue;
    let acc = 0;
    for (let k = 0; k < len; k++) acc += (src[i - k] - m[i]) ** 2;
    r[i] = Math.sqrt(acc / len);
  }
  return r;
}

export function bollinger(src, len = 20, mult = 2) {
  const basis = sma(src, len), sd = stdev(src, len), n = src.length;
  const upper = out(n), lower = out(n);
  for (let i = 0; i < n; i++) { upper[i] = basis[i] + mult * sd[i]; lower[i] = basis[i] - mult * sd[i]; }
  return { basis, upper, lower };
}

export function trueRange(high, low, close) {
  const n = close.length, r = out(n);
  for (let i = 0; i < n; i++) {
    r[i] = i === 0 ? high[i] - low[i]
      : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  return r;
}

export function atr(high, low, close, len = 14) { return rma(trueRange(high, low, close), len); }

export function rsi(src, len = 14) {
  const n = src.length, up = out(n), dn = out(n);
  for (let i = 1; i < n; i++) { const d = src[i] - src[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
  const au = rma(up, len), ad = rma(dn, len), r = out(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(au[i]) || Number.isNaN(ad[i])) continue;
    r[i] = ad[i] === 0 ? 100 : au[i] === 0 ? 0 : 100 - 100 / (1 + au[i] / ad[i]);
  }
  return r;
}

export function macd(src, fast = 12, slow = 26, signal = 9) {
  const f = ema(src, fast), s = ema(src, slow), n = src.length, line = out(n);
  for (let i = 0; i < n; i++) line[i] = f[i] - s[i];
  const sig = ema(line, signal), hist = out(n);
  for (let i = 0; i < n; i++) hist[i] = line[i] - sig[i];
  return { macd: line, signal: sig, hist };
}

export function highest(src, len) {
  const n = src.length, r = out(n);
  for (let i = len - 1; i < n; i++) { let m = -Infinity; for (let k = 0; k < len; k++) m = Math.max(m, src[i - k]); r[i] = m; }
  return r;
}

export function lowest(src, len) {
  const n = src.length, r = out(n);
  for (let i = len - 1; i < n; i++) { let m = Infinity; for (let k = 0; k < len; k++) m = Math.min(m, src[i - k]); r[i] = m; }
  return r;
}

export function stoch(high, low, close, len = 14, smoothK = 3, smoothD = 3) {
  const hh = highest(high, len), ll = lowest(low, len), n = close.length, raw = out(n);
  for (let i = 0; i < n; i++) raw[i] = hh[i] === ll[i] ? 50 : (100 * (close[i] - ll[i])) / (hh[i] - ll[i]);
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

/** VWAP that restarts every `dayOf(time)` change (e.g. each trading day). */
export function vwap(time, high, low, close, volume, dayOf) {
  const n = close.length, r = out(n);
  let day = null, pv = 0, vv = 0;
  for (let i = 0; i < n; i++) {
    const d = dayOf(time[i]);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const tp = (high[i] + low[i] + close[i]) / 3, v = volume[i] || 1;
    pv += tp * v; vv += v;
    r[i] = pv / vv;
  }
  return r;
}

export function crossover(a, b, i) { return i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i]; }
export function crossunder(a, b, i) { return i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i]; }
