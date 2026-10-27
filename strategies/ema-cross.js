// EMA kesişimi: hızlı EMA yavaşı yukarı keserse al, aşağı keserse sat.
// Stop ATR'ye göre, hedef risk x R:R, lot %risk ile hesaplanır.
// Market emirleri bir sonraki barın açılışında dolar.
const strategy = {
  name: 'EMA kesişimi',
  params: { fast: 9, slow: 21, atrLen: 14, slAtr: 1.5, rr: 2, riskPct: 1 },

  // Tüm göstergeler bir kez hesaplanır; i. değer yalnızca 0..i barlarını kullanır.
  setup(s, ta, p) {
    return {
      fast: ta.ema(s.close, p.fast),
      slow: ta.ema(s.close, p.slow),
      atr: ta.atr(s.high, s.low, s.close, p.atrLen),
    };
  },

  // Grafikte çizilecek seriler
  plots: { fast: '#f5c542', slow: '#4aa3ff' },

  // Her bar kapanışında çalışır. ctx.ind.* ve ctx.series.* bu bara kadar uzanır.
  onBar(ctx) {
    const { ind, p, close } = ctx;
    const atr = ind.atr[ctx.i];
    if (!Number.isFinite(atr)) return;

    if (ctx.crossover(ind.fast, ind.slow)) {
      ctx.closeAll();
      ctx.buy({ sl: close - atr * p.slAtr, rr: p.rr, riskPct: p.riskPct, comment: 'EMA yukarı' });
    } else if (ctx.crossunder(ind.fast, ind.slow)) {
      ctx.closeAll();
      ctx.sell({ sl: close + atr * p.slAtr, rr: p.rr, riskPct: p.riskPct, comment: 'EMA aşağı' });
    }
  },
};
