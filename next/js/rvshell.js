// The frame every page of the test copy shares (Alltra's app): the profile
// and its settings, one floating bar at the foot (a round button, a pill, a
// round button), sheets that rise from the foot, the account sheet and the
// app switcher.
import { api } from './api.js?v=1039d95bd6';
import * as F from './format.js?v=1039d95bd6';
import { avatar, brandMark, flushStorage, h, icon, storage, store, useProfileStorage } from './ui/dom.js?v=1039d95bd6';
import { configureICT } from './chart/sessions.js?v=1039d95bd6';
import { settingsDialog } from './ui/dialogs.js?v=1039d95bd6';
import { openPalette } from './ui/palette.js?v=1039d95bd6';
import { BACKGROUNDS, DEFAULT_APPEARANCE, PRESETS, applyAppearance, normalizeAppearance, paintLastLook, revealPage } from './ui/look.js?v=1039d95bd6';

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const NAMES = { EURUSD: 'Euro / Dolar', NAS100: 'Nasdaq 100', XAUUSD: 'Altın / Dolar', GBPUSD: 'Sterlin / Dolar', USDCAD: 'Dolar / Kanada doları', SPX500: 'S&P 500', USATECHIDXUSD: 'Nasdaq 100', USA500IDXUSD: 'S&P 500' };

export const shell = { me: null, settings: {}, onRepaint: () => {} };

// a minimal stand-in for the chart app, enough for the settings dialog
export const host = {
  mode: 'browse',
  get settings() { return shell.settings; },
  get theme() { return document.documentElement.dataset.theme || 'dark'; },
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

// ── the floating bar ─────────────────────────────────────────────────────
/** `left` / `right`: { icon | node, label, onclick }; `center`: a node (the pill's content). */
export function dock({ left, center, right }) {
  let bar = document.getElementById('rv-dock');
  if (!bar) { bar = h('nav.rv-dock', { id: 'rv-dock', 'aria-label': 'Gezinme' }); document.body.append(bar); }
  const round = (b) => (b ? h('button.rv-round', { type: 'button', title: b.label, 'aria-label': b.label, onclick: b.onclick }, b.node || icon(b.icon, 24)) : h('span.rv-round.ghost'));
  bar.replaceChildren(round(left), h('div.rv-pill', {}, center), round(right));
  return bar;
}

/** A tab of the pill: an icon, chosen or not. */
export function pillTab({ icon: ic, label, on, onclick }) {
  return h(`button.rv-tab${on ? '.on' : ''}`, { type: 'button', title: label, 'aria-label': label, 'aria-current': on ? 'page' : null, onclick }, h('span.rv-tab-ic', {}, icon(ic, 22)));
}

/** The search pill: markets, sessions and commands. */
export function searchPill(items) {
  return h('button.rv-search', { type: 'button', onclick: () => openPalette(items) }, icon('search', 22), h('span', {}, 'Ara'));
}

// ── sheets ───────────────────────────────────────────────────────────────
let openSheet = null;
export function closeSheet() { openSheet?.close(); }

/** A sheet from the foot (a centred card on a wide screen): a grip, an
 *  optional coloured banner, a title row with a back / close button. */
export function sheet({ title, body, banner = null, cls = '' }) {
  closeSheet();
  const back = h('div.rv-sheet-back');
  const close = () => {
    if (!back.isConnected) return;
    box.classList.add('out'); back.classList.add('out');
    setTimeout(() => back.remove(), 200);
    if (openSheet?.box === box) openSheet = null;
  };
  const head = h('header.rv-sheet-head', {},
    h('button.rv-round.sm', { type: 'button', title: 'Kapat', 'aria-label': 'Kapat', onclick: close }, icon('close', 18)),
    title ? h('h2', {}, title) : h('span'),
    h('span.rv-round.sm.ghost'));
  const box = h(`div.rv-sheet${cls ? `.${cls}` : ''}${banner ? '.has-banner' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Sayfa' },
    banner ? h('div.rv-sheet-banner', { style: { background: banner } }) : null,
    h('div.rv-grip'), head, h('div.rv-sheet-body', {}, body));
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  openSheet = { close, box };
  return { close, el: box };
}

/** A card of rows (iOS grouped list): icon, title, a line under it, a chevron. */
export function group(rows) {
  return h('div.rv-group', {}, rows.filter(Boolean).map((r) => h(`button.rv-row${r.danger ? '.danger' : ''}`, { type: 'button', onclick: r.onclick, disabled: !!r.disabled },
    h('span.rv-row-ic', {}, icon(r.icon, 20)),
    h('span.rv-row-t', {}, h('b', {}, r.title), r.sub ? h('small', {}, r.sub) : null),
    r.value != null ? h('span.rv-row-v', {}, r.value) : null,
    h('span.rv-row-go', {}, icon('chevron', 16)))));
}

/** The profile: who is in, the look, the settings, the way out. */
export function accountSheet() {
  const p = shell.me.profile;
  const s = sheet({
    title: 'Profil', cls: 'account',
    banner: 'linear-gradient(160deg, var(--rv-glow1) 0%, var(--rv-glow2) 46%, color-mix(in srgb, var(--rv-glow2) 30%, transparent) 78%, transparent 100%)',
    body: [
      h('div.rv-account', {}, avatar({ ...p, locked: false }, 'lg'), h('h3', {}, p.name), h('span', {}, 'RV Next · test sürümü')),
      group([
        { icon: 'palette', title: 'Görünüm', sub: 'tema, vurgu rengi, mum renkleri', onclick: () => { s.close(); appearanceSheet(homeLook); } },
        { icon: 'sliders', title: 'Tercihler', sub: 'saat dilimi, hesap, işlem ücretleri', onclick: () => { s.close(); settingsDialog(host); } },
      ]),
      group([
        { icon: 'swap', title: 'Profil değiştir', sub: 'başka bir profille gir', onclick: async () => { await flushStorage(); await api.leaveProfile(); window.location.replace('profiles.html'); } },
        { icon: 'home', title: 'Ana siteye dön', sub: 'r5vers.github.io', onclick: () => { window.location.href = '../home.html'; } },
        { icon: 'refresh', title: 'Test sürümünü sıfırla', sub: 'ana siteden yeniden kopyalar', onclick: () => { window.location.href = 'sifirla.html'; }, danger: true },
      ]),
    ],
  });
  return s;
}

export const APPS = [
  { id: 'replay', name: 'Replay', sub: 'Geçmişi bar bar yaşa', icon: 'replay', href: 'replay.html', badge: 'Yeni' },
  { id: 'chart', name: 'Grafik', sub: 'Son baktığın piyasa', icon: 'chart', href: chartUrl({ view: 'chart' }) },
  { id: 'analytics', name: 'Analiz', sub: 'Oturumlarının istatistiği', icon: 'indicator', href: 'replay.html#analiz' },
  { id: 'strategy', name: 'Strateji testi', sub: 'Kodla yıllarca backtest', icon: 'flask', href: chartUrl({ tab: 'strategy' }) },
  { id: 'data', name: 'Veri', sub: '15 yıllık paketler', icon: 'data', href: chartUrl({ tab: 'data' }) },
];

/** The apps, from any page (the round button with the mark). */
export function appsSheet(current) {
  sheet({
    title: 'Uygulamalar', cls: 'apps',
    body: h('div.rv-apps-grid', {}, [{ id: 'home', name: 'Ana ekran', sub: 'Özet', icon: 'home', href: 'home.html' }, ...APPS].map((a) =>
      h(`a.rv-app-mini${a.id === current ? '.on' : ''}`, { href: a.href, onclick: (e) => { e.preventDefault(); go(a.href); } },
        h('span.rv-app-mini-ic', {}, icon(a.icon, 22)), h('b', {}, a.name), h('small', {}, a.sub)))),
  });
}

/** The round button with the RV mark. */
export const markButton = (current) => ({ node: brandMark(26), label: 'Uygulamalar', onclick: () => appsSheet(current) });

/** The avatar at a page's top right. */
export function avatarButton() {
  const p = shell.me.profile;
  return h('button.rv-avatar', { type: 'button', title: 'Profil', 'aria-label': 'Profil', onclick: () => accountSheet() }, avatar({ ...p, locked: false }, 'sm'));
}

/** Palette entries every page shares. */
export function baseItems() {
  const out = [];
  const add = (group, label, run, extra = {}) => out.push({ group, label, run, ...extra });
  add('Uygulamalar', 'Replay', () => go('replay.html'), { icon: 'replay' });
  add('Uygulamalar', 'Yeni replay oturumu', () => go(chartUrl({ new: 'replay' })), { icon: 'play', keys: 'başlat yeni' });
  add('Uygulamalar', 'Grafik', () => go(chartUrl({ view: 'chart' })), { icon: 'chart' });
  add('Uygulamalar', 'Analiz', () => go('replay.html#analiz'), { icon: 'indicator' });
  add('Uygulamalar', 'Strateji testi', () => go(chartUrl({ tab: 'strategy' })), { icon: 'flask', keys: 'backtest' });
  add('Uygulamalar', 'Veri paketleri', () => go(chartUrl({ tab: 'data' })), { icon: 'data' });
  add('Ayarlar', 'Görünüm', () => appearanceSheet(homeLook), { icon: 'palette', keys: 'tema renk' });
  add('Ayarlar', 'Tercihler', () => settingsDialog(host), { icon: 'sliders' });
  return out;
}

/** A market's mark: its first letters on a colour of its own. */
export function symbolBadge(symbol, size = 44) {
  const hue = [...String(symbol || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return h('span.rv-sym', { style: { width: `${size}px`, height: `${size}px`, background: `linear-gradient(140deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 70% 42%))`, fontSize: `${Math.round(size * 0.34)}px` } },
    String(symbol || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase());
}

// ── appearance (Alltra's sheet: theme carousel, accent cards, candles) ──
export const ACCENTS = [['#3b82f6', 'Mavi'], ['#a855f7', 'Mor'], ['#ec4899', 'Pembe'], ['#ef4444', 'Kırmızı'], ['#f97316', 'Turuncu'], ['#eab308', 'Altın'], ['#22c55e', 'Yeşil'], ['#14b8a6', 'Turkuaz'], ['#9ca3af', 'Platin']];
export const CANDLES = [['Klasik', '#26a69a', '#ef5350'], ['Gök / gül', '#38bdf8', '#f43f5e'], ['Canlı', '#22c55e', '#ef4444'], ['Sade', '#e5e7eb', '#6b7280']];

/** The look of the home pages: settings of the profile, painted on save. */
export const homeLook = {
  get a() { return shell.settings.appearance; },
  apply(a) { shell.settings.appearance = a; applyAppearance(a, undefined, { page: 'home' }); },
  save() { host.saveSettings(); },
};

/** `ctx`: { a (the appearance), apply(a), save() } — from any page. */
export function appearanceSheet(ctx, tab = 'theme') {
  const a = ctx.a;
  const set = (patch) => { Object.assign(a, patch); ctx.apply(a); ctx.save(); paint(); };
  const tabs = h('div.rv-ptabs');
  const pane = h('div.rv-ppane');
  const paint = () => {
    tabs.replaceChildren(...[['theme', 'Tema'], ['accent', 'Vurgu'], ['candles', 'Grafik']].map(([k, l]) => h(`button${tab === k ? '.on' : ''}`, { type: 'button', onclick: () => { tab = k; paint(); } }, l)));
    if (tab === 'theme') {
      const cur = PRESETS.find((p) => p.id === a.preset) || PRESETS[0];
      pane.replaceChildren(
        h('div.rv-themes', {}, PRESETS.map((p) => h(`button.rv-theme${p.id === a.preset ? '.on' : ''}`, { type: 'button', 'aria-label': p.name,
          onclick: (e) => { set({ preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down }); e.currentTarget.scrollIntoView?.({ inline: 'center', behavior: 'smooth', block: 'nearest' }); } },
        h('span.rv-theme-win', { style: { background: BACKGROUNDS[p.bg]?.css } }, h('i.d'), h('i.l', { style: { background: p.accent } }), h('i.s'), h('i.c')), h('b', {}, p.name)))),
        h('div.rv-theme-now', {}, h('b', {}, cur.name), h('span', {}, 'Geçerli tema')));
      setTimeout(() => pane.querySelector('.rv-theme.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }), 30);
    } else if (tab === 'accent') {
      pane.replaceChildren(h('div.rv-accents', {}, ACCENTS.map(([c, n]) => h(`button.rv-accent${a.accent === c ? '.on' : ''}`, { type: 'button', style: { '--c': c }, onclick: () => set({ accent: c, homeAccent: null }) },
        h('span.rv-accent-win', {}, h('i.d'), h('i.l'), h('i.d2'), h('i.l2')), h('b', {}, n)))));
    } else {
      pane.replaceChildren(group(CANDLES.map(([n, up, down]) => ({ icon: 'chart', title: n, sub: a.up === up && a.down === down ? 'seçili' : 'yükselen · düşen', value: h('span.rv-dots', {}, h('i', { style: { background: up } }), h('i', { style: { background: down } })), onclick: () => set({ up, down, homeUp: null, homeDown: null }) }))));
    }
  };
  paint();
  return sheet({ title: 'Görünüm', cls: 'look', body: [tabs, pane] });
}

// ── wide screens: a rail of the apps on the left ─────────────────────────
export function sideNav(current) {
  let nav = document.getElementById('rv-side');
  if (!nav) { nav = h('aside.rv-side', { id: 'rv-side', 'aria-label': 'Uygulamalar' }); document.body.append(nav); }
  const p = shell.me.profile;
  const item = (id, label, ic, href) => h(`a.rv-side-item${id === current ? '.on' : ''}`, { href, onclick: (e) => { e.preventDefault(); go(href); } }, icon(ic, 20), h('span', {}, label));
  nav.replaceChildren(
    h('a.rv-side-brand', { href: 'home.html', onclick: (e) => { e.preventDefault(); go('home.html'); } }, brandMark(26), h('b', {}, 'ReplayView')),
    h('nav.rv-side-list', {},
      item('home', 'Ana ekran', 'home', 'home.html'),
      ...APPS.map((x) => item(x.id, x.name, x.icon, x.href))),
    h('div.rv-side-foot', {},
      h('button.rv-side-item', { type: 'button', onclick: () => appearanceSheet(homeLook) }, icon('palette', 20), h('span', {}, 'Görünüm')),
      h('button.rv-side-me', { type: 'button', onclick: () => accountSheet() }, avatar({ ...p, locked: false }, 'sm'), h('span', {}, h('b', {}, p.name), h('small', {}, 'Profil ve ayarlar')))));
}
