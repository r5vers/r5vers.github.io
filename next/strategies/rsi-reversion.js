// RSI ortalamaya dönüş: ana trend yönünde (EMA 200), RSI aşırı bölgeden
// dönünce işleme gir; RSI 50'yi geçince ya da stop/hedefte çık.
const strategy = {
  name: 'RSI dönüş (trend filtreli)',
  params: { rsiLen: 14, low: 30, high: 70, trendLen: 200, atrLen: 14, slAtr: 2, riskPct: 1 },

  setup(s, ta, p) {
    return {
      rsi: ta.rsi(s.close, p.rsiLen),
      trend: ta.ema(s.close, p.trendLen),
      atr: ta.atr(s.high, s.low, s.close, p.atrLen),
    };
  },

  plots: { trend: '#ff9800' },

  onBar(ctx) {
    const { ind, p, i, close } = ctx;
    const rsi = ind.rsi[i], prev = ind.rsi[i - 1], trend = ind.trend[i], atr = ind.atr[i];
    if (![rsi, prev, trend, atr].every(Number.isFinite)) return;
    const pos = ctx.position;

    if (pos) {
      // çıkış: RSI orta çizgiyi geçti
      if ((pos.side === 'buy' && rsi > 50) || (pos.side === 'sell' && rsi < 50)) ctx.closePosition(pos.id);
      return;
    }
    if (close > trend && prev < p.low && rsi >= p.low) {
      ctx.buy({ sl: close - atr * p.slAtr, rr: 3, riskPct: p.riskPct, comment: 'RSI dip' });
    } else if (close < trend && prev > p.high && rsi <= p.high) {
      ctx.sell({ sl: close + atr * p.slAtr, rr: 3, riskPct: p.riskPct, comment: 'RSI tepe' });
    }
  },
};
