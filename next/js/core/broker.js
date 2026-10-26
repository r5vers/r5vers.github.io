// Simulated broker: market / limit / stop orders, SL / TP, spread, commission.
//
// Chart prices are BID (like MetaTrader); ask = bid + spread. Longs open at the
// ask and close at the bid, shorts the other way round, so a long's SL / TP
// trigger on the bid and a short's on the ask.
//
// Each bar is walked open -> first extreme -> second extreme -> close. The
// extreme nearer the open is assumed to come first (TradingView's rule). A
// level crossed by a gap at the open fills at the open, not at the level.

const EPS = 1e-10;

export const DEFAULTS = {
  balance: 10000,
  currency: 'USD',
  contractSize: 100000,
  pipSize: 0.0001,
  decimals: 5,
  spread: 0, // in price units
  commission: 0, // per lot per side, account currency
  quoteConv: 'none', // 'divide': P&L is in the quote ccy, divide by price (USDJPY...)
  lotStep: 0.01,
  sameBar: 'path', // 'path' | 'worst' (when SL and TP both fit in one bar, SL first)
};

const round = (x, step) => Math.round(x / step) * step;

export function lotsForRisk({ balance, riskPct, entry, sl, contractSize, quoteConv = 'none', lotStep = 0.01 }) {
  const dist = Math.abs(entry - sl);
  if (!(dist > 0) || !(riskPct > 0) || !(balance > 0)) return 0;
  const perLot = dist * contractSize / (quoteConv === 'divide' ? entry : 1);
  const lots = Math.floor((balance * riskPct / 100) / perLot / lotStep + 1e-9) * lotStep;
  return Math.max(0, Number(lots.toFixed(6)));
}

/** One account for several brokers (a replay session with more than one
 *  market): one balance, and the equity counts every market's open trades. */
export function shareAccount(brokers, balance = brokers[0]?.balance) {
  const account = { balance, peers: brokers.length > 1 ? brokers : null };
  for (const b of brokers) b.account = account;
  return account;
}

export class Broker {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.account = { balance: this.cfg.balance, peers: null };
    this.orders = [];
    this.positions = [];
    this.trades = [];
    this.seq = 1;
    this.last = null; // last processed bar {t,o,h,l,c}
    this.peakEquity = this.balance;
    this.maxDrawdown = 0;
    this.maxDrawdownPct = 0;
    this.equityCurve = [];
    this.closeQueue = []; // position ids to close at the next bar open
  }

  // ── prices & money ─────────────────────────────────────────────────────
  get balance() { return this.account.balance; }
  set balance(v) { this.account.balance = v; }
  get time() { return this.last ? this.last.t : null; }
  bid() { return this.last ? this.last.c : null; }
  ask() { return this.last ? this.last.c + this.cfg.spread : null; }
  units(qty) { return qty * this.cfg.contractSize; }

  toAccount(quoteAmount, price) {
    return this.cfg.quoteConv === 'divide' ? quoteAmount / price : quoteAmount;
  }

  /** Gross P&L (account ccy) of `qty` lots of a position exited at `exitPrice`. */
  pnlAt(pos, exitPrice, qty = pos.qty) {
    const diff = pos.side === 'buy' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    return this.toAccount(diff * this.units(qty), exitPrice);
  }

  /** Price a position would close at right now. */
  exitPrice(pos) { return pos.side === 'buy' ? this.bid() : this.ask(); }

  unrealized(pos) {
    if (!this.last) return 0;
    return this.pnlAt(pos, this.exitPrice(pos));
  }

  /** Unrealised P&L of this broker's own positions. */
  openPnl() {
    return this.positions.reduce((s, p) => s + this.unrealized(p), 0);
  }

  equity() {
    const peers = this.account.peers;
    return this.balance + (peers ? peers.reduce((s, b) => s + b.openPnl(), 0) : this.openPnl());
  }

  riskAmount(side, entry, sl, qty) {
    if (sl == null) return null;
    const dist = side === 'buy' ? entry - sl : sl - entry;
    return this.toAccount(dist * this.units(qty), entry);
  }

  pips(diff) { return diff / this.cfg.pipSize; }

  // ── validation ─────────────────────────────────────────────────────────
  _checkStops(side, ref, sl, tp) {
    if (sl != null && !(side === 'buy' ? sl < ref : sl > ref)) {
      return side === 'buy' ? 'SL giriş fiyatının altında olmalı' : 'SL giriş fiyatının üstünde olmalı';
    }
    if (tp != null && !(side === 'buy' ? tp > ref : tp < ref)) {
      return side === 'buy' ? 'TP giriş fiyatının üstünde olmalı' : 'TP giriş fiyatının altında olmalı';
    }
    return null;
  }

  _num(x) {
    if (x === '' || x == null) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  }

  // ── orders ─────────────────────────────────────────────────────────────
  /**
   * Place an order. type: 'market' fills now at the current bid/ask,
   * 'next' fills at the next bar's open (strategies), 'limit' / 'stop' wait.
   * Returns { ok, error?, order?, position? }.
   */
  placeOrder({ side, type = 'market', qty, price = null, sl = null, tp = null, comment = '', tag = '', autoRisk = null }) {
    if (side !== 'buy' && side !== 'sell') return { ok: false, error: 'yön buy ya da sell olmalı' };
    qty = Number(qty);
    if (!(qty > 0)) return { ok: false, error: 'lot sıfırdan büyük olmalı' };
    qty = Number(round(qty, this.cfg.lotStep).toFixed(6));
    if (!(qty > 0)) return { ok: false, error: `en küçük lot ${this.cfg.lotStep}` };
    sl = this._num(sl);
    tp = this._num(tp);
    price = this._num(price);
    if (Number.isNaN(sl) || Number.isNaN(tp) || Number.isNaN(price)) return { ok: false, error: 'geçersiz fiyat' };
    if (!this.last) return { ok: false, error: 'henüz fiyat yok' };

    if (type === 'market') {
      const entry = side === 'buy' ? this.ask() : this.bid();
      const err = this._checkStops(side, entry, sl, tp);
      if (err) return { ok: false, error: err };
      const position = this._open({ side, qty, entry, sl, tp, comment, tag, orderId: null, time: this.last.t, autoRisk });
      return { ok: true, position };
    }
    if (type === 'next') {
      const order = { id: this.seq++, side, type, qty, price: null, sl, tp, comment, tag, created: this.last.t };
      this.orders.push(order);
      return { ok: true, order };
    }
    if (type !== 'limit' && type !== 'stop') return { ok: false, error: `bilinmeyen emir tipi ${type}` };
    if (price == null || !(price > 0)) return { ok: false, error: 'emir fiyatı gerekli' };
    const ref = side === 'buy' ? this.ask() : this.bid();
    const below = price < ref;
    if (type === 'limit' && (side === 'buy' ? !below : below)) {
      return { ok: false, error: side === 'buy' ? 'Buy limit fiyatı ask altında olmalı (üstü için Buy stop)' : 'Sell limit fiyatı bid üstünde olmalı (altı için Sell stop)' };
    }
    if (type === 'stop' && (side === 'buy' ? below : !below)) {
      return { ok: false, error: side === 'buy' ? 'Buy stop fiyatı ask üstünde olmalı (altı için Buy limit)' : 'Sell stop fiyatı bid altında olmalı (üstü için Sell limit)' };
    }
    const err = this._checkStops(side, price, sl, tp);
    if (err) return { ok: false, error: err };
    const order = { id: this.seq++, side, type, qty, price, sl, tp, comment, tag, created: this.last.t, ...(autoRisk ? { autoRisk } : {}) };
    this.orders.push(order);
    return { ok: true, order };
  }

  cancelOrder(id) {
    const i = this.orders.findIndex((o) => o.id === id);
    if (i < 0) return { ok: false, error: 'emir bulunamadı' };
    const [order] = this.orders.splice(i, 1);
    return { ok: true, order };
  }

  cancelAll() { const n = this.orders.length; this.orders = []; return n; }

  modifyOrder(id, { price, sl, tp, qty } = {}) {
    const order = this.orders.find((o) => o.id === id);
    if (!order) return { ok: false, error: 'emir bulunamadı' };
    const next = { ...order };
    if (price !== undefined) next.price = this._num(price);
    if (sl !== undefined) next.sl = this._num(sl);
    if (tp !== undefined) next.tp = this._num(tp);
    if ([next.price, next.sl, next.tp].some((x) => Number.isNaN(x))) return { ok: false, error: 'geçersiz fiyat' };
    if (qty !== undefined) {
      next.qty = Number(round(Number(qty), this.cfg.lotStep).toFixed(6));
      if (!(next.qty > 0)) return { ok: false, error: `en küçük lot ${this.cfg.lotStep}` };
    }
    if (order.type === 'limit' || order.type === 'stop') {
      const ref = order.side === 'buy' ? this.ask() : this.bid();
      const below = next.price < ref;
      const wantBelow = (order.type === 'limit') === (order.side === 'buy');
      if (below !== wantBelow) return { ok: false, error: 'bu fiyat emri hemen tetikler; emir tipini değiştirin' };
      const err = this._checkStops(order.side, next.price, next.sl, next.tp);
      if (err) return { ok: false, error: err };
    }
    Object.assign(order, next);
    return { ok: true, order };
  }

  modifyPosition(id, { sl, tp } = {}) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return { ok: false, error: 'pozisyon bulunamadı' };
    const nsl = sl !== undefined ? this._num(sl) : pos.sl;
    const ntp = tp !== undefined ? this._num(tp) : pos.tp;
    if (Number.isNaN(nsl) || Number.isNaN(ntp)) return { ok: false, error: 'geçersiz fiyat' };
    const ref = this.exitPrice(pos);
    const err = this._checkStops(pos.side, ref, nsl, ntp);
    if (err) return { ok: false, error: err.replace('giriş fiyatının', 'güncel fiyatın') };
    pos.sl = nsl;
    pos.tp = ntp;
    if (pos.initialSl == null && nsl != null) {
      pos.initialSl = nsl;
      pos.initialRisk = this.riskAmount(pos.side, pos.entryPrice, nsl, pos.qty);
    }
    return { ok: true, position: pos };
  }

  /** A new size for an open position, as if it had gone in with it: the
   *  lot follows the risk once the stop is placed (FX Replay's sizing). Not
   *  for a position already partly closed. */
  resizePosition(id, qty) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return { ok: false, error: 'pozisyon bulunamadı' };
    qty = Number(round(Number(qty), this.cfg.lotStep).toFixed(6));
    if (!(qty > 0)) return { ok: false, error: `en küçük lot ${this.cfg.lotStep}` };
    if (Math.abs(pos.qty - pos.initialQty) > 1e-9) return { ok: false, error: 'kısmen kapanmış pozisyonun lotu değişmez' };
    const commission = this.cfg.commission * qty;
    this.balance += pos.commission - commission;
    Object.assign(pos, { qty, initialQty: qty, commission, initialRisk: this.riskAmount(pos.side, pos.entryPrice, pos.initialSl, qty) });
    return { ok: true, position: pos };
  }

  /** Close (part of) a position at the current price. */
  closePosition(id, { fraction = 1, reason = 'manual' } = {}) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return { ok: false, error: 'pozisyon bulunamadı' };
    const trade = this._close(pos, this.exitPrice(pos), this.last.t, reason, fraction);
    return { ok: true, trade };
  }

  closeAll(reason = 'manual') {
    return [...this.positions].map((p) => this._close(p, this.exitPrice(p), this.last.t, reason, 1));
  }

  /** Strategies: close at the next bar's open. */
  queueClose(id) { if (!this.closeQueue.includes(id)) this.closeQueue.push(id); }

  // ── internals ──────────────────────────────────────────────────────────
  _open({ side, qty, entry, sl, tp, comment, tag, orderId, time, autoRisk = null }) {
    const commission = this.cfg.commission * qty;
    this.balance -= commission;
    const pos = {
      id: this.seq++, side, qty, entryPrice: entry, entryTime: time, sl, tp,
      initialSl: sl, initialRisk: this.riskAmount(side, entry, sl, qty), initialQty: qty,
      commission, comment, tag, orderId, best: entry, worst: entry,
      // the lot follows a % risk once the stop is placed (the trader's sizing)
      ...(autoRisk ? { autoRisk } : {}),
    };
    this.positions.push(pos);
    this._event({ type: 'open', position: pos });
    return pos;
  }

  _close(pos, price, time, reason, fraction = 1) {
    const qty = fraction >= 1 ? pos.qty : Number(round(pos.qty * fraction, this.cfg.lotStep).toFixed(6));
    if (!(qty > 0)) return null;
    const full = qty >= pos.qty - 1e-9;
    const share = full ? 1 : qty / pos.qty;
    const gross = this.pnlAt(pos, price, qty);
    const closeComm = this.cfg.commission * qty;
    const openComm = pos.commission * share;
    this.balance += gross - closeComm;
    const net = gross - closeComm - openComm;
    const risk = pos.initialRisk != null && pos.initialRisk > 0 ? pos.initialRisk * (qty / pos.initialQty) : null;
    const dir = pos.side === 'buy' ? 1 : -1;
    const trade = {
      id: this.trades.length + 1, positionId: pos.id, side: pos.side, qty,
      entryTime: pos.entryTime, entryPrice: pos.entryPrice, exitTime: time, exitPrice: price,
      sl: pos.initialSl, tp: pos.tp, gross, commission: closeComm + openComm, pnl: net,
      pips: this.pips((price - pos.entryPrice) * dir),
      r: risk ? net / risk : null,
      mfe: this.pips((pos.best - pos.entryPrice) * dir),
      mae: this.pips((pos.worst - pos.entryPrice) * dir),
      reason: full ? reason : (reason === 'manual' ? 'partial' : reason),
      comment: pos.comment, tag: pos.tag, note: '',
    };
    this.trades.push(trade);
    if (full) {
      this.positions = this.positions.filter((p) => p !== pos);
    } else {
      pos.qty = Number((pos.qty - qty).toFixed(6));
      pos.commission -= openComm;
    }
    this.equityCurve.push({ t: time, balance: this.balance });
    this._event({ type: 'close', trade, position: pos });
    return trade;
  }

  _event(e) { (this._events || (this._events = [])).push(e); }

  /** Trigger points in bid space for everything that is waiting on price. */
  _triggers() {
    const s = this.cfg.spread;
    const out = [];
    for (const o of this.orders) {
      if (o.type === 'next') continue;
      // buy orders trigger on the ask (= bid + spread)
      const level = o.side === 'buy' ? o.price - s : o.price;
      const up = (o.type === 'stop') === (o.side === 'buy');
      out.push({ kind: 'order', item: o, level, up });
    }
    for (const p of this.positions) {
      const adj = p.side === 'sell' ? s : 0; // shorts close on the ask
      if (p.sl != null) out.push({ kind: 'sl', item: p, level: p.sl - adj, up: p.side === 'sell' });
      if (p.tp != null) out.push({ kind: 'tp', item: p, level: p.tp - adj, up: p.side === 'buy' });
    }
    return out;
  }

  _fire(trg, bid, gap, time) {
    const s = this.cfg.spread;
    if (trg.kind === 'order') {
      const o = trg.item;
      this.orders = this.orders.filter((x) => x !== o);
      const entry = gap ? (o.side === 'buy' ? bid + s : bid) : o.price;
      // A gap can open the position beyond its own SL / TP; the sweep that
      // follows then closes it at the same open, as a real broker would.
      this._open({ side: o.side, qty: o.qty, entry, sl: o.sl, tp: o.tp, comment: o.comment, tag: o.tag, orderId: o.id, time, autoRisk: o.autoRisk });
      return;
    }
    const p = trg.item;
    const natural = trg.kind === 'sl' ? p.sl : p.tp;
    const exit = gap ? (p.side === 'sell' ? bid + s : bid) : natural;
    this._close(p, exit, time, trg.kind, 1);
  }

  _satisfied(trg, bid) {
    return trg.up ? bid >= trg.level - EPS : bid <= trg.level + EPS;
  }

  /** Fire everything already satisfied at `bid`. */
  _sweep(bid, gap, time) {
    for (let guard = 0; guard < 10000; guard++) {
      const due = this._triggers().filter((t) => this._satisfied(t, bid));
      if (!due.length) return;
      // exits before entries, and a worst-case SL before TP
      due.sort((a, b) => (a.kind === 'order') - (b.kind === 'order') || (a.kind === 'tp') - (b.kind === 'tp'));
      this._fire(due[0], bid, gap, time);
    }
  }

  _walk(from, to, time) {
    let cur = from;
    for (let guard = 0; guard < 10000; guard++) {
      const up = to > cur;
      let best = null;
      for (const trg of this._triggers()) {
        if (trg.up !== up) continue;
        const inside = up ? trg.level > cur + EPS && trg.level <= to + EPS : trg.level < cur - EPS && trg.level >= to - EPS;
        if (inside && (!best || Math.abs(trg.level - cur) < Math.abs(best.level - cur))) best = trg;
      }
      this._track(cur);
      if (!best) { this._track(to); return; }
      cur = best.level;
      this._sweep(cur, false, time);
    }
  }

  _track(bid) {
    const s = this.cfg.spread;
    for (const p of this.positions) {
      const px = p.side === 'buy' ? bid : bid + s;
      if (p.side === 'buy') { p.best = Math.max(p.best, px); p.worst = Math.min(p.worst, px); } else { p.best = Math.min(p.best, px); p.worst = Math.max(p.worst, px); }
    }
  }

  /**
   * Advance the simulation by one bar {t, o, h, l, c}. Returns the events
   * (opens / closes) that happened inside it.
   */
  onBar(bar) {
    this._events = [];
    const { t, o, h, l, c } = bar;
    if (this.last) {
      // queued strategy actions execute at the open
      for (const id of this.closeQueue) {
        const p = this.positions.find((x) => x.id === id);
        if (p) this._close(p, p.side === 'buy' ? o : o + this.cfg.spread, t, 'strategy', 1);
      }
      this.closeQueue = [];
      for (const ord of this.orders.filter((x) => x.type === 'next')) {
        this.orders = this.orders.filter((x) => x !== ord);
        const entry = ord.side === 'buy' ? o + this.cfg.spread : o;
        this._open({ side: ord.side, qty: ord.qty, entry, sl: ord.sl, tp: ord.tp, comment: ord.comment, tag: ord.tag, orderId: ord.id, time: t });
      }
      this._sweep(o, true, t);
      let path;
      if (this.cfg.sameBar === 'worst' && this.positions.length) {
        // pessimistic: move against the (first) open position first
        path = this.positions[0].side === 'buy' ? [o, l, h, c] : [o, h, l, c];
      } else {
        path = Math.abs(h - o) < Math.abs(o - l) ? [o, h, l, c] : [o, l, h, c];
      }
      for (let i = 0; i < 3; i++) this._walk(path[i], path[i + 1], t);
    }
    this.last = { t, o, h, l, c };
    const eq = this.equity();
    if (eq > this.peakEquity) this.peakEquity = eq;
    const dd = this.peakEquity - eq;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;
    const ddPct = this.peakEquity > 0 ? dd / this.peakEquity : 0;
    if (ddPct > this.maxDrawdownPct) this.maxDrawdownPct = ddPct;
    return this._events;
  }

  // ── persistence ────────────────────────────────────────────────────────
  toJSON() {
    return {
      cfg: this.cfg, balance: this.balance, orders: this.orders, positions: this.positions,
      trades: this.trades, seq: this.seq, last: this.last, peakEquity: this.peakEquity,
      maxDrawdown: this.maxDrawdown, maxDrawdownPct: this.maxDrawdownPct,
      equityCurve: this.equityCurve, closeQueue: this.closeQueue,
    };
  }

  static fromJSON(obj) {
    const b = new Broker(obj.cfg);
    Object.assign(b, {
      balance: obj.balance, orders: obj.orders || [], positions: obj.positions || [],
      trades: obj.trades || [], seq: obj.seq || 1, last: obj.last || null,
      peakEquity: obj.peakEquity ?? obj.balance, maxDrawdown: obj.maxDrawdown || 0,
      maxDrawdownPct: obj.maxDrawdownPct || 0, equityCurve: obj.equityCurve || [],
      closeQueue: obj.closeQueue || [],
    });
    return b;
  }
}
