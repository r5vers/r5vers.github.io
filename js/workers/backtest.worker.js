// Runs a strategy test off the UI thread. The page can terminate() it to stop
// runaway user code.
import { runStrategy } from '../core/strategy.js?v=eb96803c93';
import { parseTf } from '../core/timeframes.js?v=eb96803c93';

self.onmessage = (e) => {
  const { code, base, tf, align, broker, from } = e.data;
  try {
    let last = 0;
    const result = runStrategy({
      code, base, tf: parseTf(tf), align, broker, from,
      onProgress: (p) => {
        const now = Date.now();
        if (now - last > 100) { last = now; self.postMessage({ type: 'progress', value: p }); }
      },
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err), stack: err && err.stack ? String(err.stack) : '' });
  }
};
