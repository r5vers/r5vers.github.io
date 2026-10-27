// Home of the test copy. Phones: your name and the time of day, your apps
// as large cards, recents, markets, one market's chart, the floating bar.
// Wide screens, after the original RV home and laid out on one axis: the
// date, a large greeting in the metal, the markets' sessions right now and
// the actions, centred; then the apps as five equal tiles, the markets as
// a three-by-two grid, the numbers as four equal tiles, and where you left
// off beside your recents, in two equal halves.
import { api } from './api.js?v=5cd63cafc3';
import * as F from './format.js?v=5cd63cafc3';
import { brandMark, h, icon } from './ui/dom.js?v=5cd63cafc3';
import { SESSION_SETS } from './chart/sessions.js?v=5cd63cafc3';
import { nyOffset } from './core/timeframes.js?v=5cd63cafc3';
import { openPalette, wirePalette } from './ui/palette.js?v=5cd63cafc3';
import { wireTooltips } from './ui/tooltip.js?v=5cd63cafc3';
import { APPS, NAMES, WIDE, appFrame, avatarButton, baseItems, bootShell, chartUrl, dock, go, greeting, markButton, profileDrawer, relTime, ring, searchPill, shell, symbolBadge, tz } from './rvshell.js?v=5cd63cafc3';

const netOf = (sm = {}) => (sm.balance != null && sm.initial != null ? sm.balance - sm.initial : sm.net ?? 0);

const st = { datasets: [], sessions: [], loaded: false, quotes: new Map(), chart: { range: '1A', data: null } };
const RANGES = [['1A', 23], ['6A', 130], ['YB', 0], ['1Y', 260]];

async function main() {
  let me;
  try { me = await bootShell(render); } catch (err) { document.getElementById('hub').textContent = `Açılamadı: ${err.message}`; return; }
  if (!me) return;
  render();
  wirePalette(items, { typeToSearch: true });
  wireTooltips();
  const [datasets, sessions] = await Promise.all([api.datasets().catch(() => []), api.sessions().catch(() => [])]);
  st.datasets = datasets;
  st.sessions = sessions;
  st.loaded = true;
  render();
  loadQuotes();
  loadChart();
}

function markets() {
  const withData = st.datasets.filter((d) => d.bar_count && d.source !== 'demo');
  const list = withData.length ? withData : st.datasets.filter((d) => d.bar_count);
  return [...list].sort((a, b) => (!!b.meta?.pack - !!a.meta?.pack) || b.bar_count - a.bar_count).slice(0, 8);
}
const chartMarket = () => markets().find((d) => d.id === shell.settings.datasetId) || markets()[0] || null;
const replays = () => st.sessions.filter((x) => x.kind !== 'backtest');

function items() {
  const out = baseItems();
  for (const d of markets()) out.push({ group: 'Piyasalar', label: d.symbol, sub: NAMES[d.symbol] || d.name, icon: 'chart', run: () => go(chartUrl({ ds: d.id })) });
  for (const s of replays().slice(0, 12)) out.push({ group: 'Replay oturumları', label: s.name, sub: relTime(s.updated_at), icon: 'replay', run: () => go(chartUrl({ session: s.id })) });
  return out;
}

function render() {
  const root = document.getElementById('hub');
  if (!shell.me) return;
  if (WIDE.matches) {
    document.getElementById('rv-dock')?.remove();
    appFrame({ current: 'home', crumbs: ['Ana ekran', 'Genel bakış'], actions: [
      h('button.rv-btn.ghost', { type: 'button', onclick: () => profileDrawer('look') }, icon('palette', 17), 'Görünüm')] });
    root.className = 'hub hub-wide';
    root.replaceChildren(deskHero(), appRow(true), marketGrid(), overview(), foot());
    return;
  }
  appFrame({ current: 'home' });
  const p = shell.me.profile;
  root.className = 'hub';
  root.replaceChildren(
    h('header.hub-top', {}, h('a.hub-brand', { href: 'home.html' }, brandMark(24), h('span', {}, 'ReplayView')), avatarButton()),
    h('section.hub-hello', {}, h('h1', {}, p.name), h('p', {}, greeting())),
    appRow(false),
    recents(),
    marketStrip(),
    chartCard(),
    tiles(),
    foot());
  dock({ left: markButton('home'), center: searchPill(items), right: { icon: 'plus', label: 'Yeni replay oturumu', onclick: () => go(chartUrl({ new: 'replay' })) } });
}

const foot = () => h('footer.hub-foot', {}, 'RV Next · test sürümü · veriler Dukascopy (geçmiş), OANDA / Binance (canlı)');

// ── the apps: large cards (phone), a row of tiles (wide) ────────────────
function appRow(wide) {
  const row = h(`div.hub-apps${wide ? '.wide' : ''}`, {}, APPS.map((a) => h(`a.hub-app.gl.app-${a.id}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
    h('span.hub-app-fill', { 'aria-hidden': 'true' }), h('span.hub-app-art', { 'aria-hidden': 'true' }, icon(a.icon, wide ? 150 : 140)),
    h('span.hub-app-top', {}, h('span.hub-app-ic', {}, icon(a.icon, wide ? 24 : 26)),
      wide ? h('span.hub-app-go', { 'aria-hidden': 'true' }, icon('arrow', 16)) : a.badge ? h('span.hub-badge', {}, a.badge) : null),
    h('span.hub-app-txt', {}, h('b', {}, a.name), h('small', {}, a.sub)))));
  // the cards are clear glass; the one at the row's start takes its colour,
  // fading in as it slides into place and out as it leaves
  const cards = [...row.children];
  let raf = 0;
  const tint = () => {
    raf = 0;
    if (!row.isConnected) return;
    const anchor = row.getBoundingClientRect().left + (parseFloat(getComputedStyle(row).paddingLeft) || 0);
    for (const c of cards) {
      const d = Math.abs(c.getBoundingClientRect().left - anchor);
      c.style.setProperty('--on', Math.max(0, 1 - d / (c.offsetWidth * 0.7)).toFixed(3));
    }
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(tint); };
  row.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(tint));
  if (!wide) return h('section.hub-sec', {}, h('h2.hub-h', {}, 'Uygulamaların'), row);
  return h('section.hub-sec', {}, row);
}

// ── wide: the date, the greeting, the sessions, the actions, centred ───
function deskHero() {
  const p = shell.me.profile;
  const tests = st.sessions.filter((x) => x.kind === 'backtest').length;
  const date = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() }).format(new Date());
  return h('section.hub-hero', {},
    h('span.hub-date', {}, date),
    h('h1.rv-metal', {}, `${greeting()}, ${p.name}`),
    sessionStrip(),
    h('p.hub-lead', {}, st.loaded ? `${markets().length} piyasa hazır · ${replays().length} replay oturumu · ${tests} strateji testi` : 'Yükleniyor…'),
    h('div.hub-hero-acts', {},
      h('button.rv-btn.lg', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('plus', 17), 'Yeni oturum'),
      h('button.rv-btn.ghost.lg', { type: 'button', onclick: () => go(chartUrl({ view: 'chart' })) }, icon('chart', 17), 'Grafiği aç'),
      h('button.rv-btn.ghost.lg.hub-find', { type: 'button', onclick: () => openPalette(items) }, icon('search', 17), 'Ara', h('kbd', {}, 'Ctrl K'))));
}

// the markets' sessions right now (New York time, DST aware), as on RV's home
const SESSION_NAMES = { ASIA: 'Asya', LONDON: 'Londra', 'NEW YORK': 'New York' };
const hm = (min) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`; };
function sessionStrip() {
  const now = Date.now() / 1000, local = now + nyOffset(now);
  const day = new Date(local * 1000).getUTCDay();
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  // forex closes Friday 17:00 and opens Sunday 17:00, New York time
  if (day === 6 || (day === 5 && min >= 17 * 60) || (day === 0 && min < 17 * 60)) {
    const toOpen = ((day === 5 ? 2 : day === 6 ? 1 : 0) * 1440) + 17 * 60 - min;
    return h('div.hub-sessions', {}, h('span.hub-sess', { style: { '--c': '#71717a' } }, h('i'), 'Forex kapalı', h('small', {}, `açılışa ${hm(toOpen)}`)));
  }
  const until = (t) => ((t - min) % 1440 + 1440) % 1440;
  return h('div.hub-sessions', {}, SESSION_SETS[0].zones.map((z) => {
    const open = z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to;
    const left = open ? until(z.to) : until(z.from), name = SESSION_NAMES[z.name] || z.name;
    return h(`span.hub-sess${open ? '.on' : ''}`, { style: { '--c': z.color }, title: open ? `${name} seansı açık, ${hm(left)} sonra kapanır` : `${name} seansı ${hm(left)} sonra açılır` },
      h('i'), name, h('small', {}, open ? `${hm(left)} kaldı` : `${hm(left)} sonra`));
  }));
}

// ── wide: the markets, each with its last months drawn ───────────────────
function marketGrid() {
  const list = markets();
  const head = h('div.hub-head', {}, h('h2.hub-h', {}, 'Piyasalar'), h('button.rv-link', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, 'Veri yönetimi'));
  if (st.loaded && !list.length) {
    return h('section.hub-sec', {}, head, h('div.gl.hub-empty', {}, h('p', {}, 'Bu cihazda piyasa verisi yok. 15 yıllık EURUSD, Nasdaq ve altın paketlerini aç.'),
      h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, icon('download', 16), 'Veri paketleri')));
  }
  const dfmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  return h('section.hub-sec', {}, head, h('div.hub-mkts', {}, (st.loaded ? list.slice(0, 6) : [0, 1, 2]).map((d) => {
    if (!d.id) return h('div.skel.hub-mk-skel');
    const q = st.quotes.get(d.id);
    const chg = q && q.prev ? q.last / q.prev - 1 : null;
    const years = d.first_ts && d.last_ts ? Math.round((d.last_ts - d.first_ts) / 31557600) : null;
    return h('button.gl.hub-mk', { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) },
      h('span.hub-mk-top', {}, h('span', {}, h('b', {}, d.symbol), h('small', {}, NAMES[d.symbol] || d.name || '')),
        chg != null ? h(`span.badge-num.${chg >= 0 ? 'pos' : 'neg'}`, {}, `${chg >= 0 ? '+' : ''}${F.pct(chg, 2)}`) : null),
      h('span.hub-mk-px.num', {}, q ? F.price(q.last, d.decimals) : '—'),
      q?.spark?.length > 1 ? areaSpark(q.spark) : h('span.hub-mk-nospark'),
      h('span.hub-mk-foot', {}, h('span', {}, years ? `${years} yıl veri` : `${(d.bar_count || 0).toLocaleString('tr-TR')} bar`), d.last_ts ? h('span', {}, `son: ${dfmt.format(new Date(d.last_ts * 1000))}`) : null));
  })));
}

/** A small area of the last closes in the accent, as on RV's market cards. */
function areaSpark(c) {
  const W = 300, H = 64, lo = Math.min(...c), hi = Math.max(...c), span = hi - lo || 1;
  const pts = c.map((v, i) => `${((i / (c.length - 1)) * W).toFixed(1)},${(4 + (1 - (v - lo) / span) * (H - 8)).toFixed(1)}`);
  const id = `a${Math.random().toString(36).slice(2, 8)}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('hub-mk-spark');
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <path d="M${pts[0]} L${pts.join(' L')} L${W},${H} L0,${H} Z" fill="url(#${id})"/><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  return svg;
}

// ── wide: four equal numbers, then where you left off beside recents ───
function overview() {
  return h('section.hub-sec', {},
    h('div.hub-head', {}, h('h2.hub-h', {}, 'Genel bakış'), h('button.rv-link', { type: 'button', onclick: () => go('replay.html#analiz') }, 'Analiz')),
    kpiStrip(),
    h('div.hub-duo', {}, lastCard(), recentCard()));
}

function kpiStrip() {
  const rs = replays();
  const sum = (xs) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const net = sum(rs.map((x) => netOf(x.summary)));
  const trades = sum(rs.map((x) => x.summary?.trades));
  const rates = rs.map((x) => x.summary?.winRate).filter(Number.isFinite);
  const rate = rates.length ? sum(rates) / rates.length : null;
  const ccy = rs[0]?.summary?.currency || 'USD';
  const tile = (ic, label, value, cls = '') => h('article.gl.hub-kpi', {},
    h('span.hub-kpi-ic', {}, icon(ic, 18)), h('span.hub-kpi-t', {}, h('span', {}, label), h(`b.num${cls}`, {}, value)));
  return h('div.hub-kpis', {},
    tile('indicator', 'Net K/Z', F.signedMoney(net, ccy), net > 0 ? '.pos' : net < 0 ? '.neg' : ''),
    h('article.gl.hub-kpi', {}, ring(rate, { size: 46, stroke: 5 }), h('span.hub-kpi-t', {}, h('span', {}, 'Kazanma oranı'), h('b.num', {}, rate != null ? F.pct(rate, 1) : '—'))),
    tile('swap', 'İşlem', String(trades)),
    tile('replay', 'Oturum', String(rs.length)));
}

/** Where you left off: the session, its balance and its curve, a way back in. */
function lastCard() {
  const last = replays()[0];
  if (!last) {
    return h('article.gl.ov-card.hub-last', {},
      h('div.ov-head', {}, h('h3', {}, 'Kaldığın yer')),
      h('p.hub-last-empty', {}, st.loaded ? 'Henüz replay oturumu yok. Geçmişte bir tarih seç, grafik o ana kadar olanı göstersin; bar bar ilerleyip gerçek gibi işlem aç.' : 'Yükleniyor…'),
      h('div.hub-last-acts', {}, h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'İlk oturumu başlat')));
  }
  const sm = last.summary || {};
  const ccy = sm.currency || 'USD', net = netOf(sm), init = sm.initial || 0;
  const cls = net > 0 ? '.pos' : net < 0 ? '.neg' : '';
  return h('article.gl.ov-card.hub-last', {},
    h('div.ov-head', {}, h('h3', {}, 'Kaldığın yer'), h('span.muted', {}, relTime(last.updated_at || last.created_at))),
    h('div.hub-last-who', {}, symbolBadge(sm.symbol, 44),
      h('span', {}, h('b', {}, last.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${sm.trades ?? 0} işlem`))),
    h('div.hub-last-num', {},
      h('span', {}, h('small', {}, 'Bakiye'), h('b.num', {}, sm.balance != null ? F.money(sm.balance, ccy) : '—'), h('em', {}, init ? `başlangıç ${F.money(init, ccy)}` : '—')),
      h('span', {}, h('small', {}, 'Net K/Z'), h(`b.num${cls}`, {}, F.signedMoney(net, ccy)), h(`em${cls}`, {}, init ? `${net > 0 ? '+' : ''}${F.pct(net / init, 2)}` : '—'))),
    h('div.hub-last-acts', {},
      h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ session: last.id })) }, icon('play', 16), 'Devam et'),
      h('button.rv-btn.ghost', { type: 'button', onclick: () => go('replay.html') }, 'Tüm oturumlar')));
}

function recentCard() {
  const rows = st.sessions.slice(0, 4);
  return h('article.gl.ov-card.hub-recents', {}, h('div.ov-head', {}, h('h3', {}, 'Son kullanılanlar'), h('button.rv-link', { type: 'button', onclick: () => go('replay.html') }, 'Hepsi')),
    rows.length ? h('div.ov-rows', {}, rows.map((x) => {
      const test = x.kind === 'backtest', sm = x.summary || {};
      const v = test ? sm.returnPct : netOf(sm);
      return h('button.ov-row.wide', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: x.id } : { session: x.id })) },
        h(`span.rv-row-ic.c-${test ? 'violet' : 'accent'}`, {}, icon(test ? 'flask' : 'replay', 18)),
        h('span.ov-row-t', {}, h('b', {}, test ? (sm.strategy || x.name) : x.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
        h(`b.num.ov-row-num${(v ?? 0) > 0 ? '.pos' : (v ?? 0) < 0 ? '.neg' : ''}`, {}, test ? (v != null ? F.pct(v, 1) : '—') : F.signedMoney(v, sm.currency || 'USD')),
        h('span.muted.ov-row-time', {}, relTime(x.updated_at || x.created_at)));
    }), rows.length < 4 ? h('button.ov-row.add', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) },
      h('span.ov-row-add-ic', {}, icon('plus', 18)), h('span.ov-row-t', {}, h('b', {}, 'Yeni replay oturumu'), h('small', {}, 'Geçmişte bir tarih seç, bar bar ilerle'))) : null)
      : h('p.muted', {}, st.loaded ? 'Henüz oturum yok.' : 'Yükleniyor…'));
}

// ── phone sections ───────────────────────────────────────────────────────
function recents() {
  const rows = st.sessions.slice(0, 5);
  const head = h('div.hub-head', {}, h('h2.hub-h', {}, 'Son kullanılanlar'), h('a.hub-more', { href: 'replay.html', onclick: (e) => { e.preventDefault(); go('replay.html'); }, 'aria-label': 'Hepsi' }, icon('chevron', 18)));
  if (!st.loaded) return h('section.hub-sec', {}, head, h('div.hub-list', {}, [0, 1, 2].map(() => h('div.skel.row'))));
  if (!rows.length) {
    return h('section.hub-sec', {}, head, h('div.gl.hub-empty', {}, h('p', {}, 'Henüz oturum yok. Geçmişte bir tarih seç; grafik o ana kadar olanı göstersin, bar bar ilerleyip gerçek gibi işlem aç.'),
      h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'İlk oturumu başlat')));
  }
  return h('section.hub-sec', {}, head, h('div.hub-list', {}, rows.map((s) => {
    const test = s.kind === 'backtest', sm = s.summary || {};
    return h('button.hub-recent', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: s.id } : { session: s.id })) },
      h(`span.rv-row-ic.c-${test ? 'violet' : 'accent'}`, {}, icon(test ? 'flask' : 'replay', 19)),
      h('span.hub-recent-t', {}, h('b', {}, test ? (sm.strategy || s.name) : s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
      h('span.hub-recent-time', {}, relTime(s.updated_at || s.created_at)));
  })));
}

function marketStrip() {
  const list = markets();
  if (st.loaded && !list.length) {
    return h('section.hub-sec', {}, h('h2.hub-h', {}, 'Piyasalar'), h('div.gl.hub-empty', {}, h('p', {}, 'Bu cihazda piyasa verisi yok. 15 yıllık EURUSD, Nasdaq ve altın paketlerini aç.'),
      h('button.rv-btn', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, icon('download', 16), 'Veri paketleri')));
  }
  return h('section.hub-sec', { id: 'hub-markets' },
    h('h2.hub-h', {}, 'Piyasalar'),
    h('div.hub-markets', {}, (st.loaded ? list : [0, 1, 2]).map((d) => {
      if (!d.id) return h('div.skel.hub-market');
      const q = st.quotes.get(d.id);
      const chg = q && q.prev ? q.last / q.prev - 1 : null;
      return h('button.gl.hub-market', { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) },
        h('span.hub-market-top', {}, symbolBadge(d.symbol, 30), h('b', {}, d.symbol),
          chg != null ? h(`span.badge-num.${chg >= 0 ? 'pos' : 'neg'}`, {}, `${chg >= 0 ? '+' : ''}${F.pct(chg, 2)}`) : null),
        h('span.hub-market-px.num', {}, q ? F.price(q.last, d.decimals) : '—'),
        h('small', {}, NAMES[d.symbol] || d.name));
    })));
}

async function loadQuotes() {
  await Promise.all(markets().map(async (d) => {
    const tf = d.timeframes?.includes('1D') ? '1D' : d.timeframes?.at(-1);
    if (!tf) return;
    try {
      const r = await api.bars(d.id, { tf, limit: 90 });
      const c = r?.c ? Array.from(r.c) : [];
      if (c.length) st.quotes.set(d.id, { last: c.at(-1), prev: c.at(-2), spark: c });
    } catch { /* the card stays without a price */ }
  }));
  render();
}

// ── one market's chart ───────────────────────────────────────────────────
function chartCard() {
  const d = chartMarket();
  if (!d) return null;
  const c = st.chart, data = c.data;
  const last = data?.c.at(-1), first = data?.c[0];
  const chg = data && first ? last - first : null;
  const up = chg == null || chg >= 0;
  return h('article.gl.ov-card.hub-chart.span2', { id: 'hub-chart' },
    h('div.ov-head', {}, h('h3', {}, NAMES[d.symbol] || d.symbol, h('small', {}, d.symbol)),
      h('div.rv-seg.sm', { role: 'tablist' }, RANGES.map(([r]) => h(`button${c.range === r ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(c.range === r), onclick: () => { c.range = r; loadChart(); } }, r)))),
    h('div.hub-chart-row', {},
      h('span.hub-chart-px.num', {}, last != null ? F.price(last, d.decimals) : '—'),
      chg != null ? h(`span.num.${up ? 'pos' : 'neg'}`, {}, `${chg >= 0 ? '+' : '−'}${F.price(Math.abs(chg), d.decimals)} (${F.pct(chg / first, 2)})`) : null),
    h('div.hub-plot', {}, data ? linePlot(data, up) : h('div.skel.plot')),
    h('button.rv-btn.ghost.block', { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) }, 'Grafikte aç', icon('chevron', 15)));
}

async function loadChart() {
  const d = chartMarket();
  if (!d) return;
  const c = st.chart;
  const tf = d.timeframes?.includes('1D') ? '1D' : d.timeframes?.at(-1);
  try {
    const r = await api.bars(d.id, { tf, limit: 300 });
    let t = Array.from(r?.t || []), cl = Array.from(r?.c || []);
    const n = RANGES.find(([x]) => x === c.range)?.[1];
    if (c.range === 'YB' && t.length) {
      const from = Date.UTC(new Date(t.at(-1) * 1000).getUTCFullYear(), 0, 1) / 1000;
      const i = t.findIndex((x) => x >= from);
      if (i > 0) { t = t.slice(i); cl = cl.slice(i); }
    } else if (n) { t = t.slice(-n); cl = cl.slice(-n); }
    c.data = cl.length > 1 ? { t, c: cl } : null;
  } catch { c.data = null; }
  const fresh = chartCard();
  const old = document.getElementById('hub-chart');
  if (old && fresh) old.replaceWith(fresh);
}

/** A line with a soft fill, three guides and four dates. */
function linePlot({ t, c }, up) {
  const W = 600, H = 200, pad = 6;
  const lo = Math.min(...c), hi = Math.max(...c), span = hi - lo || 1;
  const x = (i) => pad + (i / (c.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const pts = c.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    ${[0.2, 0.5, 0.8].map((g) => `<line x1="0" x2="${W}" y1="${H * g}" y2="${H * g}" stroke="rgba(255,255,255,.06)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
    <path d="M${pts[0]} L${pts.join(' L')} L${x(c.length - 1)},${H} L${x(0)},${H} Z" fill="url(#${id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  svg.style.color = up ? 'var(--pos)' : 'var(--neg)';
  const fmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: tz() });
  return [svg, h('div.hub-dates', {}, [0, 1 / 3, 2 / 3, 1].map((f) => h('span', {}, fmt.format(new Date(t[Math.round(f * (t.length - 1))] * 1000)))))];
}

function tiles() {
  const tests = st.sessions.filter((s) => s.kind === 'backtest').length;
  const tile = (label, n, href) => h('button.gl.hub-tile', { type: 'button', onclick: () => go(href) }, h('span', {}, label), h('b.num', {}, st.loaded ? String(n) : '—'));
  return h('section.hub-tiles', {}, tile('Oturumlar', replays().length, 'replay.html'), tile('Testler', tests, 'replay.html#testler'));
}

main();
