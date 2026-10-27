// The frame every app page of the test copy shares.
// Phones: one floating bar at the foot (round · pill · round) and sheets
// that rise from it. Wide screens (Alltra's desktop): a rail of the apps, an
// optional sidebar of the app's sections, a top bar with the path, and a
// drawer from the right for the profile and the look.
import { api } from './api.js?v=184b95d359';
import { LOCAL_NAMES, SITE_TAG, TEST_COPY } from './local/site.js?v=184b95d359';
import * as F from './format.js?v=184b95d359';
import { avatar, brandMark, flushStorage, h, icon, storage, store, toast, useProfileStorage } from './ui/dom.js?v=184b95d359';
import { configureICT } from './chart/sessions.js?v=184b95d359';
import { settingsDialog } from './ui/dialogs.js?v=184b95d359';
import { openPalette } from './ui/palette.js?v=184b95d359';
import { BACKGROUNDS, DEFAULT_APPEARANCE, FONT_PAIRS, METALS, PRESETS, RV_FONTS, SCENES, applyAppearance, metalCss, sceneSvg, normalizeAppearance, paintLastLook, revealPage } from './ui/look.js?v=184b95d359';

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
    try { localStorage.setItem(LOCAL_NAMES.lastLook, JSON.stringify(shell.settings.appearance)); } catch { /* private mode */ }
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
      h('button.rv-side-me', { type: 'button', onclick: () => profileDrawer('profile') }, avatar({ ...p, locked: false }, 'sm'), h('span', {}, h('b', {}, p.name), h('small', {}, SITE_TAG))));
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

/**
 * A sheet from the foot on a phone, a panel from the right on a wide screen.
 * The title sits in the middle (Alltra's sheets), `lead` to its left (a back
 * button), and `banner: true` lays the theme's light behind the top.
 */
export function sheet({ title, body, banner = null, cls = '', tabs = null, lead = null }) {
  closeSheet();
  const wide = WIDE.matches;
  const back = h(`div.rv-sheet-back${wide ? '.drawer' : ''}`);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (!back.isConnected) return;
    back.classList.add('out');
    setTimeout(() => back.remove(), 220);
    if (openSheet?.box === box) openSheet = null;
  };
  const titleEl = tabs || h('h2', {}, title || '');
  const leadEl = h('span.rv-sheet-lead', {}, lead);
  const head = h('header.rv-sheet-head', {}, leadEl, titleEl,
    h('button.rv-icon-btn.rv-close', { type: 'button', title: 'Kapat', 'aria-label': 'Kapat', onclick: close }, icon('close', 18)));
  const box = h(`div.rv-sheet${cls ? `.${cls}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Panel' },
    banner ? h('div.rv-sheet-banner', { 'aria-hidden': 'true' }, banner instanceof Node ? banner : null) : null,
    wide ? null : h('div.rv-grip'), head, h('div.rv-sheet-body', {}, body));
  back.append(box);
  box.addEventListener('scroll', () => box.classList.toggle('scrolled', box.scrollTop > 6), { passive: true });
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  openSheet = { close, box };
  return {
    close, el: box,
    setTitle: (t) => { if (!tabs) titleEl.textContent = t; box.setAttribute('aria-label', t); },
    setLead: (n) => leadEl.replaceChildren(...(n ? [n] : [])),
  };
}

/** A card of rows (iOS grouped list): icon, title, a line under it, a chevron.
 *  `mono`: plain white icons on the glass (Alltra's account list). */
export function group(rows, title = null, { mono = false } = {}) {
  return h('section.rv-group-wrap', {}, title ? h('h4.rv-group-title', {}, title) : null,
    h(`div.rv-group${mono ? '.mono' : ''}`, {}, rows.filter(Boolean).map((r) => h(`button.rv-row${r.danger ? '.danger' : ''}${r.on ? '.on' : ''}`, { type: 'button', onclick: r.onclick, disabled: !!r.disabled },
      h(`span.rv-row-ic.c-${r.tone || 'accent'}`, {}, icon(r.icon, mono ? 22 : 18)),
      h('span.rv-row-t', {}, h('b', {}, r.title), r.sub ? h('small', {}, r.sub) : null),
      r.value != null ? h('span.rv-row-v', {}, r.value) : null,
      h('span.rv-row-go', {}, icon('chevron', 15))))));
}

// ── appearance: theme, colour, type, chart ───────────────────────────────
export const ACCENTS = [['#a855f7', 'Mor'], ['#8b5cf6', 'Menekşe'], ['#6366f1', 'Çivit'], ['#3b82f6', 'Mavi'], ['#0ea5e9', 'Gök'], ['#22d3ee', 'Buz'],
  ['#14b8a6', 'Turkuaz'], ['#10b981', 'Zümrüt'], ['#22c55e', 'Yeşil'], ['#84cc16', 'Lime'], ['#eab308', 'Altın'], ['#f59e0b', 'Kehribar'],
  ['#f97316', 'Turuncu'], ['#ef4444', 'Kırmızı'], ['#f43f5e', 'Gül'], ['#ec4899', 'Pembe'], ['#d946ef', 'Fuşya'], ['#e4e4e7', 'Platin']];
export const CANDLES = [['Klasik', '#26a69a', '#ef5350'], ['Zümrüt / gül', '#34d399', '#fb7185'], ['Gök / gül', '#38bdf8', '#f43f5e'], ['Yeşil / kırmızı', '#22c55e', '#ef4444'],
  ['Lavanta', '#8fa8ff', '#c77dff'], ['Neon', '#2ee6a6', '#ff4d6d'], ['Altın / mor', '#facc15', '#a855f7'], ['Sade', '#e5e7eb', '#6b7280']];
// money made / lost on the app pages; the first is the default (null)
const MONEY = [['Zümrüt / gül', '#34d399', '#fb7185'], ['Yeşil / kırmızı', '#22c55e', '#ef4444'], ['Turkuaz / mercan', '#2dd4bf', '#fb923c'], ['Gök / gül', '#38bdf8', '#f43f5e'], ['Lime / mor', '#a3e635', '#c084fc']];

export const homeLook = {
  get a() { return shell.settings.appearance; },
  apply(a) { shell.settings.appearance = a; applyAppearance(a, undefined, { page: 'home' }); },
  save() { host.saveSettings(); },
};

// form parts of the look panes
const field = (label, control, sub = null) => h('div.rv-field', {}, h('span.rv-field-t', {}, h('b', {}, label), sub ? h('small', {}, sub) : null), control);
const form = (title, rows) => h('section.rv-group-wrap', {}, title ? h('h4.rv-group-title', {}, title) : null, h('div.rv-group.rv-form', {}, rows.filter(Boolean)));
const segCtl = (opts, val, pick) => h('div.rv-seg.sm', {}, opts.map(([v, l]) => h(`button${String(v) === String(val) ? '.on' : ''}`, { type: 'button', onclick: () => pick(v) }, l)));
const toggle = (on, flip, label) => h(`button.rv-toggle${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: flip }, h('i'));
function swatch(val, live, done, label) {
  const inp = h('input', { type: 'color', value: val, 'aria-label': label });
  const el = h('label.rv-swatch', { style: { '--c': val }, title: label }, inp);
  inp.addEventListener('input', () => { el.style.setProperty('--c', inp.value); live(inp.value); });
  inp.addEventListener('change', () => done(inp.value));
  return el;
}
function range(min, max, step, val, live, done, fmt, label) {
  const pct = (v) => `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;
  const out = h('output.rv-range-v', {}, fmt(val));
  const inp = h('input.rv-range', { type: 'range', min, max, step, value: val, 'aria-label': label, style: { '--p': pct(val) } });
  inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt(v); inp.style.setProperty('--p', pct(v)); live(v); });
  inp.addEventListener('change', () => done(+inp.value));
  return h('div.rv-range-wrap', {}, inp, out);
}

/** A small chart in the look's own colours: ground, grid, candles, volume. */
function chartPreview(a) {
  const W = 320, H = 150, bars = [[46, 62, 40, 58], [58, 70, 52, 54], [54, 60, 38, 42], [42, 50, 30, 47], [47, 78, 45, 74], [74, 86, 66, 70], [70, 74, 52, 56], [56, 66, 50, 64], [64, 96, 60, 92], [92, 100, 78, 82], [82, 90, 70, 88], [88, 112, 84, 108]];
  const y = (v) => H - 22 - (v - 26) * 1.15;
  const ground = a.chartBg === 'solid' ? a.chartColor : a.chartBg === 'gradient' ? 'url(#pg)' : 'rgba(255,255,255,.03)';
  const grid = a.gridColor || 'rgba(255,255,255,.07)';
  const lines = [];
  if (a.grid !== 'none') for (let i = 1; i < 4; i++) lines.push(`<line x1="0" x2="${W}" y1="${(H / 4) * i}" y2="${(H / 4) * i}" stroke="${grid}"/>`);
  if (a.grid === 'both') for (let i = 1; i < 6; i++) lines.push(`<line y1="0" y2="${H}" x1="${(W / 6) * i}" x2="${(W / 6) * i}" stroke="${grid}"/>`);
  const cw = 15, gap = W / (bars.length + 1);
  const candles = bars.map(([o, hi, lo, c], i) => {
    const up = c >= o, x = gap * (i + 0.6), col = up ? a.up : a.down;
    const body = (up ? a.bodyUp : a.bodyDown) || col, edge = (up ? a.borderUp : a.borderDown) || col, wick = (up ? a.wickUp : a.wickDown) || (a.wick === 'match' ? col : a.wickColor || col);
    const top = y(Math.max(o, c)), bot = y(Math.min(o, c));
    const vol = `<rect x="${x - cw / 2}" y="${H - 6 - (i % 4 + 2) * 3.2}" width="${cw}" height="${(i % 4 + 2) * 3.2}" fill="${col}" opacity="${(a.volOpacity ?? 26) / 100}"/>`;
    return `${a.volOpacity ? vol : ''}<line x1="${x}" x2="${x}" y1="${y(hi)}" y2="${y(lo)}" stroke="${wick}" stroke-width="1.5"/><rect x="${x - cw / 2}" y="${top}" width="${cw}" height="${Math.max(2, bot - top)}" rx="2" fill="${a.hollow && up ? 'transparent' : body}" stroke="${a.border || a.hollow ? edge : 'none'}" stroke-width="1.5"/>`;
  }).join('');
  const el = h('div.rv-preview');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.chartColor}"/><stop offset="1" stop-color="${a.chartColor2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="${ground}"/>${lines.join('')}${a.lastLine ? `<line x1="0" x2="${W}" y1="${y(108)}" y2="${y(108)}" stroke="${a.up}" stroke-dasharray="3 3" opacity=".8"/>` : ''}${candles}</svg>`;
  return el;
}

function lookPane(ctx, state, repaint) {
  const a = ctx.a;
  const set = (patch) => { Object.assign(a, patch); ctx.apply(a); ctx.save(); repaint(); };
  const live = (patch) => { Object.assign(a, patch); ctx.apply(a); };
  const tabs = h('div.rv-seg.rv-look-tabs', { role: 'tablist' }, [['theme', 'Tema'], ['accent', 'Renk'], ['type', 'Yazı'], ['chart', 'Grafik']].map(([k, l]) =>
    h(`button${state.tab === k ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { state.tab = k; repaint(); } }, l)));
  const pane = h('div.rv-look');
  if (state.tab === 'theme') {
    const cur = PRESETS.find((p) => p.id === a.preset) || PRESETS[0];
    const strip = h('div.rv-themes', {}, PRESETS.map((p) => h(`button.rv-theme${p.id === a.preset ? '.on' : ''}`, { type: 'button', 'aria-label': p.name, dataset: { id: p.id },
      onclick: () => set({ preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down }) },
    h('span.rv-theme-win', { style: { background: BACKGROUNDS[p.bg]?.css } },
      h('i.bar'), h('i.side'), h('i.ln', { style: { background: p.accent } }), h('i.card'), h('i.card2')),
    h('b', {}, p.name))));
    requestAnimationFrame(() => strip.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    // the scenes behind the glass, each shown small in the theme's colours
    const scenes = h('div.rv-scenes', {}, Object.entries(SCENES).map(([id, sc], i) => {
      const win = h('span.rv-scene-win');
      win.innerHTML = sceneSvg(id, `p${i}`);
      return h(`button.rv-scene${a.scene === id ? '.on' : ''}`, { type: 'button', 'aria-label': sc.name, onclick: () => set({ scene: id }) }, win, h('b', {}, sc.name));
    }));
    pane.append(strip, h('div.rv-theme-now', {}, h('b', {}, cur.name), h('span', {}, `${PRESETS.length} koyu tema`)),
      h('section.rv-group-wrap', {}, h('h4.rv-group-title', {}, 'Arka plan'), scenes),
      form('Koyuluk', [field('Sayfa ve cam', range(0, 100, 1, a.depth, (v) => live({ depth: v }), (v) => { a.depth = v; ctx.save(); }, (v) => `%${v}`, 'Koyuluk'), 'Işıkları kısar, camı koyulaştırır')]));
  } else if (state.tab === 'accent') {
    const own = !ACCENTS.some(([c]) => c === a.accent);
    pane.append(
      h('div.rv-accents', {}, ACCENTS.map(([c, n]) => h(`button.rv-accent${a.accent === c ? '.on' : ''}`, { type: 'button', style: { '--c': c }, title: n, 'aria-label': n, onclick: () => set({ accent: c, homeAccent: null }) }, h('i'), h('b', {}, n)))),
      form(null, [field('Özel renk', swatch(own ? a.accent : '#a855f7', (v) => live({ accent: v, homeAccent: null }), (v) => set({ accent: v, homeAccent: null }), 'Özel vurgu rengi'), own ? 'Seçili' : 'Kendi rengini seç')]),
      form('Kâr ve zarar', MONEY.map(([n, pos, neg], i) => {
        const on = i === 0 ? !a.pos && !a.neg : a.pos === pos && a.neg === neg;
        return h(`button.rv-field.pick${on ? '.on' : ''}`, { type: 'button', onclick: () => set(i === 0 ? { pos: null, neg: null } : { pos, neg }) },
          h('span.rv-field-t', {}, h('b', {}, n), h('small', {}, on ? 'Seçili' : 'Oturumlar, analiz, bakiye')), h('span.rv-dots', {}, h('i', { style: { background: pos } }), h('i', { style: { background: neg } })));
      })));
  } else if (state.tab === 'type') {
    // each family shown in itself: what the card shows is what the pages get
    pane.append(h('div.rv-fonts', {}, RV_FONTS.map((id) => { const f = FONT_PAIRS[id]; return h(`button.rv-font${a.font === id ? '.on' : ''}`, { type: 'button', style: { fontFamily: `${f.ui}, Inter, sans-serif` }, onclick: () => set({ font: id }) },
      h('span.rv-font-aa', {}, 'Günaydın'),
      h('span.rv-font-num', {}, '$9.841,00'),
      h('b', {}, id === 'sistem' ? 'Inter' : f.name)); })),
    // the metal the greeting, the RV name and the page titles are drawn in
    h('section.rv-group-wrap', {}, h('h4.rv-group-title', {}, 'Başlık metali'),
      h('div.rv-metals', {}, Object.entries(METALS).filter(([id]) => id !== 'graphite' && id !== 'titanium').map(([id, m]) =>
        h(`button.rv-metal-pick${a.metal === id ? '.on' : ''}`, { type: 'button', 'aria-label': m.name, onclick: () => set({ metal: id }) }, h('i', { style: { background: metalCss(id) } }), h('b', {}, m.name))))));
  } else {
    const preview = chartPreview(a);
    const repreview = () => preview.replaceWith(chartPreview(a));
    const liveChart = (patch) => { live(patch); const p = pane.querySelector('.rv-preview'); p?.replaceWith(chartPreview(a)); };
    const col = (k, label, fallback) => swatch(a[k] || fallback(), (v) => liveChart({ [k]: v }), (v) => { a[k] = v; ctx.save(); }, label);
    const pair = (ku, kd, lu, ld, fu, fd) => h('span.rv-pair', {}, col(ku, lu, fu), col(kd, ld, fd));
    const up = () => a.up, down = () => a.down;
    void repreview;
    pane.append(preview,
      h('div.rv-candle-sets', {}, CANDLES.map(([n, u, d]) => h(`button.rv-chip${a.up === u && a.down === d ? '.on' : ''}`, { type: 'button', title: n,
        onclick: () => set({ up: u, down: d, homeUp: null, homeDown: null, bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null }) },
      h('span.rv-dots', {}, h('i', { style: { background: u } }), h('i', { style: { background: d } })), n))),
      form('Mumlar', [
        field('Ana renkler', pair('up', 'down', 'Yükselen', 'Düşen', up, down), 'Yükselen · düşen'),
        field('Gövde', pair('bodyUp', 'bodyDown', 'Yükselen gövde', 'Düşen gövde', up, down)),
        field('Kenar', h('span.rv-pair', {}, toggle(a.border, () => set({ border: !a.border }), 'Kenar çizgisi'), a.border ? pair('borderUp', 'borderDown', 'Yükselen kenar', 'Düşen kenar', up, down) : null)),
        field('Fitil', pair('wickUp', 'wickDown', 'Yükselen fitil', 'Düşen fitil', up, down)),
        field('İçi boş mumlar', toggle(a.hollow, () => set({ hollow: !a.hollow }), 'İçi boş mumlar'), 'Yükselen mumun içi boş'),
        h('button.rv-field.pick', { type: 'button', onclick: () => set({ bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null }) }, h('span.rv-field-t', {}, h('b', {}, 'Parça renklerini sıfırla'), h('small', {}, 'Gövde, kenar ve fitil ana renkleri alır')), icon('refresh', 18)),
      ]),
      form('Arka plan', [
        field('Zemin', segCtl([['glass', 'Tema'], ['solid', 'Düz'], ['gradient', 'Gradyan']], a.chartBg, (v) => set({ chartBg: v }))),
        a.chartBg !== 'glass' ? field(a.chartBg === 'gradient' ? 'Üst · alt' : 'Renk', a.chartBg === 'gradient'
          ? h('span.rv-pair', {}, col('chartColor', 'Üst renk', () => '#0b0b0d'), col('chartColor2', 'Alt renk', () => '#140d26'))
          : col('chartColor', 'Zemin rengi', () => '#0b0b0d')) : null,
        field('Izgara', segCtl([['both', 'Tam'], ['horz', 'Yatay'], ['none', 'Yok']], a.grid, (v) => set({ grid: v }))),
        a.grid !== 'none' ? field('Izgara rengi', col('gridColor', 'Izgara rengi', () => '#1c1d22')) : null,
      ]),
      form('Eksen ve imleç', [
        field('Eksen yazısı', h('span.rv-pair', {}, segCtl([[10, '10'], [11, '11'], [12, '12'], [13, '13']], a.chartFont, (v) => set({ chartFont: v })), col('textColor', 'Eksen yazı rengi', () => '#a1a1aa'))),
        field('Artı imleci', h('span.rv-pair', {}, segCtl([['dotted', '···'], ['dashed', '- -'], ['solid', '—']], a.crosshair, (v) => set({ crosshair: v })), col('crossColor', 'İmleç rengi', () => '#8a8a90'))),
        field('Fiyat ölçeği', segCtl([['normal', 'Normal'], ['log', 'Log'], ['percent', '%']], a.scale, (v) => set({ scale: v }))),
      ]),
      form('Ayrıntılar', [
        field('Hacim', range(0, 70, 1, a.volOpacity ?? 26, (v) => liveChart({ volOpacity: v }), (v) => { a.volOpacity = v; ctx.save(); }, (v) => (v ? `%${v}` : 'gizli'), 'Hacim görünürlüğü')),
        field('Filigran', h('span.rv-pair', {}, toggle(a.watermark, () => set({ watermark: !a.watermark }), 'Sembol filigranı'))),
        a.watermark ? field('Filigran gücü', range(0, 20, 1, a.markOpacity ?? 4, (v) => live({ markOpacity: v }), (v) => { a.markOpacity = v; ctx.save(); }, (v) => `%${v}`, 'Filigran gücü')) : null,
        field('Son fiyat çizgisi', toggle(a.lastLine, () => set({ lastLine: !a.lastLine }), 'Son fiyat çizgisi')),
      ]));
  }
  return [tabs, pane];
}

/** `ctx`: { a (the appearance), apply(a), save() } — from any page. */
export function appearanceSheet(ctx, tab = 'theme') {
  const state = { tab };
  const body = h('div.rv-look-body');
  const repaint = () => { const y = body.closest('.rv-sheet')?.scrollTop; body.replaceChildren(...lookPane(ctx, state, repaint)); if (y != null) body.closest('.rv-sheet').scrollTop = y; };
  repaint();
  return sheet({ title: 'Görünüm', cls: 'look', body, banner: true });
}

/** The account (Alltra's): the theme's light behind the face, then the rows.
 *  "Görünüm" opens the look in the same panel, with a way back. */
export function profileDrawer(which = 'profile') {
  const p = shell.me.profile;
  const state = { tab: 'theme' };
  const body = h('div.rv-drawer-body');
  let sh = null;
  const back = h('button.rv-icon-btn.rv-close', { type: 'button', title: 'Geri', 'aria-label': 'Geri', onclick: () => { which = 'profile'; paint(); } }, h('span.rv-back-ic', {}, icon('chevron', 18)));
  const paint = () => {
    if (which === 'look') {
      sh?.setTitle('Görünüm'); sh?.setLead(back);
      const y = body.closest('.rv-sheet')?.scrollTop;
      body.replaceChildren(...lookPane(homeLook, state, paint));
      if (y != null) body.closest('.rv-sheet').scrollTop = y;
      return;
    }
    sh?.setTitle('Hesap'); sh?.setLead(null);
    body.replaceChildren(
      h('div.rv-acc', {}, h('span.rv-acc-av', {}, avatar({ ...p, locked: false }, 'lg'), h('i')), h('h3', {}, p.name), h('span', {}, TEST_COPY ? '@rv-next · test sürümü' : SITE_TAG)),
      group([
        { icon: 'user', title: 'Profil', sub: 'Profil değiştir, yeni profil', onclick: async () => { await flushStorage(); await api.leaveProfile(); window.location.replace('profiles.html'); } },
        { icon: 'palette', title: 'Görünüm', sub: 'Tema, renk, yazı ve grafik', onclick: () => { which = 'look'; paint(); } },
      ], null, { mono: true }),
      group([
        { icon: 'sliders', title: 'Tercihler', sub: 'Saat dilimi, hesap, işlem varsayılanları', onclick: () => { closeSheet(); settingsDialog(host); } },
        TEST_COPY ? { icon: 'home', title: 'Ana site', sub: 'r5vers.github.io', onclick: () => { window.location.href = '../home.html'; } } : cloudRow(),
      ], null, { mono: true }),
      ...(TEST_COPY ? [group([{ icon: 'refresh', title: 'Test sürümünü sıfırla', sub: 'Ana siteden yeniden kopyalar', danger: true, onclick: () => { window.location.href = 'sifirla.html'; } }], null, { mono: true })] : []));
  };
  // the main site: the group's cloud, linked or not, and a sync now
  let cloud = null;
  const cloudRow = () => ({
    icon: 'cloud', title: 'Bulut',
    sub: !cloud ? 'Durum soruluyor…' : cloud.linked ? (cloud.error ? `Eşitlenemedi: ${cloud.error}` : `Bağlı · son eşitleme ${cloud.last_sync ? new Date(cloud.last_sync).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : 'henüz'}`) : 'Bağlı değil · grup şifresiyle bağlan',
    onclick: async () => {
      if (!cloud?.linked) { await flushStorage(); await api.leaveProfile(); window.location.replace('profiles.html'); return; }
      try { cloud = await api.cloudSync(); toast('Bulut eşitlendi', 'ok'); } catch (err) { cloud = { ...cloud, error: err.message }; }
      if (which === 'profile') paint();
    },
  });
  if (!TEST_COPY) api.cloudStatus().then((c) => { cloud = c; if (which === 'profile') paint(); }, () => {});
  sh = sheet({ title: which === 'look' ? 'Görünüm' : 'Hesap', cls: 'account', body, banner: true });
  paint();
  return sh;
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

/** Alltra's app switcher: the bar's round mark grows into a column of the
 *  apps; the page behind goes soft until one is chosen. */
export function appSwitcher(current, from) {
  document.querySelector('.rv-switch-back')?.remove();
  const r = from.getBoundingClientRect();
  const apps = [{ id: 'home', name: 'Ana ekran', icon: 'home', href: 'home.html' }, ...APPS];
  const backdrop = h('div.rv-switch-back');
  const close = () => { backdrop.classList.add('out'); setTimeout(() => backdrop.remove(), 200); };
  const col = h('nav.rv-switch', { 'aria-label': 'Uygulamalar', style: { left: `${r.left}px`, bottom: `${window.innerHeight - r.bottom}px`, width: `${r.width}px` } },
    apps.map((a, i) => h(`a.rv-switch-app${a.id === current ? '.on' : ''}`, { href: a.href, title: a.name, 'aria-label': a.name, style: { '--i': apps.length - i },
      onclick: (e) => { e.preventDefault(); close(); if (a.id !== current) go(a.href); } }, icon(a.icon, 22), h('span.rv-switch-l', {}, a.name))),
    h('button.rv-switch-app.rv-switch-x', { type: 'button', title: 'Kapat', 'aria-label': 'Kapat', onclick: close }, brandMark(24)));
  backdrop.append(col);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
}

export const markButton = (current) => ({ node: brandMark(24), label: 'Uygulamalar', onclick: (e) => appSwitcher(current, e.currentTarget) });

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
