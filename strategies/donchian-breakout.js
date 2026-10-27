// Donchian kırılımı (Turtle tarzı): son N barın zirvesi kırılırsa al,
// dibi kırılırsa sat. Stop, ATR ile iz süren (trailing) stop olarak taşınır.
const strategy = {
  name: 'Donchian kırılımı + iz süren stop',
  params: { len: 20, atrLen: 20, slAtr: 2, trailAtr: 2.5, riskPct: 1 },

  setup(s, ta, p) {
    return {
      upper: ta.highest(s.high, p.len),
      lower: ta.lowest(s.low, p.len),
      atr: ta.atr(s.high, s.low, s.close, p.atrLen),
    };
  },

  plots: [
    { key: 'upper', color: '#26c6da', title: 'Üst kanal' },
    { key: 'lower', color: '#26c6da', title: 'Alt kanal' },
  ],

  onBar(ctx) {
    const { ind, p, i, close } = ctx;
    const up = ind.upper[i - 1], dn = ind.lower[i - 1], atr = ind.atr[i];
    if (![up, dn, atr].every(Number.isFinite)) return;
    const pos = ctx.position;

    if (pos) {
      // iz süren stop: yalnızca kâr yönünde taşı
      if (pos.side === 'buy') {
        const sl = close - atr * p.trailAtr;
        if (pos.sl == null || sl > pos.sl) ctx.setStops(pos.id, { sl });
      } else {
        const sl = close + atr * p.trailAtr;
        if (pos.sl == null || sl < pos.sl) ctx.setStops(pos.id, { sl });
      }
      return;
    }
    if (close > up) ctx.buy({ sl: close - atr * p.slAtr, riskPct: p.riskPct, comment: 'Kırılım yukarı' });
    else if (close < dn) ctx.sell({ sl: close + atr * p.slAtr, riskPct: p.riskPct, comment: 'Kırılım aşağı' });
  },
};
