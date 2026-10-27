// The frame every app page of the test copy shares.
// Phones: one floating bar at the foot (round · pill · round) and sheets
// that rise from it. Wide screens (Alltra's desktop): a rail of the apps, an
// optional sidebar of the app's sections, a top bar with the path, and a
// drawer from the right for the profile and the look.
import { api } from './api.js?v=b966ffb7f9';
import * as F from './format.js?v=b966ffb7f9';
import { avatar, brandMark, flushStorage, h, icon, storage, store, useProfileStorage } from './ui/dom.js?v=b966ffb7f9';
import { configureICT } from './chart/sessions.js?v=b966ffb7f9';
import { settingsDialog } from './ui/dialogs.js?v=b966ffb7f9';
import { openPalette } from './ui/palette.js?v=b966ffb7f9';
import { BACKGROUNDS, DEFAULT_APPEARANCE, PRESETS, applyAppearance, normalizeAppearance, paintLastLook, revealPage } from './ui/look.js?v=b966ffb7f9';

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const NAMES = { EURUSD: 'Euro / Dolar', NAS100: 'Nasdaq 100', XAUUSD: 'Altın / Dolar', GBPUSD: 'Sterlin / Dolar', USDCAD: 'Dolar / Kanada doları', SPX500: 'S&P 500', USATECHIDXUSD: 'Nasdaq 100', USA500IDXUSD: 'S&P 500' };
export const WIDE = window.matchMedia('(min-width: 1024px)');

export const shell = { me: null, settings: {}, onRepaint: () => {} };

// a minimal stand-in for the chart app, enough for the settings dialog
export const host = {
  mode: 'browse',
  get settings() { return shell.settings; },
  get theme() { return 'dark'; },
  saveSettings() {
    store('rt:settings', shell.settings);
    try { localStorage.setItem('nx-last-look', JSON.stringify(shell.settings.appearance)); } catch { /* private mode */ }
  },
  previewAppearance(a) { applyAppearance(a, undefined, { page: 'home' }); },
  applySettings() { applyAppearance(shell.settings.appearance, undefined, { page: 'home' }); shell.onRepaint(); },
  onApiChanged() {},
};

/** The profile, its settings and look; to the profile screen without one. */
export async function bootShell(onRepaint) {
  shell.onRepaint = onRepaint;
  paintLastLook('home');
  const me = await api.me();
  if (!me.profile) { window.location.replace('profiles.html'); return null; }
  shell.me = me;
  await useProfileStorage(me.profile.id, me.first);
  const s = storage('rt:settings', {}) || {};
  s.appearance = normalizeAppearance(s.appearance || DEFAULT_APPEARANCE);
  if (configureICT(s)) store('rt:settings', s);
  s.tz ||= LOCAL_TZ;
  s.volume ??= true;
  s.account = { balance: 10000, spreadPips: 0.8, commission: 0, sameBar: 'path', ...(s.account || {}) };
  shell.settings = s;
  host.saveSettings();
  applyAppearance(s.appearance, undefined, { page: 'home' });
  revealPage();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  WIDE.addEventListener?.('change', () => shell.onRepaint());
  return me;
}

export const tz = () => shell.settings.tz || LOCAL_TZ;

export function greeting() {
  const hr = Number(new Intl.DateTimeFormat('tr-TR', { hour: 'numeric', hourCycle: 'h23', timeZone: tz() }).format(new Date()));
  if (hr < 5) return 'İyi geceler';
  if (hr < 12) return 'Günaydın';
  if (hr < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function relTime(t) {
  const d = Date.now() / 1000 - t;
  if (d < 90) return 'az önce';
  if (d < 3600) return `${Math.round(d / 60)} dk önce`;
  if (d < 86400) return `${Math.round(d / 3600)} sa önce`;
  if (d < 7 * 86400) return `${Math.round(d / 86400)} gün önce`;
  return F.dateOnly(t, tz());
}

export const chartUrl = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return `chart.html${q.toString() ? `?${q}` : ''}`;
};
/** Another page, after the profile's storage is written. */
export async function go(url) {
  document.body.classList.add('leaving');
  await Promise.all([flushStorage(), new Promise((r) => setTimeout(r, 140))]);
  window.location.href = url;
}

export const APPS = [
  { id: 'replay', name: 'Replay', sub: 'Geçmişi bar bar yeniden yaşa, gerçek gibi işlem aç', icon: 'replay', href: 'replay.html', badge: 'Yeni' },
  { id: 'chart', name: 'Grafik', sub: 'Son baktığın piyasa', icon: 'chart', href: chartUrl({ view: 'chart' }) },
  { id: 'analytics', name: 'Analiz', sub: 'Seans, gün ve saat dağılımın', icon: 'indicator', href: 'replay.html#analiz' },
  { id: 'strategy', name: 'Strateji', sub: 'Kuralını yaz, yıllarca veride sına', icon: 'flask', href: chartUrl({ tab: 'strategy' }) },
  { id: 'data', name: 'Veri', sub: '15 yıllık piyasa paketleri', icon: 'data', href: chartUrl({ tab: 'data' }) },
];

// ── phones: the floating bar ─────────────────────────────────────────────
/** `left` / `right`: { icon | node, label, onclick }; `center`: the pill's content. */
export function dock({ left, center, right }) {
  let bar = document.getElementById('rv-dock');
  if (!bar) { bar = h('nav.rv-dock', { id: 'rv-dock', 'aria-label': 'Gezinme' }); document.body.append(bar); }
  const round = (b) => (b ? h('button.rv-round', { type: 'button', title: b.label, 'aria-label': b.label, onclick: b.onclick }, b.node || icon(b.icon, 22)) : h('span.rv-round.ghost'));
  bar.replaceChildren(round(left), h('div.rv-pill', {}, center), round(right));
  return bar;
}

export function pillTab({ icon: ic, label, on, onclick }) {
  return h(`button.rv-tab${on ? '.on' : ''}`, { type: 'button', title: label, 'aria-label': label, 'aria-current': on ? 'page' : null, onclick }, h('span.rv-tab-ic', {}, icon(ic, 21)));
}

export function searchPill(items) {
  return h('button.rv-search', { type: 'button', onclick: () => openPalette(items) }, icon('search', 21), h('span', {}, 'Ara'));
}

// ── wide screens: rail · sidebar · top bar ───────────────────────────────
/**
 * current: the app on the rail. sections: [{ id, label, icon, onclick, soon }] for
 * the sidebar (none: no sidebar). crumbs: ['Replay', 'Oturumlar']. actions: nodes.
 */
export function appFrame({ current, sections = null, section = null, crumbs = [], actions = [], promo = null }) {
  document.body.classList.toggle('rv-wide', WIDE.matches);
  document.body.classList.toggle('rv-has-side', WIDE.matches && !!sections);
  let rail = document.getElementById('rv-rail');
  if (!WIDE.matches) { rail?.remove(); document.getElementById('rv-side')?.remove(); document.getElementById('rv-top')?.remove(); return; }
  if (!rail) { rail = h('nav.rv-rail', { id: 'rv-rail', 'aria-label': 'Uygulamalar' }); document.body.append(rail); }
  const p = shell.me.profile;
  const tile = (id, label, ic, href) => h(`a.rv-rail-app${id === current ? '.on' : ''}`, { href, title: label, 'aria-label': label, onclick: (e) => { e.preventDefault(); go(href); } }, icon(ic, 21));
  rail.replaceChildren(
    h('a.rv-rail-mark', { href: 'home.html', title: 'Ana ekran', 'aria-label': 'Ana ekran', onclick: (e) => { e.preventDefault(); go('home.html'); } }, brandMark(26)),
    h('div.rv-rail-apps', {}, tile('home', 'Ana ekran', 'home', 'home.html'), ...APPS.map((a) => tile(a.id, a.name, a.icon, a.href))),
    h('div.rv-rail-foot', {},
      h('button.rv-rail-app', { type: 'button', title: 'Görünüm', 'aria-label': 'Görünüm', onclick: () => profileDrawer('look') }, icon('palette', 20)),
      h('button.rv-rail-me', { type: 'button', title: p.name, 'aria-label': 'Profil', onclick: () => profileDrawer('profile') }, avatar({ ...p, locked: false }, 'sm'))));

  let side = document.getElementById('rv-side');
  if (sections) {
    if (!side) { side = h('aside.rv-side', { id: 'rv-side', 'aria-label': 'Bölümler' }); document.body.append(side); }
    side.replaceChildren(
      h('div.rv-side-tools', {},
        h('button.rv-side-tool', { type: 'button', title: 'Ara', 'aria-label': 'Ara', onclick: () => openPalette(baseItems) }, icon('search', 18), h('span', {}, 'Ara'), h('kbd', {}, 'Ctrl K'))),
      h('nav.rv-side-list', {}, sections.map((s) => s === '-' ? h('hr') : h(`button.rv-side-item${s.id === section ? '.on' : ''}${s.soon ? '.soon' : ''}`, { type: 'button', onclick: s.soon ? null : s.onclick, disabled: !!s.soon },
        h(`span.rv-side-ic.c-${s.tone || 'accent'}`, {}, icon(s.icon, 17)), h('span', {}, s.label), s.soon ? h('small', {}, 'Yakında') : s.count != null ? h('small.rv-count', {}, String(s.count)) : null))),
      promo || h('span'),
      h('button.rv-side-me', { type: 'button', onclick: () => profileDrawer('profile') }, avatar({ ...p, locked: false }, 'sm'), h('span', {}, h('b', {}, p.name), h('small', {}, 'RV Next · test sürümü'))));
  } else side?.remove();

  let top = document.getElementById('rv-top');
  if (!top) { top = h('header.rv-top', { id: 'rv-top' }); document.body.append(top); }
  top.replaceChildren(
    h('nav.rv-crumbs', { 'aria-label': 'Konum' }, crumbs.flatMap((c, i) => [i ? h('span.rv-crumb-sep', {}, icon('chevron', 14)) : null, h(`span${i === crumbs.length - 1 ? '.on' : ''}`, {}, c)]).filter(Boolean)),
    h('div.rv-top-actions', {}, ...actions));
}

// ── sheets (phones) and the drawer (wide screens) ────────────────────────
let openSheet = null;
export function closeSheet() { openSheet?.close(); }

/** A sheet from the foot on a phone, a panel from the right on a wide screen. */
export function sheet({ title, body, banner = null, cls = '', tabs = null }) {
  closeSheet();
  const wide = WIDE.matches;
  const back = h(`div.rv-sheet-back${wide ? '.drawer' : ''}`);
  const close = () => {
    if (!back.isConnected) return;
    back.classList.add('out');
    setTimeout(() => back.remove(), 220);
    if (openSheet?.box === box) openSheet = null;
  };
  const head = h('header.rv-sheet-head', {},
    tabs || (title ? h('h2', {}, title) : h('span')),
    h('button.rv-icon-btn', { type: 'button', title: 'Kapat', 'aria-label': 'Kapat', onclick: close }, icon('close', 18)));
  const box = h(`div.rv-sheet${cls ? `.${cls}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Panel' },
    wide ? null : h('div.rv-grip'), head, h('div.rv-sheet-body', {}, banner, body));
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  openSheet = { close, box };
  return { close, el: box };
}

/** A card of rows (iOS grouped list): icon, title, a line under it, a chevron. */
export function group(rows, title = null) {
  return h('section.rv-group-wrap', {}, title ? h('h4.rv-group-title', {}, title) : null,
    h('div.rv-group', {}, rows.filter(Boolean).map((r) => h(`button.rv-row${r.danger ? '.danger' : ''}${r.on ? '.on' : ''}`, { type: 'button', onclick: r.onclick, disabled: !!r.disabled },
      h(`span.rv-row-ic.c-${r.tone || 'accent'}`, {}, icon(r.icon, 18)),
      h('span.rv-row-t', {}, h('b', {}, r.title), r.sub ? h('small', {}, r.sub) : null),
      r.value != null ? h('span.rv-row-v', {}, r.value) : null,
      h('span.rv-row-go', {}, icon('chevron', 15))))));
}

// ── appearance (theme carousel, accent cards, candle colours) ─────────────
export const ACCENTS = [['#5b8cff', 'Mavi'], ['#a855f7', 'Mor'], ['#ec4899', 'Pembe'], ['#f43f5e', 'Kırmızı'], ['#f97316', 'Turuncu'], ['#eab308', 'Altın'], ['#22c55e', 'Yeşil'], ['#14b8a6', 'Turkuaz'], ['#a1a1aa', 'Platin']];
export const CANDLES = [['Klasik', '#26a69a', '#ef5350'], ['Zümrüt / gül', '#34d399', '#fb7185'], ['Gök / gül', '#38bdf8', '#f43f5e'], ['Sade', '#e5e7eb', '#6b7280']];

export const homeLook = {
  get a() { return shell.settings.appearance; },
  apply(a) { shell.settings.appearance = a; applyAppearance(a, undefined, { page: 'home' }); },
  save() { host.saveSettings(); },
};

function lookPane(ctx, state, repaint) {
  const a = ctx.a;
  const set = (patch) => { Object.assign(a, patch); ctx.apply(a); ctx.save(); repaint(); };
  const tabs = h('div.rv-seg', { role: 'tablist' }, [['theme', 'Tema'], ['accent', 'Vurgu'], ['candles', 'Grafik']].map(([k, l]) =>
    h(`button${state.tab === k ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { state.tab = k; repaint(); } }, l)));
  let pane;
  if (state.tab === 'theme') {
    const cur = PRESETS.find((p) => p.id === a.preset) || PRESETS[0];
    pane = h('div.rv-look', {},
      h('div.rv-themes', {}, PRESETS.map((p) => h(`button.rv-theme${p.id === a.preset ? '.on' : ''}`, { type: 'button', 'aria-label': p.name,
        onclick: () => set({ preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down }) },
      h('span.rv-theme-win', { style: { background: BACKGROUNDS[p.bg]?.css } },
        h('i.bar'), h('i.side'), h('i.ln', { style: { background: p.accent } }), h('i.card'), h('i.card2')),
      h('b', {}, p.name)))),
      h('div.rv-theme-now', {}, h('b', {}, cur.name), h('span', {}, 'Geçerli tema')));
  } else if (state.tab === 'accent') {
    pane = h('div.rv-accents', {}, ACCENTS.map(([c, n]) => h(`button.rv-accent${a.accent === c ? '.on' : ''}`, { type: 'button', style: { '--c': c }, onclick: () => set({ accent: c, homeAccent: null }) },
      h('span.rv-accent-win', {}, h('i.dots'), h('i.d'), h('i.l'), h('i.d2'), h('i.l2')), h('b', {}, n))));
  } else {
    pane = group(CANDLES.map(([n, up, down]) => ({ icon: 'chart', title: n, sub: a.up === up && a.down === down ? 'Seçili' : 'Yükselen · düşen', on: a.up === up && a.down === down,
      value: h('span.rv-dots', {}, h('i', { style: { background: up } }), h('i', { style: { background: down } })), onclick: () => set({ up, down, homeUp: null, homeDown: null }) })));
  }
  return [tabs, pane];
}

/** `ctx`: { a (the appearance), apply(a), save() } — from any page. */
export function appearanceSheet(ctx, tab = 'theme') {
  const state = { tab };
  const body = h('div.rv-look-body');
  const repaint = () => body.replaceChildren(...lookPane(ctx, state, repaint));
  repaint();
  return sheet({ title: 'Görünüm', cls: 'look', body });
}

/** The profile and the look in one panel (Alltra's right-hand drawer). */
export function profileDrawer(which = 'profile') {
  const p = shell.me.profile;
  const state = { tab: 'theme' };
  const body = h('div.rv-drawer-body');
  const tabs = h('div.rv-tabs', { role: 'tablist' });
  const paint = () => {
    tabs.replaceChildren(...[['profile', 'Profil'], ['look', 'Görünüm']].map(([k, l]) => h(`button${which === k ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { which = k; paint(); } }, l)));
    if (which === 'look') { body.replaceChildren(...lookPane(homeLook, state, paint)); return; }
    body.replaceChildren(
      h('div.rv-banner', {},
        h('div.rv-banner-hex', { 'aria-hidden': 'true' }, Array.from({ length: 30 }, (_, i) => h('span', { style: { opacity: (0.15 + ((i * 37) % 60) / 100).toFixed(2) } }, ((i * 2654435761) >>> 0).toString(16).slice(0, 2).toUpperCase()))),
        h('div.rv-banner-me', {}, h('span.rv-banner-av', {}, avatar({ ...p, locked: false }, 'lg'), h('i')), h('h3', {}, p.name), h('span', {}, 'RV Next · test sürümü'),
          h('div.rv-banner-chips', {}, h('span', {}, icon('star', 14), 'Kurucu'), h('span', {}, icon('check', 14), 'Aktif')))),
      h('h4.rv-group-title', {}, 'Hızlı işlemler'),
      h('div.rv-quick', {},
        quick('palette', 'Görünüm', 'Tema ve vurgu', () => { which = 'look'; paint(); }),
        quick('sliders', 'Tercihler', 'Saat dilimi, hesap', () => { closeSheet(); settingsDialog(host); }),
        quick('swap', 'Profil değiştir', 'Başka profille gir', async () => { await flushStorage(); await api.leaveProfile(); window.location.replace('profiles.html'); }),
        quick('home', 'Ana site', 'r5vers.github.io', () => { window.location.href = '../home.html'; })),
      group([{ icon: 'refresh', title: 'Test sürümünü sıfırla', sub: 'Ana siteden yeniden kopyalar', danger: true, tone: 'rose', onclick: () => { window.location.href = 'sifirla.html'; } }]));
  };
  const quick = (ic, t, s, onclick) => h('button.rv-quick-btn', { type: 'button', onclick }, h('span.rv-row-ic.c-accent', {}, icon(ic, 18)), h('span.rv-row-t', {}, h('b', {}, t), h('small', {}, s)));
  paint();
  return sheet({ title: 'Profil', cls: 'drawer-panel', tabs, body });
}

/** Old names kept for the pages that call them. */
export const accountSheet = () => profileDrawer('profile');

export function appsSheet(current) {
  sheet({
    title: 'Uygulamalar', cls: 'apps',
    body: h('div.rv-apps-grid', {}, [{ id: 'home', name: 'Ana ekran', sub: 'Özet', icon: 'home', href: 'home.html' }, ...APPS].map((a) =>
      h(`a.rv-app-mini${a.id === current ? '.on' : ''}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
        h(`span.rv-app-ic.app-${a.id}`, {}, icon(a.icon, 20)), h('b', {}, a.name), h('small', {}, a.sub)))),
  });
}

export const markButton = (current) => ({ node: brandMark(24), label: 'Uygulamalar', onclick: () => appsSheet(current) });

export function avatarButton() {
  const p = shell.me.profile;
  return h('button.rv-avatar', { type: 'button', title: 'Profil', 'aria-label': 'Profil', onclick: () => profileDrawer('profile') }, avatar({ ...p, locked: false }, 'sm'));
}

export function baseItems() {
  const out = [];
  const add = (grp, label, run, extra = {}) => out.push({ group: grp, label, run, ...extra });
  add('Uygulamalar', 'Replay', () => go('replay.html'), { icon: 'replay' });
  add('Uygulamalar', 'Yeni replay oturumu', () => go(chartUrl({ new: 'replay' })), { icon: 'play', keys: 'başlat yeni' });
  add('Uygulamalar', 'Grafik', () => go(chartUrl({ view: 'chart' })), { icon: 'chart' });
  add('Uygulamalar', 'Analiz', () => go('replay.html#analiz'), { icon: 'indicator' });
  add('Uygulamalar', 'Strateji testi', () => go(chartUrl({ tab: 'strategy' })), { icon: 'flask', keys: 'backtest' });
  add('Uygulamalar', 'Veri paketleri', () => go(chartUrl({ tab: 'data' })), { icon: 'data' });
  add('Ayarlar', 'Görünüm', () => (WIDE.matches ? profileDrawer('look') : appearanceSheet(homeLook)), { icon: 'palette', keys: 'tema renk' });
  add('Ayarlar', 'Tercihler', () => settingsDialog(host), { icon: 'sliders' });
  return out;
}

/** A market's mark: its first letters on a colour of its own. */
export function symbolBadge(symbol, size = 44) {
  const hue = [...String(symbol || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return h('span.rv-sym', { style: { width: `${size}px`, height: `${size}px`, background: `linear-gradient(140deg, hsl(${hue} 72% 60%), hsl(${(hue + 40) % 360} 70% 40%))`, fontSize: `${Math.round(size * 0.33)}px` } },
    String(symbol || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase());
}

/** A ring filled to `frac` (0..1), Alltra's KPI dial. */
export function ring(frac, { size = 64, stroke = 7, tone = 'pos' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = frac == null ? 0 : Math.max(0, Math.min(1, frac));
  const el = h('span.rv-ring');
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="bg"/>${f ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" class="fg ${tone}" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}</svg>`;
  return el;
}

/** Back-compat for the earlier wide rail. */
export const sideNav = () => {};
