// "Paper" stickers: any mark printed in halftone dots and cut out of a sheet
// with scissors, like the chess king and Saturn photos. Drawn once per
// mark, colour and size on a canvas (no canvas filters: older iPhones lack
// them; the blurs here are box blurs on the alpha), kept as a blob URL.
const cache = new Map();

/** A blob URL of `src` (a mark whose shape is its alpha, `ratio` wide to
 *  high) as a paper sticker: ink `color`, `size` px on its long side. */
export function paperArt(src, ratio, color, size, seed = src) {
  const key = `${src}|${color}|${size}`;
  if (!cache.has(key)) cache.set(key, render(src, ratio, color, size, seed).catch((err) => { cache.delete(key); throw err; }));
  return cache.get(key);
}

function loadImage(src) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`görsel yüklenemedi: ${src}`));
    img.src = src;
  });
}

// a repeatable random (the same tear every time for the same mark)
function rng(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [-1, 1] over a w×h field, features `cell` px apart. */
function noise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh).map(() => rand() * 2 - 1);
  const out = new Float32Array(w * h);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = fade(fy - iy);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = fade(fx - ix);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Three box blurs of radius r (about a Gaussian) of a w×h field. */
function blur(src, w, h, r) {
  r = Math.max(1, Math.round(r));
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  const pass = (from, to, horizontal) => {
    const n = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
    const span = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += from[base + Math.min(n - 1, Math.max(0, i)) * step];
      for (let i = 0; i < n; i++) {
        to[base + i * step] = sum / span;
        sum += from[base + Math.min(n - 1, i + r + 1) * step] - from[base + Math.max(0, i - r) * step];
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

async function render(src, ratio, color, size, seed) {
  // (an SVG may have no size of its own: the ratio comes from the caller)
  const img = await loadImage(src);
  // the mark inside, a margin of paper around it
  const inner = Math.round(size * 0.88);
  const W = ratio >= 1 ? inner : Math.round(inner * ratio), H = ratio >= 1 ? Math.round(inner / ratio) : inner;
  const pad = Math.round(size * 0.06);
  const cw = W + 2 * pad, ch = H + 2 * pad;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, pad, pad, W, H);
  const px = ctx.getImageData(0, 0, cw, ch);
  const n = cw * ch;
  const shape = new Float32Array(n);
  for (let i = 0; i < n; i++) shape[i] = px.data[i * 4 + 3] / 255;
  const rand = rng(seed);
  const long = Math.max(W, H);

  // ── the cut: as with scissors, straight runs and corners a few percent
  // out from the mark. The grown shape is sampled on a coarse grid, nudged a
  // little at each point, and read back between the points in straight lines.
  const border = long * 0.035;
  const grown = blur(shape, cw, ch, border * 0.55);
  const step = Math.max(6, long / 22);
  const gw = Math.ceil(cw / step) + 1, gh = Math.ceil(ch / step) + 1;
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(cw - 1, Math.round(gx * step)), y = Math.min(ch - 1, Math.round(gy * step));
      // how far inside the grown shape (0 outside .. 1 well in), nudged
      grid[gy * gw + gx] = Math.min(1, Math.max(0, (grown[y * cw + x] - 0.02) / 0.035)) + (rand() - 0.5) * 0.3;
    }
  }
  // never into the mark: a thin band of paper always stays around it
  const near = blur(shape, cw, ch, border * 0.16);
  const out = ctx.createImageData(cw, ch);
  const d = out.data;
  const dark = luminance(color) < 0.5;
  // the paper is the ink's opposite: white under dark ink, near black under light
  const paper = dark ? [250, 250, 248] : [16, 16, 18];
  for (let y = 0; y < ch; y++) {
    const fy = y / step, iy = Math.floor(fy), ty = fy - iy;
    for (let x = 0; x < cw; x++) {
      const fx = x / step, ix = Math.floor(fx), tx = fx - ix;
      const g = (k, l) => grid[Math.min(gh - 1, k) * gw + Math.min(gw - 1, l)];
      const v = (g(iy, ix) * (1 - tx) + g(iy, ix + 1) * tx) * (1 - ty) + (g(iy + 1, ix) * (1 - tx) + g(iy + 1, ix + 1) * tx) * ty;
      const i = y * cw + x;
      // a clean edge: a pixel or so of smoothing, never a fade
      const a = Math.max(Math.min(1, Math.max(0, (v - 0.5) * 28 + 0.5)), near[i] > 0.08 ? 1 : 0);
      if (a <= 0) continue;
      const o = i * 4;
      d[o] = paper[0]; d[o + 1] = paper[1]; d[o + 2] = paper[2]; d[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(out, 0, 0);

  // ── the print: a solid rim along the mark's edge, inside it a 45° dot
  // screen: open dots where the light falls (top left), closing to solid in
  // the shade, with a slow unevenness so it reads as a printed photo
  const pitch = Math.max(4, long / 78);
  const depth = blur(shape, cw, ch, long * 0.022);
  const blob = noise(cw, ch, Math.max(10, long / 6), rand);
  const dots = document.createElement('canvas');
  dots.width = cw; dots.height = ch;
  const dc = dots.getContext('2d');
  dc.fillStyle = color;
  const s = Math.SQRT1_2, reach = Math.hypot(cw, ch);
  for (let u = -reach; u < reach; u += pitch) {
    for (let v = -reach; v < reach; v += pitch) {
      const x = (u - v) * s, y = (u + v) * s;
      if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
      const i = Math.floor(y) * cw + Math.floor(x);
      if (shape[i] < 0.02 && depth[i] < 0.05) continue;
      const light = Math.min(1, Math.max(0, ((x - pad) / W) * 0.6 + ((y - pad) / H) * 0.4));
      // light patches and shade that closes to solid, as in a printed photo
      let tone = 0.12 + 0.98 * light ** 1.5 + 0.26 * blob[i];
      tone += (1 - tone) * Math.min(1, Math.max(0, (0.9 - depth[i]) * 6));
      tone = Math.min(1, Math.max(0.06, tone));
      const r = Math.min(pitch * 0.74, pitch * Math.sqrt(tone / Math.PI) * 1.04);
      dc.beginPath();
      dc.arc(x, y, r, 0, Math.PI * 2);
      dc.fill();
    }
  }
  dc.globalCompositeOperation = 'destination-in';
  dc.drawImage(img, pad, pad, W, H);
  ctx.drawImage(dots, 0, 0);
  const blob2 = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  return URL.createObjectURL(blob2);
}
