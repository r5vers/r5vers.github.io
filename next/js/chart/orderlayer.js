// Trading on the chart, FX Replay style. An open position is one line at
// its entry with chips at the right end: TP and SL (drag them out to place
// the target and the stop), the lot, the running P&L and a close button.
// A placed stop or target is a line of its own with what it would make or
// lose; drag it to move it, × takes it away. Pending orders look the same,
// their line dashed. The lines themselves are the chart's price lines
// (tradelines.js); the chips are HTML over the chart, kept on their prices
// as the chart scrolls and zooms.
//
// PlusButton: the "+" at the price axis that follows the crosshair (as on
// TradingView): a click offers orders and a line at that price.

const ROW_H = 22;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export class OrderLayer {
  /**
   * tc: TradingChart. hooks:
   *   getBroker()                         the broker on the chart (or null)
   *   money(x), price(p)                  text for amounts and prices
   *   preview(kind, item, field, price)   { qty, pnl, r } a stop at `price` would mean
   *   onStop(kind, id, field, price)      set (price) or remove (null) a stop
   *   onPrice(id, price)                  move a pending order
   *   onClose(kind, id)                   close a position / cancel an order
   *   onMenu(kind, id, anchor)            the lot chip's menu
   *   hint(text)                          a short note for the trader
   */
  constructor(tc, hooks) {
    this.tc = tc;
    this.h = hooks;
    this.root = el('div', 'ol-layer');
    tc.host.append(this.root);
    this.rows = new Map();
    this.drag = null;
    this._raf = 0;
    this.colors = { entry: '#3d7bff', sl: '#ff9f2e', tp: '#2fd282', order: '#3d7bff' };
  }

  /** The broker changed (a fill, a step, a modify): rebuild the chips. */
  sync() {
    const b = this.h.getBroker();
    const specs = [];
    if (b) {
      for (const p of b.positions) {
        specs.push({ key: `p${p.id}`, kind: 'pos', role: 'entry', item: p, price: p.entryPrice });
        if (p.sl != null) specs.push({ key: `p${p.id}:sl`, kind: 'pos', role: 'sl', item: p, price: p.sl });
        if (p.tp != null) specs.push({ key: `p${p.id}:tp`, kind: 'pos', role: 'tp', item: p, price: p.tp });
      }
      for (const o of b.orders) {
        if (o.type === 'next') continue;
        specs.push({ key: `o${o.id}`, kind: 'ord', role: 'entry', item: o, price: o.price });
        if (o.sl != null) specs.push({ key: `o${o.id}:sl`, kind: 'ord', role: 'sl', item: o, price: o.sl });
        if (o.tp != null) specs.push({ key: `o${o.id}:tp`, kind: 'ord', role: 'tp', item: o, price: o.tp });
      }
    }
    const seen = new Set();
    for (const s of specs) {
      seen.add(s.key);
      let row = this.rows.get(s.key);
      const shape = this._shape(s);
      if (!row || row.shape !== shape) {
        row?.el.remove();
        row = { el: this._build(s), shape };
        this.rows.set(s.key, row);
        this.root.append(row.el);
      }
      row.spec = s;
      if (this.drag?.key !== s.key) row.price = s.price;
      this._fill(row, b);
    }
    for (const [key, row] of this.rows) if (!seen.has(key)) { row.el.remove(); this.rows.delete(key); }
    this._kick();
  }

  clear() { for (const row of this.rows.values()) row.el.remove(); this.rows.clear(); }

  /** Which chips a row has (a row is rebuilt when that changes). */
  _shape(s) {
    const it = s.item;
    if (s.role !== 'entry') return s.role;
    return `${s.kind}:${it.side}:${it.tp == null ? 'T' : ''}${it.sl == null ? 'S' : ''}`;
  }

  _build(s) {
    const it = s.item;
    const row = el('div', `ol-row ol-${s.role} ol-${s.kind}${s.kind === 'ord' ? ' ol-pending' : ''} ${it.side}`);
    row.dataset.key = s.key;
    if (s.role === 'entry') {
      if (it.tp == null) row.append(this._addChip(s, 'tp'));
      if (it.sl == null) row.append(this._addChip(s, 'sl'));
      const qty = el('button', 'ol-chip ol-qty');
      qty.type = 'button';
      qty.addEventListener('click', (e) => this.h.onMenu(s.kind, it.id, e.currentTarget));
      row.append(qty);
      if (s.kind === 'ord') {
        const lab = el('span', 'ol-chip ol-type ol-grab');
        lab.title = 'Emri taşımak için sürükle';
        this._grab(lab, () => this.rows.get(s.key), (price) => this.h.onPrice(it.id, price));
        row.append(lab);
      } else row.append(el('span', 'ol-chip ol-pnl'));
    } else {
      const lab = el('span', `ol-chip ol-stop-label ol-grab ${s.role}`);
      lab.title = `${s.role === 'sl' ? 'Stop' : 'Hedef'}: taşımak için sürükle`;
      this._grab(lab, () => this.rows.get(s.key), (price) => this.h.onStop(s.kind, it.id, s.role, price));
      row.append(lab);
    }
    const x = el('button', 'ol-chip ol-x', '×');
    x.type = 'button';
    x.title = s.role === 'entry' ? (s.kind === 'pos' ? 'Pozisyonu kapat' : 'Emri iptal et') : `${s.role === 'sl' ? 'Stop' : 'Hedef'} kaldır`;
    x.addEventListener('click', () => {
      if (s.role === 'entry') this.h.onClose(s.kind, it.id);
      else this.h.onStop(s.kind, it.id, s.role, null);
    });
    row.append(x);
    return row;
  }

  /** Texts and tones of a row from the broker now. */
  _fill(row, b) {
    const s = row.spec, it = s.item;
    const q = row.el.querySelector('.ol-qty');
    if (q) {
      q.textContent = String(it.qty);
      const sizing = it.autoRisk && it.sl == null;
      q.classList.toggle('ol-pending-size', !!sizing);
      q.title = sizing ? `Lot: SL’yi koyunca %${it.autoRisk} riske göre ayarlanır` : 'Lot · kısmi kapat, başabaş';
    }
    if (s.role === 'entry' && s.kind === 'pos') {
      const pnl = b.unrealized(it);
      const c = row.el.querySelector('.ol-pnl');
      c.textContent = this.h.money(pnl);
      c.classList.toggle('up', pnl > 0);
      c.classList.toggle('down', pnl < 0);
    }
    if (s.role === 'entry' && s.kind === 'ord') {
      row.el.querySelector('.ol-type').textContent = `${it.side === 'buy' ? 'BUY' : 'SELL'} ${it.type === 'limit' ? 'LIMIT' : 'STOP'}`;
    }
    if (s.role !== 'entry' && this.drag?.key !== s.key) this._stopLabel(row, row.price);
  }

  _stopLabel(row, price) {
    const s = row.spec;
    const v = this.h.preview(s.kind, s.item, s.role, price);
    const lab = row.el.querySelector('.ol-stop-label');
    if (!lab || !v) return;
    lab.textContent = `${s.role.toUpperCase()} ${this.h.money(v.pnl)}${v.r != null ? ` · ${v.r >= 0 ? '' : '−'}${Math.abs(v.r).toFixed(2)}R` : ''}${v.resized ? ` · ${v.qty} lot` : ''}`;
  }

  /** A TP or SL chip on the entry line: drag it out to place the stop. */
  _addChip(s, field) {
    const b = el('button', `ol-chip ol-add ${field}`, field.toUpperCase());
    b.type = 'button';
    b.title = field === 'tp' ? 'Hedef: yukarı / aşağı sürükleyip bırak' : 'Stop: sürükleyip bırak (lot riske göre ayarlanır)';
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = this._y(e);
      const it = s.item;
      const ghost = { el: this._ghostRow(field), price: s.price };
      this.root.append(ghost.el);
      const line = this.tc.candles.createPriceLine({ price: s.price, color: this.colors[field], lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: '' });
      this.drag = { key: `ghost:${s.key}`, ghost };
      let moved = false;
      const move = (ev) => {
        const y = this._y(ev);
        if (Math.abs(y - start) > 3) moved = true;
        const price = this.tc.priceAt(y);
        if (price == null) return;
        ghost.price = price;
        line.applyOptions({ price });
        const v = this.h.preview(s.kind, it, field, price);
        if (v) ghost.el.firstChild.textContent = `${field.toUpperCase()} ${this.h.money(v.pnl)}${v.r != null ? ` · ${Math.abs(v.r).toFixed(2)}R` : ''}${v.resized ? ` · ${v.qty} lot` : ''}`;
        this._place();
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        this.tc.candles.removePriceLine(line);
        ghost.el.remove();
        this.drag = null;
        if (moved) this.h.onStop(s.kind, it.id, field, ghost.price);
        else this.h.hint?.(`${field.toUpperCase()} için çipi tutup ${field === 'tp' ? 'hedef' : 'stop'} fiyatına sürükle`);
        this._kick();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    });
    return b;
  }

  _ghostRow(field) {
    const row = el('div', `ol-row ol-ghost ol-${field}`);
    row.append(el('span', `ol-chip ol-stop-label ${field}`, field.toUpperCase()));
    return row;
  }

  /** Drag a chip with its row: the row (and its price line) follow, then `done(price)`. */
  _grab(chip, getRow, done) {
    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const row = getRow();
      if (!row) return;
      const start = this._y(e);
      let moved = false;
      this.drag = { key: row.spec.key };
      const move = (ev) => {
        const y = this._y(ev);
        if (Math.abs(y - start) > 3) moved = true;
        const price = this.tc.priceAt(y);
        if (price == null) return;
        row.price = price;
        if (row.spec.role !== 'entry') this._stopLabel(row, price);
        this.h.onDrag?.(row.spec, price);
        this._place();
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        this.drag = null;
        if (moved) done(row.price);
        else row.price = row.spec.price;
        this._kick();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    });
  }

  _y(e) { return e.clientY - this.tc.el.getBoundingClientRect().top; }

  // ── keeping the chips on their prices ──────────────────────────────────
  _kick() {
    if (this._raf) return;
    const tick = () => {
      this._raf = 0;
      if (!this.rows.size && !this.drag) return;
      this._place();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _place() {
    const tc = this.tc;
    const W = tc.paneWidth(), H = tc.paneHeight();
    const box = this.root.style;
    const o = tc.offset();
    const left = `${o.left}px`, top = `${o.top}px`, width = `${W}px`, height = `${H}px`;
    if (box.left !== left) box.left = left;
    if (box.top !== top) box.top = top;
    if (box.width !== width) box.width = width;
    if (box.height !== height) box.height = height;
    const put = (node, price) => {
      const y = tc.yOf(price);
      const show = y != null && y > -ROW_H && y < H + ROW_H;
      if (node.hidden === show) node.hidden = !show;
      if (!show) return;
      const t = `translateY(${Math.round(y - ROW_H / 2)}px)`;
      if (node.style.transform !== t) node.style.transform = t;
    };
    for (const row of this.rows.values()) put(row.el, row.price);
    if (this.drag?.ghost) put(this.drag.ghost.el, this.drag.ghost.price);
  }
}

/** The "+" beside the price axis at the crosshair's price. */
export class PlusButton {
  constructor(tc, { onClick }) {
    this.tc = tc;
    this.btn = el('button', 'axis-plus');
    this.btn.type = 'button';
    this.btn.title = 'Bu fiyattan emir ya da çizgi';
    this.btn.setAttribute('aria-label', 'Bu fiyattan emir ya da çizgi');
    this.btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    this.btn.hidden = true;
    tc.host.append(this.btn);
    this.price = null;
    this.hover = false;
    this.btn.addEventListener('pointerenter', () => { this.hover = true; });
    this.btn.addEventListener('pointerleave', () => { this.hover = false; });
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); if (this.price != null) onClick(this.price, this.btn); });
    this.enabled = true;
  }

  /** The crosshair moved (point in pane pixels, or none when it left). */
  update(point) {
    if (!point || !this.enabled) { if (!this.hover) this.btn.hidden = true; return; }
    const W = this.tc.paneWidth(), H = this.tc.paneHeight();
    if (point.y < 0 || point.y > H || point.x < 0 || point.x > W) { if (!this.hover) this.btn.hidden = true; return; }
    const price = this.tc.priceAt(point.y);
    if (price == null) return;
    this.price = price;
    this.btn.hidden = false;
    const o = this.tc.offset();
    this.btn.style.left = `${o.left + W - 24}px`;
    this.btn.style.top = `${o.top + point.y - 10}px`;
  }

  hide() { this.hover = false; this.btn.hidden = true; }
}
