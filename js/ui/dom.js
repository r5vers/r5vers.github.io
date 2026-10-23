// Small DOM helpers: element builder, toasts, modals, icons.
import '../local/boot.js?v=eb96803c93';
import { escapeHtml } from '../format.js?v=eb96803c93';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('button.btn.primary', { onclick, title }, 'text', child...) */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && name === 'textarea') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const MAX_TOASTS = 4;

export function toast(msg, kind = 'info', ms = 3500) {
  const box = document.getElementById('toasts');
  const el = h(`div.toast.glass-pop.${kind}`, { role: kind === 'err' ? 'alert' : 'status' }, h('span.bar'), msg);
  box.append(el);
  while (box.children.length > MAX_TOASTS) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

/**
 * modal({ title, body: Node, actions: [{ label, kind, onClick }], wide })
 * onClick may return false to keep the modal open. Returns { close, el }.
 */
export function modal({ title, body, actions = [], wide = false, onClose, note = null }) {
  const root = document.getElementById('modal-root');
  const close = () => {
    // a field still being typed in fires its change (and saves) before the dialog goes
    if (back.contains(document.activeElement)) document.activeElement.blur();
    back.remove(); document.removeEventListener('keydown', onKey, true); onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const footer = h('footer', {}, note ? h('span.note', {}, icon('check', 14), note) : null, actions.map((a) => h(`button.btn.${a.kind || 'outline'}`, {
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const keep = await a.onClick?.();
        if (keep !== false) close();
      } catch (err) {
        toast(err.message || String(err), 'err');
      } finally {
        btn.disabled = false;
      }
    },
  }, a.label)));
  const box = h(`div.modal.glass-pop${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button.btn.icon.small.close-x', { onclick: close, title: 'Kapat (Esc)' }, icon('close', 16))),
    h('div.body', {}, body),
    actions.length ? footer : null);
  const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  root.append(back);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => box.querySelector('input, select, textarea')?.focus(), 0);
  return { close, el: box };
}

export function confirmBox(title, text, okLabel = 'Tamam', kind = 'primary') {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: h('p', {}, text),
      actions: [
        { label: 'Vazgeç', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, kind, onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr-TR');
}

/** Geometric avatar motifs, drawn over the profile colour (ids fit in 8 chars). */
export const AVATAR_PATTERNS = {
  '': 'Baş harfler',
  'p:orb': 'Yörünge',
  'p:lin': 'Çizgiler',
  'p:dot': 'Noktalar',
  'p:wav': 'Dalga',
  'p:cnd': 'Mumlar',
  'p:pri': 'Prizma',
  'p:sun': 'Işın',
};

const PATTERN_SVG = {
  'p:orb': '<g fill="none" stroke="#fff" stroke-width="1.2"><circle cx="70" cy="30" r="18" opacity=".55"/><circle cx="70" cy="30" r="32" opacity=".35"/><circle cx="70" cy="30" r="46" opacity=".22"/><circle cx="70" cy="30" r="60" opacity=".14"/></g><circle cx="70" cy="30" r="7" fill="#fff" opacity=".8"/>',
  'p:lin': '<g stroke="#fff" stroke-width="5" opacity=".18">' + Array.from({ length: 9 }, (_, i) => `<path d="M${-40 + i * 18} 110L${20 + i * 18} -10"/>`).join('') + '</g>',
  'p:dot': '<g fill="#fff">' + Array.from({ length: 36 }, (_, i) => `<circle cx="${12 + (i % 6) * 15.2}" cy="${12 + Math.floor(i / 6) * 15.2}" r="${1.2 + ((i * 7) % 5) * 0.45}" opacity="${0.12 + ((i * 3) % 7) * 0.06}"/>`).join('') + '</g>',
  'p:wav': '<g fill="none" stroke="#fff" stroke-width="1.6">' + Array.from({ length: 6 }, (_, i) => `<path d="M-5 ${22 + i * 12}c15-10 25 10 40 0s25 10 40 0 25 10 40 0" opacity="${0.42 - i * 0.05}"/>`).join('') + '</g>',
  'p:cnd': '<g fill="#fff"><rect x="22" y="38" width="12" height="30" rx="2" opacity=".35"/><rect x="44" y="24" width="12" height="44" rx="2" opacity=".6"/><rect x="66" y="44" width="12" height="20" rx="2" opacity=".35"/></g><g stroke="#fff" stroke-width="2" opacity=".5"><path d="M28 30v46M50 14v62M72 36v36"/></g>',
  'p:pri': '<g fill="#fff"><path d="M0 100L50 0 100 100z" opacity=".1"/><path d="M50 0l50 100H50z" opacity=".14"/><path d="M0 100L50 45 100 100z" opacity=".12"/><path d="M50 45l50 55H50z" opacity=".1"/></g>',
  'p:sun': '<g stroke="#fff" stroke-width="2.2" opacity=".22">' + Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return `<path d="M50 50L${50 + Math.cos(a) * 80} ${50 + Math.sin(a) * 80}"/>`; }).join('') + '</g><circle cx="50" cy="50" r="13" fill="#fff" opacity=".45"/>',
};

/** Profile avatar: a glass tile in the profile colour with a motif and/or the
 *  initials. Older profiles may still carry an emoji; it is shown as is. */
export function avatar(p, size = 'lg') {
  const pat = PATTERN_SVG[p.avatar];
  const el = h(`span.avatar.${size}`, { style: { '--c': p.color } });
  if (p.photo) {
    // a profile picture covers the colour and the pattern
    el.classList.add('has-photo');
    el.append(h('img.photo', { src: p.photo, alt: '', loading: 'lazy', decoding: 'async', draggable: false }));
    if (p.locked) el.append(h('span.lock', { title: 'PIN ile kilitli' }, icon('lock', size === 'lg' ? 15 : 12)));
    return el;
  }
  if (pat) {
    const bg = document.createElement('span');
    bg.className = 'motif';
    bg.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${pat}</svg>`;
    el.append(bg);
  }
  if (p.avatar && !pat) el.append(h('span.emoji', {}, p.avatar));
  else if (!pat || size !== 'sm') el.append(h('span.init', {}, initials(p.name)));
  if (p.locked) el.append(h('span.lock', { title: 'PIN ile kilitli' }, icon('lock', size === 'lg' ? 15 : 12)));
  return el;
}

/** The product mark: a replay arc around three candles (the middle one in the accent). */
/** The RV star: four concave points, the lower one longer, split by a soft
 *  curved gap into two pieces (traced from the logo artwork). */
export const STAR_VIEWBOX = '-4 -4 405.2 497.5';
export const STAR_PATH = 'M156.2 180.8 L151.0 187.0 L138.2 200.0 L123.5 213.2 L110.2 223.8 L100.8 230.5 L86.8 239.5 L73.0 247.2 L56.2 255.5 L46.2 259.8 L24.8 267.5 L11.0 271.5 L0.0 274.0 L1.5 275.0 L6.5 275.8 L20.0 279.2 L40.8 286.2 L61.5 295.2 L78.5 304.2 L96.0 315.2 L110.0 325.5 L124.0 337.2 L141.2 354.2 L153.0 367.8 L164.5 383.0 L174.0 397.5 L182.8 413.0 L191.0 430.2 L197.8 447.5 L203.0 464.0 L203.0 465.2 L205.0 471.8 L208.0 485.2 L208.2 488.8 L209.2 489.5 L212.0 471.8 L212.5 471.0 L213.0 467.0 L215.8 455.5 L221.0 437.8 L229.2 416.0 L236.0 401.2 L243.0 388.0 L252.0 373.0 L262.5 357.8 L250.2 350.5 L240.2 343.8 L228.8 334.8 L218.0 325.0 L207.2 313.8 L199.8 304.8 L187.0 286.5 L179.8 273.8 L174.8 263.5 L168.8 248.8 L166.0 240.5 L161.8 224.5 L159.0 209.2 L157.8 198.8 L157.0 183.0 L157.2 181.0 Z M182.2 0.0 L178.8 19.8 L175.0 35.5 L170.8 49.8 L163.0 70.8 L154.8 88.8 L148.0 101.5 L137.0 119.5 L130.5 128.5 L130.2 130.0 L139.8 135.5 L150.8 143.0 L158.2 148.8 L169.8 158.8 L181.8 171.0 L189.0 179.5 L197.2 190.5 L205.8 203.8 L214.0 219.2 L218.8 230.0 L221.8 238.0 L226.8 254.0 L230.0 268.5 L231.2 278.5 L231.8 279.8 L233.0 292.8 L233.0 309.0 L233.5 309.5 L242.8 299.2 L254.8 287.2 L269.8 274.0 L290.8 258.2 L311.5 245.2 L330.5 235.5 L351.8 226.5 L373.5 219.2 L389.0 215.2 L396.5 214.0 L397.2 213.2 L396.5 212.8 L391.8 212.2 L375.8 208.5 L359.2 203.5 L338.5 195.5 L321.8 187.5 L303.5 177.0 L287.5 166.2 L271.5 153.5 L256.0 139.2 L243.2 125.5 L232.0 111.8 L220.8 95.8 L208.8 75.5 L200.0 57.5 L192.8 39.2 L187.0 20.8 Z';
let markId = 0;

/** The star as SVG markup; `stops` are five colours or CSS variables. */
export function starSvg(size, stops = ['var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)', 'var(--m5)'], id = `rvm${++markId}`) {
  const offs = [0, 0.3, 0.5, 0.72, 1];
  return `<svg width="${size}" height="${size}" viewBox="${STAR_VIEWBOX}" aria-hidden="true">
<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">${stops.map((c, i) => `<stop offset="${offs[i]}" style="stop-color:${c}"/>`).join('')}</linearGradient></defs>
<path d="${STAR_PATH}" fill="url(#${id}g)" stroke="rgba(255,255,255,.4)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;
}

/** The RV star in the current metal (the --m1..--m5 colours of the appearance). */
export function brandMark(size = 22) {
  const span = document.createElement('span');
  span.className = 'mark';
  span.innerHTML = starSvg(size);
  return span;
}

export function field(label, input, hint) {
  // a <label> forwards clicks to its first control: fine around one input,
  // wrong around a group of buttons (it would press the first one)
  const single = input && ['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName);
  return h(single ? 'label.f' : 'div.f', {}, label, input, hint ? h('span.muted', { style: { fontSize: '11px' } }, hint) : null);
}

export const html = escapeHtml;

const ICONS = {
  cursor: '<path d="M5.5 3.5l13 7.4-5.6 1.7-2.2 5.9z"/>',
  trend: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.7"/><circle cx="19" cy="5" r="1.7"/>',
  ray: '<path d="M5 17.5L21 6.5"/><circle cx="5" cy="17.5" r="1.7"/>',
  hline: '<path d="M2.5 12h19"/><circle cx="12" cy="12" r="1.7"/>',
  hray: '<path d="M6.5 12h15"/><circle cx="6.5" cy="12" r="1.7"/>',
  vline: '<path d="M12 2.5v19"/><circle cx="12" cy="12" r="1.7"/>',
  rect: '<rect x="4" y="6.5" width="16" height="11" rx="1.5"/>',
  fib: '<path d="M3.5 5.5h17M3.5 9.5h17M3.5 13h17M3.5 18.5h17" stroke-dasharray="1.5 2.5"/><path d="M4.5 18.5L19.5 5.5"/>',
  long: '<rect x="4.5" y="5" width="15" height="7" rx="1" style="fill:color-mix(in srgb, var(--up) 30%, transparent);stroke:var(--up)"/><rect x="4.5" y="12" width="15" height="6.5" rx="1" style="fill:color-mix(in srgb, var(--down) 26%, transparent);stroke:var(--down)"/>',
  short: '<rect x="4.5" y="5.5" width="15" height="6.5" rx="1" style="fill:color-mix(in srgb, var(--down) 26%, transparent);stroke:var(--down)"/><rect x="4.5" y="12" width="15" height="7" rx="1" style="fill:color-mix(in srgb, var(--up) 30%, transparent);stroke:var(--up)"/>',
  measure: '<path d="M4.5 19.5V4.5M4.5 19.5h15"/><path d="M8.5 15.5l8-8" stroke-dasharray="1.5 2.5"/>',
  text: '<path d="M5.5 6.5V4.5h13v2M12 4.5v15M9 19.5h6"/>',
  arrowline: '<path d="M5 19L18.5 5.5"/><path d="M11 5.2h7.8V13"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  triangle: '<path d="M12 4.5l8.5 14.5h-17z"/>',
  channel: '<path d="M3.5 14.5L16 4.5M8 19.5L20.5 9.5"/><path d="M5.8 17l12.5-10" stroke-dasharray="1.5 2.5"/>',
  magnet: '<path d="M6.5 3.5v7.5a5.5 5.5 0 0 0 11 0V3.5h-3.6V11a1.9 1.9 0 0 1-3.8 0V3.5z"/><path d="M6.5 7h3.6M13.9 7h3.6"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  eye: '<path d="M2.5 12s3.8-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.8 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.8-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  step: '<path d="M6 6v12l9-6z" fill="currentColor" stroke="none"/><path d="M17.5 6v12" stroke-width="2"/>',
  stepbar: '<path d="M3.5 6v12l7-6zM11 6v12l7-6z" fill="currentColor" stroke="none"/><path d="M20.5 6v12" stroke-width="1.8"/>',
  ffwd: '<path d="M3.5 6.5v11l7.5-5.5zM12 6.5v11l7.5-5.5z" fill="currentColor" stroke="none"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.8 8.2L20 18M8.8 15.8L20 6"/>',
  replay: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3"/><path d="M3.5 3.5v4.7h4.7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  order: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  cloud: '<path d="M7.4 18.5h9.9a3.8 3.8 0 0 0 .5-7.55A5.6 5.6 0 0 0 7 10.2a4.15 4.15 0 0 0 .4 8.3z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  swap: '<path d="M7 7.5h12l-3.5-3.5M17 16.5H5l3.5 3.5"/>',
  bolt: '<path d="M13 3L5.5 13.5h6L11 21l7.5-10.5h-6z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  expand: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>',
  shrink: '<path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v8.5h11V10"/><path d="M10 18.5v-5h4v5"/>',
  flask: '<path d="M9.5 4h5M10.5 4v5.2L5.6 17.6A1.6 1.6 0 0 0 7 20h10a1.6 1.6 0 0 0 1.4-2.4L13.5 9.2V4"/><path d="M7.8 14.5h8.4"/>',
  data: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/><path d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
  arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  clock: '<circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.3l2.8 1.7"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 16.8v.2"/>',
  edit: '<path d="M4.5 19.5l1-4.5 10-10 3.5 3.5-10 10z"/><path d="M13.5 7l3.5 3.5"/>',
  brush: '<path d="M19.5 3.5l1 1-8.2 8.7-2-2z"/><path d="M10 12.2c-2.1-.2-3.8 1.3-3.9 3.4-.1 1.6-.9 2.6-2.1 2.9 1.2.9 2.6 1.3 4 1.2 2.5-.2 4.2-2.1 4.1-4.6"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  dashed: '<path d="M3 12h3.5M10.25 12h3.5M17.5 12H21"/>',
  extend: '<path d="M3 12h13M12.5 8l4 4-4 4"/><path d="M20.5 5v14"/>',
  live: '<circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M7.2 7.2a6.8 6.8 0 0 0 0 9.6M16.8 7.2a6.8 6.8 0 0 1 0 9.6M4.4 4.4a10.8 10.8 0 0 0 0 15.2M19.6 4.4a10.8 10.8 0 0 1 0 15.2"/>',
  chart: '<path d="M7 4.5v15M12 7v10M17 3.5v13"/><rect x="5.5" y="8" width="3" height="7" rx=".8" fill="currentColor"/><rect x="10.5" y="10" width="3" height="4.5" rx=".8"/><rect x="15.5" y="6" width="3" height="7" rx=".8" fill="currentColor"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.3.3-2.4 1.7-2.4h1.7a3.5 3.5 0 0 0 3.5-3.5C20.5 7.3 16.7 3.5 12 3.5z"/><circle cx="8" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  power: '<path d="M12 3.5v8"/><path d="M6.6 6.6a7.6 7.6 0 1 0 10.8 0"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-4 4-5.8 7.5-5.8s6.3 1.8 7.5 5.8"/>',
  indicator: '<path d="M3.5 18.5c3-7 5.2-10.5 8.5-10.5s4.8 5 8.5 5"/><path d="M3.5 5.5h4M5.5 3.5v4"/>',
  sessions: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M14.5 4.5v15"/>',
  draw: '<path d="M4.5 19.5l1-4.5 10-10 3.5 3.5-10 10z"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Per-profile state (settings, look, drawings, editor code) lives on the
// server, so it survives reloads, other browsers and private windows. A copy
// is kept in localStorage ("rt:x" as "rt:p<id>:x") as a cache and as a
// fallback when the server cannot be reached. Writes are batched; keys not yet
// confirmed by the server are listed in localStorage too, so a write cut off
// by closing the page (or made while offline) is sent on the next visit
// instead of being replaced by the older server copy.
let prefix = 'rt:';
let profile = null;
let legacy = false;
let cache = null;          // the server's values for this profile, once loaded
let pending = {};
let flushTimer = 0;
let retryMs = 2000;
let inflight = null;
let blocked = false;       // the cookie now names another profile: stop sending
const versions = {};       // key -> local write counter
let dirty = new Set();     // keys the server has not confirmed yet

const scoped = (key) => (key.startsWith('rt:') ? prefix + key.slice(3) : key);
const synced = (key) => cache && key.startsWith('rt:');
const dirtyKey = () => `${prefix}__unsent`;

function localRead(key) {
  try {
    let v = localStorage.getItem(scoped(key));
    if (v == null && legacy) v = localStorage.getItem(key);
    return v == null ? undefined : JSON.parse(v);
  } catch { return undefined; }
}

function saveDirty() {
  try { localStorage.setItem(dirtyKey(), JSON.stringify([...dirty])); } catch { /* storage blocked */ }
}

function flush(keepalive = false) {
  clearTimeout(flushTimer);
  flushTimer = 0;
  if (!cache || profile == null || blocked || !Object.keys(pending).length) return inflight || Promise.resolve();
  // one request at a time, so an older batch can never land after a newer one;
  // a caller that waits gets the newer batch sent right after
  if (inflight && !keepalive) return inflight.then(() => flush(false), () => flush(false));
  // leaving the page cannot wait: send now (it stays listed as unsent until confirmed)
  const batch = pending;
  pending = {};
  const sent = Object.fromEntries(Object.keys(batch).map((k) => [k, versions[k] || 0]));
  const body = JSON.stringify(batch);
  const small = new Blob([body]).size < 60000;
  const req = fetch(`/api/kv?profile=${profile}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: keepalive && small })
    .then((r) => {
      // another profile was picked in another tab: keep the changes listed as
      // unsent; they go up the next time this profile is opened
      if (r.status === 409) { blocked = true; return; }
      if (!r.ok) throw new Error(String(r.status));
      for (const k of Object.keys(batch)) if ((versions[k] || 0) === sent[k]) dirty.delete(k);
      saveDirty();
      retryMs = 2000;
    })
    .catch(() => {
      // send the latest value of each key again later (it stays listed as unsent)
      for (const k of Object.keys(batch)) if (!(k in pending)) pending[k] = cache[k];
      if (!keepalive) { flushTimer = setTimeout(flush, retryMs); retryMs = Math.min(retryMs * 2, 30000); }
    })
    .finally(() => { if (inflight === req) inflight = null; });
  if (!inflight) inflight = req;
  return req;
}

function schedule() {
  if (!flushTimer) flushTimer = setTimeout(flush, 500);
}

addEventListener('pagehide', () => { flush(true); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

/** Load this profile's state from the server (call once, before reading). */
export async function useProfileStorage(profileId, inheritLegacy = false) {
  prefix = `rt:p${profileId}:`;
  profile = profileId;
  legacy = inheritLegacy;
  try { dirty = new Set(JSON.parse(localStorage.getItem(dirtyKey()) || '[]')); } catch { dirty = new Set(); }
  try {
    const r = await fetch(`/api/kv?profile=${profileId}`);
    cache = r.ok ? await r.json() : null;
  } catch { cache = null; }
  if (!cache) return;
  // what this browser has that the server does not: values saved before the
  // server kept them, and writes that never reached it
  const keys = new Set(dirty);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === dirtyKey()) continue;
      if (k.startsWith(prefix)) keys.add(`rt:${k.slice(prefix.length)}`);
      else if (legacy && /^rt:(?!p\d+:)/.test(k)) keys.add(k);
    }
  } catch { /* storage blocked */ }
  for (const k of keys) {
    if (k in cache && !dirty.has(k)) continue;
    const v = localRead(k);
    if (v === undefined) continue;
    cache[k] = v;
    pending[k] = v;
    dirty.add(k);
  }
  saveDirty();
  schedule();
}

export function storage(key, fallback) {
  if (synced(key)) return key in cache ? structuredClone(cache[key]) : fallback;
  const v = localRead(key);
  return v === undefined ? fallback : v;
}

export function store(key, value) {
  try { localStorage.setItem(scoped(key), JSON.stringify(value)); } catch { /* private mode or full */ }
  if (!key.startsWith('rt:') || profile == null) return;
  versions[key] = (versions[key] || 0) + 1;
  dirty.add(key);
  saveDirty();
  if (!cache) return;
  cache[key] = structuredClone(value);
  pending[key] = value;
  schedule();
}

/** Send pending changes now and wait (before signing out or switching profile). */
export function flushStorage() { return flush(false); }

/** A soft light that follows the mouse across the glass. Only the panels near
 *  the pointer get its position (as --mx / --my on the panel), so a move does
 *  not restyle the whole page; over the chart the light holds still. */
export function wirePointerLight() {
  if (!window.matchMedia?.('(pointer: fine)').matches) return;
  const root = document.documentElement;
  const REACH = 260;
  let frame = 0, x = -1000, y = -1000;
  let lit = new Set();
  const update = () => {
    frame = 0;
    const near = new Map();
    if (root.dataset.pointer !== 'off' && x > -1000) {
      // all the reads first, then the writes: one layout per frame at most
      for (const el of document.querySelectorAll('.glass, .glass-pop')) {
        const r = el.getBoundingClientRect();
        if (x > r.left - REACH && x < r.right + REACH && y > r.top - REACH && y < r.bottom + REACH) near.set(el, r);
      }
    }
    for (const el of lit) if (!near.has(el)) { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); }
    for (const [el, r] of near) { el.style.setProperty('--mx', `${Math.round(x - r.left)}px`); el.style.setProperty('--my', `${Math.round(y - r.top)}px`); }
    lit = new Set(near.keys());
  };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.target instanceof Element && e.target.closest('.chart')) return;
    x = e.clientX; y = e.clientY;
    if (!frame) frame = requestAnimationFrame(update);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { x = -1000; y = -1000; if (!frame) frame = requestAnimationFrame(update); });
  // the panels move under a still pointer while the page scrolls
  window.addEventListener('scroll', () => { if (lit.size && !frame) frame = requestAnimationFrame(update); }, { passive: true, capture: true });
}

/** A small line chart (SVG) of `values`, coloured by `color`. */
export function sparkline(values, { color = 'currentColor', width = 120, height = 36, fill = true } = {}) {
  const el = h('span.spark');
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return el;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * width, height - 2 - ((y - lo) / span) * (height - 4)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const id = `sg${Math.random().toString(36).slice(2, 8)}`;
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">`
    + (fill ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line}L${width} ${height}L0 ${height}Z" fill="url(#${id})"/>` : '')
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  return el;
}
