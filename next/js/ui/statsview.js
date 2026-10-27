// Statistics panel: KPIs, equity curve, breakdowns by hour / weekday / month.
import * as F from '../format.js?v=0f8583c5e0';
import { h } from './dom.js?v=0f8583c5e0';

const LW = window.LightweightCharts;
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function kpi(label, value, cls = '') {
  return h('div.kpi', {}, h('div.label', {}, label), h(`div.value${cls ? `.${cls}` : ''}`, {}, value));
}

function barsList(rows, ccy) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.net)));
  return h('div.bars-mini', {}, rows.map((r) => h('div.r', {},
    h('span.muted', {}, r.label),
    h('div.track', {}, h('div.fill', { style: {
      left: r.net >= 0 ? '50%' : `${50 - (Math.abs(r.net) / max) * 50}%`,
      width: `${(Math.abs(r.net) / max) * 50}%`,
      background: r.net >= 0 ? 'var(--up)' : 'var(--down)',
    } })),
    h(`span.num.${F.cls(r.net)}`, {}, r.count ? `${F.signedMoney(r.net, ccy)} · ${r.count}` : '—'))));
}

export class StatsView {
  constructor(el) {
    this.el = el;
    this.eqChart = null;
  }

  destroy() {
    this.token = null;
    if (this.eqChart) { this.eqChart.remove(); this.eqChart = null; }
  }

  /**
   * stats: computeStats() result; equity: optional [{time, value}] mark-to-market
   * curve (strategy tests); otherwise the closed-trade balance curve is drawn.
   */
  render({ stats: s, ccy = 'USD', initial = 10000, equity = null, extra = null, theme = 'dark' }) {
    this.destroy();
    this.el.innerHTML = '';
    if (!s || !s.trades) {
      this.el.append(h('div.empty', {}, 'İstatistik için en az bir kapanmış işlem gerekli.'));
      return;
    }
    const box = h('div.equity-box', {});
    const left = h('div', {},
      h('div.kpis', {},
        kpi('Net K/Z', F.signedMoney(s.net, ccy), F.cls(s.net)),
        kpi('Getiri', F.pct(s.returnPct, 2), F.cls(s.net)),
        kpi('İşlem', String(s.trades)),
        kpi('Kazanma oranı', F.pct(s.winRate, 1)),
        kpi('Kâr faktörü', F.num(s.profitFactor, 2)),
        kpi('Beklenti / işlem', F.signedMoney(s.expectancy, ccy), F.cls(s.expectancy)),
        kpi('Ort. R', s.avgR == null ? '—' : F.signed(s.avgR, 2), F.cls(s.avgR)),
        kpi('Toplam R', s.totalR == null ? '—' : F.signed(s.totalR, 1), F.cls(s.totalR)),
        kpi('Ort. kazanç', F.money(s.avgWin, ccy), 'up'),
        kpi('Ort. kayıp', F.money(s.avgLoss, ccy), 'down'),
        kpi('Kazanç/kayıp oranı', F.num(s.payoff, 2)),
        kpi('Maks. düşüş', `${F.money(s.maxDrawdown, ccy)} · ${F.pct(s.maxDrawdownPct, 1)}`, 'down'),
        kpi('Toparlanma faktörü', F.num(s.recoveryFactor, 2)),
        kpi('Ard. kazanç / kayıp', `${s.maxConsecWins} / ${s.maxConsecLosses}`),
        kpi('En iyi / en kötü', `${F.money(s.largestWin, ccy)} / ${F.money(s.largestLoss, ccy)}`),
        kpi('Ort. süre', F.duration(s.avgDuration)),
        kpi('Long', `${s.long.count} · ${F.pct(s.long.winRate, 0)} · ${F.signedMoney(s.long.net, ccy)}`, F.cls(s.long.net)),
        kpi('Short', `${s.short.count} · ${F.pct(s.short.winRate, 0)} · ${F.signedMoney(s.short.net, ccy)}`, F.cls(s.short.net)),
        kpi('Komisyon', F.money(s.commission, ccy)),
        kpi('SQN', F.num(s.sqn, 2)),
        ...(extra || [])));
    const right = h('div', {},
      h('h4', { style: { marginTop: 0 } }, equity ? 'Varlık eğrisi' : 'Bakiye eğrisi (kapanan işlemler)'),
      box,
      h('div.split.later', {},
        h('div', {}, h('h4', {}, 'Giriş saatine göre'), barsList(s.byHour.map((r, i) => ({ ...r, label: `${String(i).padStart(2, '0')}:00` })).filter((r) => r.count), ccy)),
        h('div', {},
          h('h4', {}, 'Güne göre'), barsList(s.byWeekday.map((r, i) => ({ ...r, label: DAYS[i] })), ccy),
          h('h4', {}, 'Aya göre'), barsList(s.byMonth.map((r) => ({ ...r, label: r.month.slice(2) })), ccy))));
    this.el.append(h('div.stats-layout', {}, left, right));
    // the curve once the figures are on screen: both in one frame froze the
    // page for a moment after a long test
    const token = this.token = {};
    requestAnimationFrame(() => setTimeout(() => { if (this.token === token) this._curve(box, { s, initial, equity, theme }); }, 0));
  }

  _curve(box, { s, initial, equity, theme }) {
    const light = theme === 'light';
    this.eqChart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { type: LW.ColorType.Solid, color: 'transparent' }, textColor: light ? '#131722' : '#d1d4dc', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: light ? '#e0e3eb' : '#2a2e39' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false, handleScale: false,
      localization: { locale: 'tr-TR', priceFormatter: (p) => p.toFixed(2) },
    });
    const series = this.eqChart.addSeries(LW.BaselineSeries, {
      baseValue: { type: 'price', price: initial },
      topLineColor: '#26a69a', topFillColor1: 'rgba(38,166,154,0.3)', topFillColor2: 'rgba(38,166,154,0.02)',
      bottomLineColor: '#ef5350', bottomFillColor1: 'rgba(239,83,80,0.02)', bottomFillColor2: 'rgba(239,83,80,0.3)',
      lineWidth: 2, priceLineVisible: false,
    });
    let pts = equity ? equity.map((p) => ({ time: p.time, value: p.value }))
      : [{ time: (s.curve[0]?.t ?? 0) - 60, value: initial }, ...s.curve.map((p) => ({ time: p.t, value: p.balance }))];
    // one point per timestamp, increasing
    const dedup = [];
    for (const p of pts) {
      if (dedup.length && p.time <= dedup[dedup.length - 1].time) dedup[dedup.length - 1].value = p.value;
      else dedup.push(p);
    }
    pts = dedup;
    series.setData(pts);
    this.eqChart.timeScale().fitContent();
  }
}
