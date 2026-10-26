// The home screen of the test copy, after Alltra's: your name and the time
// of day, your apps as large cards, what you opened last, the markets, one
// market's chart, and the floating bar (apps · search · new session).
import { api } from './api.js?v=379181f731';
import * as F from './format.js?v=379181f731';
import { h, icon } from './ui/dom.js?v=379181f731';
import { wirePalette } from './ui/palette.js?v=379181f731';
import { wireTooltips } from './ui/tooltip.js?v=379181f731';
import { APPS, NAMES, avatarButton, baseItems, bootShell, chartUrl, dock, go, greeting, markButton, relTime, searchPill, shell, symbolBadge, tz } from './rvshell.js?v=379181f731';

const st = { datasets: [], sessions: [], loaded: false, quotes: new Map(), chart: { range: '1A', data: null, loading: false } };
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

function items() {
  const out = baseItems();
  for (const d of markets()) out.push({ group: 'Piyasalar', label: d.symbol, sub: NAMES[d.symbol] || d.name, icon: 'chart', run: () => go(chartUrl({ ds: d.id })) });
  for (const s of st.sessions.filter((x) => x.kind !== 'backtest').slice(0, 12)) out.push({ group: 'Replay oturumları', label: s.name, sub: relTime(s.updated_at), icon: 'replay', run: () => go(chartUrl({ session: s.id })) });
  return out;
}

function render() {
  const root = document.getElementById('hub');
  if (!shell.me) return;
  const p = shell.me.profile;
  root.replaceChildren(
    h('header.hub-top', {}, avatarButton()),
    h('section.hub-hello', {}, h('h1', {}, p.name), h('p', {}, greeting())),
    apps(),
    recents(),
    marketStrip(),
    chartCard(),
    tiles(),
    h('footer.hub-foot', {}, 'RV Next · test sürümü · veriler Dukascopy (geçmiş) ve OANDA / Binance (canlı)'));
  dock({ left: markButton('home'), center: searchPill(items), right: { icon: 'plus', label: 'Yeni replay oturumu', onclick: () => go(chartUrl({ new: 'replay' })) } });
}

function apps() {
  return h('section.hub-sec', {},
    h('h2.hub-h', {}, 'Uygulamaların'),
    h('div.hub-apps', {}, APPS.map((a, i) => h(`a.hub-app.c${i}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
      h('span.hub-app-top', {}, h('span.hub-app-ic', {}, icon(a.icon, 30)), a.badge ? h('span.hub-badge', {}, a.badge) : null),
      h('span.hub-app-name', {}, a.name),
      h('span.hub-app-sub', {}, a.sub)))));
}

function recents() {
  const rows = st.sessions.slice(0, 5);
  const head = h('div.hub-head', {}, h('h2.hub-h', {}, 'Son kullanılanlar'), h('a.hub-more', { href: 'replay.html', onclick: (e) => { e.preventDefault(); go('replay.html'); }, 'aria-label': 'Hepsi' }, icon('chevron', 18)));
  if (!st.loaded) return h('section.hub-sec', {}, head, h('div.hub-recents', {}, [0, 1, 2].map(() => h('div.hub-recent.skel'))));
  if (!rows.length) {
    return h('section.hub-sec', {}, head, h('div.hub-empty', {}, h('p', {}, 'Henüz oturum yok. Geçmişte bir tarih seç, grafik o ana kadar olanı göstersin; bar bar ilerleyip gerçek gibi işlem aç.'),
      h('button.rv-cta', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'İlk oturumu başlat')));
  }
  return h('section.hub-sec', {}, head, h('div.hub-recents', {}, rows.map((s) => {
    const test = s.kind === 'backtest';
    const sm = s.summary || {};
    return h('button.hub-recent', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: s.id } : { session: s.id })) },
      h('span.hub-recent-ic', {}, icon(test ? 'flask' : 'replay', 20)),
      h('span.hub-recent-t', {}, h('b', {}, test ? (sm.strategy || s.name) : s.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
      h('span.hub-recent-time', {}, relTime(s.updated_at || s.created_at)));
  })));
}

function marketStrip() {
  const list = markets();
  if (st.loaded && !list.length) {
    return h('section.hub-sec', {}, h('h2.hub-h', {}, 'Piyasalar'), h('div.hub-empty', {}, h('p', {}, 'Bu cihazda piyasa verisi yok. 15 yıllık EURUSD, Nasdaq ve altın paketlerini aç.'),
      h('button.rv-cta', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, icon('download', 16), 'Veri paketleri')));
  }
  return h('section.hub-sec', {},
    h('div.hub-head', {}, h('h2.hub-h', {}, 'Piyasalar'), h('a.hub-more', { href: chartUrl({ tab: 'data' }), onclick: (e) => { e.preventDefault(); go(chartUrl({ tab: 'data' })); }, 'aria-label': 'Veri' }, icon('data', 18))),
    h('div.hub-markets', {}, (st.loaded ? list : [0, 1, 2]).map((d) => {
      if (!d.id) return h('div.hub-market.skel');
      const q = st.quotes.get(d.id);
      const chg = q && q.prev ? q.last / q.prev - 1 : null;
      return h('button.hub-market', { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) },
        h('span.hub-market-top', {}, symbolBadge(d.symbol, 30), h('span', {}, d.symbol),
          chg != null ? h(`span.hub-chg.${chg >= 0 ? 'up' : 'down'}`, {}, `${chg >= 0 ? '+' : ''}${F.pct(chg, 2)}`) : null),
        h('span.hub-market-price.rv-num', {}, q ? F.price(q.last, d.decimals) : '—'),
        h('span.hub-market-name', {}, NAMES[d.symbol] || d.name));
    })));
}

async function loadQuotes() {
  await Promise.all(markets().map(async (d) => {
    const tf = d.timeframes?.includes('1D') ? '1D' : d.timeframes?.at(-1);
    if (!tf) return;
    try {
      const r = await api.bars(d.id, { tf, limit: 2 });
      const c = r?.c ? Array.from(r.c) : [];
      if (c.length) st.quotes.set(d.id, { last: c.at(-1), prev: c.at(-2) });
    } catch { /* the card stays without a price */ }
  }));
  const fresh = marketStrip();
  document.querySelector('.hub-markets')?.closest('section')?.replaceWith(fresh);
}

// ── one market's chart, Alltra's "Nasdaq 100" card ─────────────────────
function chartCard() {
  const d = chartMarket();
  if (!d) return null;
  const c = st.chart;
  const data = c.data;
  const last = data?.c.at(-1), first = data?.c[0];
  const chg = data && first ? last - first : null;
  const up = chg == null || chg >= 0;
  const seg = h('div.hub-seg', { role: 'tablist' }, RANGES.map(([r]) => h(`button${c.range === r ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(c.range === r), onclick: () => { c.range = r; loadChart(); } }, r)));
  return h('section.hub-card.hub-chart', { id: 'hub-chart' },
    h('div.hub-chart-name', {}, `${NAMES[d.symbol] || d.symbol}`, h('small', {}, d.symbol)),
    seg,
    h('div.hub-chart-row', {},
      h('span.hub-chart-price.rv-num', {}, last != null ? F.price(last, d.decimals) : '—'),
      chg != null ? h(`span.hub-chart-chg.${up ? 'up' : 'down'}`, {}, `${chg >= 0 ? '+' : '−'}${F.price(Math.abs(chg), d.decimals)} (${F.pct(chg / first, 2)})`) : null),
    h('div.hub-chart-plot', {}, data ? linePlot(data, up) : h('div.hub-plot-skel')),
    h('button.hub-wide', { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) }, 'Grafikte aç', icon('chevron', 16)));
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
      const y = new Date(t.at(-1) * 1000).getUTCFullYear();
      const from = Date.UTC(y, 0, 1) / 1000;
      const i = t.findIndex((x) => x >= from);
      if (i > 0) { t = t.slice(i); cl = cl.slice(i); }
    } else if (n) { t = t.slice(-n); cl = cl.slice(-n); }
    c.data = cl.length > 1 ? { t, c: cl } : null;
  } catch { c.data = null; }
  document.getElementById('hub-chart')?.replaceWith(chartCard());
}

/** A line with a soft fill under it, three guides and four dates. */
function linePlot({ t, c }, up) {
  const W = 600, H = 220, pad = 6;
  const lo = Math.min(...c), hi = Math.max(...c), span = hi - lo || 1;
  const x = (i) => pad + (i / (c.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const pts = c.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const color = up ? 'var(--rv-sky)' : 'var(--rv-rose)';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    ${[0.18, 0.5, 0.82].map((g) => `<line x1="0" x2="${W}" y1="${H * g}" y2="${H * g}" stroke="rgba(255,255,255,.07)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
    <path d="M${pts[0]} L${pts.join(' L')} L${x(c.length - 1)},${H} L${x(0)},${H} Z" fill="url(#${id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  svg.style.color = color;
  const labels = [0, 1 / 3, 2 / 3, 1].map((f) => t[Math.round(f * (t.length - 1))]);
  const fmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: tz() });
  return [svg, h('div.hub-dates', {}, labels.map((ts) => h('span', {}, fmt.format(new Date(ts * 1000)))))];
}

function tiles() {
  const replays = st.sessions.filter((s) => s.kind !== 'backtest').length;
  const tests = st.sessions.filter((s) => s.kind === 'backtest').length;
  const tile = (label, n, href) => h('button.hub-tile', { type: 'button', onclick: () => go(href) }, h('span', {}, label), h('b.rv-num', {}, st.loaded ? String(n) : '—'));
  return h('section.hub-tiles', {}, tile('Replay oturumları', replays, 'replay.html'), tile('Strateji testleri', tests, 'replay.html#testler'));
}

main();
