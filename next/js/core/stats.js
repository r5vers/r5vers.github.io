// Performance statistics over closed trades.

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const BE_EPS = 1e-9;

function streaks(trades) {
  let win = 0, loss = 0, maxWin = 0, maxLoss = 0;
  for (const t of trades) {
    if (t.pnl > BE_EPS) { win++; loss = 0; } else if (t.pnl < -BE_EPS) { loss++; win = 0; } else { win = 0; loss = 0; }
    maxWin = Math.max(maxWin, win);
    maxLoss = Math.max(maxLoss, loss);
  }
  return { maxWin, maxLoss };
}

function side(trades) {
  const wins = trades.filter((t) => t.pnl > BE_EPS).length;
  return { count: trades.length, winRate: trades.length ? wins / trades.length : null, net: sum(trades.map((t) => t.pnl)) };
}

/** Closed-trade balance curve and its worst peak-to-trough fall. */
export function drawdown(trades, initial) {
  let bal = initial, peak = initial, maxDd = 0, maxDdPct = 0;
  const curve = [];
  for (const t of trades) {
    bal += t.pnl;
    curve.push({ t: t.exitTime, balance: bal });
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDd) maxDd = dd;
    if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak;
  }
  return { curve, maxDd, maxDdPct, final: bal };
}

/**
 * trades: broker trade records (sorted by exit time).
 * opts.initial: starting balance; opts.tz: IANA zone for hour / weekday buckets.
 */
export function computeStats(trades, { initial = 10000, tz = 'UTC' } = {}) {
  const n = trades.length;
  const pnls = trades.map((t) => t.pnl);
  const wins = trades.filter((t) => t.pnl > BE_EPS);
  const losses = trades.filter((t) => t.pnl < -BE_EPS);
  const grossProfit = sum(wins.map((t) => t.pnl));
  const grossLoss = -sum(losses.map((t) => t.pnl));
  const net = sum(pnls);
  const rs = trades.map((t) => t.r).filter((r) => r != null && Number.isFinite(r));
  const dd = drawdown(trades, initial);
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? -grossLoss / losses.length : null;
  const mean = n ? net / n : null;
  const sd = n > 1 ? Math.sqrt(sum(pnls.map((p) => (p - mean) ** 2)) / (n - 1)) : null;
  const durations = trades.map((t) => t.exitTime - t.entryTime);
  const st = streaks(trades);

  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byHour = Array.from({ length: 24 }, () => ({ count: 0, net: 0, wins: 0 }));
  const byWeekday = days.map(() => ({ count: 0, net: 0, wins: 0 }));
  const byMonth = new Map();
  for (const t of trades) {
    const d = new Date(t.entryTime * 1000);
    const h = Number(hourFmt.format(d)) % 24;
    const w = days.indexOf(dayFmt.format(d));
    for (const b of [byHour[h], byWeekday[w]]) {
      if (!b) continue;
      b.count++; b.net += t.pnl; if (t.pnl > BE_EPS) b.wins++;
    }
    const m = new Date(t.exitTime * 1000).toISOString().slice(0, 7);
    const mb = byMonth.get(m) || { month: m, count: 0, net: 0 };
    mb.count++; mb.net += t.pnl;
    byMonth.set(m, mb);
  }

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    breakeven: n - wins.length - losses.length,
    winRate: n ? wins.length / n : null,
    net,
    returnPct: initial ? net / initial : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss ? avgWin / -avgLoss : null,
    expectancy: mean,
    avgR: rs.length ? sum(rs) / rs.length : null,
    totalR: rs.length ? sum(rs) : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : null,
    maxConsecWins: st.maxWin,
    maxConsecLosses: st.maxLoss,
    maxDrawdown: dd.maxDd,
    maxDrawdownPct: dd.maxDdPct,
    recoveryFactor: dd.maxDd > 0 ? net / dd.maxDd : null,
    // undefined when every trade made the same amount
    sqn: sd > 1e-9 ? (mean / sd) * Math.sqrt(Math.min(n, 100)) : null,
    avgDuration: n ? sum(durations) / n : null,
    commission: sum(trades.map((t) => t.commission || 0)),
    long: side(trades.filter((t) => t.side === 'buy')),
    short: side(trades.filter((t) => t.side === 'sell')),
    byHour,
    byWeekday,
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    curve: dd.curve,
    finalBalance: dd.final,
  };
}
