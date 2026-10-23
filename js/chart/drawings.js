// Drawing tools rendered through a series primitive, with selection, handles,
// dragging and a magnet. Anchors are stored as { time, price } so drawings stay
// put across timeframe changes.
//
// The manager owns the mouse on the chart: other things that want to grab it
// (trade lines, "pick a price" mode) register as interceptors and get first go.

const POINTS = { trend: 2, ray: 2, rect: 2, fib: 2, measure: 2, hline: 1, hray: 1, vline: 1, text: 1, long: 1, short: 1 };
const COLORS = { trend: '#2962ff', ray: '#2962ff', hline: '#f5a623', hray: '#f5a623', vline: '#9598a1', rect: '#9c27b0', fib: '#9598a1', measure: '#2962ff', text: '#d1d4dc', long: '#26a69a', short: '#ef5350' };
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1];
export const TOOL_NAMES = {
  cursor: 'İmleç', trend: 'Trend çizgisi', ray: 'Işın', hline: 'Yatay çizgi', hray: 'Yatay ışın',
  vline: 'Dikey çizgi', rect: 'Dikdörtgen (bölge)', fib: 'Fibonacci düzeltmesi', long: 'Long pozisyon',
  short: 'Short pozisyon', measure: 'Ölçüm', text: 'Metin',
};
export function fibLevels(d) {
  return (d.levels || FIB_LEVELS.map(value => ({ value, visible: true }))).filter(l => l.visible !== false && Number.isFinite(l.value));
}
export function drawingStylePatch(d, patch) {
  if (d.type !== 'fib' || 'levels' in patch) return patch;
  const shared = ['color', 'width', 'dash'].filter(key => key in patch);
  if (!shared.length) return patch;
  return { ...patch, levels: (patch.levels || d.levels || FIB_LEVELS.map(value => ({ value, visible: true }))).map(level => ({
    ...level, ...Object.fromEntries(shared.map(key => [key, patch[key]])),
  })) };
}
export const drawingOpacity = (value, fallback = 100) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : fallback)) / 100;
const TOL = 6;

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

class DrawingPrimitive {
  constructor(manager) {
    this.m = manager;
    const renderer = { draw: (target) => target.useMediaCoordinateSpace((scope) => this.m._draw(scope.context, scope.mediaSize)) };
    this._views = [{ zOrder: () => 'top', renderer: () => renderer }];
  }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return this._views; }
}

export class DrawingManager {
  constructor(tc, { onChange, onSelect, onToolChange, format, requestText } = {}) {
    this.tc = tc;
    this.requestText = requestText || ((initial, submit) => { const text = window.prompt('Metin', initial); if (text?.trim()) submit(text.trim()); });
    this.drawings = [];
    this.history = ["[]"]; this.historyAt = 0;
    this.selected = null;
    this.tool = 'cursor';
    this.magnet = false;
    this.creating = null;
    this.drag = null;
    this.interceptors = [];
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onToolChange = onToolChange || (() => {});
    this.format = format || { price: (p) => p.toFixed(5), pips: (d) => d, pct: (x) => x };
    this.primitive = new DrawingPrimitive(this);
    tc.candles.attachPrimitive(this.primitive);
    const el = tc.el;
    el.addEventListener('mousedown', (e) => this._down(e), true);
    el.addEventListener('dblclick', (e) => this._dbl(e), true);
    // touch: the same handlers; one finger only, so pinch-zoom stays with the chart
    for (const [type, kind] of [['touchstart', 'down'], ['touchmove', 'move'], ['touchend', 'up'], ['touchcancel', 'up']]) {
      el.addEventListener(type, (e) => this._touch(e, kind), { capture: true, passive: false });
    }
    window.addEventListener('mousemove', (e) => this._move(e), true);
    window.addEventListener('mouseup', (e) => this._up(e), true);
  }

  _changed() {
    const state = JSON.stringify(this.serialize());
    if (this.history[this.historyAt] !== state) {
      this.history = this.history.slice(0, this.historyAt + 1);
      this.history.push(state);
      if (this.history.length > 100) this.history.shift();
      this.historyAt = this.history.length - 1;
    }
    this.onChange();
  }
  historyStep(delta) {
    this.cancel();
    const next = this.historyAt + delta;
    if (next < 0 || next >= this.history.length) return;
    this.historyAt = next; this.drawings = JSON.parse(this.history[next]);
    this.select(null); this.redraw(); this.onChange();
  }

  redraw() { this.primitive.requestUpdate?.(); }

  // ── public API ─────────────────────────────────────────────────────────
  setTool(tool) {
    if (this.creating) this._cancelCreate();
    this.tool = tool;
    this.tc.el.classList.toggle('drawing', tool !== 'cursor');
    this.onToolChange(tool);
  }

  load(list) {
    this.drawings = (list || []).map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
    this.history = [JSON.stringify(this.serialize())]; this.historyAt = 0;
    this.select(null);
    this.redraw();
  }

  serialize() { return this.drawings.filter((d) => d !== this.creating?.d).map((d) => JSON.parse(JSON.stringify(d))); }

  select(id) {
    this.selected = id == null ? null : this.drawings.find((d) => d.id === id) || null;
    this.onSelect(this.selected);
    this.redraw();
  }

  update(id, props) {
    const d = this.drawings.find((x) => x.id === id);
    if (!d) return;
    Object.assign(d, drawingStylePatch(d, props));
    this.redraw();
    this._changed();
  }

  remove(id) {
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selected?.id === id) this.select(null);
    this.redraw();
    this._changed();
  }

  clear() {
    this.drawings = [];
    this.select(null);
    this._changed();
  }

  addInterceptor(i) { this.interceptors.push(i); return () => { this.interceptors = this.interceptors.filter((x) => x !== i); }; }

  // ── geometry ───────────────────────────────────────────────────────────
  _xy(e) {
    const r = this.tc.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _inPane(x, y) { return x >= 0 && y >= 0 && x <= this.tc.paneWidth() && y <= this.tc.paneHeight(); }

  _px(p) { return { x: this.tc.xOf(p.time), y: this.tc.yOf(p.price) }; }

  _pointAt(x, y, snap = true) {
    const l = this.tc.logicalAt(x);
    let price = this.tc.priceAt(y);
    if (l == null || price == null) return null;
    if (snap && this.magnet) {
      const bar = this.tc.barAt(x);
      if (bar) {
        let best = null;
        for (const v of [bar.open, bar.high, bar.low, bar.close]) {
          const dy = Math.abs(this.tc.yOf(v) - y);
          if (dy < 40 && (!best || dy < best.dy)) best = { v, dy };
        }
        if (best) price = best.v;
      }
    }
    return { time: this.tc.logicalToTime(l), price, logical: l };
  }

  _handles(d) {
    const P = d.points.map((p) => this._px(p));
    if (d.type === 'long' || d.type === 'short') {
      const x0 = P[0].x, x1 = this.tc.xOf(d.points[1].time);
      return [
        { name: 'entry', x: x0, y: P[0].y },
        { name: 'target', x: x0, y: this.tc.yOf(d.target) },
        { name: 'stop', x: x0, y: this.tc.yOf(d.stop) },
        { name: 'end', x: x1, y: P[0].y },
      ];
    }
    return P.map((p, i) => ({ name: `p${i}`, x: p.x, y: p.y }));
  }

  _hit(x, y) {
    if (this.hideAll) return null;
    if (this.selected) {
      for (const hd of this._handles(this.selected)) {
        if (hd.x != null && hd.y != null && Math.hypot(hd.x - x, hd.y - y) <= TOL + 2) return { d: this.selected, handle: hd.name };
      }
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (this._hitBody(d, x, y)) return { d, handle: null };
    }
    return null;
  }

  _hitBody(d, x, y) {
    const P = d.points.map((p) => this._px(p));
    if (P.some((p) => p.x == null || p.y == null)) return false;
    const W = this.tc.paneWidth();
    switch (d.type) {
      case 'trend': return distToSegment(x, y, P[0].x, P[0].y, P[1].x, P[1].y) <= TOL;
      case 'ray': {
        const [a, b] = this._rayEnd(P[0], P[1], W);
        return distToSegment(x, y, a.x, a.y, b.x, b.y) <= TOL;
      }
      case 'hline': return Math.abs(y - P[0].y) <= TOL;
      case 'hray': return Math.abs(y - P[0].y) <= TOL && x >= P[0].x - TOL;
      case 'vline': return Math.abs(x - P[0].x) <= TOL;
      case 'rect': case 'measure': {
        const [l, r] = [Math.min(P[0].x, P[1].x), Math.max(P[0].x, P[1].x)];
        const [t, b] = [Math.min(P[0].y, P[1].y), Math.max(P[0].y, P[1].y)];
        return x >= l - TOL && x <= r + TOL && y >= t - TOL && y <= b + TOL;
      }
      case 'fib': {
        const l = Math.min(P[0].x, P[1].x), r = d.extend ? W : Math.max(P[0].x, P[1].x);
        if (x < l - TOL || x > r + TOL) return false;
        return fibLevels(d).some((lv) => Math.abs(y - this.tc.yOf(this._fibPrice(d, lv.value))) <= TOL);
      }
      case 'long': case 'short': {
        const x1 = this.tc.xOf(d.points[1].time);
        const ys = [P[0].y, this.tc.yOf(d.target), this.tc.yOf(d.stop)];
        return x >= Math.min(P[0].x, x1) - TOL && x <= Math.max(P[0].x, x1) + TOL && y >= Math.min(...ys) - TOL && y <= Math.max(...ys) + TOL;
      }
      case 'text': {
        const size = d.size || 13;
        const w = Math.max(20, (d.text || '').length * size * 0.6);
        return x >= P[0].x - 6 && x <= P[0].x + w + 6 && y >= P[0].y - size - 6 && y <= P[0].y + 6;
      }
      default: return false;
    }
  }

  _rayEnd(a, b, W) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < 1e-6) return [a, { x: a.x, y: dy > 0 ? 1e5 : -1e5 }];
    const tEdge = ((dx > 0 ? W : 0) - a.x) / dx;
    return [a, { x: a.x + dx * Math.max(tEdge, 1), y: a.y + dy * Math.max(tEdge, 1) }];
  }

  _fibPrice(d, level) {
    const [p0, p1] = d.points;
    return p1.price + (p0.price - p1.price) * level;
  }

  // ── mouse ──────────────────────────────────────────────────────────────
  _take(e) { e.preventDefault(); e.stopPropagation(); }

  _touch(e, kind) {
    if (kind !== 'up' && e.touches.length > 1) return;
    const t = (kind === 'up' ? e.changedTouches : e.touches)[0];
    if (!t) return;
    const busy = () => this.drag || this.creating;
    const ev = {
      clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false, buttons: kind === 'move' ? 1 : 0,
      preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation(),
    };
    if (kind === 'down') { this._down(ev); return; }
    if (!busy()) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind === 'move') this._move(ev); else this._up(ev);
  }

  _down(e) {
    if (e.button !== 0) return;
    const { x, y } = this._xy(e);
    if (!this._inPane(x, y)) return;

    if (this.creating) {
      this._take(e);
      const pt = this._pointAt(x, y);
      if (pt) this._setPoint(this.creating.d, 1, pt);
      this._finishCreate();
      return;
    }

    for (const ic of this.interceptors) {
      const handler = ic.start?.(x, y, e);
      if (handler) { this._take(e); this.drag = { external: handler }; return; }
    }

    if (this.tool !== 'cursor') {
      this._take(e);
      this._startCreate(x, y);
      return;
    }

    const hit = this._hit(x, y);
    if (!hit) {
      if (this.selected) this.select(null);
      return; // let the chart pan
    }
    this._take(e);
    if (this.selected !== hit.d) this.select(hit.d.id);
    if (hit.d.locked) return;
    const pt = this._pointAt(x, y, false);
    this.drag = {
      d: hit.d, handle: hit.handle, start: pt,
      orig: JSON.parse(JSON.stringify({ points: hit.d.points, target: hit.d.target, stop: hit.d.stop })),
      moved: false,
    };
  }

  _move(e) {
    const { x, y } = this._xy(e);
    if (this.drag?.external) { this.drag.external.move?.(x, y, e); return; }
    if (this.creating) {
      const pt = this._pointAt(x, y);
      if (pt) { this._setPoint(this.creating.d, 1, pt); this.redraw(); }
      return;
    }
    if (this.drag) {
      e.preventDefault();
      this._dragTo(x, y, e.shiftKey);
      return;
    }
    if (!this._inPane(x, y) || e.buttons) return;
    let cursor = '';
    for (const ic of this.interceptors) {
      const c = ic.hover?.(x, y);
      if (c) { cursor = c; break; }
    }
    if (!cursor && this.tool === 'cursor') {
      const hit = this._hit(x, y);
      if (hit) cursor = hit.handle ? 'pointer' : 'move';
    }
    this.tc.el.style.cursor = cursor;
  }

  _up(e) {
    if (this.drag?.external) {
      const { x, y } = this._xy(e);
      const h = this.drag.external;
      this.drag = null;
      h.end?.(x, y, e);
      return;
    }
    if (this.creating) {
      const { x, y } = this._xy(e);
      if (Math.hypot(x - this.creating.x, y - this.creating.y) > 5) this._finishCreate();
      return;
    }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) this._changed();
    }
  }

  _dbl(e) {
    const { x, y } = this._xy(e);
    const hit = this._hit(x, y);
    if (hit && hit.d.type === 'text') {
      this._take(e);
      const id = hit.d.id;
      this.requestText(hit.d.text || '', text => this.update(id, { text }));
    }
  }

  // ── create / drag ──────────────────────────────────────────────────────
  _newId() { return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

  _startCreate(x, y) {
    const pt = this._pointAt(x, y);
    if (!pt) return;
    const type = this.tool;
    // the colour and style last used for this tool, else the tool's own; text
    // starts in a colour that reads on the chart's background
    const look = this.tc.look || {};
    const lightBg = look.chartBg === 'solid' && /^#[0-9a-f]{6}$/i.test(look.chartColor || '')
      ? [1, 3, 5].reduce((s, i, k) => s + [0.299, 0.587, 0.114][k] * parseInt(look.chartColor.slice(i, i + 2), 16), 0) / 255 > 0.55
      : this.tc.theme === 'light';
    const own = type === 'text' ? (lightBg ? '#1d1f24' : '#eef0f4') : COLORS[type];
    const d = { id: this._newId(), type, color: own, width: 1.5, ...(this.defaults?.(type) || {}), points: [{ time: pt.time, price: pt.price }] };
    if (POINTS[type] === 1) {
      if (type === 'text') {
        this.setTool('cursor');
        this.requestText('', text => {
          if (!text?.trim()) return;
          d.text = text.trim(); this.drawings.push(d); this.select(d.id); this._changed();
        });
        return;
      }
      if (type === 'long' || type === 'short') {
        const top = this.tc.priceAt(0), bottom = this.tc.priceAt(this.tc.paneHeight());
        const span = Math.abs(top - bottom) || pt.price * 0.002;
        const dir = type === 'long' ? 1 : -1;
        d.target = pt.price + dir * span * 0.12;
        d.stop = pt.price - dir * span * 0.06;
        d.points.push({ time: this.tc.logicalToTime(pt.logical + 30), price: pt.price });
      }
      this.drawings.push(d);
      this.setTool('cursor');
      this.select(d.id);
      this._changed();
      return;
    }
    d.points.push({ time: pt.time, price: pt.price });
    this.drawings.push(d);
    this.creating = { d, x, y };
    this.redraw();
  }

  _setPoint(d, i, pt) {
    d.points[i] = { time: pt.time, price: pt.price };
  }

  _finishCreate() {
    const { d } = this.creating;
    this.creating = null;
    this.setTool('cursor');
    this.select(d.id);
    this._changed();
  }

  _cancelCreate() {
    const { d } = this.creating;
    this.creating = null;
    this.drawings = this.drawings.filter((x) => x !== d);
    this.redraw();
  }

  cancel() {
    if (this.creating) this._cancelCreate();
    if (this.tool !== 'cursor') this.setTool('cursor');
  }

  _shift(p, dl, dp) {
    const l = this.tc.timeToLogical(p.time);
    return { time: this.tc.logicalToTime(l + dl), price: p.price + dp };
  }

  _dragTo(x, y, shift) {
    const g = this.drag;
    const pt = this._pointAt(x, y, !!g.handle);
    if (!pt || !g.start) return;
    g.moved = true;
    const d = g.d;
    const o = g.orig;
    if (g.handle) {
      if (g.handle === 'target') d.target = pt.price;
      else if (g.handle === 'stop') d.stop = pt.price;
      else if (g.handle === 'end') d.points[1] = { time: pt.time, price: d.points[0].price };
      else if (g.handle === 'entry') {
        d.points[0] = { time: pt.time, price: pt.price };
        d.points[1] = { time: d.points[1].time, price: pt.price };
      } else {
        const i = Number(g.handle.slice(1));
        let price = pt.price;
        // shift: keep a trend line horizontal
        if (shift && d.type === 'trend') price = d.points[1 - i].price;
        d.points[i] = { time: pt.time, price };
      }
    } else {
      const dl = Math.round(pt.logical - g.start.logical);
      const dp = d.type === 'vline' ? 0 : pt.price - g.start.price;
      const dlx = d.type === 'hline' ? 0 : dl;
      d.points = o.points.map((p) => this._shift(p, dlx, dp));
      if (o.target != null) d.target = o.target + dp;
      if (o.stop != null) d.stop = o.stop + dp;
    }
    this.redraw();
  }

  // ── rendering ──────────────────────────────────────────────────────────
  _draw(ctx, size) {
    const W = size.width, H = size.height;
    for (const d of this.drawings) {
      if (this.hideAll || d.hidden) continue;
      ctx.save();
      try { this._render(ctx, d, W, H); } catch { /* off-screen anchors */ }
      ctx.restore();
    }
    if (!this.hideAll && this.selected && !this.selected.hidden) {
      ctx.save();
      for (const hd of this._handles(this.selected)) {
        if (hd.x == null || hd.y == null) continue;
        ctx.beginPath();
        ctx.arc(hd.x, hd.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#131722';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2962ff';
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _label(ctx, text, x, y, { color = '#d1d4dc', bg = 'rgba(19,23,34,0.85)', align = 'left', base = 'middle' } = {}) {
    ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
    const w = ctx.measureText(text).width + 8;
    let lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const ly = base === 'bottom' ? y - 16 : base === 'top' ? y : y - 8;
    ctx.fillStyle = bg;
    ctx.fillRect(lx, ly, w, 16);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 4, ly + 8);
  }

  _render(ctx, d, W, H) {
    const color = d.color || COLORS[d.type];
    const P = d.points.map((p) => this._px(p));
    if (P.some((p) => p.x == null || p.y == null)) return;
    const sel = this.selected === d;
    ctx.globalAlpha = drawingOpacity(d.opacity);
    ctx.strokeStyle = rgba(color, drawingOpacity(d.lineOpacity));
    ctx.lineWidth = (d.width ?? 1.5) + (sel ? 0.5 : 0);
    ctx.setLineDash(d.dash === 'dot' ? [1.5, 4] : d.dash ? [6, 4] : []);
    ctx.lineCap = d.dash === 'dot' ? 'round' : 'butt';
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const fmt = this.format;

    switch (d.type) {
      case 'trend': line(P[0], P[1]); break;
      case 'ray': { const [a, b] = this._rayEnd(P[0], P[1], W); line(a, b); break; }
      case 'hline':
        line({ x: 0, y: P[0].y }, { x: W, y: P[0].y });
        this._label(ctx, fmt.price(d.points[0].price), W - 2, P[0].y, { color: '#fff', bg: color, align: 'right' });
        break;
      case 'hray':
        line(P[0], { x: W, y: P[0].y });
        this._label(ctx, fmt.price(d.points[0].price), W - 2, P[0].y, { color: '#fff', bg: color, align: 'right' });
        break;
      case 'vline': line({ x: P[0].x, y: 0 }, { x: P[0].x, y: H }); break;
      case 'rect': {
        const x = Math.min(P[0].x, P[1].x), y = Math.min(P[0].y, P[1].y);
        const w = Math.abs(P[1].x - P[0].x), h = Math.abs(P[1].y - P[0].y);
        ctx.fillStyle = rgba(color, drawingOpacity(d.fill, 18));
        ctx.fillRect(x, y, d.extend ? W - x : w, h);
        if ((d.width ?? 1.5) > 0) ctx.strokeRect(x, y, d.extend ? W - x : w, h);
        break;
      }
      case 'fib': {
        const l = Math.min(P[0].x, P[1].x), r = d.extend ? W : Math.max(P[0].x, P[1].x);
        ctx.setLineDash([]);
        const levels = fibLevels(d);
        levels.forEach((level, i) => {
          const lv = level.value;
          const price = this._fibPrice(d, lv), y = this.tc.yOf(price);
          if (y == null) return;
          if (i > 0) {
            const yPrev = this.tc.yOf(this._fibPrice(d, levels[i - 1].value));
            ctx.fillStyle = rgba(level.color || color, drawingOpacity(d.fill, 7));
            ctx.fillRect(l, Math.min(y, yPrev), r - l, Math.abs(y - yPrev));
          }
          ctx.strokeStyle = rgba(level.color || color, drawingOpacity(d.lineOpacity));
          ctx.lineWidth = level.width ?? d.width ?? 1.5;
          const dash = level.dash ?? d.dash;
          ctx.setLineDash(dash === 'dot' ? [1.5, 4] : dash ? [6, 4] : []);
          line({ x: l, y }, { x: r, y });
          ctx.fillStyle = rgba(d.textColor || level.color || color, drawingOpacity(d.textOpacity));
          ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
          ctx.textBaseline = 'bottom';
          if (d.labels !== false) ctx.fillText(`${d.percent ? `${(lv * 100).toFixed(1)}%` : lv}${d.prices === false ? '' : ` (${fmt.price(price)})`}`, l + 2, y - 1);
        });
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = rgba(color, 0.6 * drawingOpacity(d.lineOpacity));
        if (d.baseline !== false) line(P[0], P[1]);
        break;
      }
      case 'measure': {
        const x = Math.min(P[0].x, P[1].x), y = Math.min(P[0].y, P[1].y);
        const w = Math.abs(P[1].x - P[0].x), h = Math.abs(P[1].y - P[0].y);
        const dp = d.points[1].price - d.points[0].price;
        const up = dp >= 0;
        ctx.fillStyle = rgba(up ? '#2962ff' : '#ef5350', 0.15);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = up ? '#2962ff' : '#ef5350';
        line(P[0], P[1]);
        const bars = Math.round(this.tc.timeToLogical(d.points[1].time) - this.tc.timeToLogical(d.points[0].time));
        const text = `${dp >= 0 ? '+' : ''}${fmt.price(dp)} (${fmt.pips(dp)} pip, ${fmt.pct(dp / d.points[0].price)}) · ${bars} bar`;
        this._label(ctx, text, x + w / 2, up ? y - 4 : y + h + 4, { align: 'center', base: up ? 'bottom' : 'top', bg: up ? '#2962ff' : '#ef5350', color: '#fff' });
        break;
      }
      case 'long': case 'short': {
        const x0 = P[0].x, x1 = this.tc.xOf(d.points[1].time);
        const yE = P[0].y, yT = this.tc.yOf(d.target), yS = this.tc.yOf(d.stop);
        const l = Math.min(x0, x1), w = Math.abs(x1 - x0);
        ctx.fillStyle = 'rgba(38,166,154,0.22)';
        ctx.fillRect(l, Math.min(yE, yT), w, Math.abs(yT - yE));
        ctx.fillStyle = 'rgba(239,83,80,0.22)';
        ctx.fillRect(l, Math.min(yE, yS), w, Math.abs(yS - yE));
        ctx.strokeStyle = '#787b86';
        line({ x: l, y: yE }, { x: l + w, y: yE });
        const entry = d.points[0].price;
        const reward = Math.abs(d.target - entry), risk = Math.abs(entry - d.stop);
        const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';
        const cx = l + w / 2;
        this._label(ctx, `Hedef ${fmt.price(d.target)} · ${fmt.pips(reward)} pip · ${fmt.pct(reward / entry)}`, cx, yT + (yT < yE ? -3 : 3), { align: 'center', base: yT < yE ? 'bottom' : 'top', bg: '#089981', color: '#fff' });
        this._label(ctx, `Stop ${fmt.price(d.stop)} · ${fmt.pips(risk)} pip · ${fmt.pct(risk / entry)}`, cx, yS + (yS < yE ? -3 : 3), { align: 'center', base: yS < yE ? 'bottom' : 'top', bg: '#f23645', color: '#fff' });
        this._label(ctx, `${d.type === 'long' ? 'LONG' : 'SHORT'} ${fmt.price(entry)} · R:R ${rr}`, cx, yE, { align: 'center', bg: 'rgba(42,46,57,0.95)' });
        break;
      }
      case 'text': {
        const size = d.size || 13;
        ctx.font = `${d.bold ? 700 : 500} ${size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(d.text || '').width;
        // an optional plate behind the text, in the opposite tone of the text
        if (d.bg) {
          const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
          const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
          ctx.fillStyle = dark ? 'rgba(14, 15, 20, 0.82)' : 'rgba(255, 255, 255, 0.88)';
          const px = 6, top = P[0].y - size - 5;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(P[0].x - px, top, tw + px * 2, size + 9, 6) : ctx.rect(P[0].x - px, top, tw + px * 2, size + 9);
          ctx.fill();
        }
        ctx.fillStyle = rgba(d.textColor || color, drawingOpacity(d.textOpacity));
        ctx.fillText(d.text || '', P[0].x, P[0].y);
        if (sel) { ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = rgba(color, 0.6); ctx.strokeRect(P[0].x - 4, P[0].y - size - 3, tw + 8, size + 6); ctx.setLineDash([]); }
        break;
      }
      default: break;
    }
  }
}
