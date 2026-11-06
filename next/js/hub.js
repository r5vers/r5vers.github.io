// The home: one page for every width. Brutal type on a ruled grid, liquid
// glass where something floats, and the first market drawn in ASCII behind
// your name (the hx parts below; css/home3.css).
import { api } from './api.js?v=b60488f141';
import { SITE_TAG } from './local/site.js?v=b60488f141';
import * as F from './format.js?v=b60488f141';
import { h, icon } from './ui/dom.js?v=b60488f141';
import { SESSION_SETS } from './chart/sessions.js?v=b60488f141';
import { nyOffset } from './core/timeframes.js?v=b60488f141';
import { openPalette, wirePalette } from './ui/palette.js?v=b60488f141';
import { wireTooltips } from './ui/tooltip.js?v=b60488f141';
import { APPS, NAMES, WIDE, appFrame, baseItems, bootShell, chartUrl, dock, go, greeting, markButton, relTime, searchPill, shell, tz } from './rvshell.js?v=b60488f141';

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
  // the home: one page for every width (hx below); the shell around it as before
  document.body.classList.add('hx-page');
  if (WIDE.matches) {
    document.getElementById('rv-dock')?.remove();
    appFrame({ current: 'home', crumbs: ['Ana ekran'] });
  } else {
    appFrame({ current: 'home' });
    dock({ left: markButton('home'), center: searchPill(items), right: { icon: 'plus', label: 'Yeni replay oturumu', onclick: () => go(chartUrl({ new: 'replay' })) } });
  }
  root.className = 'hx';
  root.replaceChildren(hxHero(), hxStats(), hxBoard(), hxIndex(), hxLog(), hxFoot());
}

// ── the home ────────────────────────────────────────────────────────────
// Brutal type on a ruled grid, with liquid glass only where it floats: the
// name set huge over the first market's line and two lights, where you left
// off on a pane of glass, the numbers as big figures between hairlines, the
// markets as a ticker board, the apps as a numbered index, recents as a log.
const two = (n) => String(n + 1).padStart(2, '0');
const nyTime = () => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date());

function hxHero() {
  const p = shell.me.profile;
  const now = new Date();
  const date = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz() }).format(now);
  const day = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: tz() }).format(now);
  const first = markets()[0];
  const q = first && st.quotes.get(first.id);
  const art = h('div.hx-art', { 'aria-hidden': 'true' }, h('i.hx-light.a'), h('i.hx-light.b'), h('i.hx-light.c'));
  if (q?.spark?.length > 1) {
    // characters of 11px (9px on phones) Azeret Mono are about 0.6 of that wide
    const cols = Math.max(48, Math.min(260, Math.round((window.innerWidth - (WIDE.matches ? 224 : 0)) / (WIDE.matches ? 6.6 : 5.4))));
    art.append(h('pre.hx-ascii', {}, asciiChart(q.spark, cols, WIDE.matches ? 26 : 16)), h('span.hx-line-tag', {}, `${first.symbol} · 90G · ASCII`));
  }
  return h('section.hx-hero', {}, art,
    h('div.hx-meta', {},
      h('span', {}, 'RV/00'), h('span', {}, date), h('span', {}, day), h('span', {}, `NY ${nyTime()}`), hxSessions()),
    h('div.hx-title', {},
      h('span.hx-hi', {}, `${greeting()},`),
      h('h1.hx-name', {}, p.name)),
    h('div.hx-acts', {},
      h('button.hx-btn.solid', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, 'Yeni oturum', icon('plus', 18)),
      h('button.hx-btn', { type: 'button', onclick: () => go(chartUrl({ view: 'chart' })) }, 'Grafik', icon('arrow', 18)),
      h('button.hx-btn.ghost', { type: 'button', onclick: () => openPalette(items) }, icon('search', 16), 'Ara', h('kbd', {}, 'Ctrl K'))),
    hxResume());
}

/** A market's closes drawn in characters, as a terminal would: the line in
 *  solid marks, the ground under it thinning out the further down it goes. */
function asciiChart(c, cols, rows) {
  const lo = Math.min(...c), hi = Math.max(...c), span = hi - lo || 1;
  const at = (x) => {
    const f = (x / (cols - 1)) * (c.length - 1), i = Math.floor(f), t = f - i;
    const v = c[i] + ((c[i + 1] ?? c[i]) - c[i]) * t;
    return Math.round((1 - (v - lo) / span) * (rows - 1));
  };
  const top = Array.from({ length: cols }, (_, x) => at(x));
  const RAMP = '#*=+-:. ';
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const d = y - top[x];
      if (d < 0) line += ' ';
      else if (d === 0) {
        const step = (top[x + 1] ?? top[x]) - top[x];
        line += step < 0 ? '/' : step > 0 ? '\\' : '_';
      } else line += RAMP[Math.min(RAMP.length - 1, Math.floor((d / rows) * RAMP.length * 1.4))];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** A share as a bar of characters: [██████░░░░]. */
const asciiBar = (f, n = 16) => { const k = Math.round(Math.max(0, Math.min(1, f ?? 0)) * n); return `[${'█'.repeat(k)}${'░'.repeat(n - k)}]`; };

const RV_ASCII = [
  '██████╗ ██╗   ██╗',
  '██╔══██╗██║   ██║',
  '██████╔╝██║   ██║',
  '██╔══██╗╚██╗ ██╔╝',
  '██║  ██║ ╚████╔╝ ',
  '╚═╝  ╚═╝  ╚═══╝  ',
].join('\n');

/** The markets' sessions as plain tags: open ones lit. */
function hxSessions() {
  const now = Date.now() / 1000, local = now + nyOffset(now);
  const day = new Date(local * 1000).getUTCDay();
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  if (day === 6 || (day === 5 && min >= 17 * 60) || (day === 0 && min < 17 * 60)) return h('span.hx-sess', {}, 'FX KAPALI');
  return h('span.hx-sessions', {}, SESSION_SETS[0].zones.map((z) => {
    const open = z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to;
    return h(`span.hx-sess${open ? '.on' : ''}`, { style: { '--c': z.color } }, (SESSION_NAMES[z.name] || z.name).toUpperCase());
  }));
}

/** Where you left off, on glass. */
function hxResume() {
  const last = replays()[0];
  if (!st.loaded) return h('div.hx-glass.hx-resume.skel');
  if (!last) {
    return h('button.hx-glass.hx-resume', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) },
      h('span.hx-k', {}, 'İLK OTURUM'), h('b.hx-resume-name', {}, 'Herhangi bir günü yeniden yaşa'),
      h('span.hx-resume-sub', {}, 'Geçmişte bir tarih seç, bar bar ilerle.'), h('span.hx-resume-go', {}, 'Başlat', icon('arrow', 16)));
  }
  const sm = last.summary || {}, ccy = sm.currency || 'USD', net = netOf(sm);
  return h('button.hx-glass.hx-resume', { type: 'button', onclick: () => go(chartUrl({ session: last.id })) },
    h('span.hx-k', {}, `KALDIĞIN YER · ${relTime(last.updated_at || last.created_at).toUpperCase()}`),
    h('b.hx-resume-name', {}, last.name),
    h('span.hx-resume-sub', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''} · ${sm.trades ?? 0} işlem`),
    h('span.hx-resume-nums', {},
      h('span', {}, h('small', {}, 'BAKİYE'), h('b.num', {}, sm.balance != null ? F.money(sm.balance, ccy) : '—')),
      h('span', {}, h('small', {}, 'NET'), h(`b.num${net > 0 ? '.pos' : net < 0 ? '.neg' : ''}`, {}, F.signedMoney(net, ccy)))),
    h('span.hx-resume-go', {}, 'Devam et', icon('arrow', 16)));
}

function hxStats() {
  const rs = replays();
  const sum = (xs) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const net = sum(rs.map((x) => netOf(x.summary)));
  const rates = rs.map((x) => x.summary?.winRate).filter(Number.isFinite);
  const rate = rates.length ? sum(rates) / rates.length : null;
  const ccy = rs[0]?.summary?.currency || 'USD';
  const cell = (k, v, cls = '', extra = null) => h('div.hx-stat', {}, h('span.hx-k', {}, k), h(`b.num${cls}`, {}, v), extra);
  return h('section.hx-stats', {},
    cell('NET K/Z', F.signedMoney(net, ccy), net > 0 ? '.pos' : net < 0 ? '.neg' : ''),
    cell('KAZANMA', rate != null ? F.pct(rate, 1) : '—', '', h('span.hx-bar', {}, asciiBar(rate))),
    cell('İŞLEM', String(sum(rs.map((x) => x.summary?.trades)))),
    cell('OTURUM', String(rs.length)));
}

function hxBoard() {
  const list = markets().slice(0, 6);
  const head = h('header.hx-head', {}, h('h2', {}, 'Piyasalar'), h('span.hx-k', {}, `${String(list.length).padStart(2, '0')} / PAKET`),
    h('button.hx-link', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, 'Veri', icon('arrow', 14)));
  const cells = (st.loaded ? list : [0, 1, 2]).map((d, i) => {
    if (!d.id) return h('div.hx-cell.skel');
    const q = st.quotes.get(d.id);
    const chg = q && q.prev ? q.last / q.prev - 1 : null;
    return h(`button.hx-cell${chg != null ? (chg >= 0 ? '.up' : '.down') : ''}`, { type: 'button', onclick: () => go(chartUrl({ ds: d.id })) },
      h('span.hx-cell-top', {}, h('span.hx-k', {}, two(i)), h('span.hx-chg.num', {}, chg != null ? `${chg >= 0 ? '▲' : '▼'} ${F.pct(Math.abs(chg), 2)}` : '—')),
      h('b.hx-sym', {}, d.symbol),
      h('span.hx-sym-name', {}, NAMES[d.symbol] || d.name || ''),
      h('span.hx-px.num', {}, q ? F.price(q.last, d.decimals) : '—'),
      h('span.hx-spark', {}, q?.spark?.length > 1 ? areaSpark(q.spark) : null));
  });
  return h('section.hx-sec', {}, head, h('div.hx-board', {}, cells));
}

function hxIndex() {
  return h('section.hx-sec', {}, h('header.hx-head', {}, h('h2', {}, 'Uygulamalar'), h('span.hx-k', {}, `${String(APPS.length).padStart(2, '0')} / ARAÇ`)),
    h('nav.hx-index', {}, APPS.map((a, i) => h(`a.hx-item.app-${a.id}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
      h('span.hx-k', {}, two(i)), h('b', {}, a.name), h('span.hx-item-sub', {}, a.sub), h('span.hx-item-go', {}, icon('arrow', 22))))));
}

function hxLog() {
  const rows = st.sessions.slice(0, 6);
  const head = h('header.hx-head', {}, h('h2', {}, 'Kayıt'), h('span.hx-k', {}, 'SON OTURUMLAR'),
    h('button.hx-link', { type: 'button', onclick: () => go('replay.html') }, 'Hepsi', icon('arrow', 14)));
  if (st.loaded && !rows.length) return h('section.hx-sec', {}, head, h('p.hx-empty', {}, 'Henüz oturum yok.'));
  return h('section.hx-sec', {}, head, h('div.hx-log', {}, (st.loaded ? rows : [0, 1, 2]).map((x) => {
    if (!x.id) return h('div.hx-logrow.skel');
    const test = x.kind === 'backtest', sm = x.summary || {};
    const v = test ? sm.returnPct : netOf(sm);
    return h('button.hx-logrow', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: x.id } : { session: x.id })) },
      h('span.hx-k', {}, test ? 'TEST' : 'REPLAY'),
      h('b', {}, test ? (sm.strategy || x.name) : x.name),
      h('span.hx-log-sym', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`),
      h(`span.num.hx-log-v${(v ?? 0) > 0 ? '.pos' : (v ?? 0) < 0 ? '.neg' : ''}`, {}, test ? (v != null ? F.pct(v, 1) : '—') : F.signedMoney(v, sm.currency || 'USD')),
      h('span.hx-log-t', {}, relTime(x.updated_at || x.created_at)));
  })));
}

const hxFoot = () => h('footer.hx-foot', {}, h('pre.hx-logo', { 'aria-label': 'RV' }, RV_ASCII),
  h('span.hx-foot-t', {}, h('span', {}, SITE_TAG), h('span', {}, 'Veri: Dukascopy (geçmiş) · OANDA / Binance (canlı)')));

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
