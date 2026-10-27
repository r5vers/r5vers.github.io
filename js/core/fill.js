// Which bars a strategy test fills orders on. Finer is more exact, but a
// browser (phones included) should not hold more than ~600k of them.
import { canAggregate, parseTf } from './timeframes.js?v=d93fdedfec';

const MAX_FILL_BARS = 600_000;
const FILL_CANDIDATES = ['1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '4h'];
const OPEN_SHARE = 0.72;           // markets are closed at weekends

/** Timeframes the broker can fill on: from the base up to the chart's own. */
export function fillChoices(ds, chartTf) {
  const base = parseTf(ds.base_tf);
  const chart = parseTf(chartTf);
  const out = [];
  for (const id of new Set([ds.base_tf, ...FILL_CANDIDATES])) {
    let tf;
    try { tf = parseTf(id); } catch { continue; }
    if (tf.kind !== 'intraday' && id !== ds.base_tf) continue;
    if (!ds.timeframes.includes(id) && id !== ds.base_tf) continue;
    if (tf.seconds < base.seconds || !canAggregate(base, tf) || !canAggregate(tf, chart)) continue;
    if (chart.kind === 'intraday' && tf.seconds > chart.seconds) continue;
    out.push(tf);
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

export function autoFill(ds, chartTf, from, to) {
  const choices = fillChoices(ds, chartTf);
  for (const tf of choices) {
    if (((to - from) / tf.seconds) * OPEN_SHARE <= MAX_FILL_BARS) return tf.id;
  }
  return choices.length ? choices[choices.length - 1].id : ds.base_tf;
}
