// Price lines for open positions and pending orders; SL / TP and order prices
// can be dragged on the chart.

const C = { buy: '#26a69a', sell: '#ef5350', sl: '#ef5350', tp: '#26a69a', order: '#2962ff', entry: '#9598a1' };

export class TradeLines {
  constructor(tc, { getBroker, money, onModify, onDragStart }) {
    this.tc = tc;
    this.getBroker = getBroker;
    this.money = money;
    this.onModify = onModify;
    this.onDragStart = onDragStart;
    this.lines = new Map();
    this.dragging = null;
  }

  _specs() {
    const b = this.getBroker();
    if (!b) return [];
    const out = [];
    for (const p of b.positions) {
      const side = p.side === 'buy' ? 'LONG' : 'SHORT';
      out.push({ key: `p${p.id}:entry`, price: p.entryPrice, color: C[p.side], style: 0, width: 1, title: `${side} ${p.qty} · ${this.money(b.unrealized(p))}` });
      if (p.sl != null) out.push({ key: `p${p.id}:sl`, kind: 'pos', id: p.id, field: 'sl', price: p.sl, color: C.sl, style: 2, width: 1, title: `SL ${this.money(b.pnlAt(p, p.sl))}` });
      if (p.tp != null) out.push({ key: `p${p.id}:tp`, kind: 'pos', id: p.id, field: 'tp', price: p.tp, color: C.tp, style: 2, width: 1, title: `TP ${this.money(b.pnlAt(p, p.tp))}` });
    }
    for (const o of b.orders) {
      if (o.type === 'next') continue;
      const name = `${o.side === 'buy' ? 'BUY' : 'SELL'} ${o.type === 'limit' ? 'LIMIT' : 'STOP'} ${o.qty}`;
      out.push({ key: `o${o.id}:price`, kind: 'ord', id: o.id, field: 'price', price: o.price, color: C.order, style: 0, width: 1, title: name });
      const ghost = { side: o.side, entryPrice: o.price, qty: o.qty };
      if (o.sl != null) out.push({ key: `o${o.id}:sl`, kind: 'ord', id: o.id, field: 'sl', price: o.sl, color: C.sl, style: 1, width: 1, title: `SL ${this.money(b.pnlAt(ghost, o.sl))}` });
      if (o.tp != null) out.push({ key: `o${o.id}:tp`, kind: 'ord', id: o.id, field: 'tp', price: o.tp, color: C.tp, style: 1, width: 1, title: `TP ${this.money(b.pnlAt(ghost, o.tp))}` });
    }
    return out;
  }

  sync() {
    const specs = this._specs();
    const seen = new Set();
    for (const s of specs) {
      if (this.dragging && this.dragging.key === s.key) { seen.add(s.key); continue; }
      seen.add(s.key);
      const opts = { price: s.price, color: s.color, lineStyle: s.style, lineWidth: s.width, axisLabelVisible: true, title: s.title, lineVisible: true };
      const cur = this.lines.get(s.key);
      if (cur) cur.line.applyOptions(opts);
      else this.lines.set(s.key, { line: this.tc.candles.createPriceLine(opts), spec: s });
      this.lines.get(s.key).spec = s;
    }
    for (const [key, v] of this.lines) {
      if (!seen.has(key)) { this.tc.candles.removePriceLine(v.line); this.lines.delete(key); }
    }
  }

  clear() {
    for (const v of this.lines.values()) this.tc.candles.removePriceLine(v.line);
    this.lines.clear();
  }

  _near(x, y) {
    if (x > this.tc.paneWidth()) return null;
    let best = null;
    for (const v of this.lines.values()) {
      if (!v.spec.kind) continue;
      const ly = this.tc.yOf(v.spec.price);
      if (ly == null) continue;
      const d = Math.abs(ly - y);
      if (d <= 5 && (!best || d < best.d)) best = { d, v };
    }
    return best ? best.v : null;
  }

  /** DrawingManager interceptor. */
  interceptor() {
    return {
      hover: (x, y) => (this._near(x, y) ? 'ns-resize' : null),
      start: (x, y) => {
        const v = this._near(x, y);
        if (!v) return null;
        const b = this.getBroker();
        const spec = v.spec;
        this.dragging = spec;
        this.onDragStart?.();
        return {
          move: (_, my) => {
            const price = this.tc.priceAt(my);
            if (price == null) return;
            spec.price = price;
            let title = spec.title;
            if (spec.kind === 'pos' && b) {
              const pos = b.positions.find((p) => p.id === spec.id);
              if (pos) title = `${spec.field.toUpperCase()} ${this.money(b.pnlAt(pos, price))}`;
            }
            v.line.applyOptions({ price, title });
          },
          end: () => {
            this.dragging = null;
            this.onModify(spec.kind, spec.id, spec.field, spec.price);
            this.sync();
          },
        };
      },
    };
  }
}
