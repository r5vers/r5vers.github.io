// Stickers on the home screen: marks stuck anywhere on the page, as on a
// notebook. A sticker sits where it was put (left as a share of the page's
// width, top in pixels, so it stays by the same card), at its size and
// angle, colour (white, black or any) and opacity. Tap or click one to pick
// it: drag to move, the corner to resize, the knob on top to turn (two
// fingers do both on a phone), and a small bar to recolour, fade, bring
// forward, lock or remove it. A photo sticker (the chess king) keeps its own
// shades: black is as it is, white turns it over, a colour tints it. Paper
// mode prints any other mark like those photos: halftone dots on a sheet
// with a torn edge (paper.js); off again, it is flat as before. A locked
// sticker lets taps through to what is under it; in the home screen's edit
// mode it can be picked, changed and unlocked again. They are kept with the
// profile (rt:stickers), apart for phones and laptops like the layout.
import { h, icon, modal, storage, store } from './dom.js?v=efec4daadb';
import { paperArt } from './paper.js?v=efec4daadb';

// the art files sit beside the pages (the test copy lives under /next/)
function art(file) { return new URL(`../../stickers/${file}`, import.meta.url).href; }

export const STICKERS = [
  { id: 'eye', name: 'Göz', src: art('eye.svg'), ratio: 1893 / 1875 },
  { id: 'skull', name: 'Kafatası', src: art('skull.png'), ratio: 629 / 658 },
  { id: 'moon', name: 'Ay', src: art('moon.svg'), ratio: 1173 / 1170 },
  { id: 'burst', name: 'Patlama', src: art('burst.png'), ratio: 464 / 477 },
  { id: 'star', name: 'Kayan yıldız', src: art('star.svg'), ratio: 1956 / 666 },
  { id: 'cute-skull', name: 'Sevimli kafatası', src: art('cute-skull.svg'), ratio: 1998 / 1770 },
  { id: 'flame', name: 'Alevli kafa', src: art('flame.svg'), ratio: 1032 / 1584 },
  { id: 'tribal', name: 'Tribal kafatası', src: art('tribal.svg'), ratio: 1308 / 2211 },
  { id: 'bang', name: 'Ünlem', src: art('bang.svg'), ratio: 927 / 1284 },
  { id: 'king', name: 'Şah', src: art('king.png'), ratio: 302 / 636, photo: true },
  { id: 'saturn', name: 'Satürn', src: art('saturn.png'), ratio: 662 / 415, photo: true },
  { id: 'halftone', name: 'Noktalı üçgenler', src: art('halftone.png'), ratio: 658 / 444, photo: true },
];
const BY_ID = Object.fromEntries(STICKERS.map((s) => [s.id, s]));
export const STICKER_COLORS = { white: '#ffffff', black: '#0b0b0d' };
const KEY = 'rt:stickers';
const MIN_W = 36;
const MIN_OPACITY = 0.15;
const inkOf = (c) => STICKER_COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? c : STICKER_COLORS.white);
const opacityOf = (o) => (Number.isFinite(o) ? clamp(o, MIN_OPACITY, 1) : 1);

/** The mark itself: one colour through the shape, or the photo as it is
 *  (white), turned over (black) or tinted (a colour). */
function artEl(st, c, o, tag = 'span.sticker-art', paper = null) {
  const art = h(`${tag}${st.photo ? '.photo' : ''}`, { style: { '--src': `url("${st.src}")` } });
  art._st = st;
  if (st.photo) art.append(h('img', { src: st.src, alt: '', draggable: 'false' }));
  paintArt(art, c, o, paper);
  return art;
}
const paperOf = (s) => ({ on: !!s.p, w: s.w });
// the paper print's size: enough pixels for the sticker on this screen, in
// steps (a resize redraws it only when it needs more)
const printSize = (w, st) => clamp(Math.ceil((Math.max(w, w / st.ratio) * Math.min(3, window.devicePixelRatio || 1)) / 240) * 240, 480, 1440);
/** Colour, opacity and paper mode (`paper`: { on, w }) onto a mark. The
 *  paper print is drawn off to the side; the flat mark shows until it is
 *  ready. */
function paintArt(art, c, o, paper = null) {
  const st = art._st;
  const want = paper?.on && st && !st.photo ? `${inkOf(c)}|${printSize(paper.w, st)}` : null;
  if (want !== art._paper) {
    art._paper = want;
    if (!want) {
      art.classList.remove('paper');
      art.style.backgroundImage = '';
    } else {
      paperArt(st.src, st.ratio, inkOf(c), printSize(paper.w, st), st.id).then((url) => {
        if (art._paper !== want) return;
        art.style.backgroundImage = `url("${url}")`;
        art.classList.add('paper');
      }).catch(() => {});
    }
  }
  if (art.classList.contains('photo')) {
    // the king is dark: black is the photo itself, white turns it over
    art.style.setProperty('--ink', /^#/.test(c || '') ? inkOf(c) : '#ffffff');
    art.classList.toggle('inv', c === 'white');
  } else {
    art.style.setProperty('--ink', inkOf(c));
  }
  art.style.opacity = String(opacityOf(o));
}

let device = () => 'desk';
let layer = null;
let selected = null;               // key of the picked sticker
let lastColor = 'white';

function all() { return storage(KEY, {}) || {}; }
function list() {
  const items = all()[device()];
  return Array.isArray(items) ? items.filter((s) => s && BY_ID[s.s]) : [];
}
function save(items) { const a = { ...all() }; a[device()] = items; store(KEY, a); }
function update(key, patch) { save(list().map((s) => (s.k === key ? { ...s, ...patch } : s))); }

/** Draw the stickers into `root` (the home page's content); call after every render. */
export function mountStickers(root, deviceOf) {
  device = deviceOf;
  layer?.remove();
  layer = h('div.sticker-layer', { 'aria-label': 'Stickerlar' });
  root.append(layer);
  for (const s of list()) layer.append(stickerEl(s));
  // (out of edit mode a locked sticker is not picked: it lets taps through)
  const sel = selected && list().find((x) => x.k === selected);
  if (!sel || (sel.lock && !document.body.classList.contains('editing'))) selected = null;
  if (selected) pick(selected);
}

function widthOf() { return layer?.clientWidth || 1; }
function place(el, s) {
  const st = BY_ID[s.s];
  el.style.left = `${s.x * widthOf()}px`;
  el.style.top = `${s.y}px`;
  el.style.width = `${s.w}px`;
  el.style.height = `${s.w / st.ratio}px`;
  el.style.transform = `translate(-50%, -50%) rotate(${s.r || 0}deg)`;
  el.style.zIndex = String(s.z || 1);
}

function stickerEl(s) {
  const st = BY_ID[s.s];
  const art = artEl(st, s.c, s.o, undefined, paperOf(s));
  const el = h(`div.sticker${s.lock ? '.locked' : ''}`, { 'data-k': s.k, role: 'img', 'aria-label': `${st.name} sticker` },
    art,
    h('span.sticker-frame', {}),
    h('span.sticker-turn', { 'data-act': 'turn', title: 'Döndür' }),
    h('span.sticker-size', { 'data-act': 'size', title: 'Boyut' }));
  place(el, s);
  el.addEventListener('pointerdown', (e) => onDown(e, el));
  return el;
}

// ── picking ───────────────────────────────────────────────────────────────
function pick(key) {
  selected = key;
  for (const el of layer.querySelectorAll('.sticker')) el.classList.toggle('on', el.dataset.k === key);
  showBar();
}
export function unpick() {
  selected = null;
  layer?.querySelectorAll('.sticker.on').forEach((el) => el.classList.remove('on'));
  layer?.querySelector('.sticker-bar')?.remove();
}

function showBar() {
  layer.querySelector('.sticker-bar')?.remove();
  const s = list().find((x) => x.k === selected);
  if (!s) return;
  const art = () => layer.querySelector(`[data-k="${s.k}"] .sticker-art`);
  const setColor = (c) => { lastColor = c; s.c = c; update(s.k, { c }); paintArt(art(), c, s.o, paperOf(s)); markSwatches(); };
  const swatch = (c, label) => h('button.sb-swatch', { type: 'button', title: label, 'aria-label': label, 'data-c': c, style: { '--sw': STICKER_COLORS[c] }, onclick: () => setColor(c) });
  // any colour: the browser's own picker, the sticker follows while choosing
  const custom = /^#/.test(s.c || '') ? s.c : '#9fa8ff';
  const picker = h('input', { type: 'color', value: custom, 'aria-label': 'Renk seç',
    // (a paper print is redrawn once the colour is chosen, not on every step)
    oninput: (e) => { if (!s.p) paintArt(art(), e.target.value, s.o); customBtn.style.setProperty('--sw', e.target.value); customBtn.dataset.c = e.target.value; },
    onchange: (e) => setColor(e.target.value) });
  const customBtn = h('label.sb-swatch.custom', { title: 'Renk seç', 'data-c': custom, style: { '--sw': custom } }, picker);
  const markSwatches = () => {
    for (const b of bar.querySelectorAll('.sb-swatch')) b.classList.toggle('on', b.classList.contains('custom') ? /^#/.test(s.c || '') : b.dataset.c === s.c);
  };
  const pct = h('output.sb-val', {}, `%${Math.round(opacityOf(s.o) * 100)}`);
  const fade = h('input.sb-range', { type: 'range', min: String(MIN_OPACITY * 100), max: '100', step: '1', value: String(Math.round(opacityOf(s.o) * 100)), 'aria-label': 'Opaklık',
    oninput: (e) => { const o = Number(e.target.value) / 100; paintArt(art(), s.c, o, paperOf(s)); pct.textContent = `%${e.target.value}`; },
    onchange: (e) => { s.o = Number(e.target.value) / 100; update(s.k, { o: s.o }); } });
  // paper mode: the torn sheet and the dots of the photo stickers, on any mark
  const paperBtn = BY_ID[s.s].photo ? null : h(`button.sb-toggle${s.p ? '.on' : ''}`, { type: 'button', title: 'Kağıt: yırtık kenar ve noktalı baskı (tekrar basınca düz)', 'aria-pressed': String(!!s.p),
    onclick: () => {
      s.p = !s.p;
      update(s.k, { p: s.p });
      paintArt(art(), s.c, s.o, paperOf(s));
      paperBtn.classList.toggle('on', s.p);
      paperBtn.setAttribute('aria-pressed', String(s.p));
    } }, h('span.sb-knob'), 'Kağıt');
  const bar = h('div.sticker-bar', { role: 'toolbar', 'aria-label': 'Sticker' },
    h('div.sb-row', {},
      swatch('white', 'Beyaz'), swatch('black', 'Siyah'), customBtn,
      h('span.sb-sep'),
      h('button.sb-btn', { type: 'button', title: 'Öne getir', 'aria-label': 'Öne getir', onclick: () => { update(s.k, { z: topZ() + 1 }); refresh(s.k); } }, icon('up', 16)),
      h('button.sb-btn', { type: 'button', title: 'Düz yap', 'aria-label': 'Düz yap', onclick: () => { update(s.k, { r: 0 }); refresh(s.k); } }, icon('refresh', 16)),
      // a locked one is picked only in the home screen's edit mode: there it can be opened again
      s.lock
        ? h('button.sb-btn.on', { type: 'button', title: 'Kilidi aç', 'aria-label': 'Kilidi aç', onclick: () => { update(s.k, { lock: false }); refresh(s.k); } }, icon('unlock', 16))
        : h('button.sb-btn', { type: 'button', title: 'Kilitle: dokununca altındaki çalışır (düzenleme modunda yine düzenlenir)', 'aria-label': 'Kilitle', onclick: () => { update(s.k, { lock: true }); unpick(); refresh(s.k); } }, icon('lock', 16)),
      h('button.sb-btn.danger', { type: 'button', title: 'Kaldır', 'aria-label': 'Kaldır', onclick: () => remove(s.k) }, icon('trash', 16))),
    h('div.sb-row.sb-fade', {}, h('span.sb-label', {}, 'Opaklık'), fade, pct, paperBtn));
  for (const b of bar.querySelectorAll('button, input, label')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  layer.append(bar);
  markSwatches();
  placeBar(bar, s);
}
/** The bar goes under the sticker, clear of its corner handle; above it
 *  (clear of the turning knob) when there is no room on screen below. */
function placeBar(bar, s) {
  const st = BY_ID[s.s];
  const a = ((s.r || 0) * Math.PI) / 180;
  const half = (Math.abs(s.w * Math.sin(a)) + Math.abs((s.w / st.ratio) * Math.cos(a))) / 2;
  const hw = bar.offsetWidth / 2 + 6, bh = bar.offsetHeight;
  const x = Math.min(Math.max(s.x * widthOf(), hw), Math.max(hw, widthOf() - hw));
  const below = s.y + half + 34;
  const roomBelow = layer.getBoundingClientRect().top + below + bh + 8 < window.innerHeight;
  bar.style.left = `${x}px`;
  bar.style.top = `${roomBelow ? below : Math.max(0, s.y - half - 56 - bh)}px`;
}
const topZ = () => Math.max(1, ...list().map((s) => s.z || 1));

function refresh(key) {
  const s = list().find((x) => x.k === key);
  const old = layer.querySelector(`[data-k="${key}"]`);
  if (!s) { old?.remove(); return; }
  const fresh = stickerEl(s);
  old ? old.replaceWith(fresh) : layer.append(fresh);
  if (selected === key) pick(key);
}

function remove(key) {
  save(list().filter((s) => s.k !== key));
  const el = layer.querySelector(`[data-k="${key}"]`);
  unpick();
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
}

// ── moving, sizing, turning ───────────────────────────────────────────────
const touches = new Map();          // pointerId -> {x, y} on the picked sticker
let gesture = null;

function onDown(e, el) {
  if (e.button > 0) return;
  e.stopPropagation();               // not a long press on the page (edit mode)
  const key = el.dataset.k;
  const s = list().find((x) => x.k === key);
  if (!s) return;
  const wasPicked = selected === key;
  if (!wasPicked) pick(key);
  // on a touch screen the first tap only picks: the page still scrolls under
  // a sticker that is not picked
  if (e.pointerType !== 'mouse' && !wasPicked && !e.target.dataset.act) return;
  e.preventDefault();
  el.setPointerCapture?.(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const rect = layer.getBoundingClientRect();
  const centre = { x: rect.left + s.x * widthOf(), y: rect.top + s.y };
  const act = e.target.dataset.act || 'move';
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    gesture = { kind: 'pinch', s, el, d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x), w0: s.w, r0: s.r || 0 };
  } else {
    gesture = { kind: act, s, el, x0: e.clientX, y0: e.clientY, sx: s.x, sy: s.y, w0: s.w, r0: s.r || 0, centre,
      d0: Math.hypot(e.clientX - centre.x, e.clientY - centre.y) || 1, a0: Math.atan2(e.clientY - centre.y, e.clientX - centre.x), moved: false };
  }
  el.classList.add('held');
  layer.querySelector('.sticker-bar')?.classList.add('quiet');
  const onMove = (ev) => {
    if (!touches.has(ev.pointerId) || !gesture) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = gesture, now = { ...g.s };
    if (g.kind === 'pinch' && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      now.w = clampW(g.w0 * (Math.hypot(b.x - a.x, b.y - a.y) / (g.d0 || 1)));
      now.r = snap(g.r0 + ((Math.atan2(b.y - a.y, b.x - a.x) - g.a0) * 180) / Math.PI);
    } else if (g.kind === 'move') {
      now.x = clamp((g.sx * widthOf() + ev.clientX - g.x0) / widthOf(), 0, 1);
      now.y = clamp(g.sy + ev.clientY - g.y0, 0, layer.clientHeight);
    } else if (g.kind === 'size') {
      now.w = clampW(g.w0 * (Math.hypot(ev.clientX - g.centre.x, ev.clientY - g.centre.y) / g.d0));
    } else if (g.kind === 'turn') {
      now.r = snap(g.r0 + ((Math.atan2(ev.clientY - g.centre.y, ev.clientX - g.centre.x) - g.a0) * 180) / Math.PI);
    }
    g.moved = true;
    g.now = now;
    place(g.el, now);
  };
  const onUp = (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size) return;        // the other finger is still down
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.classList.remove('held');
    const g = gesture;
    gesture = null;
    if (g?.moved && g.now) {
      const { x, y, w } = g.now;
      const r = Math.round((g.now.r || 0) * 10) / 10;
      update(key, { x, y, w, r });
      place(g.el, { ...g.now, r });
      // a paper print made bigger may need more pixels
      if (g.now.p) paintArt(g.el.querySelector('.sticker-art'), g.now.c, g.now.o, paperOf(g.now));
    }
    if (selected === key) showBar();
  };
  if (touches.size === 1) {
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampW = (w) => clamp(w, MIN_W, Math.max(MIN_W * 2, Math.min(1100, widthOf() * 1.2)));
// a sticker turned to within 3° of straight (or a right angle) goes straight
function snap(r) {
  const n = ((r % 360) + 540) % 360 - 180;
  const near = Math.round(n / 90) * 90;
  return Math.abs(n - near) < 3 ? near : n;
}

// a tap or click anywhere else lets the picked sticker go
document.addEventListener('pointerdown', (e) => {
  if (selected && !e.target.closest?.('.sticker.on, .sticker-bar')) unpick();
}, true);
document.addEventListener('keydown', (e) => {
  if (!selected || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape') unpick();
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(selected); }
});
// the left of each sticker is a share of the page's width: follow it
window.addEventListener('resize', () => {
  if (!layer) return;
  for (const s of list()) { const el = layer.querySelector(`[data-k="${s.k}"]`); if (el) place(el, s); }
  const bar = layer.querySelector('.sticker-bar'); const s = list().find((x) => x.k === selected);
  if (bar && s) placeBar(bar, s);
});

// ── adding ────────────────────────────────────────────────────────────────
/** The sticker sheet: pick a colour and a mark; it lands in the middle of
 *  what is on screen. */
export function stickerSheet() {
  let color = lastColor;
  const locked = list().filter((s) => s.lock).length;
  const grid = h('div.sticker-pick');
  const paint = () => {
    grid.replaceChildren(...STICKERS.map((st) => h('button.sp-item', { type: 'button', title: st.name, 'aria-label': `${st.name} ekle`, onclick: () => { add(st.id, color); dlg.close(); } },
      artEl(st, color, 1, 'span.sp-art'))));
    grid.dataset.color = color;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === color);
  };
  const seg = h('div.seg.sticker-colors', { role: 'group', 'aria-label': 'Renk' },
    ...Object.entries({ white: 'Beyaz', black: 'Siyah' }).map(([c, label]) => h('button', { type: 'button', 'data-c': c, onclick: () => { color = c; lastColor = c; paint(); } },
      h('i', { style: { background: STICKER_COLORS[c] } }), label)));
  paint();
  const body = h('div.sticker-sheet', {}, seg, grid,
    h('p.muted.sticker-help', {}, 'Ekledikten sonra sürükle; köşeden büyüt, üstteki noktadan döndür. Telefonda önce dokun, sonra sürükle ya da iki parmakla büyüt ve döndür.'),
    locked ? h('button.btn.small.outline', { type: 'button', onclick: () => { save(list().map((s) => ({ ...s, lock: false }))); dlg.close(); for (const s of list()) refresh(s.k); } },
      icon('lock', 14), `${locked} kilitli sticker’ın kilidini aç`) : null);
  const dlg = modal({ title: 'Sticker ekle', body });
}

function add(id, color) {
  const st = BY_ID[id];
  const phone = device() === 'phone';
  const rect = layer.getBoundingClientRect();
  const w = phone ? 120 : 170;
  const s = {
    k: Math.random().toString(36).slice(2, 10), s: id, c: color,
    x: 0.5, y: clamp(window.innerHeight / 2 - rect.top, 40, Math.max(40, layer.clientHeight - 40)),
    w: st.ratio > 2 ? w * 1.5 : w, r: Math.round((Math.random() * 10 - 5) * 10) / 10, z: topZ() + 1,
  };
  save([...list(), s]);
  const el = stickerEl(s);
  el.classList.add('landing');
  layer.append(el);
  setTimeout(() => el.classList.remove('landing'), 600);
  pick(s.k);
}
