// A second (third, fourth) chart in a split layout: one market of the
// replay session at a timeframe of its own, on the session's one clock. It
// shows the candles, the session's indicators, the market's drawings and its
// open trades; the chart the trader works on (drawing, trading) is the
// main one, and a click here makes this one the main chart (app.js).
import { TradingChart } from '../chart/chart.js?v=c20cb1ba70';
import { DrawingManager } from '../chart/drawings.js?v=c20cb1ba70';
import { TradeLines } from '../chart/tradelines.js?v=c20cb1ba70';
import { bucket } from '../core/timeframes.js?v=c20cb1ba70';
import * as F from '../format.js?v=c20cb1ba70';
import { h, icon } from './dom.js?v=c20cb1ba70';

export class SidePane {
  /** `slot`: the layout cell; `leg`: the market; `tf`: its timeframe id. */
  constructor(app, slot, leg, tf) {
    this.app = app;
    this.slot = slot;
    this.leg = leg;
    this.tf = tf;
    this.view = null;
    this.engine = null;
    const chartEl = h('div.chart.side-chart');
    this.legend = h('div.side-head');
    this.mainBtn = h('button.side-main', { type: 'button', title: 'Ana grafik yap (çizim ve işlem burada)', 'aria-label': 'Ana grafik yap', onclick: (e) => { e.stopPropagation(); app.activatePane(this.slotIndex()); } }, icon('expand', 15));
    slot.replaceChildren(chartEl, this.legend, this.mainBtn);
    const paint = app.chart;
    this.tc = new TradingChart(chartEl, {
      tz: app.settings.tz, theme: paint.theme, look: paint.look, host: slot,
      onCrosshair: (p) => { this._legend(p); app._syncCross(this.tc, p); },
      onNeedOlder: () => this._older(),
    });
    this.tc.setAccent(paint.accent);
    this.lines = new TradeLines(this.tc, { getBroker: () => this.leg.broker, money: (x) => F.signedMoney(x, this.leg.broker.cfg.currency), onModify: () => {} });
    this.drawings = new DrawingManager(this.tc, { format: app.drawings.format });
    this.drawings.readOnly = true;
    // a click (not a drag) makes this the main chart
    let down = null;
    chartEl.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    chartEl.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) app.activatePane(this.slotIndex());
      down = null;
    });
  }

  slotIndex() { return Number(this.slot.dataset.i); }

  /** Show the market at the cursor (again after a rewind, a new market or timeframe). */
  async open() {
    if (this.dead) return;
    const leg = this.leg;
    const ds = leg.ds;
    if (!ds.timeframes.includes(this.tf)) this.tf = ds.timeframes.includes('1h') ? '1h' : ds.timeframes[0];
    this._drop();
    this.engine = leg.engine;
    const tf = this.tf, engine = this.engine;
    const view = await engine.addView(tf);
    // closed or changed while the bars were read
    if (this.dead || this.engine !== engine || this.tf !== tf) { engine.dropView(tf); return; }
    this.view = view;
    this.viewTf = tf;
    this.view.from = Infinity;
    this.tc.setFormat({ tz: this.app.settings.tz, decimals: ds.decimals, tf: this.view.builder.tf, align: ds.align });
    this.tc.setWatermark(`${ds.symbol} ${this.tf}`);
    for (const ind of [...this.tc.indicators]) this.tc.removeIndicator(ind.id);
    for (const s of this.app.settings.indicators) this.tc.addIndicator(s.type, s.params, s.colors);
    this.tc.setBars(this.view.builder.bars, { fit: true });
    this.drawings.load(this.app._legDrawings(leg));
    this.decorate();
    this._head();
    this._legend(null);
  }

  _drop() {
    if (this.engine && this.view) this.engine.dropView(this.viewTf);
    this.view = null;
  }

  /** The replay moved: the new and changed bars. */
  update() {
    const v = this.view;
    if (!v || this.dead) return;
    if (this.engine !== this.leg.engine) { this.open(); return; }
    if (v.from === -1) this.tc.setBars(v.builder.bars, { keepLogical: this.tc.chart.timeScale().getVisibleLogicalRange() });
    else if (v.from !== Infinity) this.tc.updateFrom(v.from);
    v.from = Infinity;
    this.lines.sync();
    if (!this._hover) this._legend(null);
  }

  /** Trades changed: lines and markers. */
  decorate() {
    this.lines.sync();
    const b = this.leg.broker, ds = this.leg.ds;
    const tf = this.view?.builder.tf;
    const bars = this.tc.bars;
    if (!tf || !bars.length) { this.tc.setMarkers([]); return; }
    const first = bars[0].time, end = bars[bars.length - 1].time + tf.seconds;
    const inside = (t) => t >= first && t < end;
    const out = [];
    for (const t of b.trades) {
      const buy = t.side === 'buy';
      if (inside(t.entryTime)) out.push({ time: bucket(t.entryTime, tf, ds.align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#3d7bff' : '#ff5a76', shape: buy ? 'arrowUp' : 'arrowDown', text: '' });
      if (inside(t.exitTime)) out.push({ time: bucket(t.exitTime, tf, ds.align), position: buy ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#2fd282' : '#ff5a76', shape: 'circle', text: '' });
    }
    for (const p of b.positions) {
      const buy = p.side === 'buy';
      if (inside(p.entryTime)) out.push({ time: bucket(p.entryTime, tf, ds.align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#3d7bff' : '#ff5a76', shape: buy ? 'arrowUp' : 'arrowDown', text: '' });
    }
    this.tc.setMarkers(out.sort((a, c) => a.time - c.time));
  }

  async _older() {
    if (!this.view) return;
    const n = await this.engine.loadOlderView(this.viewTf, 2000);
    if (n && this.view) {
      const r = this.tc.chart.timeScale().getVisibleLogicalRange();
      this.tc.setBars(this.view.builder.bars, { keepLogical: r ? { from: r.from + n, to: r.to + n } : null });
      this.decorate();
    }
  }

  /** The pane's header: its market and timeframe to pick, and the bar's prices. */
  _head() {
    const ds = this.leg.ds, legs = this.app.legs;
    const tfSel = h('select.side-tf', { title: 'Zaman dilimi', 'aria-label': 'Zaman dilimi', onpointerdown: (e) => e.stopPropagation(), onchange: (e) => { this.tf = e.target.value; this.app._savePanes(); this.open(); } },
      ds.timeframes.map((t) => h('option', { value: t }, t)));
    tfSel.value = this.tf;
    let sym;
    if (legs.length > 1) {
      sym = h('select.side-sym', { title: 'Piyasa', 'aria-label': 'Piyasa', onpointerdown: (e) => e.stopPropagation(), onchange: (e) => {
        const leg = legs.find((l) => l.key === e.target.value);
        if (leg) { this._drop(); this.leg = leg; this.app._savePanes(); this.open(); }
      } }, legs.map((l) => h('option', { value: l.key }, l.ds.symbol)));
      sym.value = this.leg.key;
    } else sym = h('span.side-symname', {}, ds.symbol);
    this.ohlc = h('span.side-ohlc');
    this.legend.replaceChildren(sym, tfSel, this.ohlc);
    this._sig = null;
  }

  /** The bar under the crosshair (or the last one). */
  _legend(param) {
    this._hover = !!param?.time;
    if (!this.ohlc) return;
    const bar = (param?.time && param.seriesData?.get(this.tc.candles)) || this.tc.bars[this.tc.bars.length - 1];
    const sig = bar ? `${bar.time}|${bar.open}|${bar.high}|${bar.low}|${bar.close}` : '';
    if (sig === this._sig) return;
    this._sig = sig;
    const dec = this.leg.ds.decimals;
    this.ohlc.className = `side-ohlc ${bar && bar.close >= bar.open ? 'up' : 'down'}`;
    this.ohlc.textContent = bar ? `${F.price(bar.open, dec)} ${F.price(bar.high, dec)} ${F.price(bar.low, dec)} ${F.price(bar.close, dec)}` : '';
  }

  applyLook() {
    const c = this.app.chart;
    this.tc.applyLook(c.look, c.theme);
    this.tc.setAccent(c.accent);
  }

  destroy() {
    this.dead = true;
    this._drop();
    this.lines.clear();
    this.drawings.destroy();
    this.tc.remove();
    this.slot.replaceChildren();
  }
}
