// The light on the glass follows the pointer: the card under it learns where
// (--mx, --my, in % of the card) and css/glass.css draws a soft sheen and a
// brighter rim there. One listener for the page, one write per frame; touch
// screens and reduced motion keep the resting light.
const GLASS = '.gl, .hub-app, .rv-round, .rv-pill';

export function wireGlassLight(root = document) {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0, ev = null, lit = null;
  const paint = () => {
    raf = 0;
    const el = ev?.target?.closest?.(GLASS) || null;
    if (lit && lit !== el) lit.classList.remove('lit');
    lit = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(((ev.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(((ev.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    el.classList.add('lit');
  };
  root.addEventListener('pointermove', (e) => { ev = e; if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
  root.addEventListener('pointerleave', () => { lit?.classList.remove('lit'); lit = null; }, { passive: true });
}
