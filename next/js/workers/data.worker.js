// Candles off the page: reading the years, unpacking them and building the
// timeframes happen here, so the chart and the backtest never wait frozen.
// The page sends { id, op, ds, q, light } (local/server.js) and gets the
// answer local/candles.js gives.
import { IdbDb, MemoryDb } from '../local/db.js?v=131e7ce3e0';
import { barsAnswer, replayAnswer } from '../local/candles.js?v=131e7ce3e0';

let dbp = null;
const light = () => Object.assign(new MemoryDb(), { light: true });
function dbFor(isLight) {
  // light mode (iPhone): nothing in IndexedDB, years in the browser's file cache
  dbp ||= isLight ? Promise.resolve(light()) : IdbDb.open().catch(() => light());
  return dbp;
}

self.onmessage = async (e) => {
  const { id, op, ds, q, light: isLight } = e.data;
  try {
    const db = await dbFor(isLight);
    const r = op === 'replay' ? await replayAnswer(db, ds, q) : await barsAnswer(db, ds, q);
    self.postMessage({ id, ok: true, r }, r.bytes ? [r.bytes] : []);
  } catch (err) {
    self.postMessage({ id, ok: false, status: err?.status || 500, message: err?.message || String(err) });
  }
};
