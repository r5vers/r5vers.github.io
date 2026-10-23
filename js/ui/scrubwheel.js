// A thumb wheel for replay: the top of a dial, seen from the front, above the
// replay controls. Its marks (two short, one long) sit on a gentle arc and
// turn with the finger; the mark at the top glows, the two either side a
// little less. Each mark that passes the top moves the replay one candle, and
// the lit marks give a small lift and flare as it does. Roll fast to run,
// slow down near what matters, lift the finger to stop at once (no coasting).
import { h } from './dom.js?v=64b6fa7342';

const GAP = 17;           // px along the arc between marks = one candle
const HEIGHT = 54;
const MAX_PER_FRAME = 40; // a very fast flick still draws every frame

const PULSE_MS = 260;     // the little lift of the lit marks on each candle

function rgb(color) {
  const probe = document.createElement('i');
  probe.style.color = color;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [255, 255, 255];
  probe.remove();
  return m.slice(0, 3).map(Number);
}

/** `onSteps(n)` moves the replay up to n candles and returns how many it did. */
export function scrubWheel({ onSteps, onStart, getLook = () => ({}) }) {
  const canvas = h('canvas.scrub-dial', { 'aria-hidden': 'true' });
  const el = h('div.scrub', { role: 'slider', 'aria-label': 'Replay tekerleği: sağa çevirdikçe mum ilerler', title: 'Sağa çevir: her çizgi bir mum ileri' }, canvas);
  let travelled = 0;     // px the dial has turned in all
  let carry = 0;         // travel not yet turned into a candle
  let pending = 0;       // candles waiting for the next frame
  let lastX = null;
  let lastT = 0;
  let frame = 0;
  let paintFrame = 0;
  let pulseAt = -1e9;
  let colors = null;
  // motion that eases rather than jumps: the press (0..1), the speed of the
  // roll, and a little give when it is pushed the wrong way
  let press = 0, pressTo = 0, speed = 0, give = 0, lastPaint = 0;

  const readColors = () => {
    const css = getComputedStyle(document.documentElement);
    colors = { accent: rgb(css.getPropertyValue('--accent').trim() || '#9fa8ff'), light: document.documentElement.dataset.theme === 'light' };
  };

  const paint = (now = performance.now()) => {
    paintFrame = 0;
    const w = el.clientWidth, hgt = HEIGHT;
    if (!w) return;
    const dt = Math.min(50, now - (lastPaint || now));
    lastPaint = now;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // the top of a wheel: a wide arc whose centre is far below the strip
    const R = w * 1.4;
    const cx = w / 2, cy = 6 + R;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    if (!colors) readColors();
    colors.light = document.documentElement.dataset.theme === 'light';
    const look = getLook();
    if (look.chartBg === 'solid' && /^#[0-9a-f]{6}$/i.test(look.chartColor || '')) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(look.chartColor.slice(i, i + 2), 16));
      colors.light = .299 * r + .587 * g + .114 * b > 140;
    }

    // ease the press in and out, let the speed and the give settle
    const k = 1 - Math.exp(-dt / 70);
    press += (pressTo - press) * k;
    if (Math.abs(pressTo - press) < 0.002) press = pressTo;
    if (lastX === null || now - lastT > 60) speed *= Math.exp(-dt / 120);
    if (speed < 0.005) speed = 0;
    if (lastX === null || give > -0.05) give *= Math.exp(-dt / 90);
    if (Math.abs(give) < 0.05) give = 0;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = Math.asin(Math.min(0.98, (w / 2 - 8) / R));
    const step = GAP / R;
    const phase = (travelled + give) / R;
    const first = Math.ceil((-span - phase) / step), last = Math.floor((span - phase) / step);
    const [ar, ag, ab] = colors.accent;
    const base = colors.light ? '20, 22, 30' : '235, 238, 248';
    // each candle: the lit marks rise a touch and flare, then settle (ease out)
    const t = Math.min(1, (now - pulseAt) / PULSE_MS);
    const pulse = t < 1 ? (1 - t) ** 2 : 0;
    // a fast roll widens the light a little, as if the wheel were warming up
    const fast = Math.min(1, speed / 1.2);
    const window_ = step * (2.4 + 0.5 * press + 1.4 * fast);
    ctx.lineCap = 'round';
    for (let i = first; i <= last; i++) {
      const a = i * step + phase;
      const edge = Math.abs(a) / span;                 // 0 at the top, 1 at the ends
      const near = Math.max(0, 1 - Math.abs(a) / window_); // the glow around the top
      const long = ((i % 3) + 3) % 3 === 0;
      const lift = (2.5 * pulse + 1.2 * press) * near;
      const len = (long ? 20 : 11) * (1 - 0.3 * edge) * (1 + (0.12 * pulse + 0.08 * press) * near);
      const sin = Math.sin(a), cos = Math.cos(a);
      const x0 = cx + (R - 3 + lift) * sin, y0 = cy - (R - 3 + lift) * cos;
      const x1 = cx + (R - 3 + lift - len) * sin, y1 = cy - (R - 3 + lift - len) * cos;
      const fade = (1 - edge) ** 1.4;
      ctx.lineWidth = long ? 2.2 : 1.6;
      if (near > 0.02) {
        ctx.shadowColor = `rgba(${ar}, ${ag}, ${ab}, ${Math.min(1, (0.6 + 0.3 * press) * near + 0.3 * pulse * near)})`;
        ctx.shadowBlur = 10 * near * (1 + 0.8 * pulse + 0.3 * fast);
        const mix = near ** 0.8;
        ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${Math.min(1, 0.35 + (0.5 + 0.15 * press) * mix + 0.25 * pulse * mix)})`;
      } else {
        ctx.shadowColor = colors.light ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 3;
        ctx.strokeStyle = `rgba(${base}, ${(long ? 0.62 : 0.42) * fade * (0.85 + 0.15 * press)})`;
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (pulse > 0 || press !== pressTo || speed > 0 || give !== 0) repaint();
  };
  const repaint = () => { if (!paintFrame) paintFrame = requestAnimationFrame(paint); };

  const flush = () => {
    frame = 0;
    if (pending <= 0) return;
    const want = Math.min(pending, MAX_PER_FRAME);
    pending -= want;
    const done = onSteps(want);
    // the replay stopped (a fill, the end of the data): so does the wheel
    if (done < want) { pending = 0; carry = 0; }
    if (pending > 0) frame = requestAnimationFrame(flush);
  };
  const queue = (n) => {
    pending += n;
    const now = performance.now();
    // a fast roll keeps a steady beat rather than one long flare
    if (now - pulseAt > 110) { pulseAt = now; repaint(); }
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const travel = (dx, dtMs = 16) => {
    if (dx <= 0) {
      // it only turns forward: pushed back it gives a little, then springs home
      give = Math.max(-9, give + dx * 0.25);
      repaint();
      return;
    }
    if (give < 0) give = Math.min(0, give + dx);
    speed += ((dx / Math.max(8, dtMs)) - speed) * 0.35;
    travelled += dx;
    carry += dx;
    repaint();
    const n = Math.floor(carry / GAP);
    if (n > 0) { carry -= n * GAP; queue(n); }
  };
  const end = (e) => {
    if (lastX === null) return;
    lastX = null;
    carry = 0;
    pressTo = 0;
    el.classList.remove('active');
    repaint();
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    lastX = e.clientX;
    lastT = performance.now();
    if (!colors) readColors();
    pressTo = 1;
    el.classList.add('active');
    repaint();
    try { el.setPointerCapture(e.pointerId); } catch { /* old browser */ }
    onStart?.();
  });
  el.addEventListener('pointermove', (e) => {
    if (lastX === null) return;
    const dx = e.clientX - lastX;
    const now = performance.now();
    lastX = e.clientX;
    travel(dx, now - lastT);
    lastT = now;
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // a mouse wheel or trackpad works too (down / right = forward)
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    onStart?.();
    travel(0.3 * (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
  }, { passive: false });
  // drawn when it appears, resizes, or the theme changes colour
  new ResizeObserver(() => { readColors(); repaint(); }).observe(el);
  new MutationObserver(() => { readColors(); repaint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
  return el;
}
