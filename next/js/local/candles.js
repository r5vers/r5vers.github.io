// The candle answers (bars, replay): plain functions over a database. They
// run in the data worker (workers/data.worker.js), so a page never freezes
// on years of candles, and here, on the page, where no worker can start.
import { barRows } from './query.js?v=184b95d359';
import { colsToRecords, toJsonColumns } from './rtc.js?v=184b95d359';
import { deviceSource } from './series.js?v=184b95d359';

export const MAX_BARS = 200_000;
export const MAX_BIN_BARS = 6_000_000;
const int = (x) => (x === undefined || x === null || x === '' ? null : Number(x));
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export async function barsAnswer(db, ds, q) {
  const bin = q.fmt === 'bin';
  const limit = Math.max(1, Math.min(int(q.limit) ?? 5000, bin ? MAX_BIN_BARS : MAX_BARS));
  const { cols, scale, tf } = await barRows(ds, q.tf, { ...q, limit }, deviceSource(db));
  if (bin) {
    return { status: 200, bytes: colsToRecords(cols), headers: { 'Content-Type': 'application/octet-stream', 'X-Scale': String(scale), 'X-Count': String(cols.t.length), 'X-TF': tf.id } };
  }
  return { status: 200, json: { tf: tf.id, count: cols.t.length, ...toJsonColumns(cols, scale, ds.decimals + 2) } };
}

export async function replayAnswer(db, ds, q) {
  const src = deviceSource(db);
  const base = await src.base(ds);
  if (!base.n) throw bad('veri seti boş');
  const to = int(q.to);
  const i = Math.max((await base.search(to, 'right')) - 1, 0);
  const cursor = await base.tAt(i);
  const dec = ds.decimals + 2;
  const history = Math.max(1, Math.min(int(q.history) ?? 3000, MAX_BARS));
  const feed = Math.max(1, Math.min(int(q.feed) ?? 5000, MAX_BARS));
  const chart = await barRows(ds, q.tf, { to: cursor, limit: history }, src);
  const next = await barRows(ds, ds.base_tf, { after: cursor, limit: feed }, src);
  return {
    status: 200, json: {
      cursor, tf: chart.tf.id,
      current: toJsonColumns(await base.slice(i, i + 1), base.scale, dec),
      bars: toJsonColumns(chart.cols, base.scale, dec), feed: toJsonColumns(next.cols, base.scale, dec),
      first_ts: await base.tAt(0), last_ts: await base.tAt(base.n - 1),
    },
  };
}
