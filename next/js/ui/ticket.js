// Order ticket + account summary (right side panel).
import { lotsForRisk } from '../core/broker.js?v=1039d95bd6';
import * as F from '../format.js?v=1039d95bd6';
import { h, icon } from './dom.js?v=1039d95bd6';

export class Ticket {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.mode = 'market';
    this.pendingPrice = null;
  }

  get t() { return this.app.settings.ticket; }
  get ds() { return this.app.ds; }

  _save() { this.app.saveSettings(); }

  _closeButton() {
    return h('button.btn.small.mobile-only', { style: { justifySelf: 'end' }, onclick: () => this.el.classList.remove('show') }, icon('close', 14), 'Kapat');
  }

  render() {
    const app = this.app;
    this.el.innerHTML = '';
    this.el.append(this._closeButton());
    if (app.mode === 'live') {
      this.livePrice = h('div.live-price.mono', {}, '—');
      this.liveChange = h('div.muted', { style: { fontSize: '12px' } }, '');
      this.el.append(h('div.card', {},
        h('h3', {}, 'Canlı', h('span.badge.live', {}, app.ds.symbol)),
        this.livePrice, this.liveChange,
        h('p.notice', { style: { marginTop: '10px' } }, 'Canlı grafik izleme içindir. Bu sembolde işlem pratiği yapmak için geçmişini indirip o günlerden replay başlatın.'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } },
          h('button.btn.primary', { onclick: () => app.downloadLiveHistory() }, icon('download', 15), 'Son 10 yılı indir (replay için)'),
          h('button.btn.outline', { onclick: () => app.exitLive() }, 'Canlıdan çık'))));
      this.update();
      return;
    }
    if (app.mode !== 'replay') {
      this.el.append(h('div.card', {},
        h('h3', {}, 'İşlem paneli'),
        h('p.notice', {}, 'Emir vermek için geçmişte bir noktadan replay başlatın. Grafik o andan sonrasını göstermez; barlar siz ilerlettikçe gelir.'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } },
          h('button.btn.primary', { onclick: () => app.newSessionDialog() }, icon('replay'), 'Replay başlat'),
          h('button.btn.outline', { onclick: () => app.pickReplayStart() }, icon('scissors'), 'Grafikten başlangıç seç'),
          h('button.btn.outline', { onclick: () => app.sessionsDialog() }, 'Kayıtlı oturum aç')),
        h('p.muted', { style: { fontSize: '11px', marginTop: '10px' } },
          'Kısayollar: ', h('kbd', {}, 'Space'), ' oynat/duraklat, ', h('kbd', {}, '→'), ' ilerle, ', h('kbd', {}, 'Shift+→'), ' bir grafik barı, ',
          h('kbd', {}, 'Shift+B'), ' / ', h('kbd', {}, 'Shift+S'), ' al / sat.')));
      this.el.append(this._helpCard());
      return;
    }
    this.el.append(this._orderCard(), this._accountCard(), this._sessionCard());
    this.update();
  }

  _helpCard() {
    return h('div.card', {},
      h('h3', {}, 'Nasıl çalışır'),
      h('ol', { style: { margin: 0, paddingLeft: '18px', color: 'var(--muted)', fontSize: '12px', display: 'grid', gap: '4px' } },
        h('li', {}, 'Alttaki “Veri” sekmesinden CSV yükleyin ya da OANDA / Binance / Yahoo’dan indirin.'),
        h('li', {}, 'Replay başlatıp tarihi seçin; ilerledikçe 1m veriden üst zaman dilimleri oluşur.'),
        h('li', {}, 'Emir verin, SL/TP çizgilerini grafikte sürükleyin, notlar alın.'),
        h('li', {}, '“İstatistik” sekmesinde sonuçlarınızı, “Strateji Testi”nde otomatik testleri görün.')));
  }

  _seg(options, value, onPick) {
    return h('div.seg', {}, options.map(([v, label]) => h(`button${v === value ? '.on' : ''}`, { onclick: () => onPick(v) }, label)));
  }

  _orderCard() {
    const t = this.t;
    this.sellBtn = h('button.sell', { onclick: () => this.submit('sell') }, h('small', {}, 'SAT'), h('span', {}, '—'));
    this.buyBtn = h('button.buy', { onclick: () => this.submit('buy') }, h('small', {}, 'AL'), h('span', {}, '—'));
    this.spreadEl = h('div.spread', {}, '—');

    const priceInput = h('input.ctl.sm.mono', { type: 'text', inputmode: 'decimal', placeholder: 'fiyat', value: this.pendingPrice ?? '', oninput: (e) => { this.pendingPrice = F.parseNumber(e.target.value); this.update(); } });
    this.priceInput = priceInput;
    const pick = h('button.btn.icon.small.outline', { title: 'Grafikten fiyat seç', onclick: () => this.app.pickPrice((p) => { this.pendingPrice = Number(p.toFixed(this.ds.decimals)); priceInput.value = this.pendingPrice; this.update(); }) }, icon('target', 15));

    const num = (key, step, onChange) => h('input.ctl.sm.mono', { type: 'number', step, min: 0, value: t[key], oninput: (e) => { t[key] = Number(e.target.value); this._save(); onChange?.(); this.update(); } });
    const check = (key) => h('input', { type: 'checkbox', checked: !!t[key], onchange: (e) => { t[key] = e.target.checked; this._save(); if (key === 'slOn') this.render(); else this.update(); } });

    this.sizeHint = h('span.hint', {}, '');
    this.slHint = h('div.hint', { style: { gridColumn: '2' } }, '');
    this.tpHint = h('div.hint', { style: { gridColumn: '2' } }, '');

    return h('div.card', {},
      h('h3', {}, 'Emir', h('span.badge', {}, this.ds.symbol)),
      h('div.quote', {}, this.sellBtn, this.spreadEl, this.buyBtn),
      h('div', { style: { marginTop: '8px' } }, this._seg([['market', 'Piyasa'], ['pending', 'Bekleyen']], this.mode, (v) => { this.mode = v; this.render(); })),
      this.mode === 'pending' ? h('div.field', {}, h('label', {}, 'Fiyat'), h('div.inline', {}, priceInput, pick)) : null,
      h('div.field', {}, h('label', {}, 'Miktar'),
        h('div.inline', {},
          this._seg([['lots', 'Lot'], ['risk', '% Risk']], t.sizeMode, (v) => { t.sizeMode = v; this._save(); this.render(); }),
          t.sizeMode === 'lots' ? num('lots', 0.01) : num('riskPct', 0.1))),
      h('div.field', {}, h('span'), this.sizeHint),
      h('div.field', {}, h('label', {}, check('slOn'), 'SL pip'), h('div.inline', {}, num('slPips', 0.1))),
      this.slHint,
      h('div.field', {}, h('label', {}, check('tpOn'), 'TP pip'), h('div.inline', {}, num('tpPips', 0.1))),
      this.tpHint,
      // what the order means before it goes in (as MT5's calculator)
      (this.calc = h('div.calc', {})),
      h('p.muted', { style: { fontSize: '11px', margin: '8px 0 0' } }, 'SL/TP çizgilerini grafikte sürükleyerek değiştirebilirsiniz.'));
  }

  _accountCard() {
    this.acct = h('dl.kv', {});
    return h('div.card', {}, h('h3', {}, 'Hesap'), this.acct);
  }

  _sessionCard() {
    const s = this.app.session;
    const notes = h('textarea.ctl', { rows: 4, style: { width: '100%', resize: 'vertical' }, placeholder: 'Oturum notları, plan, gözlemler…', oninput: (e) => { s.notes = e.target.value; this.app.markDirty(); } });
    notes.value = s.notes || '';
    this.sessInfo = h('dl.kv', {});
    return h('div.card', {}, h('h3', {}, 'Oturum'), this.sessInfo, h('div', { style: { marginTop: '8px' } }, notes));
  }

  /** Entry, SL, TP and lots the ticket would send for `side`. */
  plan(side) {
    const b = this.app.broker;
    const t = this.t;
    const pip = this.ds.pip_size;
    let entry = side === 'buy' ? b.ask() : b.bid();
    let type = 'market';
    if (this.mode === 'pending') {
      const p = this.pendingPrice;
      if (!(p > 0)) return { error: 'Bekleyen emir için fiyat girin' };
      entry = p;
      const ref = side === 'buy' ? b.ask() : b.bid();
      type = (side === 'buy') === (p < ref) ? 'limit' : 'stop';
    }
    const dir = side === 'buy' ? 1 : -1;
    const sl = t.slOn && t.slPips > 0 ? entry - dir * t.slPips * pip : null;
    const tp = t.tpOn && t.tpPips > 0 ? entry + dir * t.tpPips * pip : null;
    const step = b.cfg.lotStep || 0.01;
    const maxLots = b.cfg.maxLots || 100;
    let qty = t.lots;
    let note = null;
    if (t.sizeMode === 'risk') {
      if (sl == null) {
        note = `Al / Sat taslak açar: SL’yi grafikte sürükleyip koy, lot %${F.num(t.riskPct, 2)} riske göre hesaplanır, sonra onayla`;
      } else {
        qty = lotsForRisk({ balance: b.balance, riskPct: t.riskPct, entry, sl, contractSize: b.cfg.contractSize, quoteConv: b.cfg.quoteConv, lotStep: step });
        // a very tight stop would ask for an absurd size: keep it sane
        if (qty > maxLots) { qty = maxLots; note = `Lot üst sınırda (${maxLots}); risk %${F.num(t.riskPct, 1)}'in altında kalır`; }
        if (!(qty > 0)) { qty = step; note = `Risk çok küçük: en küçük lot (${step}) kullanılır`; }
        if (!note && Math.abs(entry - sl) < b.cfg.spread * 2) note = 'SL spread’e çok yakın: lot çok büyük çıkar, SL’yi genişletin';
      }
    }
    if (!(qty > 0)) return { error: 'Lot girin', entry, type };
    return { side, type, entry, sl, tp, qty: Number(qty.toFixed(6)), note };
  }

  submit(side) {
    const p = this.plan(side);
    if (p.error) { this.app.toast(p.error, 'err'); return; }
    // every order starts as a draft on the chart (the SL / TP pips, when
    // ticked, place its stops): the trader checks it and confirms
    this.app.startDraft(side, p.type === 'market' ? {} : { type: 'pending', price: p.entry });
  }

  update() {
    const app = this.app;
    if (app.mode === 'live' && this.livePrice) {
      const bars = app.chart.bars;
      const last = bars[bars.length - 1];
      if (!last) return;
      // change against the previous daily-ish reference: the first visible bar of today
      const dayStart = Math.floor(last.time / 86400) * 86400;
      const ref = bars.find((b) => b.time >= dayStart) || bars[0];
      const ch = last.close - ref.open;
      this.livePrice.textContent = F.price(last.close, app.ds.decimals);
      this.livePrice.className = `live-price mono ${ch >= 0 ? 'up' : 'down'}`;
      this.liveChange.textContent = `Bugün ${ch >= 0 ? '+' : ''}${F.price(ch, app.ds.decimals)} (${F.pct(ch / ref.open, 2)}) · Y ${F.price(Math.max(...bars.filter((b) => b.time >= dayStart).map((b) => b.high), last.high), app.ds.decimals)} · D ${F.price(Math.min(...bars.filter((b) => b.time >= dayStart).map((b) => b.low), last.low), app.ds.decimals)}`;
      return;
    }
    const b = app.broker;
    if (app.mode !== 'replay' || !b || !this.buyBtn) return;
    const dec = this.ds.decimals;
    const ccy = b.cfg.currency;
    const bid = b.bid(), ask = b.ask();
    for (const [btn, side, px] of [[this.sellBtn, 'sell', bid], [this.buyBtn, 'buy', ask]]) {
      const plan = this.plan(side);
      const label = side === 'buy' ? 'AL' : 'SAT';
      const kind = this.mode === 'market' ? '' : plan.type === 'limit' ? ' LİMİT' : plan.type === 'stop' ? ' STOP' : '';
      btn.firstChild.textContent = `${label}${kind}${plan.qty ? ` ${plan.qty}` : ''}`;
      btn.lastChild.textContent = F.price(this.mode === 'market' ? px : plan.entry, dec);
      btn.disabled = app.engine?.atEnd ?? false;
    }
    this.spreadEl.textContent = `${F.num(b.cfg.spread / this.ds.pip_size, 1)}\npip`;

    const buy = this.plan('buy'), sell = this.plan('sell');
    const t = this.t;
    if (buy.note) this.sizeHint.textContent = buy.note;
    else if (buy.error) this.sizeHint.textContent = buy.error;
    else if (t.sizeMode === 'risk') this.sizeHint.textContent = `≈ ${F.num(buy.qty, 2)} lot · %${F.num(t.riskPct, 2)} risk`;
    else this.sizeHint.textContent = buy.sl != null ? `${F.num(buy.qty, 2)} lot` : 'SL yok: risk sınırsız';
    this.sizeHint.classList.toggle('warn', !!buy.note);
    // the calculator: lot, risk and reward in money and in % of the balance
    if (this.calc) {
      const cell = (k, v, c = '') => h('div.calc-cell', {}, h('span.k', {}, k), h(`span.v${c ? `.${c}` : ''}`, {}, v));
      // a draft on the chart: the panel shows what confirming it does
      const dp = app.draft ? app._draftPlan() : null;
      if (dp) {
        const pct = (x) => F.pct(x / b.balance, 2);
        this.calc.replaceChildren(
          cell('Taslak', `${dp.side === 'buy' ? 'Al' : 'Sat'} · ${({ market: 'piyasa', limit: 'limit', stop: 'stop' })[dp.type]}`),
          cell('Lot', dp.qty ? F.num(dp.qty, 2) : '—'),
          cell('Risk', dp.risk != null ? `${F.money(dp.risk, ccy)} · ${pct(dp.risk)}` : '—', 'down'),
          cell('Kazanç', dp.reward != null ? `${F.money(dp.reward, ccy)} · ${pct(dp.reward)}` : '—', 'up'),
          cell('R:R', dp.r != null ? `1 : ${F.num(dp.r, 2)}` : '—'),
          cell('Durum', dp.ok ? 'onaya hazır' : dp.why, dp.ok ? 'up' : ''));
        this.sizeHint.textContent = dp.ok ? 'Taslak hazır: grafikteki çubuktan onayla (Enter)' : `Taslak: ${dp.why}`;
      } else if (!buy.qty) { this.calc.replaceChildren(); } else {
        const risk = buy.sl != null ? b.riskAmount('buy', buy.entry, buy.sl, buy.qty) : null;
        const reward = buy.tp != null ? b.toAccount((buy.tp - buy.entry) * b.units(buy.qty), buy.entry) : null;
        const pipValue = b.toAccount(this.ds.pip_size * b.units(buy.qty), buy.entry);
        const pct = (x) => F.pct(x / b.balance, 2);
        this.calc.replaceChildren(
          cell('Lot', F.num(buy.qty, 2)),
          cell('Pip değeri', F.money(pipValue, ccy)),
          cell('Risk', risk != null ? `${F.money(risk, ccy)} · ${pct(risk)}` : 'sınırsız', 'down'),
          cell('Kazanç', reward != null ? `${F.money(reward, ccy)} · ${pct(reward)}` : '—', 'up'),
          cell('R:R', risk && reward ? `1 : ${F.num(reward / risk, 2)}` : '—'),
          cell('Bakiye sonrası', risk != null ? `${F.money(b.balance - risk, ccy)} / ${reward != null ? F.money(b.balance + reward, ccy) : '—'}` : '—'));
      }
    }
    this.slHint.textContent = t.slOn ? `AL ${F.price(buy.sl, dec)} · SAT ${F.price(sell.sl, dec)}` : '';
    const rr = t.slOn && t.tpOn && t.slPips > 0 ? ` · R:R ${(t.tpPips / t.slPips).toFixed(2)}` : '';
    this.tpHint.textContent = t.tpOn ? `AL ${F.price(buy.tp, dec)} · SAT ${F.price(sell.tp, dec)}${rr}` : '';

    const open = b.positions.reduce((s, p) => s + b.unrealized(p), 0);
    const init = b.cfg.balance;
    const closed = b.trades.reduce((s, x) => s + x.pnl, 0);
    const wins = b.trades.filter((x) => x.pnl > 0).length;
    const row = (k, v, c = '') => [h('dt', {}, k), h(`dd${c ? `.${c}` : ''}`, {}, v)];
    this.acct.replaceChildren(
      ...row('Bakiye', F.money(b.balance, ccy)),
      ...row('Varlık (equity)', F.money(b.equity(), ccy)),
      ...row('Açık K/Z', F.signedMoney(open, ccy), F.cls(open)),
      ...row('Kapanan K/Z', F.signedMoney(closed, ccy), F.cls(closed)),
      ...row('Getiri', F.pct((b.equity() - init) / init, 2), F.cls(b.equity() - init)),
      ...row('İşlem / kazanma', `${b.trades.length} / ${b.trades.length ? F.pct(wins / b.trades.length, 0) : '—'}`),
      ...row('Maks. düşüş', `${F.money(b.maxDrawdown, ccy)} (${F.pct(b.maxDrawdownPct, 1)})`));
    const s = app.session;
    this.sessInfo.replaceChildren(
      ...row('Ad', s.name),
      ...row('Başlangıç', F.dateTime(s.startTime, app.settings.tz)),
      ...row('Şimdi', F.dateTime(app.engine.cursor, app.settings.tz)),
      ...row('Spread / kom.', `${F.num(b.cfg.spread / this.ds.pip_size, 1)} pip / ${F.money(b.cfg.commission, ccy)}`));
  }
}
