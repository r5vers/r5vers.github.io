// Liquid glass, where the browser can bend a backdrop (Chromium): behind each
// control the page is displaced near its edges by a map shaped like the
// control itself, so lines and light passing behind it curve as through a
// slab of glass, and stay true in the middle. Safari and Firefox cannot run
// an SVG filter on a backdrop; they keep the plain frosted glass of the CSS.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SUPPORTED = typeof navigator !== 'undefined' && /Chrome\/\d+/.test(navigator.userAgent);

// the controls that get the bend; large scrolling cards keep the cheap glass
const TARGETS = ['.rv-pill', '.rv-round:not(.ghost)', '.rv-rail', '.rv-side', '.rv-crumbs', '.rv-top-actions .rv-btn.ghost', '.hub-searchbar',
  '.rv-switch', '.rv-close', '.m-pill', '.m-round', '.m-acts', '.page-chart #draw-toolbar', '.page-chart .fav-bar',
  '.page-chart .topbar :is(.instrument, .tf-group, .mode-switch, .legs, .home-link, .btn.icon, .search-btn, .profile-chip, #btn-indicators, #btn-draw)', '.ds-pop .ds-sheet'].join(', ');

let defs = null;
let count = 0;
const sized = new ResizeObserver((entries) => { for (const e of entries) queue(e.target); });
const pending = new Set();
let frame = 0;

function queue(el) {
  pending.add(el);
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; for (const x of pending) bend(x); pending.clear(); });
}

/** A displacement map for a w×h rounded box: red / green carry how far, and
 *  which way, to look inward; 128 means "straight through". */
function edgeMap(w, h, radius, band) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const hw = w / 2, hh = h / 2, r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      let dist, nx, ny;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; dist = l - r; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
      else if (qx > qy) { dist = qx - r; nx = Math.sign(px); ny = 0; }
      else { dist = qy - r; nx = 0; ny = Math.sign(py); }
      const t = Math.max(0, Math.min(1, 1 + dist / band)); // 1 at the rim, 0 a band inside it
      const k = t * t * (3 - 2 * t);
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * k * 127;
      d[i + 1] = 128 - ny * k * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function bend(el) {
  if (!el.isConnected) return;
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (w < 8 || h < 8 || w * h > 600000) return;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const key = `${w}x${h}x${radius}`;
  if (el.dataset.lg === key) return;
  if (!defs) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.append(defs);
    document.body.append(svg);
  }
  const id = el.dataset.lgId || (el.dataset.lgId = `rv-lg-${++count}`);
  let f = defs.querySelector(`#${id}`);
  if (!f) { f = document.createElementNS(SVG_NS, 'filter'); f.id = id; defs.append(f); }
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  const band = Math.max(6, Math.min(18, Math.min(w, h) * 0.32));
  const scale = Math.max(10, Math.min(34, Math.min(w, h) * 0.5));
  f.innerHTML = `<feImage href="${edgeMap(w, h, radius, band)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>`;
  // frosted as in the CSS, the bend on top of it
  el.style.backdropFilter = `blur(${el.matches('.rv-side, .rv-rail, .rv-crumbs, .ds-sheet') ? 20 : 14}px) url(#${id}) saturate(170%) brightness(1.04)`;
  el.dataset.lg = key;
}

function scan(root) {
  if (!(root instanceof Element)) return;
  const found = root.matches?.(TARGETS) ? [root] : [];
  found.push(...root.querySelectorAll(TARGETS));
  for (const el of found) {
    if (el.dataset.lgSeen) continue;
    el.dataset.lgSeen = '1';
    sized.observe(el);
    queue(el);
  }
}

/** Bend the backdrop behind the glass controls, now and as they appear. */
export function liquidGlass() {
  if (!SUPPORTED || window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  document.documentElement.classList.add('lg-bend');
  scan(document.body);
  new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) scan(n); })
    .observe(document.body, { childList: true, subtree: true });
}
