// The Replay app (Alltra's Backtest): a header of light, "replay any
// instrument" with a new session and a continue button, the sessions as
// cards (a tap opens the session's sheet), and at the foot the app's tabs:
// sessions · analysis · more. Replay sessions and strategy tests sit side by
// side under one switch.
import { api } from './api.js?v=379181f731';
import * as F from './format.js?v=379181f731';
import { confirmBox, h, icon, toast } from './ui/dom.js?v=379181f731';
import { SESSION_SETS } from './chart/sessions.js?v=379181f731';
import { nyOffset } from './core/timeframes.js?v=379181f731';
import { wirePalette } from './ui/palette.js?v=379181f731';
import { settingsDialog } from './ui/dialogs.js?v=379181f731';
import { avatarButton, baseItems, bootShell, chartUrl, dock, go, group, host, markButton, pillTab, relTime, sheet, symbolBadge, tz } from './rvshell.js?v=379181f731';

const st = { sessions: [], datasets: [], loaded: false, kind: 'replay', filter: 'all', view: 'sessions', trades: null, tradesLoading: false };

const fromHash = () => {
  const x = location.hash.slice(1);
  if (x === 'analiz') { st.view = 'analytics'; }
  else if (x === 'diger') { st.view = 'more'; }
  else if (x === 'testler') { st.view = 'sessions'; st.kind = 'test'; }
  else st.view = 'sessions';
};

async function main() {
  fromHash();
  let me;
  try { me = await bootShell(render); } catch (err) { document.getElementById('ra-root').textContent = `Açılamadı: ${err.message}`; return; }
  if (!me) return;
  render();
  wirePalette(() => baseItems(), { typeToSearch: true });
  window.addEventListener('hashchange', () => { fromHash(); render(); if (st.view === 'analytics') loadTrades(); });
  const [sessions, datasets] = await Promise.all([api.sessions().catch(() => []), api.datasets().catch(() => [])]);
  st.sessions = sessions;
  st.datasets = datasets;
  st.loaded = true;
  render();
  if (st.view === 'analytics') loadTrades();
}

const replays = () => st.sessions.filter((s) => s.kind !== 'backtest');
const tests = () => st.sessions.filter((s) => s.kind === 'backtest');
const setView = (v) => { const hash = { sessions: st.kind === 'test' ? 'testler' : '', analytics: 'analiz', more: 'diger' }[v]; history.replaceState(null, '', hash ? `#${hash}` : location.pathname); st.view = v; render(); if (v === 'analytics') loadTrades(); window.scrollTo({ top: 0 }); };

function render() {
  const root = document.getElementById('ra-root');
  const title = { sessions: st.kind === 'test' ? 'Strateji' : 'Replay', analytics: 'Analiz', more: 'Diğer' }[st.view];
  const top = h('header.ra-top', {}, h('h1', {}, title), h('div.ra-top-r', {}, avatarButton()));
  const body = st.view === 'analytics' ? analytics() : st.view === 'more' ? more() : sessionsView();
  root.className = `ra ra-${st.view}`;
  root.replaceChildren(h('div.ra-aurora', { 'aria-hidden': 'true' }), top, ...body);
  dock({
    left: markButton('replay'),
    center: [
      pillTab({ icon: 'clock', label: 'Oturumlar', on: st.view === 'sessions', onclick: () => setView('sessions') }),
      pillTab({ icon: 'indicator', label: 'Analiz', on: st.view === 'analytics', onclick: () => setView('analytics') }),
      pillTab({ icon: 'apps', label: 'Diğer', on: st.view === 'more', onclick: () => setView('more') }),
    ],
    right: { icon: 'plus', label: st.kind === 'test' ? 'Yeni strateji testi' : 'Yeni replay oturumu', onclick: () => go(chartUrl(st.kind === 'test' ? { tab: 'strategy' } : { new: 'replay' })) },
  });
}

// ── sessions ─────────────────────────────────────────────────────────────
const FILTERS = {
  replay: [['all', 'Tümü', () => true], ['open', 'Açık', (s) => (s.summary?.open || 0) > 0], ['up', 'Kârda', (s) => (s.summary?.net ?? 0) > 0], ['down', 'Zararda', (s) => (s.summary?.net ?? 0) < 0]],
  test: [['all', 'Tümü', () => true], ['up', 'Kârda', (s) => (s.summary?.returnPct ?? 0) > 0], ['down', 'Zararda', (s) => (s.summary?.returnPct ?? 0) < 0]],
};

function sessionsView() {
  const test = st.kind === 'test';
  const all = test ? tests() : replays();
  const filters = FILTERS[st.kind];
  if (!filters.some(([v]) => v === st.filter)) st.filter = 'all';
  const pass = filters.find(([v]) => v === st.filter)[2];
  const rows = all.filter(pass);
  const last = replays()[0];
  const kindSeg = h('div.ra-kind', { role: 'tablist' }, [['replay', 'Replay'], ['test', 'Strateji']].map(([k, l]) =>
    h(`button${st.kind === k ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(st.kind === k), onclick: () => { st.kind = k; st.filter = 'all'; setView('sessions'); } }, l)));
  const hero = h('section.ra-hero', {},
    h('h2', {}, test ? 'Stratejini yıllarca veride sına.' : 'Herhangi bir piyasayı yeniden yaşa.'),
    h('p', {}, test ? 'Kuralını yaz, 15 yıllık veride saniyeler içinde çalıştır; her test sonuçlarıyla burada saklanır.' : 'Gerçek fiyat hareketini bar bar ilerlet, stratejini canlıymış gibi işle.'),
    h('div.ra-cta', {},
      h('button.rv-cta.big', { type: 'button', onclick: () => go(chartUrl(test ? { tab: 'strategy' } : { new: 'replay' })) }, test ? 'Yeni test' : 'Yeni oturum'),
      !test && last ? h('button.rv-round.play', { type: 'button', title: `Devam et: ${last.name}`, 'aria-label': `Devam et: ${last.name}`, onclick: () => go(chartUrl({ session: last.id })) }, icon('play', 22)) : null));
  const chips = h('div.ra-chips', { role: 'tablist' }, filters.map(([v, l, f]) => {
    const n = all.filter(f).length;
    return h(`button.ra-chip${st.filter === v ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(st.filter === v), disabled: v !== 'all' && !n, onclick: () => { st.filter = v; render(); } }, l, h('small', {}, String(n)));
  }));
  const list = !st.loaded ? h('div.ra-list', {}, [0, 1, 2].map(() => h('div.ra-card.skel')))
    : !all.length ? h('div.ra-empty', {}, test ? 'Henüz strateji testi yok. Strateji sekmesinde bir kural yazıp çalıştırınca burada görünür.' : 'Henüz replay oturumu yok. “Yeni oturum” ile geçmişte bir tarih seç.')
      : !rows.length ? h('div.ra-empty', {}, 'Bu süzgece uyan oturum yok.')
        : h('div.ra-list', {}, rows.map(test ? testCard : sessionCard));
  return [kindSeg, hero, h('div.ra-sec-head', {}, h('h3', {}, test ? 'Testler' : 'Oturumlar'), chips), list];
}

const money = (sm) => sm?.currency || 'USD';
const symOf = (sm) => (sm?.symbols?.[0] || String(sm?.symbol || '').split(' · ')[0] || '?');

function sessionCard(s) {
  const sm = s.summary || {};
  const bal = sm.balance ?? sm.initial;
  const cls = (sm.net ?? 0) > 0 ? 'up' : (sm.net ?? 0) < 0 ? 'down' : '';
  return h('button.ra-card', { type: 'button', onclick: () => sessionSheet(s) },
    symbolBadge(symOf(sm), 46),
    h('span.ra-card-t', {}, h('b', {}, s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${relTime(s.updated_at)}`)),
    h(`span.ra-card-v.rv-num${cls ? `.${cls}` : ''}`, {}, bal != null ? F.money(bal, money(sm)) : '—'));
}

function testCard(s) {
  const sm = s.summary || {};
  const cls = (sm.returnPct ?? 0) > 0 ? 'up' : (sm.returnPct ?? 0) < 0 ? 'down' : '';
  return h('button.ra-card', { type: 'button', onclick: () => testSheet(s) },
    h('span.rv-sym.flask', {}, icon('flask', 22)),
    h('span.ra-card-t', {}, h('b', {}, sm.strategy || s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${relTime(s.created_at)}`)),
    h(`span.ra-card-v.rv-num${cls ? `.${cls}` : ''}`, {}, sm.returnPct != null ? `${sm.returnPct > 0 ? '+' : ''}${F.pct(sm.returnPct, 1)}` : '—'));
}

const tile = (k, v, cls = '') => h('div.ra-tile', {}, h('span', {}, k), h(`b.rv-num${cls ? `.${cls}` : ''}`, {}, v));
const pf = (x) => (x === 'inf' ? '∞' : x == null ? '—' : F.num(x, 2));

/** A session's sheet: its balance large, how far it went, its numbers and what to do with it. */
function sessionSheet(s) {
  const sm = s.summary || {};
  const ccy = money(sm);
  const bal = sm.balance ?? sm.initial ?? 0;
  const initial = sm.initial ?? 10000;
  const ret = initial ? (bal - initial) / initial : 0;
  const cls = ret > 0 ? 'up' : ret < 0 ? 'down' : '';
  const ds = st.datasets.find((d) => d.id === s.dataset_id);
  const end = ds?.last_ts;
  const frac = sm.startTime && sm.cursor && end && end > sm.startTime ? Math.min(1, (sm.cursor - sm.startTime) / (end - sm.startTime)) : 0;
  const sh = sheet({
    cls: 'session',
    body: [
      h('div.ra-sh-head', {}, symbolBadge(symOf(sm), 40), h('div', {}, h('b', {}, s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`))),
      h(`div.ra-sh-big.rv-num${cls ? `.${cls}` : ''}`, {}, F.money(bal, ccy)),
      h(`span.ra-sh-badge${cls ? `.${cls}` : ''}`, {}, `${ret > 0 ? '+' : ''}${F.pct(ret, 2)}`),
      h('div.ra-sh-progress', {},
        h('div.ra-sh-progress-t', {}, h('span', {}, 'Verideki yeri'), h('span', {}, sm.open ? `${sm.open} açık pozisyon` : `%${F.num(frac * 100, 0)}`)),
        h('div.ra-bar', {}, h('i', { style: { width: `${Math.max(1.5, frac * 100).toFixed(1)}%` } })),
        h('div.ra-sh-progress-d', {}, h('span', {}, `Başlangıç ${sm.startTime ? F.dateOnly(sm.startTime, tz()) : '—'}`), h('span', {}, `Şimdi ${sm.cursor ? F.dateTime(sm.cursor, tz()) : '—'}`))),
      h('div.ra-tiles', {},
        tile('Başlangıç', F.money(initial, ccy, 0)), tile('Bakiye', F.money(bal, ccy, 0), cls), tile('Kazanma oranı', sm.winRate != null ? F.pct(sm.winRate, 1) : '—'),
        tile('İşlem', String(sm.trades ?? 0)), tile('Kâr faktörü', pf(sm.profitFactor)), tile('Maks. düşüş', sm.maxDrawdownPct != null ? F.pct(sm.maxDrawdownPct, 1) : '—')),
      h('div.ra-sh-actions', {},
        h('button.rv-round', { type: 'button', title: 'Kopyasını oluştur', 'aria-label': 'Kopyasını oluştur', onclick: () => duplicate(s, sh) }, icon('copy', 22)),
        h('button.rv-cta.big', { type: 'button', onclick: () => go(chartUrl({ session: s.id })) }, icon('play', 18), 'Devam et'),
        h('button.rv-round.danger', { type: 'button', title: 'Sil', 'aria-label': 'Oturumu sil', onclick: () => remove(s, sh) }, icon('trash', 22))),
      h('button.ra-rename', { type: 'button', onclick: () => rename(s, sh) }, icon('edit', 15), 'Adını değiştir'),
    ],
  });
}

function testSheet(s) {
  const sm = s.summary || {};
  const ccy = money(sm);
  const cls = (sm.returnPct ?? 0) > 0 ? 'up' : (sm.returnPct ?? 0) < 0 ? 'down' : '';
  const sh = sheet({
    cls: 'session',
    body: [
      h('div.ra-sh-head', {}, h('span.rv-sym.flask', { style: { width: '40px', height: '40px' } }, icon('flask', 20)), h('div', {}, h('b', {}, sm.strategy || s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`))),
      h(`div.ra-sh-big.rv-num${cls ? `.${cls}` : ''}`, {}, sm.returnPct != null ? `${sm.returnPct > 0 ? '+' : ''}${F.pct(sm.returnPct, 2)}` : '—'),
      h(`span.ra-sh-badge${cls ? `.${cls}` : ''}`, {}, F.signedMoney(sm.net, ccy)),
      h('div.ra-sh-progress', {}, h('div.ra-sh-progress-d', {}, h('span', {}, F.dateOnly(sm.from, 'UTC')), h('span', {}, F.dateOnly(sm.to, 'UTC')))),
      h('div.ra-tiles', {},
        tile('İşlem', String(sm.trades ?? 0)), tile('Kazanma oranı', sm.winRate != null ? F.pct(sm.winRate, 1) : '—'), tile('Kâr faktörü', pf(sm.profitFactor)),
        tile('Net', F.signedMoney(sm.net, ccy), (sm.net ?? 0) >= 0 ? 'up' : 'down'), tile('Maks. düşüş', sm.maxDrawdownPct != null ? F.pct(sm.maxDrawdownPct, 1) : '—'), tile('Tarih', relTime(s.created_at))),
      h('div.ra-sh-actions', {},
        h('span.rv-round.ghost'),
        h('button.rv-cta.big', { type: 'button', onclick: () => go(chartUrl({ backtest: s.id })) }, icon('chart', 18), 'Sonuçları aç'),
        h('button.rv-round.danger', { type: 'button', title: 'Sil', 'aria-label': 'Testi sil', onclick: () => remove(s, sh) }, icon('trash', 22))),
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
  const input = h('input.ctl', { type: 'text', value: s.name, maxlength: 80, 'aria-label': 'Oturumun adı', style: { width: '100%' } });
  const save = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      await api.updateSession(s.id, { name });
      s.name = name;
      sh2.close();
      render();
    } catch (err) { toast(err.message, 'err'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sh.close();
  const sh2 = sheet({ title: 'Adını değiştir', body: [input, h('button.rv-cta.big.block', { type: 'button', onclick: save }, 'Kaydet')] });
  setTimeout(() => input.select(), 50);
}

// ── analysis: every closed trade of the replay sessions ───────────────────
async function loadTrades() {
  if (st.trades || st.tradesLoading || !st.loaded) return;
  st.tradesLoading = true;
  const list = replays().slice(0, 40);
  const out = [];
  await Promise.all(list.map(async (s) => {
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
/** Which session a time falls in (New York time): Asia till London opens, London till New York does. */
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
    return [h('div.ra-list', {}, [0, 1].map(() => h('div.ra-acard.skel')))];
  }
  const trades = st.trades;
  if (!trades.length) {
    return [h('div.ra-empty', {}, h('p', {}, 'Analiz için kapanmış işlem yok. Replay’de işlem açıp kapattıkça seans, gün ve saat dağılımın burada çıkar.'),
      h('button.rv-cta', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'Replay başlat'))];
  }
  const ccy = replays()[0]?.summary?.currency || 'USD';
  const sum = (xs) => xs.reduce((s, t) => s + t.pnl, 0);
  const net = sum(trades);
  const wins = trades.filter((t) => t.pnl > 0);
  const gw = sum(wins), gl = -sum(trades.filter((t) => t.pnl < 0));
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');

  // P&L by session
  const zones = ['ASIA', 'LONDON', 'NEW YORK'].map((z) => { const xs = trades.filter((t) => zoneOf(t.entryTime) === z); return { z, n: xs.length, pnl: sum(xs) }; });
  const zmax = Math.max(...zones.map((x) => Math.abs(x.pnl)), 1e-9);
  const upZones = zones.filter((x) => x.pnl > 0).length;
  const bySession = card('Seanslara göre K/Z', h('div.ra-acard-big', {}, h(`b.rv-num.${cls(net)}`, {}, F.signedMoney(net, ccy)), h(`span.ra-pillnote.${upZones >= 2 ? 'up' : ''}`, {}, `${upZones}/3 kârda`)),
    h('div.ra-cols', {}, zones.map((x) => h('div.ra-col', {},
      h('span.ra-col-k', {}, ZONE_NAMES[x.z]), h('span.ra-col-n', {}, h('b', {}, String(x.n)), ' işlem'),
      h('div.ra-col-bar', {}, h(`i.${cls(x.pnl) || 'zero'}`, { style: { height: `${Math.max(8, (Math.abs(x.pnl) / zmax) * 100)}%` } })),
      h(`span.ra-col-v.rv-num.${cls(x.pnl)}`, {}, F.signedMoney(x.pnl, ccy))))));

  // day of week and hour, in the trader's time zone
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hourCycle: 'h23', timeZone: tz() });
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const when = trades.map((t) => { const parts = fmt.formatToParts(new Date(t.entryTime * 1000)); return { d: DAYS.indexOf(parts.find((p) => p.type === 'weekday').value), hr: Number(parts.find((p) => p.type === 'hour').value) % 24, t }; });
  const TR_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const days = WEEK.map((d) => { const xs = when.filter((w) => w.d === d).map((w) => w.t); return { d, n: xs.length, pnl: sum(xs) }; });
  const dmax = Math.max(...days.map((x) => Math.abs(x.pnl)), 1e-9);
  const best = [...days].filter((x) => x.n).sort((a, b) => b.pnl - a.pnl)[0] || days[0];
  const byDay = card('Haftanın günleri', h('div.ra-acard-big', {}, h(`b.rv-num.${cls(best.pnl)}`, {}, F.signedMoney(best.pnl, ccy)), h('span.ra-pillnote', {}, `en iyi gün: ${TR_DAYS[best.d]}`)),
    h('div.ra-days', {}, days.map((x) => h('div.ra-day', {}, h('div.ra-day-bar', {}, h(`i.${cls(x.pnl) || 'zero'}`, { style: { height: `${Math.max(6, (Math.abs(x.pnl) / dmax) * 100)}%` } })), h('span', {}, TR_DAYS[x.d])))));

  // trade time: weekday × two-hour slot
  const cells = new Map();
  for (const w of when) { const k = `${w.d}:${Math.floor(w.hr / 2)}`; cells.set(k, (cells.get(k) || 0) + w.t.pnl); }
  const cmax = Math.max(...[...cells.values()].map(Math.abs), 1e-9);
  const heat = card('İşlem saati', h('div.ra-acard-big', {}, h('b.rv-num', {}, `${trades.length} işlem`), h('span.ra-pillnote', {}, tz().replace('_', ' '))),
    h('div.ra-heat', {},
      WEEK.flatMap((d) => [h('span.ra-heat-d', {}, TR_DAYS[d]), ...Array.from({ length: 12 }, (_, s) => {
        const v = cells.get(`${d}:${s}`);
        const a = v == null ? 0 : 0.25 + 0.75 * (Math.abs(v) / cmax);
        return h(`i.ra-heat-c${v == null ? '' : v >= 0 ? '.up' : '.down'}`, { style: v == null ? {} : { '--a': a.toFixed(2) }, title: v == null ? '' : `${TR_DAYS[d]} ${String(s * 2).padStart(2, '0')}:00 · ${F.signedMoney(v, ccy)}` });
      })]),
      h('span'), ...['00', '04', '08', '12', '16', '20'].map((x) => h('span.ra-heat-h', {}, x))));

  // long against short
  const longs = trades.filter((t) => t.side === 'buy'), shorts = trades.filter((t) => t.side !== 'buy');
  const lpct = trades.length ? (longs.length / trades.length) * 100 : 50;
  const ls = card('Alış / satış', h('div.ra-ls', {},
    h('div.ra-ls-row', {}, h('span', {}, 'Alış ', h('b', {}, String(longs.length))), h('span', {}, 'Satış ', h('b', {}, String(shorts.length)))),
    h('div.ra-ls-bar', {}, h('i.long', { style: { width: `${lpct}%` } }), h('i.short', { style: { width: `${100 - lpct}%` } })),
    h('div.ra-ls-row', {}, h(`span.rv-num.${cls(sum(longs))}`, {}, F.signedMoney(sum(longs), ccy)), h(`span.rv-num.${cls(sum(shorts))}`, {}, F.signedMoney(sum(shorts), ccy)))));

  const summary = h('div.ra-tiles.four', {},
    tile('Net K/Z', F.signedMoney(net, ccy), cls(net)), tile('İşlem', String(trades.length)),
    tile('Kazanma', F.pct(wins.length / trades.length, 1)), tile('Kâr faktörü', gl > 0 ? F.num(gw / gl, 2) : '∞'));
  return [summary, bySession, byDay, heat, ls];
}

function card(title, ...body) {
  return h('section.ra-acard', {}, h('header', {}, title), h('div.ra-acard-body', {}, body));
}

// ── more ─────────────────────────────────────────────────────────────────
function more() {
  return [
    group([
      { icon: 'chart', title: 'Grafik', sub: 'son baktığın piyasa', onclick: () => go(chartUrl({ view: 'chart' })) },
      { icon: 'flask', title: 'Strateji testi', sub: 'kural yaz, yıllarca veride çalıştır', onclick: () => go(chartUrl({ tab: 'strategy' })) },
      { icon: 'data', title: 'Veri paketleri', sub: '15 yıllık EURUSD, Nasdaq, altın…', onclick: () => go(chartUrl({ tab: 'data' })) },
    ]),
    group([
      { icon: 'palette', title: 'Görünüm', sub: 'tema, renkler, grafik', onclick: () => settingsDialog(host, { section: 'look' }) },
      { icon: 'sliders', title: 'Tercihler', sub: 'saat dilimi, hesap, işlem ücretleri', onclick: () => settingsDialog(host) },
      { icon: 'home', title: 'Ana ekran', sub: 'özet ve uygulamalar', onclick: () => go('home.html') },
    ]),
  ];
}

main();
