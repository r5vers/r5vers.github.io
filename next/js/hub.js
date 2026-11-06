// The home: a trading desk before the open. The markets' day as a 24-hour
// dial (the sessions as arcs, the hand at New York time) beside where you
// left off, then a watchlist and your journal. One page for every width
// (the desk parts below; css/home3.css).
import { api } from './api.js?v=60be322688';
import * as F from './format.js?v=60be322688';
import { h, icon } from './ui/dom.js?v=60be322688';
import { SESSION_SETS } from './chart/sessions.js?v=60be322688';
import { nyOffset } from './core/timeframes.js?v=60be322688';
import { openPalette, wirePalette } from './ui/palette.js?v=60be322688';
import { wireTooltips } from './ui/tooltip.js?v=60be322688';
import { NAMES, WIDE, appFrame, baseItems, bootShell, chartUrl, dock, go, greeting, markButton, relTime, searchPill, shell, tz } from './rvshell.js?v=60be322688';

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
  document.body.classList.add('desk-page');
  if (WIDE.matches) {
    document.getElementById('rv-dock')?.remove();
    appFrame({ current: 'home', crumbs: ['Ana ekran'] });
  } else {
    appFrame({ current: 'home' });
    dock({ left: markButton('home'), center: searchPill(items), right: { icon: 'plus', label: 'Yeni replay oturumu', onclick: () => go(chartUrl({ new: 'replay' })) } });
  }
  root.className = 'desk';
  root.replaceChildren(deskTitle(), h('div.desk-top', {}, sessionsPanel(), continuePanel()), h('div.desk-bottom', {}, watchlist(), journal()));
}

// ── the home ────────────────────────────────────────────────────────────
const hmShort = (m) => (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`);
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The markets' day right now, New York time: each session open or not and
 *  how long until it closes or opens; null over the forex weekend. */
function marketDay() {
  const now = Date.now() / 1000, local = now + nyOffset(now);
  const day = new Date(local * 1000).getUTCDay();
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  const closed = day === 6 || (day === 5 && min >= 17 * 60) || (day === 0 && min < 17 * 60);
  const until = (t) => ((t - min) % 1440 + 1440) % 1440;
  const zones = SESSION_SETS[0].zones.map((z) => {
    const open = !closed && (z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to);
    return { name: SESSION_NAMES[z.name] || z.name, color: z.color, from: z.from, to: z.to, open, left: open ? until(z.to) : until(z.from) };
  });
  return { min, closed, zones };
}

function deskTitle() {
  const p = shell.me.profile;
  const date = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() }).format(new Date());
  const md = marketDay();
  const open = md.zones.filter((z) => z.open);
  const next = [...md.zones].filter((z) => !z.open).sort((x, y) => x.left - y.left)[0];
  const now = md.closed ? 'Forex hafta sonu kapalı.'
    : open.length ? `${open.map((z) => z.name).join(' ve ')} açık, kapanışa ${hmShort(Math.min(...open.map((z) => z.left)))}.`
      : `${next.name} ${hmShort(next.left)} sonra açılıyor.`;
  return h('header.desk-title', {},
    h('div', {}, h('h1', {}, `${greeting()}, ${p.name}`), h('p', {}, `${date.charAt(0).toLocaleUpperCase('tr-TR')}${date.slice(1)}. ${now}`)),
    h('div.desk-actions', {},
      h('button.desk-btn', { type: 'button', onclick: () => openPalette(items) }, icon('search', 16), 'Ara', h('kbd', {}, 'Ctrl K')),
      h('button.desk-btn.primary', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('plus', 16), 'Yeni oturum')));
}

/** The day as a 24-hour dial, midnight New York at the top: each session on
 *  its own ring (so where they overlap shows), the open ones lit, the hours,
 *  and the hand at the time now. */
function sessionDial(md) {
  const S = 280, c = S / 2, r = 124, gap = 13;
  const at = (m, rr) => { const a = (m / 1440) * 2 * Math.PI - Math.PI / 2; return [c + rr * Math.cos(a), c + rr * Math.sin(a)]; };
  const arc = (from, to, rr) => {
    const span = ((to - from) % 1440 + 1440) % 1440;
    const [x0, y0] = at(from, rr), [x1, y1] = at(from + span, rr);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 ${span > 720 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  let svg = '';
  md.zones.forEach((z, i) => {
    const rr = r - i * gap;
    svg += `<circle cx="${c}" cy="${c}" r="${rr}" class="dial-track"/><path d="${arc(z.from, z.to, rr)}" class="dial-arc${z.open ? ' on' : ''}" style="stroke:${z.color}"/>`;
  });
  const inner = r - (md.zones.length - 1) * gap - 12;
  for (let hh = 0; hh < 24; hh++) {
    const major = hh % 6 === 0;
    const [x0, y0] = at(hh * 60, inner), [x1, y1] = at(hh * 60, inner - (major ? 9 : 5));
    svg += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" class="dial-tick${major ? ' major' : ''}"/>`;
    if (major) { const [lx, ly] = at(hh * 60, inner - 20); svg += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" class="dial-hour">${String(hh).padStart(2, '0')}</text>`; }
  }
  const [hx, hy] = at(md.min, r + 10), [tx, ty] = at(md.min, inner + 4);
  svg += `<line x1="${tx.toFixed(2)}" y1="${ty.toFixed(2)}" x2="${hx.toFixed(2)}" y2="${hy.toFixed(2)}" class="dial-hand"/><circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="4" class="dial-hand-dot"/>`;
  svg += `<text x="${c}" y="${c + 4}" class="dial-time">${clock(md.min)}</text><text x="${c}" y="${c + 28}" class="dial-zone">New York</text>`;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', `0 0 ${S} ${S}`);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `Seans kadranı, New York saati ${clock(md.min)}`);
  el.classList.add('dial');
  el.innerHTML = svg;
  return el;
}

function sessionsPanel() {
  const md = marketDay();
  return h('section.desk-panel.desk-sessions', {},
    h('header.desk-panel-head', {}, h('h2', {}, 'Seanslar'), h('span.desk-muted', {}, 'New York saatiyle')),
    h('div.desk-sessions-body', {}, sessionDial(md),
      h('ul.desk-legend', {}, md.zones.map((z) => h(`li${z.open ? '.on' : ''}`, { style: { '--c': z.color } },
        h('i'),
        h('span', {}, h('b', {}, z.name), h('small', {}, `${clock(z.from)} – ${clock(z.to)}`)),
        h('em', {}, md.closed ? 'Kapalı' : z.open ? `${hmShort(z.left)} kaldı` : `${hmShort(z.left)} sonra`))))));
}

function continuePanel() {
  const last = replays()[0];
  if (!st.loaded) return h('section.desk-panel.desk-continue.skel');
  if (!last) {
    return h('section.desk-panel.desk-continue', {},
      h('h2', {}, 'Kaldığın yer'),
      h('p.desk-lead', {}, 'Henüz bir replay oturumun yok. Geçmişte bir gün seç; grafik o ana kadar olanı gösterir, sen bar bar ilerleyip gerçek gibi işlem açarsın.'),
      h('div.desk-row-actions', {}, h('button.desk-btn.primary', { type: 'button', onclick: () => go(chartUrl({ new: 'replay' })) }, icon('play', 16), 'İlk oturumu başlat')));
  }
  const sm = last.summary || {}, ccy = sm.currency || 'USD', net = netOf(sm), init = sm.initial || 0;
  const end = st.datasets.find((d) => d.id === last.dataset_id)?.last_ts;
  const day = sm.startTime && sm.cursor ? Math.max(1, Math.ceil((sm.cursor - sm.startTime) / 86400)) : 1;
  const total = sm.startTime && end ? Math.max(day, Math.ceil((end - sm.startTime) / 86400)) : null;
  const tone = net > 0 ? '.gain' : net < 0 ? '.loss' : '';
  return h('section.desk-panel.desk-continue', {},
    h('header.desk-panel-head', {}, h('h2', {}, 'Kaldığın yer'), h('span.desk-muted', {}, relTime(last.updated_at || last.created_at))),
    h('div.desk-session', {},
      h('b', {}, last.name),
      h('span.desk-muted', {}, `${sm.symbol || 'Piyasa'}, ${sm.tf || ''} grafik, ${sm.trades ?? 0} işlem`)),
    h('div.desk-balance', {},
      h('b.num', {}, sm.balance != null ? F.money(sm.balance, ccy) : '—'),
      h(`span.num${tone}`, {}, `${F.signedMoney(net, ccy)}${init ? ` (${net > 0 ? '+' : ''}${F.pct(net / init, 2)})` : ''}`)),
    h('div.desk-progress', {},
      h('div.desk-progress-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total || 1, 'aria-valuenow': day }, h('i', { style: { width: `${total ? Math.max(1.5, (day / total) * 100) : 0}%` } })),
      h('span.desk-muted', {}, total ? `Gün ${day} / ${total}` : `Gün ${day}`)),
    h('div.desk-row-actions', {},
      h('button.desk-btn.primary', { type: 'button', onclick: () => go(chartUrl({ session: last.id })) }, icon('play', 16), 'Devam et'),
      h('button.desk-btn', { type: 'button', onclick: () => go('replay.html') }, 'Tüm oturumlar')));
}

/** Markets with the last price placed in its 90-day range. */
function watchlist() {
  const list = markets().slice(0, 6);
  return h('section.desk-panel.desk-watch', {},
    h('header.desk-panel-head', {}, h('h2', {}, 'İzleme listesi'), h('button.desk-link', { type: 'button', onclick: () => go(chartUrl({ tab: 'data' })) }, 'Veri paketleri')),
    st.loaded && !list.length ? h('p.desk-lead', {}, 'Bu cihazda piyasa verisi yok. Veri paketlerinden EURUSD, Nasdaq ve altını aç.') : null,
    h('div.desk-table', { role: 'table' },
      h('div.desk-tr.desk-th', { role: 'row' }, h('span', {}, 'Piyasa'), h('span', {}, '90 günlük aralık'), h('span.r', {}, 'Son'), h('span.r', {}, 'Gün')),
      (st.loaded ? list : [0, 1, 2, 3]).map((d) => {
        if (!d.id) return h('div.desk-tr.skel');
        const q = st.quotes.get(d.id);
        const chg = q && q.prev ? q.last / q.prev - 1 : null;
        const lo = q ? Math.min(...q.spark) : 0, hi = q ? Math.max(...q.spark) : 0;
        const pos = q && hi > lo ? (q.last - lo) / (hi - lo) : 0.5;
        return h('button.desk-tr', { type: 'button', role: 'row', onclick: () => go(chartUrl({ ds: d.id })) },
          h('span.desk-mkt', {}, h('b', {}, d.symbol), h('small', {}, NAMES[d.symbol] || d.name || '')),
          h('span.desk-range', { title: q ? `90 gün: ${F.price(lo, d.decimals)} – ${F.price(hi, d.decimals)}` : '' },
            h('small.num', {}, q ? F.price(lo, d.decimals) : ''), h('span.desk-range-bar', {}, q ? h('i', { style: { left: `${(pos * 100).toFixed(1)}%` } }) : null), h('small.num', {}, q ? F.price(hi, d.decimals) : '')),
          h('span.r.num.desk-last', {}, q ? F.price(q.last, d.decimals) : '—'),
          h(`span.r.num${chg > 0 ? '.gain' : chg < 0 ? '.loss' : ''}`, {}, chg != null ? `${chg > 0 ? '+' : ''}${F.pct(chg, 2)}` : '—'));
      })));
}

/** Your practice in one sentence, then the sessions behind it. */
function journal() {
  const rs = replays();
  const sum = (xs) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const net = sum(rs.map((x) => netOf(x.summary)));
  const trades = sum(rs.map((x) => x.summary?.trades));
  const rates = rs.map((x) => x.summary?.winRate).filter(Number.isFinite);
  const rate = rates.length ? sum(rates) / rates.length : null;
  const ccy = rs[0]?.summary?.currency || 'USD';
  const rows = st.sessions.slice(0, 5);
  return h('section.desk-panel.desk-journal', {},
    h('header.desk-panel-head', {}, h('h2', {}, 'Günlük'), h('button.desk-link', { type: 'button', onclick: () => go('replay.html#analiz') }, 'Analiz')),
    st.loaded && rs.length ? h('p.desk-summary', {},
      `${rs.length} replay oturumunda ${trades} işlem; kazanma oranın `, h('b', {}, rate != null ? F.pct(rate, 0) : '—'), ', toplam ',
      h(`b.num${net > 0 ? '.gain' : net < 0 ? '.loss' : ''}`, {}, F.signedMoney(net, ccy)), '.') : null,
    st.loaded && !rows.length ? h('p.desk-lead', {}, 'Oturumların burada listelenir.') : null,
    h('div.desk-list', {}, (st.loaded ? rows : [0, 1, 2]).map((x) => {
      if (!x.id) return h('div.desk-li.skel');
      const test = x.kind === 'backtest', sm = x.summary || {};
      const v = test ? sm.returnPct : netOf(sm);
      return h('button.desk-li', { type: 'button', onclick: () => go(chartUrl(test ? { backtest: x.id } : { session: x.id })) },
        h('span.desk-li-t', {}, h('b', {}, test ? (sm.strategy || x.name) : x.name), h('small', {}, `${test ? 'Strateji testi' : 'Replay'}, ${sm.symbol || '—'} ${sm.tf || ''}, ${relTime(x.updated_at || x.created_at)}`)),
        h(`span.num${(v ?? 0) > 0 ? '.gain' : (v ?? 0) < 0 ? '.loss' : ''}`, {}, test ? (v != null ? F.pct(v, 1) : '—') : F.signedMoney(v, sm.currency || 'USD')));
    })));
}

// the markets' sessions, by their Turkish names
const SESSION_NAMES = { ASIA: 'Asya', LONDON: 'Londra', 'NEW YORK': 'New York' };

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
