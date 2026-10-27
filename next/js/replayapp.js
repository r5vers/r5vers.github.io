// The Replay app (Alltra's Backtest). Phones: a header of light, the
// Replay / Strategy switch, new session and continue, filter chips, session
// rows; at the foot the app's tabs (sessions · analysis · more). Wide
// screens: the app's sections in a sidebar, a banner, the sessions as a grid
// of cards (P&L, day of the replay, progress). A session opens in a sheet
// (a drawer on a wide screen).
import { api } from './api.js?v=131e7ce3e0';
import * as F from './format.js?v=131e7ce3e0';
import { confirmBox, h, icon, toast } from './ui/dom.js?v=131e7ce3e0';
import { SESSION_SETS } from './chart/sessions.js?v=131e7ce3e0';
import { nyOffset } from './core/timeframes.js?v=131e7ce3e0';
import { wirePalette } from './ui/palette.js?v=131e7ce3e0';
import { settingsDialog } from './ui/dialogs.js?v=131e7ce3e0';
import { WIDE, appFrame, appearanceSheet, avatarButton, baseItems, bootShell, chartUrl, dock, go, group, homeLook, host, markButton, pillTab, profileDrawer, relTime, ring, sheet, symbolBadge, tz } from './rvshell.js?v=131e7ce3e0';

/** A replay's result: its balance against where it started (closed and open trades). */
const netOf = (sm = {}) => (sm.balance != null && sm.initial != null ? sm.balance - sm.initial : sm.net ?? 0);

const st = { sessions: [], datasets: [], loaded: false, kind: 'replay', filter: 'all', view: 'sessions', trades: null, tradesLoading: false };

const fromHash = () => {
  const x = location.hash.slice(1);
  st.view = x === 'analiz' ? 'analytics' : x === 'diger' ? 'more' : 'sessions';
  st.kind = x === 'testler' ? 'test' : st.view === 'sessions' && x !== 'testler' ? 'replay' : st.kind;
};

async function main() {
  fromHash();
  let me;
  try { me = await bootShell(render); } catch (err) { document.getElementById('ra-root').textContent = `Açılamadı: ${err.message}`; return; }
  if (!me) return;
  render();
  wirePalette(() => baseItems(), { typeToSearch: true });
  window.addEventListener('hashchange', () => { fromHash(); render(); });
  const [sessions, datasets] = await Promise.all([api.sessions().catch(() => []), api.datasets().catch(() => [])]);
  st.sessions = sessions;
  st.datasets = datasets;
  st.loaded = true;
  render();
}

const replays = () => st.sessions.filter((s) => s.kind !== 'backtest');
const tests = () => st.sessions.filter((s) => s.kind === 'backtest');
function setView(v, kind = st.kind) {
  st.view = v; st.kind = kind; st.filter = 'all';
  const hash = v === 'analytics' ? 'analiz' : v === 'more' ? 'diger' : kind === 'test' ? 'testler' : '';
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  const root = document.getElementById('ra-root');
  const wide = WIDE.matches;
  const sectionId = st.view === 'sessions' ? st.kind : st.view;
  const label = { replay: 'Oturumlar', test: 'Testler', analytics: 'Analiz', more: 'Diğer' }[sectionId];
  appFrame({
    current: st.view === 'analytics' ? 'analytics' : 'replay',
    section: sectionId,
    sections: [
      { id: 'replay', label: 'Oturumlar', icon: 'clock', count: st.loaded ? replays().length : null, onclick: () => setView('sessions', 'replay') },
      { id: 'analytics', label: 'Analiz', icon: 'indicator', tone: 'violet', onclick: () => setView('analytics') },
      { id: 'test', label: 'Strateji testleri', icon: 'flask', tone: 'teal', count: st.loaded ? tests().length : null, onclick: () => setView('sessions', 'test') },
      '-',
      { id: 'chart', label: 'Grafik', icon: 'chart', tone: 'blue', onclick: () => go(chartUrl({ view: 'chart' })) },
      { id: 'data', label: 'Veri paketleri', icon: 'data', tone: 'amber', onclick: () => go(chartUrl({ tab: 'data' })) },
      { id: 'cal', label: 'Ekonomik takvim', icon: 'news', tone: 'rose', soon: true },
    ],
    crumbs: ['Replay', label],
    actions: [h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl(st.kind === 'test' ? { tab: 'strategy' } : { new: 'replay' })) }, icon('plus', 17), st.kind === 'test' ? 'Yeni test' : 'Yeni oturum')],
    promo: promoCard(),
  });
  root.className = `ra ra-${st.view}${wide ? ' ra-wide' : ''}`;
  const body = st.view === 'analytics' ? analytics() : st.view === 'more' ? more() : (wide ? sessionsWide() : sessionsPhone());
  const title = { sessions: st.kind === 'test' ? 'Strateji' : 'Replay', analytics: 'Analiz', more: 'Diğer' }[st.view];
  root.replaceChildren(
    wide ? h('span') : h('div.ra-aurora', { 'aria-hidden': 'true' }),
    wide ? h('span') : h('header.ra-top', {}, h('h1', {}, title), avatarButton()),
    ...body);
  if (wide) { document.getElementById('rv-dock')?.remove(); return; }
  dock({
    left: markButton('replay'),
    center: [
      pillTab({ icon: 'clock', label: 'Oturumlar', on: st.view === 'sessions', onclick: () => setView('sessions', st.kind) }),
      pillTab({ icon: 'indicator', label: 'Analiz', on: st.view === 'analytics', onclick: () => setView('analytics') }),
      pillTab({ icon: 'apps', label: 'Diğer', on: st.view === 'more', onclick: () => setView('more') }),
    ],
    right: { icon: 'plus', label: st.kind === 'test' ? 'Yeni strateji testi' : 'Yeni replay oturumu', onclick: () => go(chartUrl(st.kind === 'test' ? { tab: 'strategy' } : { new: 'replay' })) },
  });
}

function promoCard() {
  const last = replays()[0];
  return h('button.rv-promo', { type: 'button', onclick: () => go(last ? chartUrl({ session: last.id }) : chartUrl({ new: 'replay' })) },
    h('span.rv-promo-art', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span.rv-promo-play', {}, icon('play', 16))),
    h('b', {}, last ? 'Kaldığın yerden devam' : 'İlk oturumunu başlat'),
    h('small', {}, last ? `${last.name} · ${relTime(last.updated_at)}` : 'Bir tarih seç, bar bar ilerle'));
}

// ── sessions ─────────────────────────────────────────────────────────────
const FILTERS = {
  replay: [['all', 'Tümü', () => true], ['open', 'Açık', (s) => (s.summary?.open || 0) > 0], ['up', 'Kârda', (s) => netOf(s.summary) > 0], ['down', 'Zararda', (s) => netOf(s.summary) < 0]],
  test: [['all', 'Tümü', () => true], ['up', 'Kârda', (s) => (s.summary?.returnPct ?? 0) > 0], ['down', 'Zararda', (s) => (s.summary?.returnPct ?? 0) < 0]],
};
function filtered() {
  const all = st.kind === 'test' ? tests() : replays();
  const filters = FILTERS[st.kind];
  if (!filters.some(([v]) => v === st.filter)) st.filter = 'all';
  return { all, filters, rows: all.filter(filters.find(([v]) => v === st.filter)[2]) };
}
const heroText = () => (st.kind === 'test'
  ? ['Stratejini yıllarca veride sına.', 'Kuralını yaz, 15 yıllık veride saniyeler içinde çalıştır; her test sonuçlarıyla burada saklanır.']
  : ['Herhangi bir piyasayı yeniden yaşa.', 'Gerçek fiyat hareketini bar bar ilerlet, stratejini canlıymış gibi işle.']);
const newUrl = () => chartUrl(st.kind === 'test' ? { tab: 'strategy' } : { new: 'replay' });

function chips(all, filters) {
  return h('div.rv-seg', { role: 'tablist' }, filters.map(([v, l, f]) => {
    const n = all.filter(f).length;
    return h(`button${st.filter === v ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(st.filter === v), disabled: v !== 'all' && !n, onclick: () => { st.filter = v; render(); } }, l, h('small', {}, String(n)));
  }));
}

function sessionsPhone() {
  const { all, filters, rows } = filtered();
  const [t, sub] = heroText();
  const last = replays()[0];
  const test = st.kind === 'test';
  return [
    h('div.ra-kind', { role: 'tablist' }, [['replay', 'Replay'], ['test', 'Strateji']].map(([k, l]) =>
      h(`button${st.kind === k ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(st.kind === k), onclick: () => setView('sessions', k) }, l))),
    h('section.ra-hero', {}, h('h2', {}, t), h('p', {}, sub),
      h('div.ra-cta', {},
        h('button.rv-btn.xl', { type: 'button', onclick: () => go(newUrl()) }, test ? 'Yeni test' : 'Yeni oturum'),
        !test && last ? h('button.rv-round', { type: 'button', title: `Devam et: ${last.name}`, 'aria-label': `Devam et: ${last.name}`, onclick: () => go(chartUrl({ session: last.id })) }, icon('play', 22)) : null)),
    h('div.ra-sec-head', {}, h('h3', {}, test ? 'Testler' : 'Oturumlar'), chips(all, filters)),
    listOf(all, rows, (s) => (test ? testRow(s) : sessionRow(s)), 'ra-list'),
  ];
}

function sessionsWide() {
  const { all, filters, rows } = filtered();
  const [t, sub] = heroText();
  const test = st.kind === 'test';
  return [
    h('section.gl.ra-banner', {},
      h('div.ra-banner-txt', {},
        h('span.eyebrow', {}, test ? 'Strateji testi' : 'Replay · klasik mod'),
        h('h2', {}, t), h('p', {}, sub),
        h('div.row', {},
          h('button.rv-btn.lg', { type: 'button', onclick: () => go(newUrl()) }, test ? 'Yeni test' : 'Yeni oturum'),
          h('button.rv-btn.ghost.lg', { type: 'button', onclick: () => document.getElementById('ra-panel')?.scrollIntoView({ behavior: 'smooth' }) }, test ? 'Testleri görüntüle' : 'Oturumları görüntüle'))),
      h('div.ra-banner-art', { 'aria-hidden': 'true' }, h('i.r1'), h('i.r2'), h('i.r3'), h('span.ra-banner-core', {}, icon(test ? 'flask' : 'replay', 46)))),
    h('section.gl.ra-panel', { id: 'ra-panel' },
      h('header.ra-panel-head', {}, h('h3', {}, test ? 'Testler' : 'Oturumlar', h('small', {}, `${all.length} ${test ? 'test' : 'oturum'}`)), chips(all, filters)),
      listOf(all, rows, (s) => (test ? testCard(s) : sessionCard(s)), 'ra-grid')),
  ];
}

function listOf(all, rows, make, cls) {
  if (!st.loaded) return h(`div.${cls}`, {}, [0, 1, 2].map(() => h('div.skel.card')));
  if (!all.length) {
    return h('div.ra-empty', {}, h('span.ra-empty-ic', {}, icon(st.kind === 'test' ? 'flask' : 'replay', 26)),
      h('b', {}, st.kind === 'test' ? 'Henüz strateji testi yok' : 'Henüz replay oturumu yok'),
      h('p', {}, st.kind === 'test' ? 'Strateji sekmesinde bir kural yazıp çalıştırınca burada görünür.' : 'Geçmişte bir tarih seç, grafik o ana kadar olanı göstersin.'),
      h('button.rv-btn', { type: 'button', onclick: () => go(newUrl()) }, icon('plus', 16), st.kind === 'test' ? 'Yeni test' : 'Yeni oturum'));
  }
  if (!rows.length) return h('div.ra-empty', {}, h('p', {}, 'Bu süzgece uyan kayıt yok.'));
  return h(`div.${cls}`, {}, rows.map(make));
}

const money = (sm) => sm?.currency || 'USD';
const symOf = (sm) => (sm?.symbols?.[0] || String(sm?.symbol || '').split(' · ')[0] || '?');
const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');

/** Where a replay stands in its data: day n of N. */
function progress(s) {
  const sm = s.summary || {};
  const end = st.datasets.find((d) => d.id === s.dataset_id)?.last_ts;
  const day = sm.startTime && sm.cursor ? Math.max(1, Math.ceil((sm.cursor - sm.startTime) / 86400)) : 1;
  const total = sm.startTime && end ? Math.max(day, Math.ceil((end - sm.startTime) / 86400)) : null;
  return { day, total, frac: total ? Math.min(1, day / total) : 0, end };
}

function sessionRow(s) {
  const sm = s.summary || {};
  const bal = sm.balance ?? sm.initial;
  return h('button.gl.ra-row', { type: 'button', onclick: () => sessionSheet(s) },
    symbolBadge(symOf(sm), 44),
    h('span.ra-row-t', {}, h('b', {}, s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${relTime(s.updated_at)}`)),
    h(`span.ra-row-v.num.${tone(netOf(sm))}`, {}, bal != null ? F.money(bal, money(sm), 0) : '—'));
}
function testRow(s) {
  const sm = s.summary || {};
  return h('button.gl.ra-row', { type: 'button', onclick: () => testSheet(s) },
    h('span.rv-row-ic.c-violet.lg', {}, icon('flask', 20)),
    h('span.ra-row-t', {}, h('b', {}, sm.strategy || s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${relTime(s.created_at)}`)),
    h(`span.ra-row-v.num.${tone(sm.returnPct ?? 0)}`, {}, sm.returnPct != null ? `${sm.returnPct > 0 ? '+' : ''}${F.pct(sm.returnPct, 1)}` : '—'));
}

function sessionCard(s) {
  const sm = s.summary || {};
  const net = netOf(sm), init = sm.initial || 10000;
  const pr = progress(s);
  return h('article.ra-card', { tabindex: '0', onclick: () => sessionSheet(s), onkeydown: (e) => { if (e.key === 'Enter') sessionSheet(s); } },
    h('header', {}, symbolBadge(symOf(sm), 34), h('div', {}, h('b', {}, s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
      h('button.rv-icon-btn', { type: 'button', title: 'Seçenekler', 'aria-label': 'Seçenekler', onclick: (e) => { e.stopPropagation(); sessionSheet(s); } }, icon('more', 18))),
    h('div.ra-card-pl', {}, h(`b.num.${tone(net)}`, {}, F.signedMoney(net, money(sm), Math.abs(net) >= 1000 ? 0 : 2)), h(`span.badge-num.${tone(net)}`, {}, `${net > 0 ? '+' : ''}${F.pct(net / init, 2)}`)),
    h('div.ra-card-day', {}, h('b', {}, `Gün ${pr.day}${pr.total ? ` / ${pr.total}` : ''}`), h('span', {}, pr.total ? `${pr.total - pr.day} gün kaldı` : 'bitiş yok')),
    h('div.ra-bar', {}, h('i', { style: { width: `${Math.max(1.5, pr.frac * 100).toFixed(1)}%` } })),
    h('div.ra-card-dates', {}, h('span', {}, sm.startTime ? F.dateOnly(sm.startTime, tz()) : '—'), h('span', {}, pr.end ? F.dateOnly(pr.end, tz()) : '—')));
}
function testCard(s) {
  const sm = s.summary || {};
  return h('article.ra-card', { tabindex: '0', onclick: () => testSheet(s) },
    h('header', {}, h('span.rv-row-ic.c-violet', {}, icon('flask', 17)), h('div', {}, h('b', {}, sm.strategy || s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
      h('button.rv-icon-btn', { type: 'button', 'aria-label': 'Seçenekler', onclick: (e) => { e.stopPropagation(); testSheet(s); } }, icon('more', 18))),
    h('div.ra-card-pl', {}, h(`b.num.${tone(sm.returnPct ?? 0)}`, {}, sm.returnPct != null ? `${sm.returnPct > 0 ? '+' : ''}${F.pct(sm.returnPct, 2)}` : '—'), h(`span.badge-num.${tone(sm.net ?? 0)}`, {}, F.signedMoney(sm.net, money(sm), 0))),
    h('div.ra-card-day', {}, h('b', {}, `${sm.trades ?? 0} işlem`), h('span', {}, `Kazanma ${sm.winRate != null ? F.pct(sm.winRate, 0) : '—'}`)),
    h('div.ra-bar', {}, h('i', { style: { width: `${Math.max(1.5, (sm.winRate ?? 0) * 100).toFixed(1)}%` } })),
    h('div.ra-card-dates', {}, h('span', {}, F.dateOnly(sm.from, 'UTC')), h('span', {}, F.dateOnly(sm.to, 'UTC'))));
}

const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v));
const pf = (x) => (x === 'inf' ? '∞' : x == null ? '—' : F.num(x, 2));

function sessionSheet(s) {
  const sm = s.summary || {};
  const ccy = money(sm);
  const bal = sm.balance ?? sm.initial ?? 0, initial = sm.initial ?? 10000;
  const ret = initial ? (bal - initial) / initial : 0;
  const pr = progress(s);
  const sh = sheet({
    title: 'Replay oturumu', cls: 'session',
    body: [
      h('div.ra-sh-head', {}, symbolBadge(symOf(sm), 44), h('div', {}, h('b', {}, s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`))),
      h(`div.ra-sh-big.num.${tone(ret)}`, {}, F.money(bal, ccy)),
      h(`span.badge-num.lg.${tone(ret)}`, {}, `${ret > 0 ? '+' : ''}${F.pct(ret, 2)}`),
      h('div.ra-sh-progress', {},
        h('div.ra-card-day', {}, h('b', {}, `Gün ${pr.day}${pr.total ? ` / ${pr.total}` : ''}`), h('span', {}, sm.open ? `${sm.open} açık pozisyon` : pr.total ? `${pr.total - pr.day} gün kaldı` : '')),
        h('div.ra-bar', {}, h('i', { style: { width: `${Math.max(1.5, pr.frac * 100).toFixed(1)}%` } })),
        h('div.ra-card-dates', {}, h('span', {}, sm.startTime ? F.dateOnly(sm.startTime, tz()) : '—'), h('span', {}, sm.cursor ? F.dateTime(sm.cursor, tz()) : '—'))),
      h('div.ra-tiles', {},
        tile('Başlangıç', F.money(initial, ccy, 0)), tile('Bakiye', F.money(bal, ccy, 0), tone(ret)), tile('Kazanma', sm.winRate != null ? F.pct(sm.winRate, 1) : '—'),
        tile('İşlem', String(sm.trades ?? 0)), tile('Kâr faktörü', pf(sm.profitFactor)), tile('Maks. düşüş', sm.maxDrawdownPct != null ? F.pct(sm.maxDrawdownPct, 1) : '—')),
      h('div.ra-sh-actions', {},
        h('button.rv-round', { type: 'button', title: 'Kopyasını oluştur', 'aria-label': 'Kopyasını oluştur', onclick: () => duplicate(s, sh) }, icon('copy', 21)),
        h('button.rv-btn.xl', { type: 'button', onclick: () => go(chartUrl({ session: s.id })) }, icon('play', 18), 'Devam et'),
        h('button.rv-round.danger', { type: 'button', title: 'Sil', 'aria-label': 'Oturumu sil', onclick: () => remove(s, sh) }, icon('trash', 21))),
      h('button.rv-link.center', { type: 'button', onclick: () => rename(s, sh) }, icon('edit', 15), 'Adını değiştir'),
    ],
  });
}

function testSheet(s) {
  const sm = s.summary || {};
  const ccy = money(sm);
  const sh = sheet({
    title: 'Strateji testi', cls: 'session',
    body: [
      h('div.ra-sh-head', {}, h('span.rv-row-ic.c-violet.lg', {}, icon('flask', 20)), h('div', {}, h('b', {}, sm.strategy || s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`))),
      h(`div.ra-sh-big.num.${tone(sm.returnPct ?? 0)}`, {}, sm.returnPct != null ? `${sm.returnPct > 0 ? '+' : ''}${F.pct(sm.returnPct, 2)}` : '—'),
      h(`span.badge-num.lg.${tone(sm.net ?? 0)}`, {}, F.signedMoney(sm.net, ccy)),
      h('div.ra-card-dates', {}, h('span', {}, F.dateOnly(sm.from, 'UTC')), h('span', {}, F.dateOnly(sm.to, 'UTC'))),
      h('div.ra-tiles', {},
        tile('İşlem', String(sm.trades ?? 0)), tile('Kazanma', sm.winRate != null ? F.pct(sm.winRate, 1) : '—'), tile('Kâr faktörü', pf(sm.profitFactor)),
        tile('Net', F.signedMoney(sm.net, ccy, 0), tone(sm.net ?? 0)), tile('Maks. düşüş', sm.maxDrawdownPct != null ? F.pct(sm.maxDrawdownPct, 1) : '—'), tile('Tarih', relTime(s.created_at))),
      h('div.ra-sh-actions', {},
        h('span.rv-round.ghost'),
        h('button.rv-btn.xl', { type: 'button', onclick: () => go(chartUrl({ backtest: s.id })) }, icon('chart', 18), 'Sonuçları aç'),
        h('button.rv-round.danger', { type: 'button', title: 'Sil', 'aria-label': 'Testi sil', onclick: () => remove(s, sh) }, icon('trash', 21))),
    ],
  });
}

async function remove(s, sh) {
  if (!(await confirmBox('Sil', `“${s.name}” silinsin mi? Bu geri alınamaz.`, 'Sil', 'danger'))) return;
  try {
    await api.deleteSession(s.id);
    st.sessions = st.sessions.filter((x) => x.id !== s.id);
    st.trades = null;
    sh.close();
    render();
    toast('Silindi', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

async function duplicate(s, sh) {
  try {
    const full = await api.session(s.id);
    await api.createSession({ name: `${s.name} (kopya)`, dataset_id: s.dataset_id, kind: s.kind, state: full.state, summary: full.summary || s.summary });
    st.sessions = await api.sessions();
    sh.close();
    render();
    toast('Kopyası oluşturuldu', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

function rename(s, sh) {
  const input = h('input.rv-input', { type: 'text', value: s.name, maxlength: 80, 'aria-label': 'Oturumun adı' });
  const save = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try { await api.updateSession(s.id, { name }); s.name = name; sh2.close(); render(); } catch (err) { toast(err.message, 'err'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sh.close();
  const sh2 = sheet({ title: 'Adını değiştir', body: [h('label.rv-label', {}, 'Oturumun adı'), input, h('button.rv-btn.xl.block', { type: 'button', onclick: save }, 'Kaydet')] });
  setTimeout(() => input.select(), 60);
}

// ── analysis: every closed trade of the replay sessions ───────────────────
async function loadTrades() {
  if (st.trades || st.tradesLoading || !st.loaded) return;
  st.tradesLoading = true;
  const out = [];
  await Promise.all(replays().slice(0, 40).map(async (s) => {
    try {
      const full = await api.session(s.id);
      for (const l of full.state?.legs || []) for (const t of l.broker?.trades || []) out.push({ ...t, symbol: l.symbol });
    } catch { /* a session that cannot be read is left out */ }
  }));
  st.trades = out;
  st.tradesLoading = false;
  if (st.view === 'analytics') render();
}

const ZONE_NAMES = { ASIA: 'Asya', LONDON: 'Londra', 'NEW YORK': 'New York' };
function zoneOf(t) {
  const local = t + nyOffset(t);
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  const z = SESSION_SETS[0].zones;
  const lon = z.find((x) => x.name === 'LONDON'), ny = z.find((x) => x.name === 'NEW YORK');
  if (min >= ny.from && min < ny.to) return 'NEW YORK';
  if (min >= lon.from && min < ny.from) return 'LONDON';
  return 'ASIA';
}

function analytics() {
  if (!st.loaded || !st.trades) {
    if (st.loaded) loadTrades();
    return [h('div.ra-kpis', {}, [0, 1, 2, 3].map(() => h('div.skel.kpi'))), h('div.ra-acards', {}, [0, 1].map(() => h('div.skel.acard')))];
  }
  const trades = st.trades;
  if (!trades.length) {
    return [h('div.ra-empty', {}, h('span.ra-empty-ic', {}, icon('indicator', 26)), h('b', {}, 'Analiz için kapanmış işlem yok'),
      h('p', {}, 'Replay’de işlem açıp kapattıkça seans, gün ve saat dağılımın burada çıkar.'),
      h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'Replay başlat'))];
  }
  const ccy = replays()[0]?.summary?.currency || 'USD';
  const sum = (xs) => xs.reduce((s, t) => s + t.pnl, 0);
  const net = sum(trades);
  const wins = trades.filter((t) => t.pnl > 0);
  const gw = sum(wins), gl = -sum(trades.filter((t) => t.pnl < 0));
  const pfv = gl > 0 ? gw / gl : null;
  const kpi = (k, v, cls, extra = null) => h('article.gl.ra-kpi', {}, h('div', {}, h('span', {}, k), h(`b.num${cls ? `.${cls}` : ''}`, {}, v)), extra);
  const kpis = h('div.ra-kpis', {},
    kpi('Net K/Z', F.signedMoney(net, ccy), tone(net)),
    kpi('Kâr faktörü', pfv != null ? F.num(pfv, 2) : '∞', '', ring(pfv != null ? pfv / (pfv + 1) : 1, { size: 60, stroke: 6, tone: pfv != null && pfv < 1 ? 'neg' : 'pos' })),
    kpi('Kazanma oranı', F.pct(wins.length / trades.length, 1), '', ring(wins.length / trades.length, { size: 60, stroke: 6, tone: wins.length / trades.length < 0.5 ? 'neg' : 'pos' })),
    kpi('İşlem', String(trades.length), ''));

  const zones = ['ASIA', 'LONDON', 'NEW YORK'].map((z) => { const xs = trades.filter((t) => zoneOf(t.entryTime) === z); return { z, n: xs.length, pnl: sum(xs) }; });
  const zmax = Math.max(...zones.map((x) => Math.abs(x.pnl)), 1e-9);
  const upZones = zones.filter((x) => x.pnl > 0).length;
  const bySession = card('Seanslara göre K/Z', h('div.ra-acard-big', {}, h(`b.num.${tone(net)}`, {}, F.signedMoney(net, ccy)), h(`span.badge-num.${upZones >= 2 ? 'pos' : ''}`, {}, `${upZones}/3 kârda`)),
    h('div.ra-cols', {}, zones.map((x) => h('div.ra-col', {},
      h('span.ra-col-k', {}, ZONE_NAMES[x.z]), h('span.ra-col-n', {}, h('b.num', {}, String(x.n)), ' işlem'),
      h('div.ra-col-bar', {}, h(`i.${tone(x.pnl) || 'zero'}`, { style: { height: `${Math.max(8, (Math.abs(x.pnl) / zmax) * 100)}%` } })),
      h(`span.ra-col-v.num.${tone(x.pnl)}`, {}, F.signedMoney(x.pnl, ccy))))));

  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hourCycle: 'h23', timeZone: tz() });
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const when = trades.map((t) => { const parts = fmt.formatToParts(new Date(t.entryTime * 1000)); return { d: DAYS.indexOf(parts.find((p) => p.type === 'weekday').value), hr: Number(parts.find((p) => p.type === 'hour').value) % 24, t }; });
  const days = WEEK.map((d) => { const xs = when.filter((w) => w.d === d).map((w) => w.t); return { d, n: xs.length, pnl: sum(xs) }; });
  const dmax = Math.max(...days.map((x) => Math.abs(x.pnl)), 1e-9);
  const best = [...days].filter((x) => x.n).sort((a, b) => b.pnl - a.pnl)[0] || days[0];
  const byDay = card('Haftanın günleri', h('div.ra-acard-big', {}, h(`b.num.${tone(best.pnl)}`, {}, F.signedMoney(best.pnl, ccy)), h('span.badge-num', {}, `en iyi gün: ${TR[best.d]}`)),
    h('div.ra-days', {}, days.map((x) => h('div.ra-day', {}, h('div.ra-day-bar', {}, h(`i.${tone(x.pnl) || 'zero'}`, { style: { height: `${Math.max(6, (Math.abs(x.pnl) / dmax) * 100)}%` } })), h('span', {}, TR[x.d])))));

  const cells = new Map();
  for (const w of when) { const k = `${w.d}:${Math.floor(w.hr / 2)}`; cells.set(k, (cells.get(k) || 0) + w.t.pnl); }
  const cmax = Math.max(...[...cells.values()].map(Math.abs), 1e-9);
  const heat = card('İşlem saati', h('div.ra-acard-big', {}, h('b.num', {}, `${trades.length} işlem`), h('span.badge-num', {}, tz().replace('_', ' '))),
    h('div.ra-heat', {},
      WEEK.flatMap((d) => [h('span.ra-heat-d', {}, TR[d]), ...Array.from({ length: 12 }, (_, s) => {
        const v = cells.get(`${d}:${s}`);
        return h(`i.ra-heat-c${v == null ? '' : v >= 0 ? '.pos' : '.neg'}`, { style: v == null ? {} : { '--a': (0.3 + 0.7 * (Math.abs(v) / cmax)).toFixed(2) }, title: v == null ? '' : `${TR[d]} ${String(s * 2).padStart(2, '0')}:00 · ${F.signedMoney(v, ccy)}` });
      })]),
      h('span'), ...['00', '04', '08', '12', '16', '20'].map((x) => h('span.ra-heat-h', {}, x))));

  const longs = trades.filter((t) => t.side === 'buy'), shorts = trades.filter((t) => t.side !== 'buy');
  const lpct = trades.length ? (longs.length / trades.length) * 100 : 50;
  const ls = card('Alış / satış', h('div.ra-ls', {},
    h('div.ra-ls-row', {}, h('span', {}, 'Alış ', h('b.num', {}, String(longs.length))), h('span', {}, 'Satış ', h('b.num', {}, String(shorts.length)))),
    h('div.ra-ls-bar', {}, h('i.long', { style: { width: `${lpct}%` } }), h('i.short', { style: { width: `${100 - lpct}%` } })),
    h('div.ra-ls-row', {}, h(`span.num.${tone(sum(longs))}`, {}, F.signedMoney(sum(longs), ccy)), h(`span.num.${tone(sum(shorts))}`, {}, F.signedMoney(sum(shorts), ccy)))));

  return [kpis, h('div.ra-acards', {}, bySession, byDay, heat, ls)];
}

function card(title, ...body) {
  return h('section.gl.ra-acard', {}, h('header', {}, title), h('div.ra-acard-body', {}, body));
}

// ── more ─────────────────────────────────────────────────────────────────
function more() {
  return [
    group([
      { icon: 'chart', title: 'Grafik', sub: 'Son baktığın piyasa', tone: 'blue', onclick: () => go(chartUrl({ view: 'chart' })) },
      { icon: 'flask', title: 'Strateji testi', sub: 'Kural yaz, yıllarca veride çalıştır', tone: 'violet', onclick: () => go(chartUrl({ tab: 'strategy' })) },
      { icon: 'data', title: 'Veri paketleri', sub: '15 yıllık EURUSD, Nasdaq, altın…', tone: 'amber', onclick: () => go(chartUrl({ tab: 'data' })) },
    ], 'Uygulamalar'),
    group([
      { icon: 'palette', title: 'Görünüm', sub: 'Tema, vurgu rengi, mum renkleri', onclick: () => appearanceSheet(homeLook) },
      { icon: 'sliders', title: 'Tercihler', sub: 'Saat dilimi, hesap, işlem ücretleri', tone: 'teal', onclick: () => settingsDialog(host) },
      { icon: 'user', title: 'Profil', sub: 'Profil değiştir, test sürümü', tone: 'rose', onclick: () => profileDrawer('profile') },
    ], 'Ayarlar'),
  ];
}

main();
