// Asya seansı likidite süpürmesi (ICT tarzı, 15m/5m için).
// Asya aralığı (00:00-06:00 UTC) belirlenir. Londra açılışında (07:00-10:00 UTC)
// fiyat Asya zirvesinin üstüne fitil atıp aralığın içinde kapanırsa SAT,
// dibinin altına fitil atıp içeride kapanırsa AL. Stop süpürme ucunun ötesinde,
// hedef aralığın karşı ucu (ya da en az 1.5R).
const strategy = {
  name: 'Asya süpürmesi (Londra)',
  params: { asiaStart: 0, asiaEnd: 6, tradeStart: 7, tradeEnd: 10, bufferPips: 2, minRR: 1.5, riskPct: 1 },

  setup() { return {}; },

  onBar(ctx) {
    const { p } = ctx;
    const hour = Math.floor((ctx.time % 86400) / 3600);
    const day = Math.floor(ctx.time / 86400);
    const st = this.state || (this.state = { day: -1, hi: -Infinity, lo: Infinity, traded: false });

    if (st.day !== day) Object.assign(st, { day, hi: -Infinity, lo: Infinity, traded: false });
    if (hour >= p.asiaStart && hour < p.asiaEnd) {
      st.hi = Math.max(st.hi, ctx.high);
      st.lo = Math.min(st.lo, ctx.low);
      return;
    }
    if (hour === p.tradeEnd && ctx.position) ctx.closeAll();
    if (st.traded || ctx.position || hour < p.tradeStart || hour >= p.tradeEnd) return;
    if (!Number.isFinite(st.hi) || !Number.isFinite(st.lo)) return;

    const buf = p.bufferPips * ctx.pip;
    if (ctx.high > st.hi && ctx.close < st.hi) {
      const sl = ctx.high + buf;
      const risk = sl - ctx.close;
      const tp = Math.min(st.lo, ctx.close - risk * p.minRR);
      ctx.sell({ sl, tp, riskPct: p.riskPct, comment: 'Asya zirvesi süpürüldü' });
      st.traded = true;
    } else if (ctx.low < st.lo && ctx.close > st.lo) {
      const sl = ctx.low - buf;
      const risk = ctx.close - sl;
      const tp = Math.max(st.hi, ctx.close + risk * p.minRR);
      ctx.buy({ sl, tp, riskPct: p.riskPct, comment: 'Asya dibi süpürüldü' });
      st.traded = true;
    }
  },
};
