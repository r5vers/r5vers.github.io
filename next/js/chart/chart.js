// TradingView Lightweight Charts wrapper: candles, volume, indicators, markers
// and the time <-> logical-index mapping drawings need.
import { INDICATORS, computeIndicator } from './indicators.js?v=fd94038260';
import { SessionsPrimitive } from './sessions.js?v=fd94038260';

const LW = window.LightweightCharts;

const THEMES = {
  dark: { text: '#a1a1aa', grid: 'rgba(255,255,255,0.045)', border: 'rgba(255,255,255,0.08)', cross: 'rgba(255,255,255,0.38)', label: '#2c2c2e', neutral: '#8b909c', mark: 'rgba(255,255,255,0.035)' },
  light: { text: '#2a2a2a', grid: 'rgba(0,0,0,0.055)', border: 'rgba(0,0,0,0.14)', cross: 'rgba(0,0,0,0.42)', label: '#1d1d1f', neutral: '#6d6d6d', mark: 'rgba(0,0,0,0.045)' },
};
const NARROW = window.matchMedia('(max-width: 760px)');

export const DEFAULT_LOOK = {
  up: '#8fa8ff', down: '#c77dff', wick: 'match', wickColor: null, border: true, hollow: false,
  grid: 'both', crosshair: 'dotted', chartBg: 'glass', chartColor: '#0b0b0d', lastLine: true,
  watermark: true, scale: 'normal', chartFont: 11,
  // each part of a candle can have its own colours (null: the up / down colour)
  bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null,
};
const CROSSHAIR = { dotted: 1, dashed: 2, solid: 0 };
const SCALE_MODE = { normal: 0, log: 1, percent: 2 };

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const DTF = new Map();

export class TradingChart {
  constructor(el, { tz = 'UTC', decimals = 5, theme = 'dark', look = DEFAULT_LOOK, onCrosshair, onNeedOlder, onNeedNewer, onScaleChange, host = null } = {}) {
    this.el = el;
    // what the chart's own buttons and overlays sit in (the chart area; with
    // split charts the chart itself moves between the area's slots)
    this.host = host || el.parentElement;
    this.tz = tz;
    this.decimals = decimals;
    this.tf = null;
    this.align = 'utc';
    this.bars = [];
    this.indicators = [];
    this.onCrosshair = onCrosshair;
    this.onNeedOlder = onNeedOlder;
    this.onNeedNewer = onNeedNewer;
    this.onScaleChange = onScaleChange;
    this._edgeBusy = false;
    this.look = { ...DEFAULT_LOOK, ...look };

    this.chart = LW.createChart(el, {
      autoSize: true,
      layout: { fontFamily: getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace', fontSize: 11, panes: { separatorColor: 'rgba(255,255,255,0.08)', enableResize: true } },
      rightPriceScale: { borderVisible: true, scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderVisible: true, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7, minBarSpacing: 0.5 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      localization: { locale: 'tr-TR', timeFormatter: (t) => this._fmtCrosshair(t), priceFormatter: (p) => p.toFixed(this.decimals) },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    });
    this.candles = this.chart.addSeries(LW.CandlestickSeries, { priceFormat: this._priceFormat() });
    this.volume = this.chart.addSeries(LW.HistogramSeries, {
      priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false });
    this.markersApi = LW.createSeriesMarkers(this.candles, []);
    this.theme = theme;
    this.applyLook(this.look, theme);

    this._onNarrow = () => this.applyLook();
    NARROW.addEventListener?.('change', this._onNarrow);
    this.chart.subscribeCrosshairMove((param) => this.onCrosshair?.(param));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => this._checkEdges(range));
    this._wirePriceAxis();
  }

  // ── price scale: the library's own TradingView behaviour (drag the axis to
  // stretch, drag the pane to pan once auto scale is off, double click the
  // axis to reset). The "A" button in the corner shows and toggles auto scale.
  _wirePriceAxis() {
    const auto = document.createElement('button');
    auto.className = 'autoscale-btn on';
    auto.type = 'button';
    auto.title = 'Otomatik ölçek (fiyat eksenine çift tık da olur)';
    auto.textContent = 'A';
    auto.addEventListener('click', () => (this._autoOn() ? null : this.autoScale()));
    this.host?.append(auto);
    this.autoBtn = auto;

    const place = () => {
      if (this._removed) return;
      const w = this.chart.priceScale('right').width();
      if (!w) return;
      const o = this.offset();
      const left = o.left + this.el.clientWidth - w;
      // the corner under the price axis, as on TradingView
      const timeH = this.chart.timeScale().height?.() || 28;
      Object.assign(auto.style, { left: `${left + (w - 22) / 2}px`, top: `${o.top + this.el.clientHeight - timeH + (timeH - 20) / 2}px` });
    };
    this.placeAxisZone = place;
    this._ro = new ResizeObserver(place);
    this._ro.observe(this.el);
    this.chart.timeScale().subscribeSizeChange(() => requestAnimationFrame(place));
    requestAnimationFrame(place);
    // the library has no auto-scale event: look after anything that can change it
    const sync = () => requestAnimationFrame(() => { if (!this._removed) this._setAutoUi(this._autoOn()); });
    for (const ev of ['pointerup', 'dblclick', 'wheel', 'touchend']) this.el.addEventListener(ev, sync, { passive: true });
  }

  _autoOn() { return this.chart.priceScale('right').options().autoScale !== false; }

  /** Where the chart sits in its host, in CSS pixels. */
  offset() {
    if (this.el.offsetParent === this.host) return { left: this.el.offsetLeft, top: this.el.offsetTop };
    const a = this.el.getBoundingClientRect(), b = this.host.getBoundingClientRect();
    return { left: a.left - b.left - this.host.clientLeft, top: a.top - b.top - this.host.clientTop };
  }

  /** The chart moved to another place in its host (split charts). */
  moved() { requestAnimationFrame(() => this.placeAxisZone?.()); }

  remove() {
    this._removed = true;
    this._ro?.disconnect();
    NARROW.removeEventListener?.('change', this._onNarrow);
    this.autoBtn?.remove();
    this.chart.remove();
  }

  priceRange() {
    const r = this.chart.priceScale('right').getVisibleRange?.();
    return r && Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from ? r : null;
  }

  setPriceRange(range) {
    if (!(range.to > range.from)) return;
    const ps = this.chart.priceScale('right');
    ps.setAutoScale(false);
    ps.setVisibleRange(range);
    this._setAutoUi(false);
  }

  autoScale() {
    this.chart.priceScale('right').setAutoScale(true);
    this._setAutoUi(true);
  }

  _setAutoUi(on) {
    if (this.autoBtn?.classList.contains('on') === on) return;
    if (this.autoBtn) this.autoBtn.classList.toggle('on', on);
    this.onScaleChange?.(on);
  }

  // ── formatting ─────────────────────────────────────────────────────────
  _priceFormat() {
    return { type: 'price', precision: this.decimals, minMove: 10 ** -this.decimals };
  }

  // making a formatter is far slower than using one, and the axis asks for
  // labels on every frame: one per (options, zone)
  _dtf(opts, tz) {
    const key = `${tz}|${JSON.stringify(opts)}`;
    let f = DTF.get(key);
    if (!f) { f = new Intl.DateTimeFormat('tr-TR', { timeZone: tz, hourCycle: 'h23', ...opts }); DTF.set(key, f); }
    return f;
  }

  /** Daily and slower bars are labelled with dates (00:00 UTC): show them in UTC. */
  _zone() { return this.tf && this.tf.kind !== 'intraday' ? 'UTC' : this.tz; }

  _fmtCrosshair(t) {
    const intraday = this.tf && this.tf.kind === 'intraday';
    const f = this._dtf(intraday
      ? { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }, this._zone());
    return f.format(new Date(t * 1000));
  }

  _tick(t, type) {
    const d = new Date(t * 1000);
    const z = this._zone();
    switch (type) {
      case 0: return this._dtf({ year: 'numeric' }, z).format(d);
      case 1: return this._dtf({ month: 'short' }, z).format(d);
      case 2: return this._dtf({ day: 'numeric' }, z).format(d);
      default: return this._dtf({ hour: '2-digit', minute: '2-digit' }, z).format(d);
    }
  }

  setFormat({ tz, decimals, tf, align }) {
    if (tz) this.tz = tz;
    if (decimals != null) this.decimals = decimals;
    if (tf) this.tf = tf;
    if (align) this.align = align;
    this.chart.applyOptions({
      localization: { timeFormatter: (t) => this._fmtCrosshair(t), priceFormatter: (p) => p.toFixed(this.decimals) },
      timeScale: { tickMarkFormatter: (t, type) => this._tick(t, type), timeVisible: !this.tf || this.tf.kind === 'intraday' },
    });
    this.candles.applyOptions({ priceFormat: this._priceFormat() });
  }

  applyTheme(theme) { this.applyLook(this.look, theme); }

  /** Faint symbol and timeframe behind the candles. */
  setWatermark(text) {
    this.watermarkText = text || '';
    this._paintWatermark();
  }

  _paintWatermark() {
    const th = this._th || THEMES[this.theme] || THEMES.dark;
    const on = this.look.watermark && !!this.watermarkText;
    const css = getComputedStyle(document.documentElement);
    const family = css.getPropertyValue('--display').trim() || 'sans-serif';
    const weight = css.getPropertyValue('--d-weight').trim() || '700';
    const opts = {
      visible: on, horzAlign: 'center', vertAlign: 'center',
      lines: [{ text: this.watermarkText, color: th.mark, fontSize: 84, fontFamily: family, fontStyle: weight }],
    };
    if (!this.watermark) {
      if (!on || !LW.createTextWatermark) return;
      this.watermark = LW.createTextWatermark(this.chart.panes()[0], opts);
    } else this.watermark.applyOptions(opts);
  }

  /** Theme (text / grid tones) plus the user's chart look: candle colours,
   *  grid, and a transparent (glass) or solid background. */
  applyLook(look = this.look, theme = this.theme) {
    if (this._removed) return;
    const base = THEMES[theme] || THEMES.dark;
    this.theme = theme;
    this.look = { ...DEFAULT_LOOK, ...look };
    const L = this.look;
    // the user's chart colours win over the theme's
    const th = { ...base };
    if (L.gridColor) th.grid = rgba(L.gridColor, 0.9);
    if (L.textColor) th.text = L.textColor;
    if (L.crossColor) th.cross = L.crossColor;
    if (Number.isFinite(L.markOpacity)) th.mark = theme === 'light' ? `rgba(0,0,0,${L.markOpacity / 100})` : `rgba(255,255,255,${L.markOpacity / 100})`;
    this._th = th;
    if (L.grid === true) L.grid = 'both';
    if (L.grid === false) L.grid = 'none';
    const bg = L.chartBg === 'solid' ? L.chartColor : 'rgba(0,0,0,0)';
    const crossStyle = CROSSHAIR[L.crosshair] ?? 1;
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
    const mode = SCALE_MODE[L.scale] ?? 0;
    // phones get axis text a size smaller, which leaves the candles more room
    const fontSize = Math.min(Number(L.chartFont) || 11, NARROW.matches ? 10 : 99);
    this.chart.applyOptions({
      layout: { background: { type: LW.ColorType.Solid, color: bg }, textColor: th.text, fontSize, fontFamily, panes: { separatorColor: th.border } },
      grid: { vertLines: { color: th.grid, visible: L.grid === 'both' }, horzLines: { color: th.grid, visible: L.grid !== 'none' } },
      rightPriceScale: { borderColor: th.border, mode },
      timeScale: { borderColor: th.border },
      crosshair: { vertLine: { color: th.cross, labelBackgroundColor: th.label, style: crossStyle }, horzLine: { color: th.cross, labelBackgroundColor: th.label, style: crossStyle } },
    });
    const wick = (c) => (L.wick === 'match' ? c : L.wick === 'custom' && L.wickColor ? L.wickColor : th.neutral);
    this.candles.applyOptions({
      upColor: L.hollow ? 'rgba(0,0,0,0)' : L.bodyUp || L.up, downColor: L.bodyDown || L.down,
      borderVisible: L.hollow || L.border !== false,
      borderUpColor: L.borderUp || L.up, borderDownColor: L.borderDown || L.down,
      wickUpColor: L.wickUp || wick(L.up), wickDownColor: L.wickDown || wick(L.down),
      priceLineVisible: L.lastLine !== false,
    });
    if (mode !== this._scaleMode) { this._scaleMode = mode; this.autoScale(); }
    if (this.bars.length) this.volume.setData(this.bars.map((b) => this._vol(b)));
    this._paintWatermark();
    requestAnimationFrame(() => this.placeAxisZone?.());
  }

  // ── data ───────────────────────────────────────────────────────────────
  _vol(b) { return { time: b.time, value: b.volume, color: rgba(b.close >= b.open ? this.look.up : this.look.down, (this.look.volOpacity ?? 26) / 100) }; }

  setBars(bars, { fit = false, keepLogical = null } = {}) {
    this.bars = bars;
    this._drawn = bars.length;
    this.candles.setData(bars);
    this.volume.setData(bars.map((b) => this._vol(b)));
    this.refreshIndicators(true);
    if (keepLogical) this.chart.timeScale().setVisibleLogicalRange(keepLogical);
    else if (fit) this.scrollToEnd();
  }

  /** How many bars a view shows: about 7px a bar (TradingView's density), so
   *  a phone opens on readable candles instead of a squeezed history. */
  _barsFor(max) {
    const w = this.paneWidth() || this.el.clientWidth || 900;
    return Math.max(30, Math.min(max, Math.round(w / 7)));
  }

  scrollToEnd(visibleBars = 150) {
    const n = this.bars.length;
    const pad = (this.paneWidth() || this.el.clientWidth || 900) < 500 ? 5 : 12;
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - this._barsFor(visibleBars)), to: n + pad });
  }

  /** Prepend older bars without moving the view. */
  prependBars(older) {
    // never break the time order the chart needs
    if (this.bars.length) older = older.filter((b) => b.time < this.bars[0].time);
    if (!older.length) return;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    this.setBars(older.concat(this.bars), {
      keepLogical: range ? { from: range.from + older.length, to: range.to + older.length } : null,
    });
  }

  appendBars(newer) {
    if (this.bars.length) newer = newer.filter((b) => b.time > this.bars[this.bars.length - 1].time);
    if (!newer.length) return;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    this.setBars(this.bars.concat(newer), { keepLogical: range });
  }

  /** Bars from `index` on changed in place or were appended (replay). */
  updateFrom(index) {
    const n = this.bars.length;
    const drawn = this._drawn ?? 0;
    // each update() costs about as much as a fifth of a full setData: past a
    // few changed bars one setData is cheaper than many updates
    if (n - index > 4 || index > drawn) { this.setBars(this.bars, { keepLogical: this.chart.timeScale().getVisibleLogicalRange() }); return; }
    for (let i = Math.max(0, index); i < n; i++) {
      // historicalUpdate only for a bar the chart already has that is no
      // longer its newest (live feeds); new bars are plain appends
      const old = i < drawn - 1;
      this.candles.update(this.bars[i], old);
      this.volume.update(this._vol(this.bars[i]), old);
    }
    this._drawn = n;
    this.refreshIndicators(false, index, drawn);
  }

  _checkEdges(range) {
    if (this._removed || !range || this._edgeBusy || !this.bars.length) return;
    const run = (fn) => {
      if (!fn) return;
      this._edgeBusy = true;
      Promise.resolve(fn()).finally(() => { this._edgeBusy = false; });
    };
    if (range.from < 30) run(this.onNeedOlder);
    else if (range.to > this.bars.length - 30) run(this.onNeedNewer);
  }

  setMarkers(markers) {
    this.markersApi.setMarkers(markers || []);
  }

  // ── indicators ─────────────────────────────────────────────────────────
  addIndicator(type, params = {}, colors = null, id = null) {
    const def = INDICATORS[type];
    if (!def) return null;
    // an EMA without colours of its own follows the theme's accent
    const autoColor = !colors && type === 'ema' && !!this.accent;
    const ind = { id: id || `${type}-${Math.random().toString(36).slice(2, 8)}`, type, params: { ...def.params, ...params }, colors: colors || (autoColor ? [this.accent] : def.colors), autoColor, series: [], pane: null };
    if (def.primitive) {
      ind.primitive = new SessionsPrimitive(this, ind.params);
      this.candles.attachPrimitive(ind.primitive);
      ind.primitive.requestUpdate?.();
      // the library may hand the primitive its update hook a frame later
      requestAnimationFrame(() => { ind.primitive.requestUpdate?.(); this.chart.applyOptions({}); });
      this.indicators.push(ind);
      return ind;
    }
    const pane = def.overlay ? 0 : this.chart.panes().length;
    const outputs = computeIndicator(def, this.bars, ind.params, ind.colors, { align: this.align });
    for (const o of outputs) {
      const opts = { color: o.color, lineWidth: o.width || 1.5, lineStyle: o.style || 0, priceLineVisible: false, lastValueVisible: !def.overlay || o.key === outputs[0].key, crosshairMarkerVisible: false, priceFormat: def.overlay ? this._priceFormat() : { type: 'price', precision: 2, minMove: 0.01 } };
      const s = o.kind === 'histogram'
        ? this.chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
        : this.chart.addSeries(LW.LineSeries, opts, pane);
      ind.series.push({ key: o.key, api: s, kind: o.kind || 'line', negColor: o.negColor, color: o.color });
    }
    if (!def.overlay) {
      requestAnimationFrame(() => this.placeAxisZone?.());
      ind.pane = ind.series[0].api.getPane();
      ind.pane.setStretchFactor(0.3);
      for (const lv of def.levels || []) ind.series[ind.series.length - 1].api.createPriceLine({ price: lv, color: '#787b86', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    }
    this.indicators.push(ind);
    this._fillIndicator(ind, outputs);
    return ind;
  }

  removeIndicator(id) {
    const i = this.indicators.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (this.indicators[i].primitive) this.candles.detachPrimitive(this.indicators[i].primitive);
    for (const s of this.indicators[i].series) this.chart.removeSeries(s.api);
    this.indicators.splice(i, 1);
    requestAnimationFrame(() => this.placeAxisZone?.());
  }

  /** Recolour the indicators that follow the accent. */
  setAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '') || hex === this.accent) return;
    this.accent = hex;
    for (const ind of this.indicators) {
      if (!ind.autoColor) continue;
      ind.colors = [hex];
      ind.series[0]?.api.applyOptions({ color: hex });
      if (ind.series[0]) ind.series[0].color = hex;
    }
  }

  updateIndicator(id, params) {
    const ind = this.indicators.find((x) => x.id === id);
    if (!ind) return;
    const { type } = ind;
    // an untouched accent colour keeps following the theme
    const colors = ind.autoColor && ind.colors?.[0]?.toLowerCase() === this.accent?.toLowerCase() ? null : ind.colors;
    const idx = this.indicators.indexOf(ind);
    this.removeIndicator(id);
    const next = this.addIndicator(type, params, colors, id);
    // keep the list order
    this.indicators.splice(this.indicators.indexOf(next), 1);
    this.indicators.splice(idx, 0, next);
  }

  _point(s, time, v) {
    if (!Number.isFinite(v)) return { time };
    if (s.kind === 'histogram') return { time, value: v, color: v >= 0 ? s.color : s.negColor };
    return { time, value: v };
  }

  _fillIndicator(ind, outputs) {
    for (const s of ind.series) {
      const o = outputs.find((x) => x.key === s.key);
      const data = this.bars.map((b, i) => this._point(s, b.time, o.values[i]));
      s.api.setData(data);
    }
  }

  refreshIndicators(full, from = 0, drawn = this.bars.length) {
    for (const ind of this.indicators) {
      if (ind.primitive) continue;
      const def = INDICATORS[ind.type];
      const outputs = computeIndicator(def, this.bars, ind.params, ind.colors, { align: this.align });
      if (full) { this._fillIndicator(ind, outputs); continue; }
      for (const s of ind.series) {
        const o = outputs.find((x) => x.key === s.key);
        const n = this.bars.length;
        // as for the candles: historical updates only for points the series already has
        for (let i = Math.max(0, from); i < n; i++) s.api.update(this._point(s, this.bars[i].time, o.values[i]), i < drawn - 1);
      }
    }
  }

  indicatorValues(param) {
    const out = [];
    for (const ind of this.indicators) {
      const last = this.bars.length - 1;
      const vals = ind.series.map((s) => {
        const d = param && param.time != null && param.seriesData ? param.seriesData.get(s.api) : s.api.dataByIndex(last);
        return d && d.value != null ? d.value : null;
      });
      out.push({ ind, vals });
    }
    return out;
  }

  // ── coordinates (used by drawings and trade lines) ─────────────────────
  get tfSeconds() { return this.tf ? this.tf.seconds : 60; }

  timeToLogical(t) {
    const b = this.bars;
    const n = b.length;
    if (!n) return null;
    if (t <= b[0].time) return (t - b[0].time) / this.tfSeconds;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / this.tfSeconds;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b[mid].time <= t) lo = mid; else hi = mid; }
    // inside bar `lo`: a fraction of it; inside a gap (weekend): the next bar
    const into = t - b[lo].time;
    return into < this.tfSeconds ? lo + into / this.tfSeconds : hi;
  }

  logicalToTime(l) {
    const b = this.bars;
    const n = b.length;
    if (!n) return null;
    const i = Math.round(l);
    if (i < 0) return b[0].time + i * this.tfSeconds;
    if (i > n - 1) return b[n - 1].time + (i - (n - 1)) * this.tfSeconds;
    return b[i].time;
  }

  xOf(t) { const l = this.timeToLogical(t); return l == null ? null : this.chart.timeScale().logicalToCoordinate(l); }
  yOf(p) { return this.candles.priceToCoordinate(p); }
  priceAt(y) { return this.candles.coordinateToPrice(y); }
  logicalAt(x) { return this.chart.timeScale().coordinateToLogical(x); }
  barAt(x) {
    const l = this.logicalAt(x);
    if (l == null) return null;
    const i = Math.round(l);
    return this.bars[Math.max(0, Math.min(this.bars.length - 1, i))] || null;
  }

  /** Width of the main pane in CSS pixels (excludes the price axis). */
  paneWidth() { return this.chart.timeScale().width(); }
  paneHeight() { return this.chart.panes()[0]?.getHeight?.() ?? this.el.clientHeight; }

  showTime(t, bars = 120) {
    const l = this.timeToLogical(t);
    if (l == null) return;
    bars = this._barsFor(bars);
    this.chart.timeScale().setVisibleLogicalRange({ from: l - bars / 2, to: l + bars / 2 });
  }

  screenshot() { return this.chart.takeScreenshot(); }

  /** Put the crosshair on the bar at (or just before) `time`; null hides it
   *  (the other charts of a split layout follow the one under the mouse). */
  crossAt(time) {
    if (this._removed) return;
    const bars = this.bars;
    if (time == null || !bars.length || time < bars[0].time) { this.chart.clearCrosshairPosition(); return; }
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].time <= time) lo = mid; else hi = mid - 1; }
    this.chart.setCrosshairPosition(bars[lo].close, bars[lo].time, this.candles);
  }
}
