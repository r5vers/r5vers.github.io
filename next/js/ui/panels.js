// Bottom-panel tables: open positions, pending orders, trade journal.
import * as F from '../format.js?v=7f60f3c784';
import { download, h } from './dom.js?v=7f60f3c784';

const sideLabel = (s) => (s === 'buy' ? 'AL' : 'SAT');
const REASONS = { sl: 'Stop', tp: 'Hedef', manual: 'Manuel', partial: 'Kısmi', strategy: 'Strateji', end: 'Test sonu' };

function priceCell(value, decimals, onCommit) {
  const input = h('input.cell', { type: 'text', inputmode: 'decimal', placeholder: '—', value: value == null ? '' : value.toFixed(decimals) });
  const commit = () => {
    const v = F.parseNumber(input.value);
    if (Number.isNaN(v)) { input.value = value == null ? '' : value.toFixed(decimals); return; }
    if (v !== value) onCommit(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

/** The session's markets (one in a session of one market), with the leg to
 *  hand back to the app's trading calls. */
function marketsOf(app) {
  if (app.legs?.length) return app.legs;
  return app.broker ? [{ ds: app.ds, broker: app.broker }] : [];
}

export function renderPositions(el, app) {
  el.innerHTML = '';
  if (app.mode !== 'replay' || !app.broker) { el.append(h('div.empty', {}, 'Replay oturumu yok.')); return; }
  const markets = marketsOf(app);
  const many = markets.length > 1;
  const open = markets.flatMap((leg) => leg.broker.positions.map((p) => ({ p, leg })));
  if (!open.length) { el.append(h('div.empty', {}, 'Açık pozisyon yok. Sağdaki panelden ya da Shift+B / Shift+S ile emir verin.')); return; }
  const tz = app.settings.tz;
  const rows = open.map(({ p, leg }) => {
    const b = leg.broker, dec = leg.ds.decimals, ccy = b.cfg.currency;
    const pnl = b.unrealized(p);
    const px = b.exitPrice(p);
    const pips = b.pips((px - p.entryPrice) * (p.side === 'buy' ? 1 : -1));
    const r = p.initialRisk > 0 ? pnl / p.initialRisk : null;
    return h('tr', {},
      many ? h('td', {}, h('button.link-btn.sym-link', { type: 'button', title: 'Grafikte göster', onclick: () => app.switchLeg(leg) }, leg.ds.symbol)) : null,
      h('td', {}, p.id),
      h(`td.${p.side === 'buy' ? 'up' : 'down'}`, {}, sideLabel(p.side)),
      h('td.num', {}, p.qty),
      h('td.num.mono', {}, F.price(p.entryPrice, dec)),
      h('td', {}, F.dateTime(p.entryTime, tz)),
      h('td', {}, priceCell(p.sl, dec, (v) => app.modifyPosition(p.id, { sl: v }, leg))),
      h('td', {}, priceCell(p.tp, dec, (v) => app.modifyPosition(p.id, { tp: v }, leg))),
      h('td.num.mono', {}, F.price(px, dec)),
      h(`td.num.${F.cls(pips)}`, {}, F.signed(pips, 1)),
      h(`td.num.${F.cls(pnl)}`, {}, F.signedMoney(pnl, ccy)),
      h('td.num', {}, r == null ? '—' : F.signed(r, 2)),
      h('td.actions', {},
        h('button.btn.small.outline', { title: 'Stopu girişe çek', onclick: () => app.breakeven(p.id, leg) }, 'BE'),
        h('button.btn.small.outline', { title: 'Yarısını kapat', onclick: () => app.closePosition(p.id, 0.5, leg) }, '½'),
        h('button.btn.small.outline.danger', { onclick: () => app.closePosition(p.id, 1, leg) }, 'Kapat')));
  });
  el.append(
    h('div.toolbar-row', { style: { padding: '6px 10px 0' } },
      h('button.btn.small.outline.danger', { onclick: () => app.closeAll() }, many ? 'Tümünü kapat (bütün piyasalar)' : 'Tümünü kapat')),
    h('table.grid', {},
      h('thead', {}, h('tr', {}, [...(many ? ['Sembol'] : []), '#', 'Yön', 'Lot', 'Giriş', 'Zaman', 'SL', 'TP', 'Fiyat', 'Pip', 'K/Z', 'R', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows)));
}

export function renderOrders(el, app) {
  el.innerHTML = '';
  if (app.mode !== 'replay' || !app.broker) { el.append(h('div.empty', {}, 'Replay oturumu yok.')); return; }
  const markets = marketsOf(app);
  const many = markets.length > 1;
  const orders = markets.flatMap((leg) => leg.broker.orders.filter((o) => o.type !== 'next').map((o) => ({ o, leg })));
  if (!orders.length) { el.append(h('div.empty', {}, 'Bekleyen emir yok. Emir panelinde “Bekleyen” seçin ya da grafiğe sağ tıklayın.')); return; }
  const tz = app.settings.tz;
  el.append(
    h('div.toolbar-row', { style: { padding: '6px 10px 0' } },
      h('button.btn.small.outline.danger', { onclick: () => app.cancelAll() }, 'Tümünü iptal et')),
    h('table.grid', {},
      h('thead', {}, h('tr', {}, [...(many ? ['Sembol'] : []), '#', 'Tip', 'Yön', 'Lot', 'Fiyat', 'SL', 'TP', 'Oluşturma', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, orders.map(({ o, leg }) => {
        const dec = leg.ds.decimals;
        return h('tr', {},
          many ? h('td', {}, h('button.link-btn.sym-link', { type: 'button', title: 'Grafikte göster', onclick: () => app.switchLeg(leg) }, leg.ds.symbol)) : null,
          h('td', {}, o.id),
          h('td', {}, o.type === 'limit' ? 'Limit' : 'Stop'),
          h(`td.${o.side === 'buy' ? 'up' : 'down'}`, {}, sideLabel(o.side)),
          h('td.num', {}, o.qty),
          h('td', {}, priceCell(o.price, dec, (v) => app.modifyOrder(o.id, { price: v }, leg))),
          h('td', {}, priceCell(o.sl, dec, (v) => app.modifyOrder(o.id, { sl: v }, leg))),
          h('td', {}, priceCell(o.tp, dec, (v) => app.modifyOrder(o.id, { tp: v }, leg))),
          h('td', {}, F.dateTime(o.created, tz)),
          h('td.actions', {}, h('button.btn.small.outline.danger', { onclick: () => app.cancelOrder(o.id, leg) }, 'İptal')));
      }))));
}

export function tradesCsv(trades, { decimals: decimalsDefault, tz, symbolOf = null, decimalsOf = null }) {
  const head = [...(symbolOf ? ['symbol'] : []), 'id', 'side', 'lots', 'entry_time', 'entry', 'exit_time', 'exit', 'sl', 'tp', 'pips', 'pnl', 'commission', 'r', 'mfe_pips', 'mae_pips', 'reason', 'note'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = trades.map((t) => { const decimals = decimalsOf ? decimalsOf(t) : decimalsDefault; return [
    ...(symbolOf ? [symbolOf(t)] : []),
    t.id, t.side, t.qty, F.dateTime(t.entryTime, tz, true), t.entryPrice.toFixed(decimals), F.dateTime(t.exitTime, tz, true),
    t.exitPrice.toFixed(decimals), t.sl == null ? '' : t.sl.toFixed(decimals), t.tp == null ? '' : t.tp.toFixed(decimals),
    t.pips.toFixed(1), t.pnl.toFixed(2), (t.commission || 0).toFixed(2), t.r == null ? '' : t.r.toFixed(2),
    t.mfe.toFixed(1), t.mae.toFixed(1), t.reason, q(t.note || t.comment),
  ].join(','); });
  return [head.join(','), ...lines].join('\n');
}

/** Trade journal; `trades` defaults to the session's, `editable` enables notes. */
export function renderHistory(el, app, { trades = null, editable = true, ccy = null, title = null } = {}) {
  const b = app.broker;
  // a replay of several markets: all their trades, each with its market
  const markets = trades ? [] : marketsOf(app);
  const legOf = new Map();
  for (const leg of markets) for (const t of leg.broker.trades) legOf.set(t, leg);
  const many = markets.length > 1;
  const list = trades || (many ? [...legOf.keys()].sort((x, y) => x.exitTime - y.exitTime || x.entryTime - y.entryTime) : (b ? b.trades : []));
  el.innerHTML = '';
  if (!list.length) { el.append(h('div.empty', {}, trades ? 'İşlem yok.' : 'Henüz kapanmış işlem yok.')); return; }
  const tz = app.settings.tz, cur = ccy || b?.cfg.currency || app.ds.currency;
  const decOf = (t) => legOf.get(t)?.ds.decimals ?? app.ds.decimals;
  const dec = app.ds.decimals;
  const row = (t) => h('tr.clickable', { onclick: (e) => { if (e.target.tagName !== 'INPUT') app.showTrade(t, legOf.get(t)); } },
    many ? h('td', {}, legOf.get(t)?.ds.symbol || '') : null,
    h('td', {}, t.id),
    h(`td.${t.side === 'buy' ? 'up' : 'down'}`, {}, sideLabel(t.side)),
    h('td.num', {}, t.qty),
    h('td', {}, F.dateTime(t.entryTime, tz)),
    h('td.num.mono', {}, F.price(t.entryPrice, decOf(t))),
    h('td', {}, F.dateTime(t.exitTime, tz)),
    h('td.num.mono', {}, F.price(t.exitPrice, decOf(t))),
    h(`td.num.${F.cls(t.pips)}`, {}, F.signed(t.pips, 1)),
    h(`td.num.${F.cls(t.pnl)}`, {}, F.signedMoney(t.pnl, cur)),
    h('td.num', {}, t.r == null ? '—' : F.signed(t.r, 2)),
    h('td.num.up', {}, F.num(t.mfe, 1)),
    h('td.num.down', {}, F.num(t.mae, 1)),
    h('td', {}, F.duration(t.exitTime - t.entryTime)),
    h('td', {}, REASONS[t.reason] || t.reason),
    h('td', { style: { width: '30%' } }, editable
      ? h('input.note', { value: t.note || t.comment || '', placeholder: 'not ekle…', onchange: (e) => { t.note = e.target.value; app.markDirty(); } })
      : (t.comment || '')));
  // the newest first, a page at a time: thousands of rows at once froze the
  // page for seconds (a five-year backtest); the CSV has them all
  const newest = [...list].reverse();
  const tbody = h('tbody');
  const more = h('button.btn.small.outline.more-rows', { type: 'button' });
  let shown = 0;
  const page = () => {
    const next = newest.slice(shown, shown + (shown ? 300 : 100));
    tbody.append(...next.map(row));
    shown += next.length;
    more.textContent = `Daha fazla göster (${(newest.length - shown).toLocaleString('tr-TR')} işlem daha)`;
    more.hidden = shown >= newest.length;
  };
  more.onclick = page;
  page();
  el.append(
    h('div.toolbar-row', { style: { padding: '6px 10px 0' } },
      title ? h('strong', {}, title) : null,
      h('span.muted', {}, `${list.length} işlem · satıra tıklayınca grafikte gösterir`),
      h('button.btn.small.outline', { onclick: () => download(`islemler-${many ? markets.map((m) => m.ds.symbol).join('-') : app.ds.symbol}.csv`, tradesCsv(list, { decimals: dec, tz, symbolOf: many ? (t) => legOf.get(t)?.ds.symbol : null, decimalsOf: decOf })) }, 'CSV indir')),
    h('table.grid', {},
      h('thead', {}, h('tr', {}, [...(many ? ['Sembol'] : []), '#', 'Yön', 'Lot', 'Giriş zamanı', 'Giriş', 'Çıkış zamanı', 'Çıkış', 'Pip', 'K/Z', 'R', 'MFE', 'MAE', 'Süre', 'Sebep', 'Not'].map((x) => h('th', {}, x)))),
      tbody),
    more);
}

/** Name each cell after its column, so phones can show a table as cards
 *  ("K/Z  +$120") instead of a row that runs off the screen. */
export function labelTables(root) {
  for (const table of root.querySelectorAll('table.grid')) {
    const names = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!names.length) continue;
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', names[i] || ''); });
    }
  }
}
