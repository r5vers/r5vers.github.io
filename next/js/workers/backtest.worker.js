// Runs a strategy test off the UI thread. The page can terminate() it to stop
// runaway user code.
import { runStrategy } from '../core/strategy.js?v=0f8583c5e0';
import { parseTf } from '../core/timeframes.js?v=0f8583c5e0';

/** At most `max` points, the highest and lowest of each stretch kept: the
 *  curve looks the same at any width, without one point per bar. */
function thinCurve(points, max) {
  if (!points || points.length <= max) return points || [];
  const per = Math.ceil(points.length / (max / 2));
  const out = [];
  for (let i = 0; i < points.length; i += per) {
    let lo = i, hi = i;
    for (let j = i + 1; j < Math.min(points.length, i + per); j++) {
      if (points[j].value < points[lo].value) lo = j;
      if (points[j].value > points[hi].value) hi = j;
    }
    if (lo !== hi) out.push(points[Math.min(lo, hi)], points[Math.max(lo, hi)]); else out.push(points[lo]);
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/** The bars endpoint's 24-byte records (api.js barsBin) as columns. */
function columns({ buf, scale, n }) {
  const dv = new DataView(buf);
  const k = 10 ** scale;
  const out = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0, p = 0; i < n; i++, p += 24) {
    out.t[i] = dv.getUint32(p, true);
    out.o[i] = dv.getInt32(p + 4, true) / k;
    out.h[i] = dv.getInt32(p + 8, true) / k;
    out.l[i] = dv.getInt32(p + 12, true) / k;
    out.c[i] = dv.getInt32(p + 16, true) / k;
    out.v[i] = dv.getFloat32(p + 20, true);
  }
  return out;
}

self.onmessage = (e) => {
  const { code, tf, align, broker, from } = e.data;
  try {
    const base = e.data.base.buf ? columns(e.data.base) : e.data.base;
    let last = 0;
    const result = runStrategy({
      code, base, tf: parseTf(tf), align, broker, from,
      onProgress: (p) => {
        const now = Date.now();
        if (now - last > 100) { last = now; self.postMessage({ type: 'progress', value: p }); }
      },
    });
    // what goes back to the page is copied there on its own thread: a curve
    // point per bar and line points as objects froze it on long tests
    result.equity = thinCurve(result.equity, 4000);
    delete result.markers;                // the chart builds its own
    const buffers = [];
    result.plots = result.plots.map(({ key, title, color, data }) => {
      const t = new Float64Array(data.length), v = new Float64Array(data.length);
      data.forEach((d, i) => { t[i] = d.time; v[i] = d.value; });
      buffers.push(t.buffer, v.buffer);
      return { key, title, color, t, v };
    });
    self.postMessage({ type: 'done', result }, buffers);
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err), stack: err && err.stack ? String(err.stack) : '' });
  }
};
