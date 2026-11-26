// The Journal app (Günlük): every trade written down in seconds, and what
// the trades add up to. Phones: a header of light, this month in three
// figures, the account's limits, the trades by day; at the foot the app's
// tabs (trades · calendar · analysis · more) and "+". Wide screens: the
// app's sections in a sidebar, a banner, this month's numbers, the trades
// by day in a panel. A trade, a day, the new trade form and the imports open
// in a sheet (a drawer on a wide screen).
//
// A trade goes in from one line ("EURUSD long TP 2R A+ FVG"), from taps
// (market, side, result, setup, grade), from a template or the last trade,
// or comes in whole from the replay sessions, a MetaTrader report or a CSV.
import { api } from './api.js?v=ac0ce45574';
import * as F from './format.js?v=ac0ce45574';
import { confirmBox, download, h, icon, toast } from './ui/dom.js?v=ac0ce45574';
import { wirePalette } from './ui/palette.js?v=ac0ce45574';
import { settingsDialog } from './ui/dialogs.js?v=ac0ce45574';
import { WIDE, appFrame, appearanceSheet, avatarButton, baseItems, bootShell, chartUrl, closeSheet, dock, go, group, homeLook, host, markButton, pillTab, profileDrawer, ring, sheet, shell, symbolBadge, tz } from './rvshell.js?v=ac0ce45574';
import * as J from './core/journal.js?v=ac0ce45574';
import * as IO from './core/journalio.js?v=ac0ce45574';
import { deleteEntries, jr, loadJournal, mergeBackup, onJournalChange, putDay, putEntries, putEntry, savePrefs } from './journalstore.js?v=ac0ce45574';

const st = { view: 'trades', filter: 'all', account: 'all', period: 'all', unit: null, month: null, sessions: [], datasets: [], error: null };
const VIEWS = { takvim: 'calendar', analiz: 'analytics', diger: 'more' };
const HASHES = { trades: '', calendar: 'takvim', analytics: 'analiz', more: 'diger' };
const TITLES = { trades: 'Günlük', calendar: 'Takvim', analytics: 'Analiz', more: 'Diğer' };
const LABELS = { trades: 'İşlemler', calendar: 'Takvim', analytics: 'Analiz', more: 'Hesaplar ve ayarlar' };

/** Put `kids` in `el`, leaving out the parts that are not there (null, false). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((x) => x != null && x !== false));
const fromHash = () => { st.view = VIEWS[location.hash.slice(1)] || 'trades'; };

async function main() {
  const wantsNew = location.hash === '#yeni';
  fromHash();
  let me;
  try { me = await bootShell(render); } catch (err) { document.getElementById('jr-root').textContent = `Açılamadı: ${err.message}`; return; }
  if (!me) return;
  render();
  wirePalette(items, { typeToSearch: true });
  wireKeys();
  window.addEventListener('hashchange', () => {
    document.body.classList.remove('leaving');
    if (location.hash === '#yeni') { history.replaceState(null, '', HASHES[st.view] ? `#${HASHES[st.view]}` : location.pathname); editSheet(); return; }
    fromHash();
    render();
  });
  try { await loadJournal(me.profile.id); } catch (err) { st.error = err.message; toast(`Günlük okunamadı: ${err.message}`, 'err'); }
  onJournalChange(() => render());
  render();
  if (wantsNew) { history.replaceState(null, '', location.pathname); editSheet(); }
  const [sessions, datasets] = await Promise.all([api.sessions().catch(() => []), api.datasets().catch(() => [])]);
  st.sessions = sessions;
  st.datasets = datasets;
}

function setView(v) {
  st.view = v;
  history.replaceState(null, '', HASHES[v] ? `#${HASHES[v]}` : location.pathname);
  render();
  window.scrollTo({ top: 0 });
}

/** "n": a new trade, from anywhere on the page but a text field. */
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'n') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || document.querySelector('.rv-sheet-back, .modal-back, .palette-back')) return;
    e.preventDefault();
    e.stopPropagation();
    editSheet();
  });
}

// ── figures and words ──────────────────────────────────────────────────────
const P = () => jr.prefs;
const unit = () => st.unit || P().unit;
const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const sum = (xs) => xs.reduce((s, x) => s + (fin(x) ? x : 0), 0);
const fmtR = (r, d = 2) => (fin(r) ? `${r > 0 ? '+' : r < 0 ? '−' : ''}${F.num(Math.abs(r), d)}R` : '—');
const accountName = (id) => J.accountOf(P().accounts, id)?.name || 'Hesapsız';
/** The currency figures of `list` are in: its accounts', USD if they differ. */
function ccyOf(list) {
  const set = new Set(list.map((e) => J.currencyOf(e, P())));
  return set.size === 1 ? [...set][0] : (st.account !== 'all' ? J.accountOf(P().accounts, st.account)?.currency : null) || 'USD';
}
const fmtV = (v, u = unit(), ccy = 'USD', d = null) => (u === 'money' ? F.signedMoney(v, ccy, d ?? (Math.abs(v) >= 1000 ? 0 : 2)) : fmtR(v, d ?? 2));
function compact(v, u, ccy) {
  if (!fin(v)) return '';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (u === 'money') {
    const sym = { USD: '$', EUR: '€', GBP: '£', TRY: '₺' }[ccy] || '';
    return `${sign}${sym}${a >= 10000 ? `${F.num(a / 1000, 0)}B` : a >= 1000 ? `${F.num(a / 1000, 1)}B` : F.num(a, 0)}`;
  }
  return `${sign}${F.num(a, a >= 10 ? 0 : 1).replace(/,0$/, '')}R`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const todayKey = () => J.dayKey(nowSec(), tz());
const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
const dayFmtShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
function dayLabel(key, short = false) {
  const t = todayKey();
  if (key === t) return 'Bugün';
  if (key === J.dayKey(nowSec() - 86400, tz())) return 'Dün';
  const s = (short ? dayFmtShort : dayFmt).format(new Date(J.dayNoon(key) * 1000));
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}
const fullDay = (key) => { const s = dayFmt.format(new Date(J.dayNoon(key) * 1000)); return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1); };
const timeFmt = (t) => (fin(t) ? new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(new Date(t * 1000)) : '');
const tzName = () => tz().split('/').pop().replace(/_/g, ' ');

const all = () => [...jr.entries.values()].sort((a, b) => (J.timeOf(b) ?? 0) - (J.timeOf(a) ?? 0) || (b.created || 0) - (a.created || 0));
const inAccount = (e) => st.account === 'all' || (st.account === 'none' ? !e.account : e.account === st.account);
function inPeriod(e) {
  if (st.period === 'all') return true;
  const t = J.timeOf(e) ?? 0, now = nowSec();
  if (st.period === '30') return t >= now - 30 * 86400;
  if (st.period === '90') return t >= now - 90 * 86400;
  const k = J.dayKey(t, tz()), today = todayKey();
  if (st.period === 'month') return k.slice(0, 7) === today.slice(0, 7);
  if (st.period === 'year') return k.slice(0, 4) === today.slice(0, 4);
  return true;
}
const res = (e) => J.resultOf(e, P());
const knownSymbols = () => [...new Set([...P().symbols, ...st.datasets.map((d) => d.symbol), ...all().slice(0, 60).map((e) => e.symbol)].filter(Boolean))];

// ── the page ────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('jr-root');
  if (!shell.me) return;
  const wide = WIDE.matches;
  appFrame({
    current: 'journal',
    section: st.view,
    sections: [
      { id: 'trades', label: 'İşlemler', icon: 'journal', count: jr.loaded ? jr.entries.size : null, onclick: () => setView('trades') },
      { id: 'calendar', label: 'Takvim', icon: 'calendar', tone: 'teal', onclick: () => setView('calendar') },
      { id: 'analytics', label: 'Analiz', icon: 'indicator', tone: 'violet', onclick: () => setView('analytics') },
      '-',
      { id: 'import', label: 'İçe aktar', icon: 'download', tone: 'blue', onclick: () => importSheet() },
      { id: 'more', label: 'Hesaplar ve ayarlar', icon: 'sliders', tone: 'amber', onclick: () => setView('more') },
      '-',
      { id: 'replay', label: 'Replay', icon: 'replay', tone: 'rose', onclick: () => go('replay.html') },
      { id: 'chart', label: 'Grafik', icon: 'chart', tone: 'blue', onclick: () => go(chartUrl({ view: 'chart' })) },
    ],
    crumbs: ['Günlük', LABELS[st.view]],
    actions: [h('button.rv-btn', { type: 'button', onclick: () => editSheet() }, icon('plus', 17), 'Yeni işlem')],
    promo: promoCard(),
  });
  root.className = `ra jr jr-${st.view}${wide ? ' ra-wide' : ''}`;
  let body;
  if (!jr.loaded) body = st.error ? [failed()] : skeleton();
  else if (st.view === 'calendar') body = calendarView(wide);
  else if (st.view === 'analytics') body = analyticsView(wide);
  else if (st.view === 'more') body = moreView();
  else body = wide ? tradesWide() : tradesPhone();
  fill(root,
    wide ? h('span') : h('div.ra-aurora', { 'aria-hidden': 'true' }),
    wide ? h('span') : h('header.ra-top', {}, h('h1', {}, TITLES[st.view]), avatarButton()),
    ...body);
  if (wide) { document.getElementById('rv-dock')?.remove(); return; }
  dock({
    left: markButton('journal'),
    center: [
      pillTab({ icon: 'journal', label: 'İşlemler', on: st.view === 'trades', onclick: () => setView('trades') }),
      pillTab({ icon: 'calendar', label: 'Takvim', on: st.view === 'calendar', onclick: () => setView('calendar') }),
      pillTab({ icon: 'indicator', label: 'Analiz', on: st.view === 'analytics', onclick: () => setView('analytics') }),
      pillTab({ icon: 'apps', label: 'Diğer', on: st.view === 'more', onclick: () => setView('more') }),
    ],
    right: { icon: 'plus', label: 'Yeni işlem', onclick: () => editSheet() },
  });
}

const skeleton = () => [h('div.ra-kpis', {}, [0, 1, 2, 3].map(() => h('div.skel.kpi'))), h('div.ra-list', {}, [0, 1, 2].map(() => h('div.skel.row')))];
const failed = () => h('div.ra-empty', {}, h('span.ra-empty-ic', {}, icon('warn', 26)), h('b', {}, 'Günlük açılamadı'), h('p', {}, st.error || ''),
  h('button.rv-btn', { type: 'button', onclick: () => location.reload() }, icon('refresh', 16), 'Yeniden dene'));

function promoCard() {
  const k = todayKey();
  const has = jr.days.has(k);
  return h('button.rv-promo', { type: 'button', onclick: () => daySheet(k) },
    h('span.rv-promo-art', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span.rv-promo-play', {}, icon('edit', 16))),
    h('b', {}, has ? 'Bugünün notu' : 'Bugünün notunu yaz'),
    h('small', {}, has ? 'Seans öncesi planın ve gün sonu değerlendirmen' : 'Seans öncesi plan, gün sonu değerlendirme'));
}

// ── trades ──────────────────────────────────────────────────────────────────
const FILTERS = [
  ['all', 'Tümü', () => true],
  ['win', 'Kazanç', (e) => res(e) === 'win'],
  ['loss', 'Kayıp', (e) => res(e) === 'loss'],
  ['be', 'BE', (e) => res(e) === 'be'],
  ['open', 'Açık', (e) => res(e) == null],
  ['aplus', 'A+', (e) => e.grade === 'A+'],
];
function filtered() {
  const list = all().filter(inAccount);
  if (!FILTERS.some(([v]) => v === st.filter)) st.filter = 'all';
  return { list, rows: list.filter(FILTERS.find(([v]) => v === st.filter)[2]) };
}
function chips(list) {
  return h('div.rv-seg', { role: 'tablist' }, FILTERS.map(([v, l, f]) => {
    const n = list.filter(f).length;
    if (v !== 'all' && !n && st.filter !== v) return null;
    return h(`button${st.filter === v ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(st.filter === v), onclick: () => { st.filter = v; render(); } }, l, h('small', {}, String(n)));
  }).filter(Boolean));
}
function accountSeg(withAll = true) {
  const accs = P().accounts;
  if (accs.length < 2 && !(accs.length === 1 && all().some((e) => !e.account))) return null;
  const opts = [...(withAll ? [['all', 'Tüm hesaplar']] : []), ...accs.map((a) => [a.id, a.name]), ...(all().some((e) => !e.account) ? [['none', 'Hesapsız']] : [])];
  return h('div.rv-seg.sm.jr-accseg', { role: 'tablist' }, opts.map(([v, l]) => h(`button${st.account === v ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { st.account = v; render(); } }, l)));
}

/** This month in three small figures (phone) or four tiles (wide). */
function monthFigures() {
  const k = todayKey().slice(0, 7);
  const list = all().filter(inAccount).filter((e) => J.dayKey(J.timeOf(e) ?? 0, tz()).slice(0, 7) === k);
  return { list, f: J.figures(list, P(), unit()), ccy: ccyOf(list) };
}

function tradesPhone() {
  const { list, rows } = filtered();
  const m = monthFigures();
  const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
  return [
    h('section.ra-hero', {}, h('h2', {}, 'Her işlem bir ders.'), h('p', {}, 'İşlemini saniyeler içinde kaydet; setup, kalite ve hatalarınla neyin kazandırdığını gör.'),
      h('div.ra-cta', {},
        h('button.rv-btn.xl', { type: 'button', onclick: () => editSheet() }, 'Yeni işlem'),
        h('button.rv-round', { type: 'button', title: 'İçe aktar', 'aria-label': 'İçe aktar', onclick: () => importSheet() }, icon('download', 22)))),
    all().length ? h('section.jr-month', {}, h('h3', {}, 'Bu ay'),
      h('div.ra-tiles', {}, tile('Net', fmtV(m.f.net, unit(), m.ccy), tone(m.f.net)), tile('Kazanma', m.f.winRate != null ? F.pct(m.f.winRate, 0) : '—'), tile('İşlem', String(m.f.n)))) : null,
    accountPanel(),
    h('div.ra-sec-head', {}, h('h3', {}, 'İşlemler'), all().length ? chips(list) : null),
    accountSeg(),
    tradeList(list, rows, false),
  ].filter(Boolean);
}

function tradesWide() {
  const { list, rows } = filtered();
  return [
    h('section.gl.ra-banner', {},
      h('div.ra-banner-txt', {},
        h('span.eyebrow', {}, 'İşlem günlüğü'),
        h('h2', {}, 'Her işlem bir ders.'),
        h('p', {}, 'İşlemini saniyeler içinde kaydet; setup, kalite, duygu ve hatalarınla neyin kazandırdığını sayılar söylesin.'),
        h('div.row', {},
          h('button.rv-btn.lg', { type: 'button', onclick: () => editSheet() }, 'Yeni işlem'),
          h('button.rv-btn.ghost.lg', { type: 'button', onclick: () => importSheet() }, 'İçe aktar'))),
      h('div.ra-banner-art', { 'aria-hidden': 'true' }, h('i.r1'), h('i.r2'), h('i.r3'), h('span.ra-banner-core', {}, icon('journal', 46)))),
    all().length ? monthKpis() : null,
    accountPanel(),
    h('section.gl.ra-panel', { id: 'jr-panel' },
      h('header.ra-panel-head', {}, h('h3', {}, 'İşlemler', h('small', {}, `${list.length} işlem`)), h('div.jr-heads', {}, accountSeg(), all().length ? chips(list) : null)),
      tradeList(list, rows, true)),
  ].filter(Boolean);
}

function monthKpis() {
  const m = monthFigures();
  const f = m.f;
  const kpi = (kind, k, v, cls, extra = null) => h(`article.gl.ra-kpi.${kind}`, {}, h('div', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v)), extra);
  return h('section.jr-kpi-sec', {}, h('div.hub-head', {}, h('h2.hub-h', {}, 'Bu ay'), h('button.rv-link', { type: 'button', onclick: () => setView('analytics') }, 'Analiz')),
    h('div.ra-kpis', {},
      kpi('net', 'Net', fmtV(f.net, unit(), m.ccy), tone(f.net), h('small.ra-kpi-sub', {}, h('b.num', {}, String(f.n)), ' işlem')),
      kpi('wr', 'Kazanma oranı', f.winRate != null ? F.pct(f.winRate, 1) : '—', '', ring(f.winRate, { size: 60, stroke: 6, tone: f.winRate != null && f.winRate < 0.5 ? 'neg' : 'pos' })),
      kpi('pf', 'Kâr faktörü', pfText(f.pf), '', ring(f.pf == null ? null : f.pf === Infinity ? 1 : f.pf / (f.pf + 1), { size: 60, stroke: 6, tone: f.pf != null && f.pf < 1 ? 'neg' : 'pos' })),
      kpi('exp', 'Beklenti', f.expectancy != null ? fmtV(f.expectancy, unit(), m.ccy) : '—', tone(f.expectancy ?? 0))));
}
const pfText = (x) => (x == null ? '—' : x === Infinity ? '∞' : F.num(x, 2));

function emptyJournal() {
  return h('div.ra-empty', {}, h('span.ra-empty-ic', {}, icon('journal', 26)),
    h('b', {}, 'Henüz işlem kaydı yok'),
    h('p', {}, 'İlk işlemini tek satırla kaydet ya da replay oturumlarından, MetaTrader raporundan içe aktar.'),
    h('div.row.jr-center', {},
      h('button.rv-btn', { type: 'button', onclick: () => editSheet() }, icon('plus', 16), 'Yeni işlem'),
      h('button.rv-btn.ghost', { type: 'button', onclick: () => importSheet() }, icon('download', 16), 'İçe aktar')),
    P().accounts.length ? null : h('button.rv-link.center', { type: 'button', onclick: () => accountSheet(null) }, icon('shield', 15), 'Önce hesabını ekle: FTMO 100K, kişisel…'));
}

/** The trades, newest first, under the day they were taken. */
function tradeList(list, rows, wide) {
  if (!list.length && !all().length) return emptyJournal();
  if (!rows.length) return h('div.ra-empty', {}, h('p', {}, 'Bu süzgece uyan işlem yok.'));
  const days = [];
  for (const e of rows) {
    const k = J.dayKey(J.timeOf(e) ?? 0, tz());
    if (days.at(-1)?.k !== k) days.push({ k, list: [] });
    days.at(-1).list.push(e);
  }
  const shown = days.slice(0, st.days || 30);
  const more = days.length > shown.length
    ? h('button.rv-btn.ghost.jr-more', { type: 'button', onclick: () => { st.days = (st.days || 30) + 30; render(); } }, `Daha eski günler (${days.length - shown.length})`)
    : null;
  return h(`div.jr-days${wide ? '.wide' : ''}`, {}, shown.map((d) => dayBlock(d, wide)), more);
}

function dayBlock(d, wide) {
  const u = unit(), ccy = ccyOf(d.list);
  const net = sum(d.list.map((e) => J.valueOf(e, P(), u)));
  const note = jr.days.get(d.k);
  return h('section.jr-day', {},
    h('button.jr-day-head', { type: 'button', onclick: () => daySheet(d.k), title: 'Günün notu ve özeti' },
      h('span.jr-day-t', {}, h('b', {}, dayLabel(d.k)), h('small', {}, `${d.list.length} işlem${note ? ' · not var' : ''}`)),
      note ? h('span.jr-day-note', { 'aria-hidden': 'true' }, icon('edit', 14)) : null,
      h(`b.num.jr-day-v.${tone(net)}`, {}, fmtV(net, u, ccy))),
    h('div.jr-rows', {}, d.list.map((e) => (wide ? tradeRowWide(e) : tradeRow(e)))));
}

const sideText = (e) => J.SIDE_NAMES[e.side] || '—';
function metaLine(e) {
  const ses = J.sessionOfEntry(e);
  return [e.setup, e.grade, ses ? J.SESSION_NAMES[ses] : null, timeFmt(e.openAt)].filter(Boolean).join(' · ');
}
function valueBlock(e) {
  const r = J.rOf(e, P()), m = J.moneyOf(e, P());
  const r0 = res(e);
  if (r0 == null) return h('span.jr-row-v', {}, h('span.jr-open', {}, 'Açık'));
  return h('span.jr-row-v', {}, h(`b.num.${tone(r ?? m ?? 0)}`, {}, r != null ? fmtR(r) : F.signedMoney(m, J.currencyOf(e, P()))),
    r != null && m != null ? h('small.num', {}, F.signedMoney(m, J.currencyOf(e, P()), Math.abs(m) >= 1000 ? 0 : 2)) : e.outcome ? h('small', {}, J.OUTCOME_NAMES[e.outcome]) : null);
}
function tradeRow(e) {
  return h('button.gl.ra-row.jr-row', { type: 'button', onclick: () => tradeSheet(e) },
    symbolBadge(e.symbol, 44),
    h('span.ra-row-t', {}, h('b', {}, `${e.symbol} · ${sideText(e)}`), h('small', {}, metaLine(e) || J.OUTCOME_NAMES[e.outcome] || '')),
    valueBlock(e));
}
function tradeRowWide(e) {
  const ses = J.sessionOfEntry(e);
  return h('button.jr-trow', { type: 'button', onclick: () => tradeSheet(e) },
    symbolBadge(e.symbol, 36),
    h('span.jr-trow-sym', {}, h('b', {}, e.symbol), h(`small.jr-side.${e.side}`, {}, sideText(e))),
    h('span.jr-trow-c', {}, e.setup || h('i', {}, '—')),
    h('span.jr-trow-c', {}, e.grade ? h(`span.jr-grade.g-${gradeCls(e.grade)}`, {}, e.grade) : h('i', {}, '—')),
    h('span.jr-trow-c.muted', {}, [ses ? J.SESSION_NAMES[ses] : null, timeFmt(e.openAt)].filter(Boolean).join(' · ')),
    h('span.jr-trow-tags', {}, [...(e.mistakes || []).slice(0, 1).map((m) => h('span.jr-tag.bad', {}, m)), ...(e.tags || []).slice(0, 2).map((t) => h('span.jr-tag', {}, t))]),
    valueBlock(e),
    h('span.rv-row-go', {}, icon('chevron', 15)));
}
const gradeCls = (g) => ({ 'A+': 'ap', A: 'a', B: 'b', C: 'c' }[g] || 'c');

// ── the account and its limits (a prop firm's rules) ────────────────────────
function shownAccount() {
  const accs = P().accounts;
  if (st.account !== 'all' && st.account !== 'none') return J.accountOf(accs, st.account);
  return J.accountOf(accs, P().account) || accs[0] || null;
}
function accountPanel() {
  const acc = shownAccount();
  if (!acc) return null;
  const list = all().filter((e) => e.account === acc.id);
  const money = (e) => J.moneyOf(e, P());
  const ccy = acc.currency || 'USD';
  const net = sum(list.map(money));
  const bal = (acc.balance || 0) + net;
  const today = todayKey();
  const todayList = list.filter((e) => J.dayKey(J.timeOf(e) ?? 0, tz()) === today);
  const todayNet = sum(todayList.map(money));
  const meters = [];
  const meter = (label, frac, text, cls) => h('div.jr-meter', {},
    h('div.jr-meter-t', {}, h('span', {}, label), h('b.num', {}, text)),
    h(`div.ra-bar.jr-bar.${cls}`, {}, h('i', { style: { width: `${Math.max(1.5, Math.min(1, frac || 0) * 100).toFixed(1)}%` } })));
  if (acc.target > 0 && acc.balance > 0) {
    const goal = acc.balance * acc.target / 100;
    meters.push(meter(`Kâr hedefi · %${F.num(acc.target, 0)}`, net / goal, `${F.signedMoney(net, ccy, 0)} / ${F.money(goal, ccy, 0)}`, 'goal'));
  }
  if (acc.daily > 0 && acc.balance > 0) {
    const lim = acc.balance * acc.daily / 100, used = Math.max(0, -todayNet);
    meters.push(meter(`Günlük zarar limiti · %${F.num(acc.daily, 0)}`, used / lim, `${F.money(used, ccy, 0)} / ${F.money(lim, ccy, 0)}`, used / lim >= 0.6 ? 'bad' : 'warn'));
  }
  if (acc.maxLoss > 0 && acc.balance > 0) {
    const lim = acc.balance * acc.maxLoss / 100, floor = acc.balance - lim, room = bal - floor;
    meters.push(meter(`Maks. zarar · %${F.num(acc.maxLoss, 0)}`, (lim - room) / lim, `kalan ${F.money(Math.max(0, room), ccy, 0)}`, room / lim <= 0.4 ? 'bad' : 'warn'));
  }
  const pct = acc.balance > 0 ? net / acc.balance : null;
  return h('article.gl.jr-acc', {},
    h('header.jr-acc-head', {},
      h(`span.rv-row-ic.c-${acc.kind === 'prop' ? 'amber' : acc.kind === 'replay' ? 'violet' : 'teal'}`, {}, icon(acc.kind === 'prop' ? 'shield' : acc.kind === 'replay' ? 'replay' : 'user', 18)),
      h('span.jr-acc-t', {}, h('b', {}, acc.name), h('small', {}, `${J.ACCOUNT_KINDS.find(([k]) => k === acc.kind)?.[1] || 'Hesap'} · ${list.length} işlem`)),
      h('button.rv-icon-btn', { type: 'button', title: 'Hesabı düzenle', 'aria-label': 'Hesabı düzenle', onclick: () => accountSheet(acc) }, icon('sliders', 17))),
    h('div.jr-acc-main', {},
      h('div.jr-acc-bal', {}, h('span', {}, 'Bakiye'), h('b.num', {}, F.money(bal, ccy, bal >= 10000 ? 0 : 2)),
        pct != null ? h(`span.badge-num.${tone(net)}`, {}, `${net > 0 ? '+' : ''}${F.pct(pct, 2)}`) : null),
      h('div.jr-acc-today', {}, h('span', {}, 'Bugün'), h(`b.num.${tone(todayNet)}`, {}, todayList.length ? F.signedMoney(todayNet, ccy, 0) : '—'), h('small', {}, `${todayList.length} işlem`))),
    meters.length ? h('div.jr-meters', {}, meters) : null);
}

// ── a trade ─────────────────────────────────────────────────────────────────
function datasetFor(symbol) {
  return st.datasets.find((d) => d.symbol === symbol) || st.datasets.find((d) => J.normalizeSymbol(d.symbol) === symbol) || null;
}

function tradeSheet(e0) {
  const e = jr.entries.get(e0.id) || e0;
  const p = P();
  const r = J.rOf(e, p), m = J.moneyOf(e, p), ccy = J.currencyOf(e, p);
  const r0 = res(e);
  const ses = J.sessionOfEntry(e);
  const pr = J.plannedRR(e) ?? (fin(e.rr) ? e.rr : null);
  const dec = (x) => (fin(x) ? (Math.abs(x) >= 1000 ? F.num(x, 2) : String(Number(x.toFixed(6)))) : '—');
  const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
  const pill = (txt, cls = '') => (txt ? h(`span.jr-pill${cls ? `.${cls}` : ''}`, {}, txt) : null);
  const ds = datasetFor(e.symbol);
  const shots = (e.links || []).map((u) => ({ u, img: J.imageOf(u) }));
  const sh = sheet({
    title: 'İşlem', cls: 'session jr-sheet',
    body: [
      h('div.ra-sh-head', {}, symbolBadge(e.symbol, 44), h('div', {}, h('b', {}, `${e.symbol} · ${sideText(e)}`), h('small', {}, `${dayLabel(J.dayKey(e.openAt ?? 0, tz()), true)} · ${timeFmt(e.openAt)}${e.closeAt ? ` – ${timeFmt(e.closeAt)}` : ''}`))),
      h(`div.ra-sh-big.num.${tone(r ?? m ?? 0)}`, {}, r0 == null ? 'Açık' : r != null ? fmtR(r) : F.signedMoney(m, ccy)),
      r0 != null ? h(`span.badge-num.lg.${tone(m ?? r ?? 0)}`, {}, m != null && r != null ? F.signedMoney(m, ccy) : J.OUTCOME_NAMES[e.outcome] || '—') : null,
      h('div.jr-pills', {},
        pill(J.OUTCOME_NAMES[e.outcome], e.outcome === 'tp' ? 'pos' : e.outcome === 'sl' ? 'neg' : ''),
        e.setup ? pill(e.setup) : null, e.grade ? h(`span.jr-pill.jr-grade.g-${gradeCls(e.grade)}`, {}, `Kalite ${e.grade}`) : null,
        ses ? pill(J.SESSION_NAMES[ses]) : null, e.tf ? pill(e.tf) : null, e.account ? pill(accountName(e.account)) : null,
        e.plan === true ? pill('Plana uydu', 'pos') : e.plan === false ? pill('Plan dışı', 'neg') : null,
        e.emotion ? pill(e.emotion) : null),
      figureTiles(e, pr, dec, tile),
      (e.mistakes || []).length ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Hatalar'), h('div.jr-chips.ro', {}, e.mistakes.map((x) => h('span.jr-tag.bad', {}, x)))) : null,
      (e.tags || []).length ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Etiketler'), h('div.jr-chips.ro', {}, e.tags.map((x) => h('span.jr-tag', {}, x)))) : null,
      e.note ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Not'), h('div.jr-note', {}, e.note)) : null,
      shots.length ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Grafik'), h('div.jr-shots', {}, shots.map(shotNode))) : null,
      h('div.ra-sh-actions', {},
        h('button.rv-round', { type: 'button', title: 'Benzerini ekle', 'aria-label': 'Benzerini ekle', onclick: () => { sh.close(); editSheet(null, likeOf(e)); } }, icon('copy', 21)),
        h('button.rv-btn.xl', { type: 'button', onclick: () => { sh.close(); editSheet(e); } }, icon('edit', 18), 'Düzenle'),
        h('button.rv-round.danger', { type: 'button', title: 'Sil', 'aria-label': 'İşlemi sil', onclick: () => removeEntry(e, sh) }, icon('trash', 21))),
      ds && fin(e.openAt) ? h('button.rv-link.center', { type: 'button', onclick: () => go(chartUrl({ ds: ds.id, at: e.openAt, to: e.closeAt || null, tf: e.tf && ds.timeframes?.includes(e.tf) ? e.tf : null })) }, icon('chart', 15), 'Grafikte gör') : null,
    ],
  });
}

/** The trade's prices and lot, those written; nothing when none is. */
function figureTiles(e, pr, dec, tile) {
  const xs = [['Giriş', e.entry], ['Stop', e.sl], ['Hedef', e.tp], ['Çıkış', e.exit]].filter(([, v]) => fin(v)).map(([k, v]) => tile(k, dec(v)));
  if (fin(e.lots)) xs.push(tile('Lot', F.num(e.lots, 2)));
  if (pr != null) xs.push(tile('Planlanan', `1:${F.num(pr, 1).replace(/,0$/, '')}`));
  if (fin(e.closeAt) && fin(e.openAt) && e.closeAt > e.openAt) xs.push(tile('Süre', F.duration(e.closeAt - e.openAt)));
  return xs.length ? h('div.ra-tiles', {}, xs) : null;
}

function shotNode({ u, img }) {
  if (!img) return h('a.jr-link', { href: u, target: '_blank', rel: 'noopener noreferrer' }, icon('arrow', 15), h('span', {}, u.replace(/^https?:\/\//, '')));
  const a = h('a.jr-shot', { href: u, target: '_blank', rel: 'noopener noreferrer', title: 'Büyük aç' }, h('img', { src: img, alt: 'Grafik görüntüsü', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
  a.querySelector('img').addEventListener('error', () => a.replaceWith(shotNode({ u, img: null })), { once: true });
  return a;
}

/** What a "similar trade" starts from: the market and the plan, not the result. */
const likeOf = (e) => ({ symbol: e.symbol, side: e.side, setup: e.setup, grade: e.grade, tf: e.tf, account: e.account, tags: [...(e.tags || [])] });

async function removeEntry(e, sh) {
  if (!(await confirmBox('İşlemi sil', `${e.symbol} ${sideText(e).toLocaleLowerCase('tr-TR')} işlemi günlükten silinsin mi? Bu geri alınamaz.`, 'Sil', 'danger'))) return;
  try { await deleteEntries([e.id]); sh?.close(); toast('Silindi', 'ok'); } catch (err) { toast(err.message, 'err'); }
}

// ── the new / edit form ─────────────────────────────────────────────────────
function blank(preset = {}) {
  const p = P();
  return {
    id: J.newId(), account: p.account || p.accounts[0]?.id || null, symbol: null, side: null, openAt: nowSec(), closeAt: null,
    entry: null, sl: null, tp: null, exit: null, lots: null, outcome: null, r: null, pnl: null, rr: null,
    setup: null, grade: null, tf: null, session: null, tags: [], mistakes: [], emotion: null, plan: null, note: '', links: [],
    source: { kind: 'manual' }, ...structuredClone(preset),
  };
}

function editSheet(existing = null, preset = {}) {
  const p = P();
  const isNew = !existing;
  const f = existing ? structuredClone(existing) : blank(preset);
  f.tags ||= []; f.mistakes ||= []; f.links ||= [];
  // R and money as typed; otherwise worked out (prices, result, the account's risk)
  const typed = { r: false, pnl: false };
  if (!isNew) {
    // an import's figures are the broker's; a typed entry's R or money is kept
    // only if it is not what the form would work out by itself
    const own = (existing.source?.kind || 'manual') !== 'manual';
    const acc0 = J.accountOf(p.accounts, existing.account);
    const r0 = J.rOf({ ...existing, r: null, pnl: null }, p);
    const m0 = fin(existing.r) && acc0?.risk > 0 ? existing.r * acc0.risk : null;
    typed.r = fin(existing.r) && (own || !(r0 != null && Math.abs(r0 - existing.r) < 1e-6));
    typed.pnl = fin(existing.pnl) && (own || !(m0 != null && Math.abs(m0 - existing.pnl) < 0.005));
  }
  const ui = { more: !isNew && [f.entry, f.sl, f.tp, f.exit, f.lots, f.closeAt].some((x) => x != null), adding: null, base: null, quickNote: null };
  const calc = () => {
    const acc = J.accountOf(p.accounts, f.account);
    const r = typed.r ? f.r : J.rOf({ ...f, r: null, pnl: typed.pnl ? f.pnl : null }, p);
    const m = typed.pnl ? f.pnl : (fin(r) && acc?.risk > 0 ? r * acc.risk : null);
    return { r: fin(r) ? r : null, m: fin(m) ? m : null, acc };
  };

  const quick = h('input.rv-input.jr-quick', { type: 'text', placeholder: 'Hızlı yaz: EURUSD long TP 2R A+ FVG', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterkeyhint: 'done', 'aria-label': 'Hızlı giriş' });
  const summary = h('div.jr-sum');
  const host = h('div.jr-form');

  const refresh = () => {
    const { r, m, acc } = calc();
    const ccy = acc?.currency || 'USD';
    fill(summary,
      h('span.jr-sum-l', {}, f.symbol ? h('b', {}, f.symbol) : h('i', {}, 'Sembol'), ' · ', f.side ? h('b', {}, J.SIDE_NAMES[f.side]) : h('i', {}, 'yön'), ' · ', f.outcome ? h('b', {}, J.OUTCOMES.find((o) => o.id === f.outcome).label) : h('i', {}, 'sonuç')),
      h(`b.num.jr-sum-v.${tone(r ?? m ?? 0)}`, {}, r != null ? fmtR(r) : m != null ? F.signedMoney(m, ccy) : '—'),
      r != null && m != null ? h(`small.num.${tone(m)}`, {}, F.signedMoney(m, ccy, Math.abs(m) >= 1000 ? 0 : 2)) : null);
    rInput.placeholder = r != null && !typed.r ? F.num(r, 2) : 'R';
    mInput.placeholder = m != null && !typed.pnl ? F.num(m, 2) : (acc?.risk ? 'K/Z' : 'K/Z (hesapta risk yok)');
  };
  const set = (patch, repaint = true) => { Object.assign(f, patch); ui.base = null; if (repaint) paint(); else refresh(); };
  // a result tapped decides R again, unless the figures are the broker's (an
  // import) or the R typed agrees with it (a TP of 3R stays 3R)
  const own = !isNew && (existing.source?.kind || 'manual') !== 'manual';
  const pickOutcome = (v) => {
    if (!own) {
      const keep = v === 'tp' ? typed.r && f.r > 0 : v === 'manual' || v == null;
      if (!keep) { typed.r = false; f.r = null; rInput.value = ''; if (typed.pnl) { typed.pnl = false; f.pnl = null; mInput.value = ''; } }
    }
    set({ outcome: v });
  };

  // number fields that live across repaints (focus stays in them)
  const numInput = (key, label, onSet) => {
    const el = h('input.rv-input.jr-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': label, placeholder: label, value: fin(f[key]) ? String(f[key]) : '' });
    el.addEventListener('input', () => { const v = F.parseNumber(el.value); onSet(Number.isNaN(v) ? null : v, el.value.trim() !== ''); ui.base = null; refresh(); });
    return el;
  };
  const rInput = numInput('r', 'R', (v, has) => { typed.r = has && v != null; f.r = typed.r ? v : null; });
  const mInput = numInput('pnl', 'K/Z', (v, has) => { typed.pnl = has && v != null; f.pnl = typed.pnl ? v : null; });
  if (!typed.r) rInput.value = '';
  if (!typed.pnl) mInput.value = '';
  const priceInputs = Object.fromEntries([['entry', 'Giriş'], ['sl', 'Stop'], ['tp', 'Hedef'], ['exit', 'Çıkış'], ['lots', 'Lot']].map(([k, l]) => [k, numInput(k, l, (v) => { f[k] = v; })]));
  const note = h('textarea.rv-input.jr-text', { rows: 4, placeholder: 'Ne gördün, neden girdin, nasıl yönettin? Kendine not…', 'aria-label': 'Not' });
  note.value = f.note || '';
  note.addEventListener('input', () => { f.note = note.value; ui.quickNote = null; ui.base = null; });
  const when = h('input.rv-input.jr-when', { type: 'datetime-local', value: F.toLocalInput(f.openAt, tz()), 'aria-label': 'Giriş zamanı' });
  when.addEventListener('change', () => { const t = F.parseLocal(when.value, tz()); if (t != null) { f.openAt = t; ui.base = null; paint(); } });
  const whenOut = h('input.rv-input.jr-when', { type: 'datetime-local', value: f.closeAt ? F.toLocalInput(f.closeAt, tz()) : '', 'aria-label': 'Kapanış zamanı' });
  whenOut.addEventListener('change', () => { f.closeAt = whenOut.value ? F.parseLocal(whenOut.value, tz()) : null; ui.base = null; });
  const linkIn = h('input.rv-input', { type: 'url', placeholder: 'TradingView bağlantısı yapıştır', autocomplete: 'off', 'aria-label': 'Grafik bağlantısı', enterkeyhint: 'done' });
  const addLink = () => {
    const v = linkIn.value.trim();
    if (!v) return;
    if (!J.isLink(v)) { toast('Bağlantı http(s) ile başlamalı', 'warn'); return; }
    if (!f.links.includes(v)) f.links.push(v);
    linkIn.value = '';
    ui.base = null;
    paint();
  };
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
  linkIn.addEventListener('paste', () => setTimeout(addLink, 0));
  linkIn.addEventListener('blur', addLink);

  // ── controls ──
  const seg = (opts, val, pick, cls = '') => h(`div.rv-seg.jr-seg${cls}`, { role: 'radiogroup' }, opts.map(([v, l]) => h(`button${v === val ? '.on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(v === val), onclick: () => pick(v === val ? null : v) }, l)));
  const listKey = { setup: 'setups', mistakes: 'mistakes', emotion: 'emotions', tags: 'tags', symbol: 'symbols' };
  const adder = (field) => {
    if (ui.adding !== field) return h('button.rv-chip.jr-add', { type: 'button', onclick: () => { ui.adding = field; paint(); } }, icon('plus', 14), 'Yeni');
    const inp = h('input.rv-input.jr-chip-in', { type: 'text', placeholder: field === 'symbol' ? 'Sembol' : 'Ad', autocomplete: 'off', 'aria-label': 'Yeni seçenek', enterkeyhint: 'done' });
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      let v = inp.value.trim();
      ui.adding = null;
      if (v) {
        if (field === 'symbol') v = J.normalizeSymbol(v) || v.toUpperCase();
        const lk = listKey[field];
        if (!p[lk].some((x) => J.fold(x) === J.fold(v))) { p[lk] = field === 'symbol' ? [v, ...p[lk]] : [...p[lk], v]; savePrefs().catch(() => {}); }
        const name = p[lk].find((x) => J.fold(x) === J.fold(v)) || v;
        if (field === 'tags' || field === 'mistakes') { if (!f[field].includes(name)) f[field].push(name); } else f[field] = name;
      }
      paint();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); ui.adding = null; done = true; paint(); } });
    inp.addEventListener('blur', commit);
    setTimeout(() => inp.focus(), 30);
    return inp;
  };
  const one = (field, opts) => h('div.jr-chips', {}, opts.map((o) => h(`button.rv-chip${f[field] === o ? '.on' : ''}`, { type: 'button', onclick: () => set({ [field]: f[field] === o ? null : o }) }, o)), adder(field));
  const many = (field, opts) => h('div.jr-chips', {}, [...new Set([...opts, ...f[field]])].map((o) => {
    const on = f[field].includes(o);
    return h(`button.rv-chip${on ? '.on' : ''}${field === 'mistakes' ? '.bad' : ''}`, { type: 'button', onclick: () => set({ [field]: on ? f[field].filter((x) => x !== o) : [...f[field], o] }) }, o);
  }), adder(field));
  const sec = (title, ...kids) => h('section.jr-sec', {}, title ? h('h4.rv-group-title', {}, title) : null, ...kids);

  function startChips() {
    const last = all()[0];
    const tpl = p.templates || [];
    if (!isNew || (!last && !tpl.length)) return null;
    return h('div.jr-chips.jr-tpls', {},
      last ? h('button.rv-chip', { type: 'button', title: 'Son işlemin piyasası, yönü, setup ve kalitesi', onclick: () => { Object.assign(f, likeOf(last)); ui.base = null; paint(); } }, icon('copy', 14), 'Sonuncuyu tekrarla') : null,
      tpl.map((t) => h('button.rv-chip', { type: 'button', onclick: () => { Object.assign(f, structuredClone(t.fields)); ui.base = null; paint(); } }, icon('bolt', 14), t.name)));
  }

  function paint() {
    const symbols = [...new Set([...(f.symbol ? [f.symbol] : []), ...p.symbols, ...knownSymbols()])].slice(0, 10);
    const ses = f.session || J.sessionOf(f.openAt);
    const acc = J.accountOf(p.accounts, f.account);
    fill(host,
      startChips(),
      sec('Sembol', one('symbol', symbols)),
      sec('Yön', seg([['buy', 'Alış'], ['sell', 'Satış']], f.side, (v) => set({ side: v }), '.side')),
      sec('Sonuç', seg(J.OUTCOMES.map((o) => [o.id, o.label]), f.outcome, (v) => pickOutcome(v), '.full')),
      sec(null, h('div.jr-pair', {},
        h('label.jr-field', {}, h('span', {}, 'R'), rInput),
        h('label.jr-field', {}, h('span', {}, `K/Z${acc?.currency ? ` · ${acc.currency}` : ''}`), mInput)),
      h('small.jr-hint', {}, acc?.risk > 0 ? `Boş bırakırsan sonuçtan hesaplanır (TP = ${F.num(fin(f.rr) ? f.rr : p.rr, 1).replace(/,0$/, '')}R, işlem başı risk ${F.money(acc.risk, acc.currency || 'USD', 0)}).` : `Boş bırakırsan sonuçtan hesaplanır (TP = ${F.num(fin(f.rr) ? f.rr : p.rr, 1).replace(/,0$/, '')}R).`)),
      sec('Setup', one('setup', p.setups)),
      sec('Kalite', seg(J.GRADES.map((g) => [g, g]), f.grade, (v) => set({ grade: v }), '.full')),
      p.accounts.length > 1 ? sec('Hesap', seg(p.accounts.map((a) => [a.id, a.name]), f.account, (v) => set({ account: v || f.account }))) : null,
      sec(`Giriş zamanı · ${tzName()}`, h('div.jr-when-row', {}, when, h('button.rv-link', { type: 'button', onclick: () => { f.openAt = nowSec(); when.value = F.toLocalInput(f.openAt, tz()); paint(); } }, 'Şimdi')),
        h('div.jr-ses', {}, h('span', {}, 'Seans'), seg([['ASIA', 'Asya'], ['LONDON', 'Londra'], ['NEW YORK', 'New York']], ses, (v) => set({ session: v }), '.sm'))),
      h('button.jr-toggle-more', { type: 'button', 'aria-expanded': String(ui.more), onclick: () => { ui.more = !ui.more; paint(); } }, h('span', {}, 'Fiyatlar, lot, kapanış, zaman dilimi'), h(`span.jr-chev${ui.more ? '.up' : ''}`, {}, icon('chevron', 16))),
      ui.more ? h('div.jr-more-box', {},
        h('div.jr-prices', {}, ...['entry', 'sl', 'tp', 'exit', 'lots'].map((k) => h('label.jr-field', {}, h('span', {}, { entry: 'Giriş', sl: 'Stop', tp: 'Hedef', exit: 'Çıkış', lots: 'Lot' }[k]), priceInputs[k]))),
        h('small.jr-hint', {}, 'Giriş, stop ve çıkış varsa R fiyatlardan hesaplanır.'),
        h('label.jr-field.wide', {}, h('span', {}, `Kapanış zamanı · ${tzName()}`), whenOut),
        sec('Zaman dilimi', seg(J.TFS.map((x) => [x, x]), f.tf, (v) => set({ tf: v }), '.sm'))) : null,
      sec('Plana uydun mu?', seg([[true, 'Evet'], [false, 'Hayır']], f.plan, (v) => set({ plan: v }), '.full')),
      sec('Duygu', one('emotion', p.emotions)),
      sec('Hatalar', many('mistakes', p.mistakes)),
      sec('Etiketler', many('tags', p.tags)),
      sec('Not', note),
      sec('Grafik', linkIn, f.links.length ? h('div.jr-shots.edit', {}, f.links.map((u) => h('div.jr-shot-wrap', {}, shotNode({ u, img: J.imageOf(u) }),
        h('button.rv-icon-btn.jr-shot-x', { type: 'button', title: 'Kaldır', 'aria-label': 'Bağlantıyı kaldır', onclick: () => { f.links = f.links.filter((x) => x !== u); paint(); } }, icon('close', 15))))) : h('small.jr-hint', {}, 'TradingView’da Alt+S görüntünün bağlantısını kopyalar; buraya yapıştır.')),
    );
    refresh();
  }

  // the quick line: what it names fills the form; deleting a word takes it back
  quick.addEventListener('input', () => {
    if (!ui.base) ui.base = { f: structuredClone(f), typed: { ...typed } };
    const parsed = J.parseQuick(quick.value, p, knownSymbols());
    Object.keys(f).forEach((k) => delete f[k]);
    Object.assign(f, structuredClone(ui.base.f));
    Object.assign(typed, ui.base.typed);
    for (const [k, v] of Object.entries(parsed)) {
      if (k === 'note' || k === 'stars') continue;
      if (k === 'tags' || k === 'mistakes') { f[k] = [...new Set([...(f[k] || []), ...v])]; continue; }
      if (k === 'r') { typed.r = true; f.r = v; rInput.value = String(v); continue; }
      if (k === 'pnl') { typed.pnl = true; f.pnl = v; mInput.value = String(v); continue; }
      f[k] = v;
    }
    if (!('r' in parsed) && !ui.base.typed.r) rInput.value = '';
    if (!('pnl' in parsed) && !ui.base.typed.pnl) mInput.value = '';
    if (parsed.note && (!f.note || f.note === ui.quickNote)) { f.note = parsed.note; note.value = f.note; ui.quickNote = parsed.note; } else if (!parsed.note && ui.quickNote != null && note.value === ui.quickNote) { f.note = ui.base.f.note; note.value = f.note || ''; ui.quickNote = null; }
    paint();
  });
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });

  async function save(again) {
    if (!f.symbol) { toast('Sembolü seç', 'warn'); return; }
    if (!f.side) { toast('Yönü seç: alış ya da satış', 'warn'); return; }
    const { r, m } = calc();
    const e = { ...f, symbol: f.symbol.toUpperCase(), r, pnl: m, note: (f.note || '').trim() };
    if (!e.outcome && r != null) e.outcome = Math.abs(r) < 0.05 ? 'be' : 'manual';
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    try {
      await putEntry(e);
      // the market goes first among the quick picks
      if (p.symbols[0] !== e.symbol) { p.symbols = [e.symbol, ...p.symbols.filter((s) => s !== e.symbol)].slice(0, 8); savePrefs().catch(() => {}); }
      toast(isNew ? 'İşlem kaydedildi' : 'Değişiklikler kaydedildi', 'ok');
      if (again) { sh.close(); editSheet(null, { account: e.account, symbol: e.symbol }); } else sh.close();
    } catch (err) { toast(err.message, 'err'); }
  }

  function saveTemplate() {
    const input = h('input.rv-input', { type: 'text', placeholder: 'Örn. EURUSD Londra FVG', maxlength: 40, 'aria-label': 'Şablonun adı' });
    const fields = { symbol: f.symbol, side: f.side, setup: f.setup, grade: f.grade, tf: f.tf, account: f.account, tags: [...f.tags], session: f.session };
    const sh2 = sheet({ title: 'Şablon olarak kaydet', body: [
      h('p.jr-p', {}, 'Bu formdaki piyasa, yön, setup, kalite, zaman dilimi ve etiketler tek dokunuşla gelsin.'),
      h('label.rv-label', {}, 'Şablonun adı'), input,
      h('button.rv-btn.xl.block', { type: 'button', onclick: async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        p.templates = [...p.templates.filter((t) => t.name !== name), { id: J.newId('t'), name, fields }];
        try { await savePrefs(); toast('Şablon kaydedildi', 'ok'); sh2.close(); editSheet(f.id && !isNew ? f : null, isNew ? f : {}); } catch (err) { toast(err.message, 'err'); }
      } }, 'Kaydet')] });
    setTimeout(() => input.focus(), 60);
  }

  const body = [
    isNew ? h('div.jr-quick-wrap', {}, quick, h('small.jr-hint', {}, 'Sembol, yön, sonuç, R, kalite ve setup yazdıkça aşağısı dolar. Enter kaydeder.')) : null,
    summary,
    host,
    h('div.jr-save', {},
      h('button.rv-btn.xl.block', { type: 'button', onclick: () => save(false) }, icon('check', 18), isNew ? 'Kaydet' : 'Değişiklikleri kaydet'),
      h('div.jr-save-links', {},
        isNew ? h('button.rv-link', { type: 'button', onclick: () => save(true) }, icon('plus', 14), 'Kaydet ve yenisini ekle') : h('button.rv-link', { type: 'button', onclick: () => removeEntry(f, sh) }, icon('trash', 14), 'Sil'),
        h('button.rv-link', { type: 'button', onclick: saveTemplate }, icon('bolt', 14), 'Şablon olarak kaydet'))),
  ];
  const sh = sheet({ title: isNew ? 'Yeni işlem' : 'İşlemi düzenle', cls: 'jr-edit', body });
  paint();
  if (isNew && WIDE.matches) setTimeout(() => quick.focus(), 80);
  return sh;
}

// ── a day ───────────────────────────────────────────────────────────────────
function daySheet(key) {
  const list = all().filter((e) => J.dayKey(J.timeOf(e) ?? 0, tz()) === key);
  const u = unit(), ccy = ccyOf(list);
  const f = J.figures(list, P(), u);
  const d = { date: key, plan: '', review: '', mood: null, ...(jr.days.get(key) || {}) };
  const state = h('small.jr-saved', {}, '');
  let timer = 0;
  const persist = () => {
    clearTimeout(timer);
    state.textContent = 'Kaydediliyor…';
    timer = setTimeout(async () => {
      try { await putDay(d, { quiet: true }); state.textContent = 'Kaydedildi'; } catch (err) { state.textContent = ''; toast(err.message, 'err'); }
    }, 600);
  };
  const area = (k, label, hint) => {
    const el = h('textarea.rv-input.jr-text', { rows: 4, placeholder: hint, 'aria-label': label });
    el.value = d[k] || '';
    el.addEventListener('input', () => { d[k] = el.value; persist(); });
    return h('section.jr-sec', {}, h('h4.rv-group-title', {}, label), el);
  };
  const moods = [['zor', 'Zor'], ['orta', 'Orta'], ['iyi', 'İyi'], ['harika', 'Harika']];
  const moodSeg = h('div.rv-seg.jr-seg.full', { role: 'radiogroup' });
  const paintMood = () => moodSeg.replaceChildren(...moods.map(([v, l]) => h(`button${d.mood === v ? '.on' : ''}`, { type: 'button', onclick: () => { d.mood = d.mood === v ? null : v; paintMood(); persist(); } }, l)));
  paintMood();
  const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
  const sh = sheet({
    title: dayLabel(key), cls: 'session jr-sheet',
    body: [
      h('div.ra-sh-head', {}, h('span.rv-row-ic.c-teal.lg', {}, icon('calendar', 20)), h('div', {}, h('b', {}, fullDay(key)), h('small', {}, list.length ? `${list.length} işlem${jr.days.has(key) ? ' · not var' : ''}` : 'İşlem yok'))),
      list.length ? h(`div.ra-sh-big.num.${tone(f.net)}`, {}, fmtV(f.net, u, ccy)) : null,
      list.length ? h('div.ra-tiles', {}, tile('Kazanma', f.winRate != null ? F.pct(f.winRate, 0) : '—'), tile('En iyi', f.best != null ? fmtV(f.best, u, ccy) : '—', tone(f.best ?? 0)), tile('En kötü', f.worst != null ? fmtV(f.worst, u, ccy) : '—', tone(f.worst ?? 0))) : null,
      list.length ? h('div.jr-rows.in-sheet', {}, list.map((e) => h('button.ov-row.jr-mini', { type: 'button', onclick: () => { sh.close(); tradeSheet(e); } },
        symbolBadge(e.symbol, 34), h('span.ov-row-t', {}, h('b', {}, `${e.symbol} · ${sideText(e)}`), h('small', {}, metaLine(e))), valueBlock(e)))) : null,
      h('button.rv-btn.ghost.block', { type: 'button', onclick: () => { sh.close(); editSheet(null, { openAt: key === todayKey() ? nowSec() : J.dayNoon(key) }); } }, icon('plus', 16), 'Bu güne işlem ekle'),
      area('plan', 'Seans öncesi plan', 'Bias, beklediğin likidite, işlem yapmayacağın koşullar…'),
      area('review', 'Gün sonu değerlendirmesi', 'Neyi iyi yaptın, neyi bir daha yapmayacaksın?'),
      h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Gün nasıldı?'), moodSeg),
      state,
    ],
  });
  return sh;
}

// ── the calendar ────────────────────────────────────────────────────────────
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
function calendarView(wide) {
  const ym = st.month || todayKey().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const u = unit();
  const list = all().filter(inAccount);
  const byDay = new Map();
  for (const e of list) {
    const k = J.dayKey(J.timeOf(e) ?? 0, tz());
    if (k.slice(0, 7) !== ym) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const monthList = list.filter((e) => J.dayKey(J.timeOf(e) ?? 0, tz()).slice(0, 7) === ym);
  const ccy = ccyOf(monthList.length ? monthList : list);
  const f = J.figures(monthList, P(), u);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;                       // Monday first
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysIn) / 7);
  const vals = [...byDay.entries()].filter(([k]) => k.slice(0, 7) === ym).map(([, xs]) => Math.abs(sum(xs.map((e) => J.valueOf(e, P(), u)))));
  const vmax = Math.max(...vals, 1e-9);
  const today = todayKey();
  const cells = [];
  const weekTotals = [];
  for (let w = 0; w < weeks; w++) {
    let wsum = 0, wn = 0;
    for (let i = 0; i < 7; i++) {
      const dayNum = w * 7 + i - lead + 1;
      if (dayNum < 1 || dayNum > daysIn) { cells.push(h('span.jr-cal-d.out')); continue; }
      const k = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const xs = byDay.get(k) || [];
      const v = xs.length ? sum(xs.map((e) => J.valueOf(e, P(), u))) : null;
      wsum += v || 0; wn += xs.length;
      const note = jr.days.has(k);
      cells.push(h(`button.jr-cal-d${xs.length ? `.${tone(v) || 'zero'}` : ''}${k === today ? '.today' : ''}${i >= 5 ? '.wkend' : ''}`, {
        type: 'button', style: v != null ? { '--a': (0.18 + 0.5 * (Math.abs(v) / vmax)).toFixed(2) } : {}, onclick: () => daySheet(k),
        title: xs.length ? `${dayLabel(k)} · ${xs.length} işlem · ${fmtV(v, u, ccy)}` : dayLabel(k),
      }, h('span.jr-cal-n', {}, String(dayNum)), note ? h('i.jr-cal-note', { 'aria-hidden': 'true' }) : null,
      xs.length ? h('b.num', {}, compact(v, u, ccy)) : null, xs.length ? h('small', {}, `${xs.length} işlem`) : null));
    }
    weekTotals.push({ v: wsum, n: wn });
  }
  const shift = (d) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); st.month = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; render(); };
  const cal = h('section.gl.jr-cal', {},
    h('header.jr-cal-head', {},
      h('button.rv-icon-btn', { type: 'button', title: 'Önceki ay', 'aria-label': 'Önceki ay', onclick: () => shift(-1) }, h('span.jr-rot90', {}, icon('chevron', 18))),
      h('h3', {}, `${MONTHS[m - 1]} ${y}`),
      h('button.rv-icon-btn', { type: 'button', title: 'Sonraki ay', 'aria-label': 'Sonraki ay', onclick: () => shift(1) }, h('span.jr-rot-90', {}, icon('chevron', 18))),
      ym !== today.slice(0, 7) ? h('button.rv-link', { type: 'button', onclick: () => { st.month = null; render(); } }, 'Bu ay') : null,
      h('span.jr-cal-sum', {}, monthList.length ? h(`b.num.${tone(f.net)}`, {}, fmtV(f.net, u, ccy)) : null, h('small', {}, monthList.length ? `${monthList.length} işlem` : 'İşlem yok'))),
    h(`div.jr-cal-grid${wide ? '.wk' : ''}`, {},
      ...WEEKDAYS.map((d) => h('span.jr-cal-wd', {}, d)), wide ? h('span.jr-cal-wd', {}, 'Hafta') : null,
      ...(wide ? Array.from({ length: weeks }, (_, w) => [...cells.slice(w * 7, w * 7 + 7), h(`span.jr-cal-w.${weekTotals[w].n ? tone(weekTotals[w].v) : ''}`, {}, weekTotals[w].n ? h('b.num', {}, compact(weekTotals[w].v, u, ccy)) : null, weekTotals[w].n ? h('small', {}, `${weekTotals[w].n} işlem`) : null)]).flat() : cells)));
  const dayVals = [...byDay.entries()].filter(([k]) => k.slice(0, 7) === ym).map(([k, xs]) => ({ k, v: sum(xs.map((e) => J.valueOf(e, P(), u))), n: xs.length }));
  const green = dayVals.filter((x) => x.v > 0).length, red = dayVals.filter((x) => x.v < 0).length;
  const bestDay = [...dayVals].sort((a, b) => b.v - a.v)[0], worstDay = [...dayVals].sort((a, b) => a.v - b.v)[0];
  const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
  const side = h('section.gl.ra-acard.jr-cal-side', {}, h('header', {}, 'Ayın özeti'),
    h('div.ra-acard-body', {},
      h('div.ra-tiles', {},
        tile('Kazanma', f.winRate != null ? F.pct(f.winRate, 0) : '—'), tile('Kâr faktörü', pfText(f.pf)),
        tile('Beklenti', f.expectancy != null ? fmtV(f.expectancy, u, ccy) : '—', tone(f.expectancy ?? 0)), tile('İşlem günü', String(dayVals.length)),
        tile('Kârlı gün', String(green), green ? 'pos' : ''), tile('Zararlı gün', String(red), red ? 'neg' : '')),
      dayVals.length ? h('div.ov-rows', {},
        bestDay && bestDay.v > 0 ? h('button.ov-row', { type: 'button', onclick: () => daySheet(bestDay.k) }, h('span.rv-row-ic.c-teal', {}, icon('up', 18)), h('span.ov-row-t', {}, h('b', {}, 'En iyi gün'), h('small', {}, dayLabel(bestDay.k))), h('b.num.ov-row-num.pos', {}, fmtV(bestDay.v, u, ccy))) : null,
        worstDay && worstDay.v < 0 ? h('button.ov-row', { type: 'button', onclick: () => daySheet(worstDay.k) }, h('span.rv-row-ic.c-rose', {}, icon('down', 18)), h('span.ov-row-t', {}, h('b', {}, 'En kötü gün'), h('small', {}, dayLabel(worstDay.k))), h('b.num.ov-row-num.neg', {}, fmtV(worstDay.v, u, ccy))) : null) : h('p.muted.jr-p', {}, 'Bu ay işlem yok. Bir güne dokunup not ya da işlem ekleyebilirsin.')));
  return [
    h('div.jr-filters', {}, accountSeg(), unitSeg()),
    wide ? h('div.jr-cal-wrap', {}, cal, side) : cal,
    wide ? null : side,
  ].filter(Boolean);
}

function unitSeg() {
  return h('div.rv-seg.sm', { role: 'tablist', 'aria-label': 'Birim' }, [['r', 'R'], ['money', 'Para']].map(([v, l]) => h(`button${unit() === v ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { st.unit = v; render(); } }, l)));
}

// ── analysis ────────────────────────────────────────────────────────────────
const PERIODS = [['all', 'Tümü'], ['month', 'Bu ay'], ['30', '30 gün'], ['90', '90 gün'], ['year', 'Bu yıl']];
function card(title, ...body) { return h('section.gl.ra-acard', {}, h('header', {}, title), h('div.ra-acard-body', {}, body)); }

function analyticsView(wide) {
  const list = all().filter(inAccount).filter(inPeriod);
  const filters = h('div.jr-filters', {}, accountSeg(),
    h('div.rv-seg.sm', { role: 'tablist', 'aria-label': 'Dönem' }, PERIODS.map(([v, l]) => h(`button${st.period === v ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { st.period = v; render(); } }, l))),
    unitSeg());
  const closed = list.filter((e) => res(e) != null);
  if (!closed.length) {
    return [filters, h('div.ra-empty', {}, h('span.ra-empty-ic', {}, icon('indicator', 26)), h('b', {}, all().length ? 'Bu süzgeçte sonuçlanmış işlem yok' : 'Analiz için işlem yok'),
      h('p', {}, 'Sonucu yazılmış işlemler oldukça kazanma oranın, setup’ların, seansların ve hataların burada çıkar.'),
      h('button.rv-btn', { type: 'button', onclick: () => editSheet() }, icon('plus', 16), 'Yeni işlem'))];
  }
  const u = unit(), ccy = ccyOf(closed), p = P();
  const f = J.figures(closed, p, u);
  const V = (v, d) => fmtV(v, u, ccy, d);
  const kpi = (kind, k, v, cls, extra = null) => h(`article.gl.ra-kpi.${kind}`, {}, h('div', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v)), extra);
  const kpis = h('div.ra-kpis', {},
    kpi('net', 'Net', V(f.net), tone(f.net), h('small.ra-kpi-sub', {}, h('b.num', {}, String(f.n)), ' işlem')),
    kpi('wr', 'Kazanma oranı', f.winRate != null ? F.pct(f.winRate, 1) : '—', '', ring(f.winRate, { size: 60, stroke: 6, tone: f.winRate != null && f.winRate < 0.5 ? 'neg' : 'pos' })),
    kpi('pf', 'Kâr faktörü', pfText(f.pf), '', ring(f.pf == null ? null : f.pf === Infinity ? 1 : f.pf / (f.pf + 1), { size: 60, stroke: 6, tone: f.pf != null && f.pf < 1 ? 'neg' : 'pos' })),
    kpi('exp', 'Beklenti', f.expectancy != null ? V(f.expectancy) : '—', tone(f.expectancy ?? 0), h('small.ra-kpi-sub', {}, 'işlem başına')));

  // the curve
  const curve = card('Bakiye eğrisi',
    h('div.ra-acard-big', {}, h(`b.num.${tone(f.net)}`, {}, V(f.net)), h(`span.badge-num${f.maxDD > 0 ? '.neg' : ''}`, {}, `en derin düşüş ${f.maxDD > 0 ? `−${u === 'money' ? F.money(f.maxDD, ccy, 0) : `${F.num(f.maxDD, 2)}R`}` : 'yok'}`)),
    curvePlot(f.curve));
  curve.classList.add('jr-span2');

  const bars = (groups, { sort = 'net', max = 8, empty = 'Kayıt yok.' } = {}) => {
    const gs = [...groups].sort(sort === 'net' ? (a, b) => b.f.net - a.f.net : (a, b) => a.f.net - b.f.net).slice(0, max);
    if (!gs.length) return h('p.muted.jr-p', {}, empty);
    const mx = Math.max(...gs.map((g) => Math.abs(g.f.net)), 1e-9);
    return h('div.jr-bars', {}, gs.map((g) => h('div.jr-bar-row', {},
      h('div.jr-bar-t', {}, h('b', {}, g.key), h('small', {}, `${g.f.n} işlem · ${g.f.winRate != null ? `%${F.num(g.f.winRate * 100, 0)} kazanma` : '—'}`)),
      h(`b.num.jr-bar-v.${tone(g.f.net)}`, {}, V(g.f.net)),
      h('div.jr-bar-track', {}, h(`i.${tone(g.f.net) || 'zero'}`, { style: { width: `${Math.max(2.5, (Math.abs(g.f.net) / mx) * 100).toFixed(1)}%` } })))));
  };

  const setups = J.groupBy(closed, (e) => e.setup || null, p, u);
  const bySetup = card('Setup’lara göre', bars(setups, { empty: 'Setup yazılmış işlem yok.' }));

  const cols = (groups, keys, names) => {
    const gmap = new Map(groups.map((g) => [g.key, g]));
    const xs = keys.map((k) => ({ k, g: gmap.get(k) }));
    const zmax = Math.max(...xs.map((x) => Math.abs(x.g?.f.net || 0)), 1e-9);
    return h('div.ra-cols', { style: { gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` } }, xs.map(({ k, g }) => h('div.ra-col', {},
      h('span.ra-col-k', {}, names[k] || k), h('span.ra-col-n', {}, h('b.num', {}, String(g?.f.n || 0)), ' işlem'),
      h('div.ra-col-bar', {}, h(`i.${tone(g?.f.net || 0) || 'zero'}`, { style: { height: `${Math.max(8, (Math.abs(g?.f.net || 0) / zmax) * 100)}%` } })),
      h(`span.ra-col-v.num.${tone(g?.f.net || 0)}`, {}, g ? V(g.f.net) : '—'),
      h('span.jr-col-wr', {}, g?.f.winRate != null ? `%${F.num(g.f.winRate * 100, 0)}` : '—'))));
  };
  const grades = J.groupBy(closed, (e) => e.grade || null, p, u);
  const best = [...grades].sort((a, b) => (b.f.expectancy ?? -1e9) - (a.f.expectancy ?? -1e9))[0];
  const byGrade = card('Kaliteye göre',
    h('div.ra-acard-big', {}, best ? h(`b.num.${tone(best.f.expectancy)}`, {}, V(best.f.expectancy)) : h('b', {}, '—'), h('span.badge-num', {}, best ? `işlem başına · en iyisi ${best.key}` : 'kalite yazılmamış')),
    cols(grades, J.GRADES, {}));
  const sessions = J.groupBy(closed, (e) => J.sessionOfEntry(e), p, u);
  const upS = sessions.filter((x) => x.f.net > 0).length;
  const bySession = card('Seanslara göre', h('div.ra-acard-big', {}, h(`b.num.${tone(f.net)}`, {}, V(f.net)), h(`span.badge-num.${upS >= 2 ? 'pos' : ''}`, {}, `${upS}/3 kârda`)),
    cols(sessions, J.SESSIONS.map(([k]) => k), J.SESSION_NAMES));

  // days and hours
  const TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const when = closed.map((e) => ({ ...J.weekdayHour(e.openAt ?? J.timeOf(e) ?? 0, tz()), v: J.valueOf(e, p, u) || 0 }));
  const days = WEEK.map((d) => { const xs = when.filter((w) => w.d === d); return { d, n: xs.length, v: xs.reduce((s, x) => s + x.v, 0) }; });
  const dmax = Math.max(...days.map((x) => Math.abs(x.v)), 1e-9);
  const bestD = [...days].filter((x) => x.n).sort((a, b) => b.v - a.v)[0] || days[0];
  const byDay = card('Haftanın günleri', h('div.ra-acard-big', {}, h(`b.num.${tone(bestD.v)}`, {}, V(bestD.v)), h('span.badge-num', {}, `en iyi gün: ${TR[bestD.d]}`)),
    h('div.ra-days', {}, days.map((x) => h('div.ra-day', { title: `${TR[x.d]} · ${x.n} işlem · ${V(x.v)}` }, h('div.ra-day-bar', {}, h(`i.${tone(x.v) || 'zero'}`, { style: { height: `${Math.max(6, (Math.abs(x.v) / dmax) * 100)}%` } })), h('span', {}, TR[x.d])))));
  const cells = new Map();
  for (const w of when) { const k = `${w.d}:${Math.floor(w.hr / 2)}`; cells.set(k, (cells.get(k) || 0) + w.v); }
  const cmax = Math.max(...[...cells.values()].map(Math.abs), 1e-9);
  const heat = card('İşlem saati', h('div.ra-acard-big', {}, h('b.num', {}, `${closed.length} işlem`), h('span.badge-num', {}, tz().replace(/_/g, ' '))),
    h('div.ra-heat', {},
      WEEK.flatMap((d) => [h('span.ra-heat-d', {}, TR[d]), ...Array.from({ length: 12 }, (_, s) => {
        const v = cells.get(`${d}:${s}`);
        return h(`i.ra-heat-c${v == null ? '' : v >= 0 ? '.pos' : '.neg'}`, { style: v == null ? {} : { '--a': (0.3 + 0.7 * (Math.abs(v) / cmax)).toFixed(2) }, title: v == null ? '' : `${TR[d]} ${String(s * 2).padStart(2, '0')}:00 · ${V(v)}` });
      })]),
      h('span'), ...['00', '04', '08', '12', '16', '20'].map((x) => h('span.ra-heat-h', {}, x))));

  // discipline: the plan, the mistakes
  const planned = closed.filter((e) => e.plan === true), unplanned = closed.filter((e) => e.plan === false);
  const fp = J.figures(planned, p, u), fu = J.figures(unplanned, p, u);
  const clean = closed.filter((e) => !(e.mistakes || []).length), dirty = closed.filter((e) => (e.mistakes || []).length);
  const fc = J.figures(clean, p, u), fd = J.figures(dirty, p, u);
  const vs = (a, b, la, lb) => h('div.jr-vs', {},
    [[la, a], [lb, b]].map(([l, x]) => h('div.jr-vs-c', {}, h('span', {}, l), h(`b.num.${tone(x.expectancy ?? 0)}`, {}, x.n ? V(x.expectancy) : '—'),
      h('small', {}, x.n ? `${x.n} işlem · %${F.num((x.winRate ?? 0) * 100, 0)} kazanma` : 'işlem yok'))));
  const discipline = card('Disiplin',
    h('p.jr-p.muted', {}, 'İşlem başına ortalama sonuç.'),
    vs(fp, fu, 'Plana uydu', 'Plan dışı'),
    vs(fc, fd, 'Hatasız', 'Hatalı'));
  const mistakes = J.groupBy(closed, (e) => e.mistakes || [], p, u);
  const cost = mistakes.reduce((s, g) => s + Math.min(0, g.f.net), 0);
  const byMistake = card('Hataların bedeli',
    h('div.ra-acard-big', {}, h(`b.num.${tone(cost)}`, {}, mistakes.length ? V(cost) : '—'), h('span.badge-num', {}, mistakes.length ? 'hatalı işlemlerin zararı' : 'hata yazılmamış')),
    bars(mistakes, { sort: 'cost', max: 8, empty: 'Hata yazılmış işlem yok. İyi gidiyorsun ya da yazmıyorsun.' }));
  const byEmotion = card('Duygulara göre', bars(J.groupBy(closed, (e) => e.emotion || null, p, u), { empty: 'Duygu yazılmış işlem yok.' }));
  const bySymbol = card('Piyasalara göre', bars(J.groupBy(closed, (e) => e.symbol, p, u)));
  const byTag = card('Etiketlere göre', bars(J.groupBy(closed, (e) => e.tags || [], p, u), { empty: 'Etiketli işlem yok.' }));

  // long / short and the spread of results
  const longs = closed.filter((e) => e.side === 'buy'), shorts = closed.filter((e) => e.side !== 'buy');
  const fl = J.figures(longs, p, u), fs = J.figures(shorts, p, u);
  const lpct = closed.length ? (longs.length / closed.length) * 100 : 50;
  const ls = card('Alış / satış', h('div.ra-ls', {},
    h('div.ra-ls-row', {}, h('span', {}, 'Alış ', h('b.num', {}, String(longs.length))), h('span', {}, 'Satış ', h('b.num', {}, String(shorts.length)))),
    h('div.ra-ls-bar', {}, h('i.long', { style: { width: `${lpct}%` } }), h('i.short', { style: { width: `${100 - lpct}%` } })),
    h('div.ra-ls-row', {}, h(`span.num.${tone(fl.net)}`, {}, V(fl.net)), h(`span.num.${tone(fs.net)}`, {}, V(fs.net))),
    h('div.ra-ls-row.jr-ls-wr', {}, h('span', {}, fl.winRate != null ? `%${F.num(fl.winRate * 100, 0)} kazanma` : '—'), h('span', {}, fs.winRate != null ? `%${F.num(fs.winRate * 100, 0)} kazanma` : '—'))));
  const rs = closed.map((e) => J.rOf(e, p)).filter(fin);
  const BINS = [[-Infinity, -1.5, '≤ −2'], [-1.5, -0.5, '−1'], [-0.5, 0.5, '0'], [0.5, 1.5, '+1'], [1.5, 2.5, '+2'], [2.5, 3.5, '+3'], [3.5, Infinity, '≥ +4']];
  const hist = BINS.map(([a, b, l]) => ({ l, n: rs.filter((r) => r > a && r <= b).length, mid: (Math.max(a, -3) + Math.min(b, 4)) / 2 }));
  const hmax = Math.max(...hist.map((x) => x.n), 1);
  const spread = card('Sonuç dağılımı (R)', h('div.ra-acard-big', {}, h('b.num', {}, rs.length ? fmtR(rs.reduce((s, x) => s + x, 0) / rs.length) : '—'), h('span.badge-num', {}, 'ortalama R')),
    h('div.ra-days.jr-hist', { style: { gridTemplateColumns: `repeat(${hist.length}, minmax(0, 1fr))` } }, hist.map((x) => h('div.ra-day', { title: `${x.l}R · ${x.n} işlem` },
      h('div.ra-day-bar', {}, h(`i.${x.n ? (x.mid > 0 ? 'pos' : x.mid < 0 ? 'neg' : 'zero') : 'zero'}`, { style: { height: `${Math.max(4, (x.n / hmax) * 100)}%` } })), h('span', {}, x.l), h('b.num.jr-hist-n', {}, String(x.n))))));

  const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
  const runs = card('Seriler ve ortalamalar', h('div.ra-tiles', {},
    tile('Kazanç serisi', String(f.runWin)), tile('Kayıp serisi', String(f.runLoss)), tile('Şu an', f.run ? `${f.run.n} ${f.run.kind === 'win' ? 'kazanç' : 'kayıp'}` : '—', f.run ? (f.run.kind === 'win' ? 'pos' : 'neg') : ''),
    tile('Ort. kazanç', f.avgWin != null ? V(f.avgWin) : '—', 'pos'), tile('Ort. kayıp', f.avgLoss != null ? V(f.avgLoss) : '—', 'neg'), tile('BE', String(f.bes)),
    tile('En iyi', f.best != null ? V(f.best) : '—', tone(f.best ?? 0)), tile('En kötü', f.worst != null ? V(f.worst) : '—', tone(f.worst ?? 0)), tile('Ort. süre', f.hold != null ? F.duration(f.hold) : '—')));

  return [filters, kpis, h('div.ra-acards', {}, curve, bySetup, byGrade, bySession, discipline, byMistake, byDay, heat, ls, spread, byEmotion, bySymbol, byTag, runs)];
}

/** The running total with its zero line; the dates under it. */
function curvePlot(points) {
  const W = 600, H = 210, pad = 8;
  const vals = [0, ...points.map((x) => x.v)];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i) => pad + (i / Math.max(1, vals.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const id = `jc${Math.random().toString(36).slice(2, 8)}`;
  const z = y(0).toFixed(1);
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".26"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${H * g}" y2="${H * g}" stroke="rgba(255,255,255,.05)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
    <line x1="0" x2="${W}" y1="${z}" y2="${z}" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <path d="M${pts[0]} L${pts.join(' L')} L${x(vals.length - 1)},${H} L${x(0)},${H} Z" fill="url(#${id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  svg.style.color = vals.at(-1) >= 0 ? 'var(--pos)' : 'var(--neg)';
  const fmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: tz() });
  const ts = points.map((p) => p.t).filter(fin);
  const dates = ts.length ? [0, 1 / 3, 2 / 3, 1].map((q) => fmt.format(new Date(ts[Math.round(q * (ts.length - 1))] * 1000))) : [];
  return h('div.hub-plot.jr-plot', {}, svg, h('div.hub-dates', {}, dates.map((d) => h('span', {}, d))));
}

// ── more: accounts, the lists, import and export ───────────────────────────
function moreView() {
  const p = P();
  const accRows = p.accounts.map((a) => ({
    icon: a.kind === 'prop' ? 'shield' : a.kind === 'replay' ? 'replay' : 'user', tone: a.kind === 'prop' ? 'amber' : a.kind === 'replay' ? 'violet' : 'teal',
    title: `${a.name}${p.account === a.id ? ' · varsayılan' : ''}`, sub: `${F.money(a.balance || 0, a.currency || 'USD', 0)} · işlem başı risk ${a.risk ? F.money(a.risk, a.currency || 'USD', 0) : 'yok'}`,
    onclick: () => accountSheet(a),
  }));
  const n = (k) => `${p[k].length} seçenek`;
  return [
    group([...accRows, { icon: 'plus', title: 'Hesap ekle', sub: 'FTMO, kişisel ya da replay hesabı', tone: 'grey', onclick: () => accountSheet(null) }], 'Hesaplar'),
    group([
      { icon: 'target', title: 'Setup’lar', sub: n('setups'), tone: 'violet', onclick: () => listSheet('setups', 'Setup’lar') },
      { icon: 'warn', title: 'Hatalar', sub: n('mistakes'), tone: 'rose', onclick: () => listSheet('mistakes', 'Hatalar') },
      { icon: 'user', title: 'Duygular', sub: n('emotions'), tone: 'teal', onclick: () => listSheet('emotions', 'Duygular') },
      { icon: 'sticker', title: 'Etiketler', sub: n('tags'), tone: 'blue', onclick: () => listSheet('tags', 'Etiketler') },
      { icon: 'bolt', title: 'Şablonlar', sub: p.templates.length ? `${p.templates.length} şablon` : 'Formdan “Şablon olarak kaydet”', tone: 'amber', onclick: () => templatesSheet() },
    ], 'Seçenekler'),
    group([
      { icon: 'flask', title: 'TP’nin R değeri', sub: `Fiyat yazılmayan TP işlemleri 1:${F.num(p.rr, 1).replace(/,0$/, '')} sayılır`, tone: 'violet', onclick: () => rrSheet() },
      { icon: 'swap', title: 'Gösterim birimi', sub: p.unit === 'money' ? 'Para' : 'R (risk katı)', tone: 'teal', onclick: async () => { await savePrefs({ unit: p.unit === 'money' ? 'r' : 'money' }); st.unit = null; toast(`Birim: ${jr.prefs.unit === 'money' ? 'para' : 'R'}`, 'ok'); } },
    ], 'Varsayılanlar'),
    group([
      { icon: 'download', title: 'İçe aktar', sub: 'Replay, MetaTrader raporu, CSV, yedek', tone: 'blue', onclick: () => importSheet() },
      { icon: 'data', title: 'CSV olarak indir', sub: `${jr.entries.size} işlem, Excel ve Sheets açar`, tone: 'amber', disabled: !jr.entries.size, onclick: () => exportCsv() },
      { icon: 'shield', title: 'Yedek indir', sub: 'Tüm günlük, notlar ve seçenekler (JSON)', tone: 'grey', onclick: () => exportBackup() },
    ], 'Veri'),
    group([
      { icon: 'replay', title: 'Replay', sub: 'Oturumlar ve strateji testleri', tone: 'rose', onclick: () => go('replay.html') },
      { icon: 'chart', title: 'Grafik', sub: 'Son baktığın piyasa', tone: 'blue', onclick: () => go(chartUrl({ view: 'chart' })) },
    ], 'Uygulamalar'),
    group([
      { icon: 'palette', title: 'Görünüm', sub: 'Tema, vurgu rengi, kâr ve zarar renkleri', onclick: () => appearanceSheet(homeLook) },
      { icon: 'sliders', title: 'Tercihler', sub: `Saat dilimi (${tzName()}), hesap, işlem ücretleri`, tone: 'teal', onclick: () => settingsDialog(host) },
      { icon: 'user', title: 'Profil', sub: 'Profil değiştir, bulut, hesap', tone: 'rose', onclick: () => profileDrawer('profile') },
    ], 'Ayarlar'),
  ];
}

function accountSheet(acc) {
  const p = P();
  const isNew = !acc;
  const a = acc ? structuredClone(acc) : { id: J.newId('a'), name: '', kind: 'prop', currency: 'USD', balance: 100000, risk: 500, daily: 5, maxLoss: 10, target: 10 };
  let makeDefault = isNew ? !p.accounts.length : p.account === a.id;
  const body = h('div.jr-form');
  const num = (k, label, suffix = '') => {
    const el = h('input.rv-input.jr-num', { type: 'text', inputmode: 'decimal', value: fin(a[k]) ? String(a[k]) : '', placeholder: '—', 'aria-label': label });
    el.addEventListener('input', () => { const v = F.parseNumber(el.value); a[k] = v == null || Number.isNaN(v) ? null : v; });
    return h('label.jr-field', {}, h('span', {}, `${label}${suffix ? ` · ${suffix}` : ''}`), el);
  };
  const name = h('input.rv-input', { type: 'text', value: a.name, maxlength: 40, placeholder: 'Örn. FTMO 100K', 'aria-label': 'Hesabın adı' });
  name.addEventListener('input', () => { a.name = name.value; });
  const paint = () => fill(body,
    isNew ? h('div.jr-chips.jr-tpls', {}, J.ACCOUNT_PRESETS.map((x) => h('button.rv-chip', { type: 'button', onclick: () => { const { key, ...rest } = x; Object.assign(a, rest); name.value = a.name; paint(); } }, x.name))) : null,
    h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Adı'), name),
    h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Türü'), h('div.rv-seg.jr-seg.full', {}, J.ACCOUNT_KINDS.map(([k, l]) => h(`button${a.kind === k ? '.on' : ''}`, { type: 'button', onclick: () => { a.kind = k; paint(); } }, l)))),
    h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Para birimi'), h('div.rv-seg.jr-seg.full', {}, ['USD', 'EUR', 'GBP', 'TRY'].map((c) => h(`button${a.currency === c ? '.on' : ''}`, { type: 'button', onclick: () => { a.currency = c; paint(); } }, c)))),
    h('div.jr-pair', {}, num('balance', 'Başlangıç bakiyesi'), num('risk', 'İşlem başı risk')),
    h('small.jr-hint', {}, 'Risk, sonucu R ile yazılan işlemin parasını hesaplar (2R × risk).'),
    h('div.jr-prices', {}, num('daily', 'Günlük zarar', '%'), num('maxLoss', 'Maks. zarar', '%'), num('target', 'Kâr hedefi', '%')),
    h('small.jr-hint', {}, 'Fon hesabının kuralları: boş bırakılanlar gösterilmez.'),
    h('div.rv-group.rv-form', {}, h('div.rv-field', {}, h('span.rv-field-t', {}, h('b', {}, 'Yeni işlemler bu hesaba'), h('small', {}, 'Formda seçili gelir')),
      h(`button.rv-toggle${makeDefault ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(makeDefault), 'aria-label': 'Varsayılan hesap', onclick: () => { makeDefault = !makeDefault; paint(); } }, h('i')))),
  );
  paint();
  const save = async () => {
    a.name = a.name.trim();
    if (!a.name) { name.focus(); toast('Hesaba bir ad ver', 'warn'); return; }
    const list = isNew ? [...p.accounts, a] : p.accounts.map((x) => (x.id === a.id ? a : x));
    try {
      await savePrefs({ accounts: list, account: makeDefault ? a.id : (p.account === a.id ? (list.find((x) => x.id !== a.id)?.id || a.id) : p.account || a.id) });
      // the trades without an account go to the first one made
      const orphans = isNew && list.length === 1 ? all().filter((e) => !e.account) : [];
      if (orphans.length) await putEntries(orphans.map((e) => ({ ...e, account: a.id })));
      toast(isNew ? 'Hesap eklendi' : 'Hesap kaydedildi', 'ok');
      sh.close();
    } catch (err) { toast(err.message, 'err'); }
  };
  const remove = async () => {
    const n = all().filter((e) => e.account === a.id).length;
    if (!(await confirmBox('Hesabı sil', n ? `“${a.name}” silinsin mi? ${n} işlemi silinmez, hesapsız kalır.` : `“${a.name}” silinsin mi?`, 'Sil', 'danger'))) return;
    try {
      const list = p.accounts.filter((x) => x.id !== a.id);
      await savePrefs({ accounts: list, account: p.account === a.id ? list[0]?.id || null : p.account });
      if (st.account === a.id) st.account = 'all';
      sh.close();
      toast('Hesap silindi', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
  const sh = sheet({ title: isNew ? 'Hesap ekle' : 'Hesap', cls: 'jr-edit', body: [body,
    h('button.rv-btn.xl.block', { type: 'button', onclick: save }, icon('check', 18), 'Kaydet'),
    isNew ? null : h('button.rv-link.center', { type: 'button', onclick: remove }, icon('trash', 15), 'Hesabı sil')] });
  if (isNew) setTimeout(() => name.focus(), 80);
}

function listSheet(key, title) {
  const p = P();
  const body = h('div.jr-form');
  const input = h('input.rv-input', { type: 'text', placeholder: 'Yeni ekle', maxlength: 40, 'aria-label': 'Yeni seçenek', enterkeyhint: 'done' });
  const add = async () => {
    const v = input.value.trim();
    if (!v) return;
    if (!p[key].some((x) => J.fold(x) === J.fold(v))) { p[key] = [...p[key], v]; await savePrefs().catch((err) => toast(err.message, 'err')); }
    input.value = '';
    paint();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const used = (x) => all().filter((e) => e.setup === x || e.emotion === x || (e.tags || []).includes(x) || (e.mistakes || []).includes(x)).length;
  const paint = () => fill(body,
    h('div.jr-add-row', {}, input, h('button.rv-btn', { type: 'button', onclick: add }, icon('plus', 16), 'Ekle')),
    p[key].length ? h('div.rv-group.jr-list', {}, p[key].map((x) => h('div.jr-list-row', {},
      h('span.jr-list-t', {}, h('b', {}, x), h('small', {}, `${used(x)} işlemde`)),
      h('button.rv-icon-btn', { type: 'button', title: 'Yukarı', 'aria-label': `${x} yukarı`, disabled: p[key][0] === x, onclick: async () => { const i = p[key].indexOf(x); const l = [...p[key]]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; p[key] = l; await savePrefs(); paint(); } }, icon('up', 16)),
      h('button.rv-icon-btn', { type: 'button', title: 'Kaldır', 'aria-label': `${x} kaldır`, onclick: async () => { p[key] = p[key].filter((y) => y !== x); await savePrefs().catch((err) => toast(err.message, 'err')); paint(); } }, icon('close', 16))))) : h('p.muted.jr-p', {}, 'Liste boş.'),
    h('small.jr-hint', {}, 'Kaldırmak eski işlemleri değiştirmez; formda seçenek olarak görünmez.'));
  paint();
  sheet({ title, cls: 'jr-edit', body: [body] });
}

function templatesSheet() {
  const p = P();
  const body = h('div.jr-form');
  const paint = () => fill(body, p.templates.length
    ? h('div.rv-group.jr-list', {}, p.templates.map((t) => h('div.jr-list-row', {},
      h('span.jr-list-t', {}, h('b', {}, t.name), h('small', {}, [t.fields.symbol, J.SIDE_NAMES[t.fields.side], t.fields.setup, t.fields.grade, t.fields.tf].filter(Boolean).join(' · ') || '—')),
      h('button.rv-icon-btn', { type: 'button', title: 'Bununla yeni işlem', 'aria-label': `${t.name} ile yeni işlem`, onclick: () => { closeSheet(); editSheet(null, structuredClone(t.fields)); } }, icon('plus', 16)),
      h('button.rv-icon-btn', { type: 'button', title: 'Sil', 'aria-label': `${t.name} sil`, onclick: async () => { p.templates = p.templates.filter((x) => x.id !== t.id); await savePrefs().catch((err) => toast(err.message, 'err')); paint(); } }, icon('trash', 16)))))
    : h('p.muted.jr-p', {}, 'Henüz şablon yok. Yeni işlem formunda alanları doldurup “Şablon olarak kaydet”e dokun.'));
  paint();
  sheet({ title: 'Şablonlar', cls: 'jr-edit', body: [body] });
}

function rrSheet() {
  const p = P();
  let rr = p.rr;
  const body = h('div.jr-form');
  const paint = () => fill(body,
    h('p.jr-p', {}, 'TP diye kaydedilen ve fiyatı yazılmayan işlemler bu R ile sayılır. İşlemin kendi R’ı ya da fiyatları yazılıysa onlar geçerlidir.'),
    h('div.rv-seg.jr-seg.full', {}, [1, 1.5, 2, 2.5, 3, 4, 5].map((x) => h(`button${rr === x ? '.on' : ''}`, { type: 'button', onclick: () => { rr = x; paint(); } }, `1:${String(x).replace('.', ',')}`))),
    h('button.rv-btn.xl.block', { type: 'button', onclick: async () => { try { await savePrefs({ rr }); toast('Kaydedildi', 'ok'); closeSheet(); } catch (err) { toast(err.message, 'err'); } } }, 'Kaydet'));
  paint();
  sheet({ title: 'TP’nin R değeri', cls: 'jr-edit', body: [body] });
}

// ── out ─────────────────────────────────────────────────────────────────────
const stamp = () => todayKey().replace(/-/g, '');
function exportCsv() {
  const list = all().reverse();
  const text = IO.toCsv(list, { accountName, rOf: (e) => J.rOf(e, P()), moneyOf: (e) => J.moneyOf(e, P()), sessionName: (e) => J.SESSION_NAMES[J.sessionOfEntry(e)] || '' });
  download(`islem-gunlugu-${stamp()}.csv`, `﻿${text}`, 'text/csv;charset=utf-8');
}
function exportBackup() {
  const data = { app: 'rv-journal', v: 1, exported_at: new Date().toISOString(), prefs: jr.prefs, entries: [...jr.entries.values()], days: [...jr.days.values()] };
  download(`islem-gunlugu-yedek-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

// ── in ──────────────────────────────────────────────────────────────────────
function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { position: 'fixed', left: '-9999px' } });
    inp.addEventListener('change', () => { resolve(inp.files?.[0] || null); inp.remove(); }, { once: true });
    document.body.append(inp);
    inp.click();
  });
}

function importSheet() {
  const sh = sheet({
    title: 'İçe aktar', cls: 'jr-edit',
    body: [
      h('p.jr-p', {}, 'İşlemler sonuçlarıyla gelir; sonra setup, kalite ve notlarını eklersin. Daha önce aktarılanlar ikinci kez gelmez.'),
      group([
        { icon: 'replay', title: 'Replay oturumlarından', sub: `${st.sessions.filter((s) => s.kind !== 'backtest').length} oturumun kapanmış işlemleri`, tone: 'violet', onclick: () => { sh.close(); replayImport(); } },
        { icon: 'chart', title: 'MetaTrader raporu', sub: 'MT4 / MT5: Geçmiş → sağ tık → Rapor (HTML ya da Excel)', tone: 'blue', onclick: async () => { const file = await pickFile('.htm,.html,.xlsx,text/html'); if (file) { sh.close(); fileImport(file); } } },
        { icon: 'data', title: 'CSV dosyası', sub: 'FTMO MetriX “Trading Journal”, cTrader, Excel ya da bu sayfanın CSV’si', tone: 'amber', onclick: async () => { const file = await pickFile('.csv,.txt,text/csv'); if (file) { sh.close(); fileImport(file); } } },
        { icon: 'shield', title: 'Yedekten geri yükle', sub: 'Bu sayfanın JSON yedeği', tone: 'grey', onclick: async () => { const file = await pickFile('.json,application/json'); if (file) { sh.close(); fileImport(file); } } },
      ], null),
    ],
  });
}

/** The account imports go to: one of `kind`, made if there is none. */
async function accountFor(kind, presetKey) {
  const p = P();
  const found = p.accounts.find((a) => a.kind === kind);
  if (found) return found.id;
  const { key, ...preset } = J.ACCOUNT_PRESETS.find((x) => x.key === presetKey);
  const a = { id: J.newId('a'), ...preset };
  await savePrefs({ accounts: [...p.accounts, a], account: p.account || a.id });
  return a.id;
}

function importPreview({ title, trades, accountDefault, onImport, zone = null, note = null }) {
  const p = P();
  const ctl = { account: accountDefault, zone };
  const body = h('div.jr-form');
  const paint = () => {
    const ready = trades(ctl);
    const fresh = ready.filter((t) => !t.dup);
    const net = sum(fresh.map((t) => t.pnl));
    const syms = [...new Set(fresh.map((t) => t.symbol))];
    const ts = fresh.map((t) => t.openAt).filter(fin).sort((a, b) => a - b);
    const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
    fill(body,
      h('div.ra-tiles', {}, tile('Yeni', String(fresh.length)), tile('Zaten var', String(ready.length - fresh.length)), tile('Net', fresh.some((t) => fin(t.pnl)) ? F.signedMoney(net, J.accountOf(p.accounts, ctl.account)?.currency || 'USD', 0) : '—', tone(net))),
      h('p.jr-p.muted', {}, fresh.length ? `${syms.slice(0, 6).join(', ')}${syms.length > 6 ? '…' : ''} · ${ts.length ? `${F.dateOnly(ts[0], tz())} – ${F.dateOnly(ts.at(-1), tz())}` : ''}` : 'Aktarılacak yeni işlem yok.'),
      note ? h('small.jr-hint', {}, note) : null,
      ctl.zone ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Rapordaki saatler'),
        h('div.rv-seg.jr-seg.full', {}, [['server', 'Sunucu'], ['UTC', 'UTC'], ['Europe/Istanbul', 'Türkiye'], [Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', 'Bu cihaz']]
          .filter(([v], i, arr) => arr.findIndex(([w]) => w === v) === i)
          .map(([v, l]) => h(`button${ctl.zone === v ? '.on' : ''}`, { type: 'button', onclick: () => { ctl.zone = v; paint(); } }, l))),
        h('small.jr-hint', {}, 'MetaTrader raporları sunucu saatiyle yazılır (FTMO dahil çoğu: kışın GMT+2, yazın GMT+3).')) : null,
      p.accounts.length ? h('section.jr-sec', {}, h('h4.rv-group-title', {}, 'Hangi hesaba'), h('div.rv-seg.jr-seg', {}, p.accounts.map((a) => h(`button${ctl.account === a.id ? '.on' : ''}`, { type: 'button', onclick: () => { ctl.account = a.id; paint(); } }, a.name)))) : null,
      fresh.length ? h('div.ov-rows.jr-preview', {}, fresh.slice(0, 5).map((t) => h('div.ov-row', {}, symbolBadge(t.symbol, 30),
        h('span.ov-row-t', {}, h('b', {}, `${t.symbol} · ${J.SIDE_NAMES[t.side]}`), h('small', {}, t.openAt ? F.dateTime(t.openAt, tz()) : '—')),
        h(`b.num.ov-row-num.${tone(t.pnl ?? t.r ?? 0)}`, {}, fin(t.pnl) ? F.signedMoney(t.pnl, J.accountOf(p.accounts, ctl.account)?.currency || 'USD') : fmtR(t.r))))) : null,
      h('button.rv-btn.xl.block', { type: 'button', disabled: !fresh.length, onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { const n = await onImport(fresh, ctl); toast(`${n} işlem aktarıldı`, 'ok'); sh.close(); setView('trades'); } catch (err) { toast(err.message, 'err'); ev.currentTarget.disabled = false; }
      } }, icon('download', 18), fresh.length ? `${fresh.length} işlemi aktar` : 'Aktarılacak işlem yok'));
  };
  const sh = sheet({ title, cls: 'jr-edit', body: [body] });
  paint();
  return { repaint: paint, ctl };
}

const refs = () => new Set([...jr.entries.values()].map((e) => e.source?.ref).filter(Boolean));

async function replayImport() {
  const sessions = st.sessions.filter((s) => s.kind !== 'backtest');
  if (!sessions.length) { toast('Henüz replay oturumu yok', 'warn'); return; }
  toast('Replay işlemleri okunuyor…', 'info', 1800);
  const raw = [];
  await Promise.all(sessions.slice(0, 60).map(async (s) => {
    try {
      const full = await api.session(s.id);
      const legs = full.state?.legs?.length ? full.state.legs : full.state?.broker ? [{ symbol: s.summary?.symbol, broker: full.state.broker }] : [];
      for (const l of legs) {
        // the parts of one position (partial closes) are one trade
        const byPos = new Map();
        for (const t of l.broker?.trades || []) {
          const k = t.positionId ?? `t${t.id}`;
          if (!byPos.has(k)) byPos.set(k, []);
          byPos.get(k).push(t);
        }
        for (const [pos, parts] of byPos) {
          const t0 = parts[0], last = parts[parts.length - 1];
          const pnl = sum(parts.map((x) => x.pnl));
          const risk = sum(parts.map((x) => (fin(x.r) && Math.abs(x.r) > 1e-9 ? x.pnl / x.r : null)));
          const r = risk > 0 ? pnl / risk : null;
          const reason = parts.some((x) => x.reason === 'tp') ? 'tp' : last.reason === 'sl' ? 'sl' : 'manual';
          raw.push({
            ref: `replay:${s.id}:${l.symbol || s.summary?.symbol}:${pos}`, sessionName: s.name,
            symbol: J.normalizeSymbol(l.symbol || s.summary?.symbol || '?'), side: t0.side === 'sell' ? 'sell' : 'buy', openAt: t0.entryTime, closeAt: last.exitTime,
            entry: t0.entryPrice, exit: last.exitPrice, sl: t0.sl ?? null, tp: t0.tp ?? null, lots: sum(parts.map((x) => x.qty)), pnl, r,
            outcome: fin(r) && Math.abs(r) < 0.1 ? 'be' : reason, note: parts.map((x) => x.note || x.comment).filter(Boolean).join(' · '), tf: s.summary?.tf || null,
          });
        }
      }
    } catch { /* a session that cannot be read is left out */ }
  }));
  if (!raw.length) { toast('Replay oturumlarında kapanmış işlem yok', 'warn'); return; }
  const have = refs();
  raw.forEach((t) => { t.dup = have.has(t.ref); });
  raw.sort((a, b) => (b.openAt ?? 0) - (a.openAt ?? 0));
  const def = P().accounts.find((a) => a.kind === 'replay')?.id || null;
  importPreview({
    title: 'Replay’den aktar', trades: () => raw, accountDefault: def,
    note: def ? null : 'Replay işlemleri ayrı bir “Replay” hesabına gider; gerçek hesabının sayıları karışmaz.',
    onImport: async (fresh, ctl) => {
      const account = ctl.account || await accountFor('replay', 'replay');
      await putEntries(fresh.map((t) => ({ ...blank(), id: J.newId(), account, symbol: t.symbol, side: t.side, openAt: t.openAt, closeAt: t.closeAt,
        entry: t.entry, exit: t.exit, sl: t.sl, tp: t.tp, lots: t.lots, pnl: fin(t.pnl) ? t.pnl : null, r: fin(t.r) ? t.r : null, outcome: t.outcome, tf: t.tf,
        note: t.note || '', tags: ['Replay'], source: { kind: 'replay', ref: t.ref } })));
      return fresh.length;
    },
  });
}

async function fileImport(file) {
  let buf;
  try { buf = await file.arrayBuffer(); } catch (err) { toast(`Dosya okunamadı: ${err.message}`, 'err'); return; }
  const kind = IO.kindOf(file.name, buf);
  if (kind === 'json') {
    let data;
    try { data = JSON.parse(IO.decodeText(buf)); } catch { toast('Bu bir yedek dosyası değil', 'err'); return; }
    if (data?.app !== 'rv-journal') { toast('Bu bir günlük yedeği değil', 'err'); return; }
    if (!(await confirmBox('Yedekten geri yükle', `${(data.entries || []).length} işlem, ${(data.days || []).length} gün notu. Buradakiler silinmez; aynı kaydın yenisi kalır.`, 'Geri yükle'))) return;
    try { const n = await mergeBackup(data); toast(n ? `${n} işlem geri yüklendi` : 'Yeni bir şey yoktu', 'ok'); } catch (err) { toast(err.message, 'err'); }
    return;
  }
  let rows;
  try {
    rows = kind === 'xlsx' ? await IO.xlsxRows(buf) : kind === 'html' ? IO.htmlRows(IO.decodeText(buf)) : IO.csvRows(IO.decodeText(buf));
  } catch (err) { toast(`Dosya okunamadı: ${err.message}`, 'err'); return; }
  const { trades: raw, how } = IO.tradesOf(rows, kind === 'csv' ? 'header' : 'mt');
  if (!raw.length) { toast('Dosyada kapanmış işlem bulunamadı. MetaTrader’da “Pozisyonlar” görünümünden rapor al.', 'err', 6000); return; }
  const have = new Set([...jr.entries.values()].map((e) => e.source?.ref).filter(Boolean));
  const keyOf = new Set([...jr.entries.values()].map((e) => `${e.symbol}|${e.side}|${Math.round((e.openAt || 0) / 60)}`));
  const hasOwnZone = raw.every((t) => t.open?.t != null);
  const p = P();
  const prop = p.accounts.find((a) => a.kind === 'prop')?.id || p.account || null;
  const build = (zone) => raw.map((t) => {
    const openAt = IO.wallToUnix(t.open, zone), closeAt = IO.wallToUnix(t.close, zone);
    const ref = t.ticket ? `${how === 'mt' ? 'mt' : 'csv'}:${t.ticket}` : `${how === 'mt' ? 'mt' : 'csv'}:${t.symbol}:${t.side}:${openAt}`;
    return { ...t, openAt, closeAt, ref, dup: have.has(ref) || keyOf.has(`${t.symbol}|${t.side}|${Math.round((openAt || 0) / 60)}`) };
  });
  let cache = { zone: undefined, list: null };
  importPreview({
    title: how === 'mt' ? 'MetaTrader raporu' : 'CSV dosyası',
    trades: (ctl) => { const z = ctl.zone || 'UTC'; if (cache.zone !== z) cache = { zone: z, list: build(z) }; return cache.list; },
    accountDefault: prop, zone: hasOwnZone ? null : 'server',
    note: `${file.name} · ${raw.length} işlem okundu`,
    onImport: async (fresh, ctl) => {
      const account = ctl.account || prop || null;
      const acc = J.accountOf(P().accounts, account);
      await putEntries(fresh.map((t) => {
        const e = { ...blank(), id: J.newId(), account: t.account && P().accounts.find((a) => a.name === t.account)?.id || account, symbol: t.symbol, side: t.side, openAt: t.openAt, closeAt: t.closeAt,
          entry: t.entry, exit: t.exit, sl: t.sl, tp: t.tp, lots: t.lots, pnl: fin(t.pnl) ? t.pnl : null, r: fin(t.r) ? t.r : null, outcome: t.outcome || null,
          setup: t.setup || null, grade: t.grade || null, note: t.note || '', tags: t.tags || [], mistakes: t.mistakes || [], emotion: t.emotion || null, tf: t.tf || null,
          plan: t.plan ?? null, links: t.links || [], source: { kind: how === 'mt' ? 'mt' : 'csv', ref: t.ref } };
        // R: from the account's fixed risk, else from the prices; the result from it
        if (!fin(e.r)) e.r = acc?.risk > 0 && fin(e.pnl) ? e.pnl / acc.risk : J.priceR(e);
        if (!e.outcome) e.outcome = fin(e.r) && Math.abs(e.r) < 0.1 ? 'be' : (fin(e.tp) && fin(e.exit) && Math.abs(e.exit - e.tp) <= Math.abs(e.tp) * 2e-4) ? 'tp' : (fin(e.sl) && fin(e.exit) && Math.abs(e.exit - e.sl) <= Math.abs(e.sl) * 2e-4) ? 'sl' : 'manual';
        return e;
      }));
      return fresh.length;
    },
  });
}

// ── the search ──────────────────────────────────────────────────────────────
function items() {
  const out = baseItems().filter((x) => x.label !== 'Yeni işlem kaydı' && x.label !== 'Günlük');
  const add = (label, run, extra = {}) => out.push({ group: 'Günlük', label, run, ...extra });
  add('Yeni işlem', () => editSheet(), { icon: 'plus', keys: 'kaydet ekle trade', kbd: 'N' });
  add('Takvim', () => setView('calendar'), { icon: 'calendar' });
  add('Günlük analizi', () => setView('analytics'), { icon: 'indicator', keys: 'istatistik' });
  add('Bugünün notu', () => daySheet(todayKey()), { icon: 'edit', keys: 'plan değerlendirme' });
  add('İçe aktar', () => importSheet(), { icon: 'download', keys: 'mt5 mt4 csv replay ftmo' });
  add('CSV olarak indir', () => exportCsv(), { icon: 'data', keys: 'dışa aktar excel' });
  for (const e of all().slice(0, 40)) {
    const r = J.rOf(e, P());
    out.push({ group: 'İşlemler', label: `${e.symbol} ${sideText(e)}${r != null ? ` ${fmtR(r)}` : ''}`, sub: [dayLabel(J.dayKey(J.timeOf(e) ?? 0, tz()), true), e.setup].filter(Boolean).join(' · '), icon: 'journal', keys: `${e.setup || ''} ${e.note || ''} ${(e.tags || []).join(' ')}`, run: () => tradeSheet(e) });
  }
  return out;
}

main();
