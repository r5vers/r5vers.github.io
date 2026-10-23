// Home screen: where everything starts after picking a profile. Markets,
// the replay you left off, every saved replay session and strategy test with
// its numbers, and one tap into the chart.
import { EXTRA_WIDGETS, extraWidget, widgetSettings, refreshWidgetClocks } from './ui/homewidgets.js?v=4a4bde5db4';
import { api } from './api.js?v=4a4bde5db4';
import * as F from './format.js?v=4a4bde5db4';
import { avatar, brandMark, confirmBox, flushStorage, h, icon, sparkline, storage, store, toast, useProfileStorage, wirePointerLight } from './ui/dom.js?v=4a4bde5db4';
import { SESSION_SETS, configureICT } from './chart/sessions.js?v=4a4bde5db4';
import { nyOffset } from './core/timeframes.js?v=4a4bde5db4';
import { settingsDialog } from './ui/dialogs.js?v=4a4bde5db4';
import { openPalette, wirePalette } from './ui/palette.js?v=4a4bde5db4';
import { wireTooltips } from './ui/tooltip.js?v=4a4bde5db4';
import { BACKGROUNDS, DEFAULT_APPEARANCE, PRESETS, applyAppearance, metalPicker, normalizeAppearance, paintLastLook, revealPage, rimControls, titleControls } from './ui/look.js?v=4a4bde5db4';
import { modal } from './ui/dom.js?v=4a4bde5db4';

const NAMES = { EURUSD: 'Euro / Dolar', NAS100: 'NASDAQ 100', XAUUSD: 'Altın / Dolar', GBPUSD: 'Sterlin / Dolar', USDCAD: 'Dolar / Kanada doları', SPX500: 'S&P 500', USATECHIDXUSD: 'NASDAQ 100', USA500IDXUSD: 'S&P 500' };
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const state = { me: null, datasets: [], sessions: [], filter: 'all', sort: 'recent', markets: new Map(), more: { tests: false, replays: false } };
const SHOWN = { tests: 6, replays: 5 };
let settings = {};

// a minimal stand-in for the chart app, enough for the settings dialog
const host = {
  mode: 'browse',
  get settings() { return settings; },
  get theme() { return document.documentElement.dataset.theme || 'dark'; },
  saveSettings() {
    store('rt:settings', settings);
    try { localStorage.setItem('rt-last-look', JSON.stringify(settings.appearance)); } catch { /* private mode */ }
  },
  previewAppearance(a) { applyAppearance(a, undefined, { page: 'home' }); },
  applySettings() { applyAppearance(settings.appearance, undefined, { page: 'home' }); renderAll(); },
  onApiChanged() {},
};

const tz = () => settings.tz || LOCAL_TZ;
const ccy = (sm) => sm?.currency || 'USD';
const pf = (x) => (x === 'inf' ? '∞' : F.num(x, 2));

function greeting() {
  const hr = Number(new Intl.DateTimeFormat('tr-TR', { hour: 'numeric', hourCycle: 'h23', timeZone: tz() }).format(new Date()));
  if (hr < 5) return 'İyi geceler';
  if (hr < 12) return 'Günaydın';
  if (hr < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

const chartUrl = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return `/chart.html${q.toString() ? `?${q}` : ''}`;
};
// every link says what it opens; a bare /chart.html is a reload and resumes a replay
const go = async (params = { view: 'chart' }) => {
  // a short fade before the next page, so the change feels like one motion
  document.body.classList.add('leaving');
  await Promise.all([flushStorage(), new Promise((r) => setTimeout(r, 160))]);
  window.location.href = chartUrl(params);
};
// coming back with the browser's back button shows the page again
window.addEventListener('pageshow', () => document.body.classList.remove('leaving'));

async function boot() {
  paintLastLook('home');
  wirePointerLight();
  let me;
  try { me = await api.me(); } catch (err) { revealPage(); toast(`Sunucuya ulaşılamadı: ${err.message}`, 'err', 8000); return; }
  if (!me.profile) { window.location.replace('/profiles.html'); return; }
  state.me = me;
  await useProfileStorage(me.profile.id, me.first);
  settings = storage('rt:settings', {}) || {};
  settings.appearance = normalizeAppearance(settings.appearance || DEFAULT_APPEARANCE);
  if (configureICT(settings)) host.saveSettings();
  // the chart fills in the rest; the settings dialog needs these
  settings.tz ||= LOCAL_TZ;
  settings.volume ??= true;
  settings.account = { balance: 10000, spreadPips: 0.8, commission: 0, sameBar: 'path', ...(settings.account || {}) };
  applyAppearance(settings.appearance, undefined, { page: 'home' });
  revealPage();
  renderShell();
  renderAll();
  wireEditGestures(document.getElementById('home'));
  document.getElementById('home').addEventListener('widget-config', e => widgetSettings(e.detail, renderAll));
  document.getElementById('home').addEventListener('widget-refresh', renderAll);
  setInterval(() => refreshWidgetClocks(), 10000);
  PHONE.addEventListener?.('change', () => renderAll());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && editing && !document.querySelector('.modal-back')) setEditing(false); });
  wirePalette(paletteItems, { typeToSearch: true });
  // the session strip counts down without redrawing the page
  setInterval(() => document.querySelector('.sessions-now')?.replaceWith(sessionStrip()), 30000);
  wireTooltips();
  const [datasets, sessions] = await Promise.all([
    api.datasets().catch(() => []),
    api.sessions().catch(() => []),
  ]);
  state.datasets = datasets;
  state.sessions = sessions;
  state.loaded = true;
  // the entrance plays once, on the first full render
  const root = document.getElementById('home');
  root.classList.add('intro');
  renderAll();
  setTimeout(() => root.classList.remove('intro'), 1400);
  loadMarkets();
  // a cloud profile changed on another device: the look and layout come with
  // a reload, sessions are simply read again
  window.addEventListener('rv-synced', async (e) => {
    const kinds = new Set(e.detail.changed.map((c) => c.kind));
    if (kinds.has('kv') || kinds.has('profile')) { await flushStorage?.(); window.location.reload(); return; }
    state.sessions = await api.sessions().catch(() => state.sessions);
    renderAll();
    toast('Diğer cihazdaki değişiklikler geldi', 'ok');
  });
}

// ── shell: top bar ─────────────────────────────────────────────────────────
function renderShell() {
  const p = state.me.profile;
  document.getElementById('brand-tile').replaceChildren(brandMark(26));
  const chip = document.getElementById('home-profile');
  chip.replaceChildren(avatar({ ...p, locked: false }, 'sm'), h('span.pname', {}, p.name));
  chip.onclick = () => openProfileMenu(chip);
  document.getElementById('home-look').onclick = () => settingsDialog(host, { section: 'look' });
  document.getElementById('home-search').onclick = () => openPalette(paletteItems);
  document.getElementById('home-search').replaceChildren(icon('search', 16), h('span.lbl', {}, 'Ara'), h('kbd', {}, 'Ctrl K'));
  document.getElementById('home-look').replaceChildren(icon('palette', 18));
  document.getElementById('home-chart').replaceChildren(icon('chart', 16), h('span.lbl', {}, 'Grafiği aç'));
  document.getElementById('home-chart').onclick = () => go();
  document.getElementById('home-chart').setAttribute('aria-label', 'Grafiği aç');
  const edit = h('button.btn.icon', { id: 'home-edit', type: 'button', title: 'Ana ekranı düzenle', 'aria-label': 'Ana ekranı düzenle', onclick: () => setEditing(true) }, icon('edit', 17));
  document.getElementById('home-look').before(edit);
  // while editing: customise on the left, done on the right (as on an iPhone)
  document.body.append(
    h('div.edit-bar', { role: 'toolbar', 'aria-label': 'Düzenleme' },
      h('button.edit-pill', { type: 'button', title: 'Özelleştir', 'aria-label': 'Özelleştir', onclick: customiseDialog }, icon('brush', 18)),
      h('button.edit-pill', { id:'layout-undo', type:'button', onclick:undoLayout }, 'Geri al'),
      h('button.edit-pill', { type: 'button', title: 'Bitti', 'aria-label': 'Bitti', onclick: () => setEditing(false) }, icon('check', 20))),
    h('button.edit-pill.edit-add', { type: 'button', onclick: addWidgetDialog }, icon('plus', 16), 'Widget ekle'),
    h('nav.home-dock', { id: 'home-dock', 'aria-label': 'Kısayollar', hidden: true }));
}

function paletteItems() {
  const out = [];
  const add = (group, label, run, extra = {}) => out.push({ group, label, run, ...extra });
  add('Komutlar', 'Grafik', () => go(), { icon: 'chart' });
  add('Komutlar', 'Replay başlat', () => go({ new: 'replay' }), { icon: 'replay', keys: 'yeni oturum' });
  add('Komutlar', 'Strateji testi', () => go({ tab: 'strategy' }), { icon: 'flask', keys: 'backtest' });
  add('Komutlar', 'Veri paketleri', () => go({ tab: 'data' }), { icon: 'data' });
  add('Komutlar', 'Görünüm', () => settingsDialog(host, { section: 'look' }), { icon: 'palette', keys: 'tema renk font' });
  add('Komutlar', 'Ayarlar', () => settingsDialog(host), { icon: 'sliders' });
  for (const d of marketList()) add('Piyasalar', d.symbol, () => go({ ds: d.id }), { sub: NAMES[d.symbol] || d.name, icon: 'chart' });
  for (const s of state.sessions.filter((x) => x.kind !== 'backtest').slice(0, 12)) add('Replay oturumları', s.name, () => go({ session: s.id }), { sub: relTime(s.updated_at), icon: 'replay' });
  for (const t of state.sessions.filter((x) => x.kind === 'backtest').slice(0, 12)) add('Strateji testleri', t.summary?.strategy || t.name, () => go({ backtest: t.id }), { sub: `${t.summary?.symbol || ''} ${t.summary?.tf || ''} · ${F.pct(t.summary?.returnPct, 1)}`, icon: 'flask' });
  for (const p of PRESETS) {
    add('Tema', p.name, () => {
      Object.assign(settings.appearance, { preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down, font: p.font });
      host.saveSettings();
      host.applySettings();
    }, { sub: 'hazır görünüm', icon: 'palette' });
  }
  return out;
}

let menu = null;
function openProfileMenu(anchor) {
  if (menu) { menu.remove(); menu = null; return; }
  const p = state.me.profile;
  menu = h('div.popover.glass-pop', { role: 'menu' },
    h('div.who', {}, avatar({ ...p, locked: false }, 'md'), h('div', {}, h('b', {}, p.name), h('span.muted', { style: { fontSize: '12px' } }, 'Oturumlar, testler ve görünüm bu profile ait'))),
    h('button.item', { onclick: async () => { await flushStorage(); await api.leaveProfile(); window.location.replace('/profiles.html'); } }, icon('swap', 16), h('span.t.plain', {}, 'Profil değiştir')),
    h('button.item', { onclick: () => { closeMenu(); setEditing(true); } }, icon('edit', 16), h('span', {}, h('span.t.plain', {}, 'Ana ekranı düzenle'), h('span.s', {}, 'kartlar, sıra, dock, yazı ve metal'))),
    h('button.item', { onclick: () => { closeMenu(); settingsDialog(host, { section: 'look' }); } }, icon('palette', 16), h('span', {}, h('span.t.plain', {}, 'Görünüm'), h('span.s', {}, 'tema, renkler, cam, yazı tipi'))),
    h('button.item', { onclick: () => { closeMenu(); settingsDialog(host); } }, icon('sliders', 16), h('span', {}, h('span.t.plain', {}, 'Ayarlar'), h('span.s', {}, 'saat dilimi, hesap, API anahtarı'))),
    state.me.auth ? h('button.item', { onclick: async () => { await flushStorage(); await api.logout(); window.location.replace('/login.html'); } }, icon('power', 16), h('span.t.plain', {}, 'Siteden çıkış')) : null);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  Object.assign(menu.style, { top: `${r.bottom + 8}px`, right: `${Math.max(8, window.innerWidth - r.right)}px` });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
function outside(e) { if (menu && !menu.contains(e.target) && !e.target.closest('#home-profile')) closeMenu(); }
function closeMenu() { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); }

// ── content ────────────────────────────────────────────────────────────────
function renderAll() {
  const root = document.getElementById('home');
  if (!state.me) return;
  const replays = state.sessions.filter((s) => s.kind !== 'backtest');
  const tests = state.sessions.filter((s) => s.kind === 'backtest');
  const L = layout();
  const build = {
    hero: () => hero(replays, tests), actions, resume: () => resume(replays), markets,
    ...Object.fromEntries(EXTRA_WIDGETS.map(([id]) => [id, () => extraWidget(id, settings)])),
    performance: () => performance(replays, tests), tests: () => testHistory(tests), replays: () => replayList(replays),
  };
  const boards = L.order.filter((id) => !L.hidden.includes(id)).map((id) => decorate(build[id](), id, L));
  root.replaceChildren(...[
    state.me.ephemeral ? h('div.banner.warn', {}, icon('warn', 16), h('span', {}, h('b', {}, 'Kalıcı disk bağlı değil. '),
      'Railway’de bu servise bir Volume eklenmezse her güncellemede profiller, oturumlar, testler ve indirilen veri silinir. Servis → Settings → Volumes → mount path ', h('code', {}, '/data'), '.')) : null,
    ...boards,
    h('footer.home-foot', {}, 'RV · Replay Terminal · veriler Dukascopy (geçmiş) ve OANDA / Binance (canlı) kaynaklıdır'),
  ].filter(Boolean));
  renderDock(L);
  const undo = document.getElementById('layout-undo'); if (undo) undo.disabled = !layoutHistory[device()].length;
}

// ── layout: which boards, in what order, how big; kept per profile and,
// within it, apart for phones and laptops ───────────────────────────────────
const WIDGETS = [
  ['hero', 'Selam ve seanslar'], ['actions', 'Kısayollar'], ['resume', 'Kaldığın yer'], ['markets', 'Piyasalar'],
  ['performance', 'Performans'], ['tests', 'Strateji testleri'], ['replays', 'Replay oturumları'],
  ...EXTRA_WIDGETS.map(([id, name]) => [id, name]),
];
const WIDGET_NAME = Object.fromEntries(WIDGETS);
const DOCK = {
  chart: { label: 'Grafik', icon: 'chart', run: () => go() },
  replay: { label: 'Replay', icon: 'replay', run: () => go({ new: 'replay' }) },
  strategy: { label: 'Strateji testi', icon: 'flask', run: () => go({ tab: 'strategy' }) },
  data: { label: 'Veri', icon: 'data', run: () => go({ tab: 'data' }) },
  live: { label: 'Canlı', icon: 'live', run: () => go({ mode: 'live' }) },
  search: { label: 'Ara', icon: 'search', run: () => openPalette(paletteItems) },
  look: { label: 'Görünüm', icon: 'palette', run: () => settingsDialog(host, { section: 'look' }) },
};
const DOCK_MAX = 6;
const PHONE = window.matchMedia('(max-width: 760px)');
const device = () => (PHONE.matches ? 'phone' : 'desk');
let editing = false;
const layoutHistory = { phone: [], desk: [] };
function undoLayout() {
  const previous = layoutHistory[device()].pop(); if (!previous) return;
  const all = storage('rt:homeLayout', {}) || {}; all[device()] = previous; store('rt:homeLayout', all); renderAll();
}


function layout() {
  const d = (storage('rt:homeLayout', {}) || {})[device()] || {};
  const ids = WIDGETS.map(([id]) => id);
  const saved = Array.isArray(d.order) ? d.order.filter((id) => ids.includes(id)) : [];
  const dock = { on: device() === 'phone', items: ['chart', 'replay', 'strategy', 'data'], ...(d.dock || {}) };
  dock.items = (Array.isArray(dock.items) ? dock.items : []).filter((k, i, all) => DOCK[k] && all.indexOf(k) === i).slice(0, DOCK_MAX);
  return {
    order: [...saved, ...ids.filter((id) => !saved.includes(id))],
    hidden: [...new Set([...(Array.isArray(d.hidden) ? d.hidden.filter(id => ids.includes(id)) : []), ...EXTRA_WIDGETS.map(([id]) => id).filter(id => !saved.includes(id))])],
    size: d.size && typeof d.size === 'object' ? d.size : {},
    dock,
  };
}
function saveLayout(L) {
  layoutHistory[device()].push(structuredClone(layout()));
  if (layoutHistory[device()].length > 30) layoutHistory[device()].shift();
  const all = { ...(storage('rt:homeLayout', {}) || {}) };
  all[device()] = L;
  store('rt:homeLayout', all);
}
const compact = (id) => layout().size[id] === 'compact';

/** A board on the home screen: named, sized, and with its edit handles. */
function decorate(node, id, L = layout()) {
  if (!node) return null;
  node.classList.add('widget');
  node.dataset.widget = id;
  node.dataset.label = WIDGET_NAME[id];
  node.classList.toggle('w-compact', L.size[id] === 'compact');
  if (editing) {
    node.append(
      h('button.w-minus', { type: 'button', title: `${WIDGET_NAME[id]}: kaldır`, 'aria-label': `${WIDGET_NAME[id]} kartını kaldır`, onclick: (e) => { e.stopPropagation(); removeWidget(id, node); } }),
      h('button.w-size', { type: 'button', title: L.size[id] === 'compact' ? 'Büyüt' : 'Küçült', 'aria-label': L.size[id] === 'compact' ? 'Büyüt' : 'Küçült', onclick: (e) => { e.stopPropagation(); toggleSize(id); } },
        icon(L.size[id] === 'compact' ? 'expand' : 'shrink', 13)),
      EXTRA_WIDGETS.some(w => w[0] === id) ? h('button.w-config', { type:'button', title:'Widget ayarları', 'aria-label':`${WIDGET_NAME[id]} ayarları`, onclick:e=>{e.stopPropagation();widgetSettings(id,renderAll);} },icon('sliders',13)) : document.createDocumentFragment(),
      h('span.w-name', {}, WIDGET_NAME[id]));
  }
  return node;
}

function setEditing(on) {
  if (editing === on) return;
  editing = on;
  document.body.classList.toggle('editing', on);
  closeMenu();
  renderAll();
}

function removeWidget(id, node) {
  const L = layout();
  if (!L.hidden.includes(id)) L.hidden.push(id);
  saveLayout(L);
  node.classList.add('w-leaving');
  setTimeout(renderAll, 220);
}

function toggleSize(id) {
  const L = layout();
  if (L.size[id] === 'compact') delete L.size[id]; else L.size[id] = 'compact';
  saveLayout(L);
  renderAll();
}

function renderDock(L) {
  const dock = document.getElementById('home-dock');
  if (!dock) return;
  const on = L.dock.on && L.dock.items.length > 0;
  document.body.classList.toggle('has-dock', on);
  dock.hidden = !on;
  if (!on) { dock.replaceChildren(); return; }
  dock.replaceChildren(...L.dock.items.map((k) => h('div.dock-cell', {},
    h('button.dock-app', { type: 'button', title: DOCK[k].label, 'aria-label': DOCK[k].label, onclick: () => { if (!editing) DOCK[k].run(); } }, icon(DOCK[k].icon, 22)),
    editing ? h('button.w-minus', { type: 'button', 'aria-label': `${DOCK[k].label}: dock'tan kaldır`, onclick: () => {
      const M = layout(); M.dock.items = M.dock.items.filter((x) => x !== k); saveLayout(M); renderAll();
    } }) : null)));
}

// press and hold a board to start editing (touch); while editing, hold and
// drag to move it — the others glide out of the way
function wireEditGestures(root) {
  let press = null;
  let drag = null;
  const boards = () => [...root.querySelectorAll('section.widget')];
  const cancelPress = () => { if (press?.timer) clearTimeout(press.timer); press = null; };
  const flip = (mutate) => {
    const others = boards().filter((b) => b !== drag.el);
    const before = new Map(others.map((b) => [b, b.offsetTop]));
    mutate();
    for (const b of others) {
      const dy = before.get(b) - b.offsetTop;
      if (!dy) continue;
      b.style.transition = 'none';
      b.style.transform = `translate3d(0, ${dy}px, 0)`;
      void b.offsetHeight;
      b.style.transition = 'transform 0.34s cubic-bezier(.2,.8,.2,1)';
      b.style.transform = '';
    }
  };
  const place = () => {
    const el = drag.el;
    const top = root.getBoundingClientRect().top + el.offsetTop;
    el.style.transform = `translate3d(0, ${drag.y - drag.grab - top}px, 0) scale(1.015)`;
  };
  const move = (y) => {
    drag.y = y;
    const el = drag.el;
    const rootTop = root.getBoundingClientRect().top;
    const list = boards();
    const at = list.indexOf(el);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b === el) continue;
      const mid = rootTop + b.offsetTop + b.offsetHeight / 2;
      if (i > at && y > mid) { flip(() => b.after(el)); break; }
      if (i < at && y < mid) { flip(() => b.before(el)); break; }
    }
    place();
  };
  const scrollLoop = () => {
    if (!drag) return;
    const edge = 90, y = drag.y;
    const v = y < edge ? -(edge - y) / 5 : y > window.innerHeight - edge ? (y - window.innerHeight + edge) / 5 : 0;
    if (v) { window.scrollBy(0, v); move(y); }
    drag.raf = requestAnimationFrame(scrollLoop);
  };
  const start = (el, y) => {
    const r = el.getBoundingClientRect();
    drag = { el, y, grab: y - r.top, raf: 0 };
    document.body.classList.add('drag-active');
    el.classList.add('dragging');
    place();
    drag.raf = requestAnimationFrame(scrollLoop);
  };
  const finish = () => {
    if (!drag) return;
    const { el } = drag;
    cancelAnimationFrame(drag.raf);
    el.style.transition = 'transform 0.3s cubic-bezier(.2,.8,.2,1)';
    el.style.transform = '';
    const shown = boards().map((b) => b.dataset.widget);
    drag = null;
    setTimeout(() => { el.classList.remove('dragging'); el.style.transition = ''; document.body.classList.remove('drag-active'); }, 300);
    // the boards not on the page (hidden, or with nothing to show) keep their slots
    const L = layout();
    let i = 0;
    L.order = L.order.map((id) => (shown.includes(id) ? shown[i++] : id));
    saveLayout(L);
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const el = e.target.closest('section.widget');
    if (!el || e.target.closest('.w-minus, .w-size, .w-config')) return;
    if (!editing) {
      if (e.pointerType === 'mouse' || e.target.closest('button, a, input, select, textarea')) return;
      press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; setEditing(true); }, 520) };
      return;
    }
    e.preventDefault();
    const mouse = e.pointerType === 'mouse';
    press = { el, x: e.clientX, y: e.clientY, mouse, timer: mouse ? 0 : setTimeout(() => { if (press) { const p = press; press = null; start(p.el, p.y); } }, 180) };
  });
  window.addEventListener('pointermove', (e) => {
    if (drag) { move(e.clientY); return; }
    if (!press) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (press.mouse && press.el && far > 4) { const p = press; press = null; start(p.el, p.y); move(e.clientY); return; }
    if (far > 9) cancelPress(); // a scroll, not a hold
  });
  window.addEventListener('pointerup', () => { cancelPress(); finish(); });
  window.addEventListener('pointercancel', () => { cancelPress(); finish(); });
  // once a board is lifted the page must not scroll under the finger
  root.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (editing || press) e.preventDefault(); });
}

function addWidgetDialog() {
  const L = layout();
  const body = h('div.widget-pick', {}, L.hidden.length
    ? L.hidden.map((id) => h('button.widget-pick-row', { type: 'button', onclick: () => {
      const M = layout(); M.hidden = M.hidden.filter((x) => x !== id); saveLayout(M); dlg.close(); renderAll(); document.querySelector(`[data-widget="${id}"]`)?.scrollIntoView({ behavior:'smooth', block:'center' });
    } }, h('span.wp-ic', {}, icon('plus', 16)), h('span', {}, h('b', {}, WIDGET_NAME[id]), h('small', { style: { display:'block', marginTop:'5px', color:'var(--muted)' } }, EXTRA_WIDGETS.find(w => w[0] === id)?.[2] || 'Ana ekran kartını geri ekle'))))
    : h('p.muted', {}, 'Tüm widget’lar eklendi. Kaldırdığın kartları buradan yeniden ekleyebilirsin.'));
  const search = h('input.ctl', { type:'search', placeholder:'Widget ara…', 'aria-label':'Widget ara', oninput:e=>{ for (const row of body.querySelectorAll('.widget-pick-row')) row.hidden = !row.textContent.toLocaleLowerCase('tr').includes(e.target.value.toLocaleLowerCase('tr')); } });
  const dlg = modal({ title: 'Widget ekle', body:h('div',{},search,body), actions: [{ label: 'Kapat' }] });
}

/** The brush: theme metal, heading text, boards and dock, saved as you go. */
function customiseDialog() {
  let tab = 'theme';
  const body = h('div.custom-sheet');
  const a = settings.appearance;
  const saveLook = (rerender = true) => {
    host.saveSettings();
    applyAppearance(settings.appearance, undefined, { page: 'home' });
    if (rerender) paint();
  };
  const seg = (opts, cur, set) => h('div.seg', {}, opts.map(([v, l]) => h(`button${cur === v ? '.on' : ''}`, { type: 'button', onclick: () => set(v) }, l)));
  const paint = () => {
    const L = layout();
    const panes = {
      theme: () => [
        ...metalPicker(a, saveLook),
        h('h4', {}, 'Arka plan'),
        h('div.swatch-row', {}, Object.entries(BACKGROUNDS).filter(([k]) => k !== 'custom').map(([k, b]) =>
          h(`button.swatch.wide${a.bg === k ? '.on' : ''}`, { type: 'button', title: b.name, 'aria-label': b.name, style: { background: b.css }, onclick: () => { a.bg = k; a.preset = null; saveLook(); } }))),
      ],
      text: () => titleControls(a, saveLook),
      cards: () => [
        ...rimControls(a, saveLook),
        h('h4', {}, 'Kartlar'),
        h('button.btn.small.outline', { type:'button', onclick:()=>{ const M=layout(); M.hidden=EXTRA_WIDGETS.map(([id])=>id); M.order=WIDGETS.map(([id])=>id); M.size={}; saveLayout(M); renderAll(); paint(); } }, 'Bu cihazın düzenini sıfırla'),
        h('p.look-lead', {}, 'Ana ekranda sürükleyerek de sıralayabilirsin.'),
        h('div.widget-list', {}, L.order.map((id, i) => h('div.widget-line', {},
          h('span.wl-name', {}, WIDGET_NAME[id]),
          seg([['full', 'Büyük'], ['compact', 'Küçük']], L.size[id] === 'compact' ? 'compact' : 'full', (v) => { const M = layout(); if (v === 'compact') M.size[id] = 'compact'; else delete M.size[id]; saveLayout(M); renderAll(); paint(); }),
          h('button.btn.icon.small', { type: 'button', title: 'Yukarı', 'aria-label': 'Yukarı taşı', disabled: i === 0, onclick: () => { const M = layout(); [M.order[i - 1], M.order[i]] = [M.order[i], M.order[i - 1]]; saveLayout(M); renderAll(); paint(); } }, icon('up', 15)),
          h('button.btn.icon.small', { type: 'button', title: 'Aşağı', 'aria-label': 'Aşağı taşı', disabled: i === L.order.length - 1, onclick: () => { const M = layout(); [M.order[i + 1], M.order[i]] = [M.order[i], M.order[i + 1]]; saveLayout(M); renderAll(); paint(); } }, icon('down', 15)),
          h('label.switch.mini', { title: 'Göster' }, h('input', { type: 'checkbox', checked: !L.hidden.includes(id), onchange: (e) => {
            const M = layout(); M.hidden = e.target.checked ? M.hidden.filter((x) => x !== id) : [...M.hidden, id]; saveLayout(M); renderAll(); paint();
          } }), h('span.track', {}, h('span.knob')))))),
      ],
      dock: () => [
        h('label.switch', {}, h('input', { type: 'checkbox', checked: L.dock.on, onchange: (e) => { const M = layout(); M.dock.on = e.target.checked; saveLayout(M); renderAll(); paint(); } }),
          h('span.track', {}, h('span.knob')), h('span.switch-label', {}, 'Dock’u göster', h('small', {}, 'Ekranın altında sabit kısayollar'))),
        h('h4', {}, `Kısayollar (en çok ${DOCK_MAX})`),
        h('div.dock-pick', {}, Object.entries(DOCK).map(([k, d]) => {
          const on = L.dock.items.includes(k);
          return h(`button.dock-chip${on ? '.on' : ''}`, { type: 'button', disabled: !on && L.dock.items.length >= DOCK_MAX, onclick: () => {
            const M = layout(); M.dock.items = on ? M.dock.items.filter((x) => x !== k) : [...M.dock.items, k]; saveLayout(M); renderAll(); paint();
          } }, icon(d.icon, 18), h('span', {}, d.label));
        })),
      ],
    };
    body.replaceChildren(
      seg([['theme', 'Tema'], ['text', 'Yazı'], ['cards', 'Kartlar'], ['dock', 'Dock']], tab, (v) => { tab = v; paint(); }),
      h('div.custom-pane', {}, ...panes[tab]()));
  };
  paint();
  modal({ title: 'Özelleştir', body, actions: [{ label: 'Bitti', kind: 'primary' }], note: 'Bu profile kaydedilir' });
}

function hero(replays, tests) {
  const p = state.me.profile;
  const date = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() }).format(new Date());
  return h('section.hero', {},
    h('div.hero-date', {}, date),
    h('h1', {}, `${greeting()}, ${p.name}`),
    sessionStrip(),
    h('p.lead', {}, !state.loaded ? 'Yükleniyor…'
      : state.datasets.length ? `${marketList().length} piyasa hazır · ${replays.length} replay oturumu · ${tests.length} strateji testi`
        : `Bu cihazda henüz piyasa verisi yok · ${replays.length} replay oturumu · ${tests.length} strateji testi`));
}

// ── market sessions right now (New York time, DST aware) ───────────────────
const SESSION_NAMES = { ASIA: 'Asya', LONDON: 'Londra', 'NEW YORK': 'New York' };
const hm = (min) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`; };

function sessionsNow(now = Date.now() / 1000) {
  const local = now + nyOffset(now);
  const day = new Date(local * 1000).getUTCDay();          // NY weekday
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  // forex closes Friday 17:00 and opens Sunday 17:00 New York time
  const closed = day === 6 || (day === 5 && min >= 17 * 60) || (day === 0 && min < 17 * 60);
  if (closed) {
    const toOpen = ((day === 5 ? 2 : day === 6 ? 1 : 0) * 1440) + 17 * 60 - min;
    return { closed: true, toOpen };
  }
  return {
    closed: false,
    zones: SESSION_SETS[0].zones.map((z) => {
      const open = z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to;
      const until = (t) => ((t - min) % 1440 + 1440) % 1440;
      return { name: SESSION_NAMES[z.name] || z.name, color: z.color, open, left: open ? until(z.to) : until(z.from) };
    }),
  };
}

function sessionStrip() {
  const s = sessionsNow();
  if (s.closed) return h('div.sessions-now', {}, h('span.sess.off', {}, h('i'), 'Forex kapalı'), h('span.sess-note', {}, `açılışa ${hm(s.toOpen)}`));
  return h('div.sessions-now', {}, s.zones.map((z) => h(`span.sess${z.open ? '.on' : ''}`, { style: { '--c': z.color }, title: z.open ? `${z.name} seansı açık, ${hm(z.left)} sonra kapanır` : `${z.name} seansı ${hm(z.left)} sonra açılır` },
    h('i'), z.name, h('small', {}, z.open ? `${hm(z.left)} kaldı` : `${hm(z.left)} sonra`))));
}

function actions() {
  const card = (ic, title, desc, onclick, cls = '') => h(`button.action${cls}`, { type: 'button', onclick },
    h('span.action-ic', {}, icon(ic, 20)), h('span.action-t', {}, title), h('span.action-d', {}, desc), h('span.action-go', {}, icon('arrow', 16)));
  return h('section.actions', {},
    card('chart', 'Grafik', 'Son baktığın piyasa ve zaman dilimi', () => go(), '.primary'),
    card('replay', 'Replay başlat', 'Geçmişte bir tarihe dön, bar bar işlem yap', () => go({ new: 'replay' })),
    card('flask', 'Strateji testi', 'Kodunla yıllarca veride otomatik backtest', () => go({ tab: 'strategy' })),
    card('data', 'Veri', '15 yıllık EURUSD, NASDAQ, altın paketleri', () => go({ tab: 'data' })));
}

function resume(replays) {
  const last = replays[0];
  if (!last) return null;
  const sm = last.summary || {};
  const spark = sm.spark?.length > 1 ? sparkline(sm.spark, { color: (sm.net ?? 0) >= 0 ? 'var(--up)' : 'var(--down)', width: 220, height: 56 }) : null;
  return h('section.resume.glass', {},
    h('div.resume-l', {},
      h('span.eyebrow', {}, icon('clock', 14), 'Kaldığın yer'),
      h('h2', {}, last.name),
      h('div.resume-meta', {},
        h('span', {}, h('b', {}, sm.symbol || '—'), sm.tf ? ` · ${sm.tf}` : ''),
        h('span', {}, `Grafik zamanı ${F.dateTime(sm.cursor, tz())}`),
        h('span', {}, `Son açılış ${relTime(last.updated_at)}`))),
    h('div.resume-stats', {},
      stat('Net', F.signedMoney(sm.net, ccy(sm)), F.cls(sm.net)),
      stat('İşlem', String(sm.trades ?? 0)),
      stat('Kazanma', F.pct(sm.winRate, 0)),
      sm.open ? stat('Açık', String(sm.open)) : null),
    spark ? h('div.resume-spark', {}, spark) : null,
    h('button.btn.primary', { onclick: () => go({ session: last.id }) }, icon('play', 14), 'Devam et'));
}

function stat(label, value, cls = '') {
  return h('div.stat', {}, h('span.k', {}, label), h(`span.v${cls ? `.${cls}` : ''}`, {}, value));
}

function relTime(t) {
  const d = Date.now() / 1000 - t;
  if (d < 90) return 'az önce';
  if (d < 3600) return `${Math.round(d / 60)} dk önce`;
  if (d < 86400) return `${Math.round(d / 3600)} saat önce`;
  if (d < 7 * 86400) return `${Math.round(d / 86400)} gün önce`;
  return F.dateOnly(t, tz());
}

// ── markets ────────────────────────────────────────────────────────────────
function marketList() {
  const withData = state.datasets.filter((d) => d.bar_count && d.source !== 'demo');
  const list = withData.length ? withData : state.datasets.filter((d) => d.bar_count);
  // packs first, then the rest by size
  return [...list].sort((a, b) => (!!b.meta?.pack - !!a.meta?.pack) || b.bar_count - a.bar_count).slice(0, 6);
}

function markets() {
  const list = marketList();
  const head = h('div.sec-head', {}, h('h3', {}, 'Piyasalar'), h('button.btn.small.outline', { onclick: () => go({ tab: 'data' }) }, 'Veri yönetimi'));
  if (!state.loaded) return h('section', { id: 'markets' }, head, h('div.grid-markets', {}, [0, 1, 2].map(() => h('div.market.skeleton'))));
  if (!list.length) {
    return h('section', { id: 'markets' }, head, h('div.empty-card', {},
      h('p', {}, 'Henüz piyasa verisi yok. 15 yıllık EURUSD, NASDAQ 100 ve altın verisini tek tıkla indir.'),
      h('button.btn.primary', { onclick: () => go({ tab: 'data' }) }, icon('download', 14), 'Veri paketlerini aç')));
  }
  return h('section', { id: 'markets' }, head, h('div.grid-markets', {}, list.map(marketCard)));
}

function marketCard(ds) {
  const m = state.markets.get(ds.id);
  const last = m?.closes.at(-1), prev = m?.closes.at(-2);
  const chg = last != null && prev ? last / prev - 1 : null;
  const years = ds.first_ts && ds.last_ts ? (ds.last_ts - ds.first_ts) / (365.25 * 86400) : 0;
  return h('button.market.glass', { type: 'button', onclick: () => go({ ds: ds.id }) },
    h('div.market-top', {},
      h('div', {}, h('div.market-sym', {}, ds.symbol), h('div.market-name', {}, NAMES[ds.symbol] || ds.name)),
      chg != null ? h(`span.chg.${F.cls(chg)}`, {}, `${chg > 0 ? '+' : ''}${F.pct(chg, 2)}`) : null),
    h('div.market-price', {}, last != null ? F.price(last, ds.decimals) : '—'),
    h('div.market-spark', {}, m ? sparkline(m.closes, { color: m.closes.at(-1) >= m.closes[0] ? 'var(--up)' : 'var(--down)', width: 260, height: 54 }) : null),
    h('div.market-foot', {},
      h('span', {}, years >= 1 ? `${Math.floor(years)} yıl veri` : `${Math.max(1, Math.round(years * 12))} ay veri`),
      h('span', {}, `son: ${F.dateOnly(ds.last_ts, tz())}`)));
}

async function loadMarkets() {
  // all markets at once
  await Promise.all(marketList().map(async (ds) => {
    const tf = ds.timeframes?.includes('1D') ? '1D' : ds.timeframes?.at(-1);
    if (!tf) return;
    try {
      const r = await api.bars(ds.id, { tf, limit: 90 });
      if (r?.c?.length) state.markets.set(ds.id, { closes: Array.from(r.c) });
    } catch { /* leave the card without a curve */ }
  }));
  // only the market cards change: the rest of the page stays as it is
  const fresh = decorate(markets(), 'markets');
  if (fresh && !layout().hidden.includes('markets')) document.getElementById('markets')?.replaceWith(fresh);
}

// ── performance across sessions and tests ──────────────────────────────────
function performance(replays, tests) {
  const all = [...replays, ...tests];
  if (!all.length) return null;
  const sum = (xs) => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  const trades = sum(all.map((s) => s.summary?.trades));
  const rates = all.map((s) => s.summary?.winRate).filter(Number.isFinite);
  const best = tests.filter((t) => Number.isFinite(t.summary?.returnPct)).sort((a, b) => b.summary.returnPct - a.summary.returnPct)[0];
  const replayNet = sum(replays.map((s) => s.summary?.net));
  return h('section', {},
    h('div.sec-head', {}, h('h3', {}, 'Performans')),
    h('div.kpi-row', {},
      kpi('Replay net', F.signedMoney(replayNet, ccy(replays[0]?.summary)), F.cls(replayNet), `${replays.length} oturum`),
      kpi('Toplam işlem', trades.toLocaleString('tr-TR'), '', 'replay + test'),
      kpi('Ortalama kazanma', rates.length ? F.pct(sum(rates) / rates.length, 0) : '—', '', 'oturum başına'),
      kpi('En iyi test', best ? F.pct(best.summary.returnPct, 1) : '—', best ? F.cls(best.summary.returnPct) : '', best ? best.summary.strategy : 'henüz test yok')));
}

function kpi(label, value, cls, sub) {
  return h('div.kpi-card.glass', {}, h('span.k', {}, label), h(`span.v${cls ? `.${cls}` : ''}`, {}, value), sub ? h('span.s', {}, sub) : null);
}

// ── strategy test history ──────────────────────────────────────────────────
function testHistory(tests) {
  const symbols = [...new Set(tests.map((t) => t.summary?.symbol).filter(Boolean))];
  if (state.filter !== 'all' && !symbols.includes(state.filter)) state.filter = 'all';
  let rows = tests.filter((t) => state.filter === 'all' || t.summary?.symbol === state.filter);
  const key = { recent: (t) => -t.created_at, net: (t) => -(t.summary?.returnPct ?? -Infinity), win: (t) => -(t.summary?.winRate ?? -1) }[state.sort];
  rows = [...rows].sort((a, b) => key(a) - key(b));
  const seg = (opts, cur, set) => h('div.seg.compact', {}, opts.map(([v, l]) => h(`button${cur === v ? '.on' : ''}`, { type: 'button', onclick: () => { set(v); renderAll(); } }, l)));
  return h('section', { id: 'tests' },
    h('div.sec-head', {}, h('h3', {}, 'Strateji testleri', h('span.count', {}, String(tests.length))),
      tests.length ? h('div.sec-tools', {},
        symbols.length > 1 ? seg([['all', 'Tümü'], ...symbols.map((s) => [s, s])], state.filter, (v) => { state.filter = v; }) : null,
        seg([['recent', 'En yeni'], ['net', 'Getiri'], ['win', 'Kazanma']], state.sort, (v) => { state.sort = v; })) : null),
    tests.length ? h('div.list.glass', {}, limited(rows, 'tests').map(testRow), moreButton(rows, 'tests')) : h('div.empty-card', {},
      h('p', {}, 'Strateji testleri burada birikir: her çalıştırma sonuçlarıyla birlikte otomatik kaydedilir.'),
      h('button.btn.outline', { onclick: () => go({ tab: 'strategy' }) }, icon('flask', 14), 'İlk testini çalıştır')));
}

function testRow(t) {
  const sm = t.summary || {};
  const up = (sm.net ?? 0) >= 0;
  return h('div.row', {},
    h('button.row-main', { type: 'button', onclick: () => go({ backtest: t.id }), title: 'Sonuçları grafikte aç' },
      h('div.row-title', {}, h('b', {}, sm.strategy || t.name), h('span.tag', {}, `${sm.symbol || '—'} · ${sm.tf || ''}`)),
      h('div.row-sub', {}, `${F.dateOnly(sm.from, 'UTC')} → ${F.dateOnly(sm.to, 'UTC')} · ${relTime(t.created_at)}`)),
    h('div.row-spark', {}, sm.spark?.length > 1 ? sparkline(sm.spark, { color: up ? 'var(--up)' : 'var(--down)', width: 110, height: 30, fill: false }) : null),
    h('div.row-stats', {},
      stat('Getiri', F.pct(sm.returnPct, 1), F.cls(sm.returnPct)),
      stat('Net', F.signedMoney(sm.net, ccy(sm)), F.cls(sm.net)),
      stat('İşlem', String(sm.trades ?? 0)),
      stat('Kazanma', F.pct(sm.winRate, 0)),
      stat('K. faktörü', pf(sm.profitFactor)),
      stat('Maks. düşüş', F.pct(sm.maxDrawdownPct, 1))),
    h('div.row-actions', {},
      h('button.btn.small.outline', { onclick: () => go({ backtest: t.id }) }, 'Aç'),
      h('button.btn.icon.small', { title: 'Sil', 'aria-label': 'Testi sil', onclick: () => remove(t, 'Testi sil') }, icon('trash', 15))));
}

const shown = (key) => (compact(key) ? 3 : SHOWN[key]);
const limited = (rows, key) => (state.more[key] ? rows : rows.slice(0, shown(key)));

function moreButton(rows, key) {
  if (rows.length <= shown(key)) return null;
  return h('button.list-more', { type: 'button', onclick: () => { state.more[key] = !state.more[key]; renderAll(); } },
    state.more[key] ? 'Daha az göster' : `Tümünü göster (${rows.length})`);
}

// ── replay sessions ────────────────────────────────────────────────────────
function replayList(replays) {
  return h('section', {},
    h('div.sec-head', {}, h('h3', {}, 'Replay oturumları', h('span.count', {}, String(replays.length))),
      h('button.btn.small.outline', { onclick: () => go({ new: 'replay' }) }, icon('plus', 14), 'Yeni oturum')),
    replays.length ? h('div.list.glass', {}, limited(replays, 'replays').map(replayRow), moreButton(replays, 'replays')) : h('div.empty-card', {},
      h('p', {}, 'Bir tarih seç, grafik o ana kadar olanı göstersin; bar bar ilerleyip gerçek gibi işlem aç. Oturumlar kaldığın yerden devam eder.'),
      h('button.btn.outline', { onclick: () => go({ new: 'replay' }) }, icon('replay', 14), 'İlk replay oturumunu başlat')));
}

function replayRow(s) {
  const sm = s.summary || {};
  const up = (sm.net ?? 0) >= 0;
  return h('div.row', {},
    h('button.row-main', { type: 'button', onclick: () => go({ session: s.id }), title: 'Kaldığın yerden devam et' },
      h('div.row-title', {}, h('b', {}, s.name), h('span.tag', {}, `${sm.symbol || '—'}${sm.tf ? ` · ${sm.tf}` : ''}`)),
      h('div.row-sub', {}, `${F.dateTime(sm.startTime, tz())} → ${F.dateTime(sm.cursor, tz())} · ${relTime(s.updated_at)}`)),
    h('div.row-spark', {}, sm.spark?.length > 1 ? sparkline(sm.spark, { color: up ? 'var(--up)' : 'var(--down)', width: 110, height: 30, fill: false }) : null),
    h('div.row-stats', {},
      stat('Net', F.signedMoney(sm.net, ccy(sm)), F.cls(sm.net)),
      stat('Bakiye', F.money(sm.balance, ccy(sm))),
      stat('İşlem', String(sm.trades ?? 0)),
      stat('Kazanma', F.pct(sm.winRate, 0)),
      stat('K. faktörü', pf(sm.profitFactor)),
      stat('Maks. düşüş', F.pct(sm.maxDrawdownPct, 1))),
    h('div.row-actions', {},
      h('button.btn.small.primary', { onclick: () => go({ session: s.id }) }, 'Devam et'),
      h('button.btn.icon.small', { title: 'Sil', 'aria-label': 'Oturumu sil', onclick: () => remove(s, 'Oturumu sil') }, icon('trash', 15))));
}

async function remove(s, title) {
  if (!(await confirmBox(title, `“${s.name}” silinsin mi? Bu geri alınamaz.`, 'Sil', 'danger'))) return;
  try {
    await api.deleteSession(s.id);
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    if (storage('rt:settings', {})?.resume === s.id) { settings.resume = null; host.saveSettings(); }
    renderAll();
    toast('Silindi', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

boot();
