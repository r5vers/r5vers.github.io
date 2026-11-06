// The light on the glass. css/glass.css draws each pane's rim lit from an
// angle (--la) and its sheen at a point (--mx / --my). The page has one
// light, which turns as you scroll and, where the phone reports it, as you
// tilt it; over a pane the pointer becomes its light: the rim brightens on
// the side facing the pointer and the sheen sits under it. One write per
// frame; reduced motion keeps the light where it rests.
const GLASS = '.gl, .hub-app, .rv-round, .rv-pill';
const REST = 315;   // degrees: the light from the top left

export function wireGlassLight(root = document) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const page = document.documentElement;
  let raf = 0, tilt = 0, pageAngle = REST;
  const turn = () => {
    raf = 0;
    // a full turn over about three screens of scrolling, plus the tilt
    // (unwrapped: going past 360 must not swing the light back round)
    pageAngle = REST + (window.scrollY / (window.innerHeight * 3)) * 360 + tilt;
    page.style.setProperty('--la', `${pageAngle.toFixed(1)}deg`);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(turn); };
  window.addEventListener('scroll', queue, { passive: true });
  // Android and desktop report the tilt without asking; iPhone asks for a
  // permission we do not prompt for, so there the scroll alone turns it
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    tilt = Math.max(-60, Math.min(60, e.gamma)) * 1.5;
    queue();
  }, { passive: true });
  turn();

  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  let praf = 0, ev = null, lit = null;
  const paint = () => {
    praf = 0;
    const el = ev?.target?.closest?.(GLASS) || null;
    if (lit && lit !== el) { lit.classList.remove('lit'); lit.style.removeProperty('--la'); }
    lit = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    el.style.setProperty('--mx', `${((x / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${((y / r.height) * 100).toFixed(1)}%`);
    // conic angles run clockwise from the top: the pointer's bearing from the
    // centre, taken as the turn nearest the page's light so it never spins round
    let deg = (Math.atan2(x - r.width / 2, -(y - r.height / 2)) * 180) / Math.PI;
    deg += 360 * Math.round((pageAngle - deg) / 360);
    el.style.setProperty('--la', `${deg.toFixed(1)}deg`);
    el.classList.add('lit');
  };
  root.addEventListener('pointermove', (e) => { ev = e; if (!praf) praf = requestAnimationFrame(paint); }, { passive: true });
  root.addEventListener('pointerleave', () => { lit?.classList.remove('lit'); lit?.style.removeProperty('--la'); lit = null; }, { passive: true });
}
