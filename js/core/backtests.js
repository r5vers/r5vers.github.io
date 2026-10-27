// Saved strategy tests: what is kept on the server for each run, and how a
// saved run becomes a result the strategy tab can show again.

const MAX_EQUITY_POINTS = 800;
const MAX_TRADES = 5000;
const SPARK_POINTS = 48;

/** Every n-th point plus the last, so the curve keeps its shape. */
export function thin(points, max) {
  if (!points || points.length <= max) return points || [];
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

const finite = (x) => (Number.isFinite(x) ? x : null);

/** The session body (name, state, summary) for one finished run. */
export function backtestRecord(result, { ds, account, code, fillTf }) {
  const stats = { ...result.stats, curve: thin(result.stats.curve, MAX_EQUITY_POINTS) };
  // JSON has no Infinity: a run without a losing trade
  const pfInfinite = result.stats.profitFactor === Infinity;
  if (pfInfinite) stats.profitFactor = null;
  const equity = thin(result.equity, MAX_EQUITY_POINTS);
  const state = {
    version: 1, name: result.name, params: result.params, code, bars: result.bars, ms: result.ms,
    dsId: ds.id, symbol: ds.symbol, currency: ds.currency, tf: result.tf, fillTf, from: result.from, to: result.to,
    account: { ...account }, stats, pfInfinite, equity,
    trades: result.trades.slice(0, MAX_TRADES), tradesTotal: result.trades.length,
    maxDrawdownEquity: result.maxDrawdownEquity, maxDrawdownEquityPct: result.maxDrawdownEquityPct,
    logs: (result.logs || []).slice(-200),
  };
  const s = result.stats;
  const summary = {
    strategy: result.name, symbol: ds.symbol, currency: ds.currency, tf: result.tf, from: result.from, to: result.to,
    trades: s.trades, net: finite(s.net), returnPct: finite(s.returnPct), winRate: finite(s.winRate),
    profitFactor: pfInfinite ? 'inf' : finite(s.profitFactor), maxDrawdownPct: finite(result.maxDrawdownEquityPct ?? s.maxDrawdownPct),
    initial: account.balance, spark: thin(result.equity, SPARK_POINTS).map((p) => Math.round(p.value * 100) / 100),
  };
  return { name: `${result.name} · ${ds.symbol} ${result.tf}`, dataset_id: ds.id, kind: 'backtest', state, summary };
}

/** A saved run back in the shape the strategy tab renders. */
export function resultFromRecord(state) {
  const stats = { ...state.stats };
  if (state.pfInfinite) stats.profitFactor = Infinity;
  return {
    name: state.name, params: state.params, bars: state.bars, ms: state.ms, tf: state.tf, dsId: state.dsId,
    from: state.from, to: state.to, stats, equity: state.equity, trades: state.trades, tradesTotal: state.tradesTotal,
    maxDrawdownEquity: state.maxDrawdownEquity, maxDrawdownEquityPct: state.maxDrawdownEquityPct,
    logs: state.logs || [], plots: [], markers: [], saved: true,
  };
}
