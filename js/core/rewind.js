// Going back in a replay session with the trades undone (FX Replay's
// bar-by-bar rewind and "replay to this candle").
//
// A broker is a pure function of the bars it was fed and what the trader
// did between them. So the session keeps checkpoints of its brokers (now
// and then, small: closed trades are kept by count, the list only grows)
// and a log of the trader's actions with the time each was made. To stand
// at an earlier time T: the brokers come back from the last checkpoint at
// or before T, the base bars after it up to T are fed to them again, and
// the logged actions are done again at their times. The log after T is
// dropped: that future did not happen.

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

/** What a checkpoint keeps of a broker. */
export function brokerState(b) {
  return clone({
    orders: b.orders, positions: b.positions, seq: b.seq, last: b.last, closeQueue: b.closeQueue,
    peakEquity: b.peakEquity, maxDrawdown: b.maxDrawdown, maxDrawdownPct: b.maxDrawdownPct,
    nTrades: b.trades.length, nCurve: b.equityCurve.length,
  });
}

/** Put a broker back to a kept state (or to a fresh one: `state` null). */
export function restoreBroker(b, state) {
  const s = state || { orders: [], positions: [], seq: 1, last: null, closeQueue: [], peakEquity: b.cfg.balance, maxDrawdown: 0, maxDrawdownPct: 0, nTrades: 0, nCurve: 0 };
  b.orders = clone(s.orders) || [];
  b.positions = clone(s.positions) || [];
  b.seq = s.seq;
  b.last = clone(s.last);
  b.closeQueue = clone(s.closeQueue) || [];
  b.peakEquity = s.peakEquity;
  b.maxDrawdown = s.maxDrawdown;
  b.maxDrawdownPct = s.maxDrawdownPct;
  b.trades.length = Math.min(b.trades.length, s.nTrades);
  b.equityCurve.length = Math.min(b.equityCurve.length, s.nCurve);
  b._events = [];
}

/** A checkpoint of every market of the session at time `t`; `n` is how
 *  many logged actions it already includes. */
export function checkpoint(t, n, legs) {
  const out = { t, n, balance: legs[0]?.broker.balance ?? 0, legs: {} };
  for (const l of legs) out.legs[l.key] = brokerState(l.broker);
  return out;
}

/** Do one logged action again (the same broker call the trader made). */
export function applyAction(b, a) {
  const x = a.args || {};
  switch (a.op) {
    case 'place': return b.placeOrder(x);
    case 'modPos': return b.modifyPosition(x.id, x.stops);
    case 'modOrd': return b.modifyOrder(x.id, x.fields);
    case 'resize': return b.resizePosition(x.id, x.qty);
    case 'close': return b.closePosition(x.id, { fraction: x.fraction ?? 1 });
    case 'closeAll': return b.closeAll();
    case 'cancel': return b.cancelOrder(x.id);
    case 'cancelAll': return b.cancelAll();
    default: return null;
  }
}

/**
 * Feed `bars` (key -> base bars after the checkpoint, oldest first, all at
 * or before `to`) to `brokers` (key -> broker, already restored), doing the
 * `actions` (the log after the checkpoint) again where they were made: an
 * action made at time a.t came after the bar at a.t and before the next.
 */
export function replayTo({ brokers, bars, actions, to }) {
  const times = new Set();
  for (const list of bars.values()) for (const b of list) times.add(b.t);
  const order = [...times].sort((a, b) => a - b);
  const at = new Map([...bars.keys()].map((k) => [k, 0]));
  let ai = 0;
  // (times are epoch seconds: "up to and including" is said with <=, as
  // to + a tiny bit is the same number at this size)
  const act = (until, inclusive = false) => {
    for (; ai < actions.length && (inclusive ? actions[ai].t <= until : actions[ai].t < until); ai++) {
      const a = actions[ai];
      const b = brokers.get(a.leg);
      if (b) applyAction(b, a);
    }
  };
  for (const t of order) {
    if (t > to) break;
    act(t);
    for (const [key, list] of bars) {
      const i = at.get(key);
      if (i < list.length && list[i].t === t) {
        brokers.get(key)?.onBar(list[i]);
        at.set(key, i + 1);
      }
    }
  }
  act(to, true);
}

/** The checkpoint to start from for time `t`: the last one at or before it. */
export function checkpointFor(points, t) {
  let best = null;
  for (const p of points) if (p.t <= t && (!best || p.t > best.t || (p.t === best.t && p.n >= best.n))) best = p;
  return best;
}

/** Keep the checkpoints a long session needs without growing for good:
 *  every one of the recent ones, then fewer and fewer further back. */
export function thinCheckpoints(points, keep = 600) {
  if (points.length <= keep) return points;
  const recent = points.slice(-Math.floor(keep / 2));
  const older = points.slice(0, points.length - recent.length).filter((_, i) => i % 2 === 0);
  return older.concat(recent);
}
