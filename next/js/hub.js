// The home: one page for every width, after iOS - a quiet wallpaper, soft
// glass widgets, app icons, a Stocks-like list and a grouped list of recents
// (the io parts below; css/home3.css).
import { api } from './api.js?v=5e84c48433';
import { SITE_TAG } from './local/site.js?v=5e84c48433';
import * as F from './format.js?v=5e84c48433';
import { h, icon } from './ui/dom.js?v=5e84c48433';
import { SESSION_SETS } from './chart/sessions.js?v=5e84c48433';
import { nyOffset } from './core/timeframes.js?v=5e84c48433';
import { openPalette, wirePalette } from './ui/palette.js?v=5e84c48433';
import { wireTooltips } from './ui/tooltip.js?v=5e84c48433';
import { APPS, NAMES, WIDE, appFrame, baseItems, bootShell, chartUrl, dock, go, greeting, markButton, relTime, ring, searchPill, shell, tz } from './rvshell.js?v=5e84c48433';

const netOf = (sm = {}) => (sm.balance != null && sm.initial != null ? sm.balance - sm.initial : sm.net ?? 0);

const st = { datasets: [], sessions: [], loaded: false, quotes: new Map() };

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
}

function markets() {
  const withData = st.datasets.filter((d) => d.bar_count && d.source !== 'demo');
  const list = withData.length ? withData : st.datasets.filter((d) => d.bar_count);
  return [...list].sort((a, b) => (!!b.meta?.pack - !!a.meta?.pack) || b.bar_count - a.bar_count).slice(0, 8);
}
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
  // the home: one page for every width (io below); the shell around it as before
  document.body.classList.add('io-page');
  if (WIDE.matches) {
    document.getElementById('rv-dock')?.remove();
    appFrame({ current: 'home', crumbs: ['Ana ekran'] });
  } else {
    appFrame({ current: 'home' });
    dock({ left: markButton('home'), center: searchPill(items), right: { icon: 'plus', label: 'Yeni replay oturumu', onclick: () => go(chartUrl({ new: 'replay' })) } });
  }
  root.className = 'io';
  root.replaceChildren(ioHead(), ioWidgets(), ioApps(), h('div.io-cols', {}, ioStocks(), ioRecents()), ioFoot());
}

// ── the home ────────────────────────────────────────────────────────────
const nyTime = () => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date());

function ioHead() {
  const p = shell.me.profile;
  const date = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() }).format(new Date());
  return h('header.io-head', {},
    h('div', {}, h('span.io-date', {}, date), h('h1', {}, `${greeting()}, ${p.name}`)),
    h('button.io-search', { type: 'button', onclick: () => openPalette(items) }, icon('search', 17), h('span', {}, 'Ara')));
}

/** The session now open (New York time), and how long it has left. */
function openSession() {
  const now = Date.now() / 1000, local = now + nyOffset(now);
  const day = new Date(local * 1000).getUTCDay();
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  if (day === 6 || (day === 5 && min >= 17 * 60) || (day === 0 && min < 17 * 60)) return null;
  const until = (t) => ((t - min) % 1440 + 1440) % 1440;
  const z = SESSION_SETS[0].zones.find((x) => (x.from < x.to ? min >= x.from && min < x.to : min >= x.from || min < x.to));
  return z ? { name: SESSION_NAMES[z.name] || z.name, color: z.color, left: until(z.to) } : { name: 'Seans arası', color: '#8e8e93', left: null };
}
const hmShort = (m) => (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`);

function ioWidgets() {
  const rs = replays();
  const sum = (xs) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const net = sum(rs.map((x) => netOf(x.summary)));
  const rates = rs.map((x) => x.summary?.winRate).filter(Number.isFinite);
  const rate = rates.length ? sum(rates) / rates.length : null;
  const ccy = rs[0]?.summary?.currency || 'USD';
  const sess = openSession();
  const small = (cls, ic, label, body) => h(`div.io-w.io-w-s${cls}`, {}, h('span.io-w-h', {}, icon(ic, 14), label), body);
  return h('section.io-widgets', {},
    ioResume(),
    small('.io-rate', 'target', 'Kazanma', h('div.io-ring', {}, ring(rate, { size: 72, stroke: 8 }), h('b.num', {}, rate != null ? F.pct(rate, 0) : '—'))),
    small('.io-sess', 'clock', 'Seans', h('div.io-w-v', {},
      h('b', { style: { color: sess?.color } }, sess ? sess.name : 'Kapalı'),
      h('small', {}, sess?.left != null ? `${hmShort(sess.left)} kaldı` : 'Forex hafta sonu kapalı'),
      h('small.io-faint', {}, `New York ${nyTime()}`))),
    small('', 'indicator', 'Net K/Z', h('div.io-w-v', {},
      h(`b.num${net > 0 ? '.pos' : net < 0 ? '.neg' : ''}`, {}, F.signedMoney(net, ccy)), h('small', {}, `${rs.length} oturum`))),
    small('', 'swap', 'İşlem', h('div.io-w-v', {}, h('b.num', {}, String(sum(rs.map((x) => x.summary?.trades)))), h('small', {}, 'toplam'))));
}

/** Where you left off: the large widget. */
function ioResume() {
  const last = replays()[0];
  if (!st.loaded) return h('div.io-w.io-w-l.skel');
  if (!last) {
    return h('button.io-w.io-w-l.io-resume', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) },
      h('span.io-w-h', {}, icon('replay', 14), 'Replay'),
      h('div.io-resume-t', {}, h('b', {}, 'İlk oturumunu başlat'), h('small', {}, 'Geçmişte bir gün seç, bar bar ilerle, gerçek gibi işlem aç.')),
      h('span.io-play', {}, icon('play', 20)));
  }
  const sm = last.summary || {}, ccy = sm.currency || 'USD', net = netOf(sm), init = sm.initial || 0;
  return h('button.io-w.io-w-l.io-resume', { type: 'button', onclick: () => go(chartUrl({ session: last.id })) },
    h('span.io-w-h', {}, icon('replay', 14), 'Kaldığın yer', h('span.io-faint', {}, relTime(last.updated_at || last.created_at))),
    h('div.io-resume-t', {},
      h('b', {}, last.name),
      h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${sm.trades ?? 0} işlem`)),
    h('div.io-resume-n', {},
      h('b.num', {}, sm.balance != null ? F.money(sm.balance, ccy) : '—'),
      h(`span.num${net > 0 ? '.pos' : net < 0 ? '.neg' : ''}`, {}, `${F.signedMoney(net, ccy)}${init ? ` (${net > 0 ? '+' : ''}${F.pct(net / init, 2)})` : ''}`)),
    h('span.io-play', {}, icon('play', 20)));
}

function ioApps() {
  return h('nav.io-apps', { 'aria-label': 'Uygulamalar' }, APPS.map((a) => h(`a.io-app.app-${a.id}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
    h('span.io-app-ic', {}, icon(a.icon, 28)), h('span.io-app-t', {}, a.name))));
}

/** The markets, as iOS Stocks lists them. */
function ioStocks() {
  const list = markets().slice(0, 6);
  return h('section.io-card.io-stocks', {},
    h('header.io-card-h', {}, h('h2', {}, 'Piyasalar'), h('button.io-link', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, 'Veri')),
    st.loaded && !list.length ? h('p.io-empty', {}, 'Bu cihazda piyasa verisi yok.') : null,
    h('div.io-rows', {}, (st.loaded ? list : [0, 1, 2]).map((d) => {
      if (!d.id) return h('div.io-row.skel');
      const q = st.quotes.get(d.id);
      const chg = q && q.prev ? q.last / q.prev - 1 : null;
      return h(`button.io-row.io-stock${chg != null ? (chg >= 0 ? '.up' : '.down') : ''}`, { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) },
        h('span.io-row-t', {}, h('b', {}, d.symbol), h('small', {}, NAMES[d.symbol] || d.name || '')),
        h('span.io-spark', {}, q?.spark?.length > 1 ? areaSpark(q.spark) : null),
        h('span.io-px', {}, h('b.num', {}, q ? F.price(q.last, d.decimals) : '—'), h('span.io-chg.num', {}, chg != null ? `${chg >= 0 ? '+' : ''}${F.pct(chg, 2)}` : '—')));
    })));
}

/** Recents, as a grouped list. */
function ioRecents() {
  const rows = st.sessions.slice(0, 5);
  return h('section.io-card.io-recents', {},
    h('header.io-card-h', {}, h('h2', {}, 'Son kullanılanlar'), h('button.io-link', { type: 'button', onclick: () => go('replay.html') }, 'Tümü')),
    st.loaded && !rows.length ? h('p.io-empty', {}, 'Henüz oturum yok.') : null,
    h('div.io-rows', {}, (st.loaded ? rows : [0, 1, 2]).map((x) => {
      if (!x.id) return h('div.io-row.skel');
      const test = x.kind === 'backtest', sm = x.summary || {};
      const v = test ? sm.returnPct : netOf(sm);
      return h('button.io-row', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: x.id } : { session: x.id })) },
        h(`span.io-row-ic.app-${test ? 'strategy' : 'replay'}`, {}, icon(test ? 'flask' : 'replay', 16)),
        h('span.io-row-t', {}, h('b', {}, test ? (sm.strategy || x.name) : x.name), h('small', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${relTime(x.updated_at || x.created_at)}`)),
        h(`span.num.io-row-v${(v ?? 0) > 0 ? '.pos' : (v ?? 0) < 0 ? '.neg' : ''}`, {}, test ? (v != null ? F.pct(v, 1) : '—') : F.signedMoney(v, sm.currency || 'USD')),
        h('span.io-chev', {}, icon('chevron', 14)));
    })));
}

const ioFoot = () => h('footer.io-foot', {}, `${SITE_TAG} · veriler Dukascopy (geçmiş), OANDA / Binance (canlı)`);

// the markets' sessions, by their Turkish names
const SESSION_NAMES = { ASIA: 'Asya', LONDON: 'Londra', 'NEW YORK': 'New York' };

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

main();
