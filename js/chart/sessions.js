// Session / ICT kill-zone bands, defined in New York time (DST aware). Each
// band is tinted in its colour, has a thin line along the top and its name
// written faintly inside it, so the zone is readable at a glance.
import { nyOffset } from '../core/timeframes.js?v=9692cc795b';

const m = (hh, mm = 0) => hh * 60 + mm;

export const SESSION_SETS = [
  {
    name: 'Seanslar',
    zones: [
      { name: 'ASIA', short: 'AS', from: m(19), to: m(4), color: '#bf5af2' },
      { name: 'LONDON', short: 'LDN', from: m(3), to: m(12), color: '#0a84ff' },
      { name: 'NEW YORK', short: 'NY', from: m(8), to: m(17), color: '#ff9f0a' },
    ],
  },
  {
    // ICT kill zones (New York local time)
    name: 'ICT kill zone',
    zones: [
      { name: 'ASIA', short: 'AS', from: m(20), to: m(0), color: '#bf5af2' },
      { name: 'LONDON', short: 'LDN', from: m(2), to: m(5), color: '#0a84ff' },
      { name: 'NY AM', short: 'NY', from: m(7), to: m(10), color: '#ff9f0a' },
      { name: 'LONDON CLOSE', short: 'LC', from: m(10), to: m(12), color: '#30d158' },
      { name: 'NY PM', short: 'PM', from: m(13, 30), to: m(16), color: '#ff375f' },
    ],
  },
];

// A one-time profile setup; later user changes remain authoritative.
export function configureICT(settings) {
  if (settings.ictPresetVersion === 1) return false;
  settings.ictPreviousSettings ||= { tz: settings.tz || 'UTC', indicators: structuredClone(settings.indicators || []) };
  settings.tz = 'America/New_York';
  const list = Array.isArray(settings.indicators) ? settings.indicators : [];
  const existing = list.find(i => i.type === 'sessions');
  const indicator = { ...(existing || { id: 'ict-default', type: 'sessions' }), params: {
    ...(existing?.params || {}), mode: 1, fill: 6, labels: 1,
    zones1: SESSION_SETS[1].zones.map(z => ({ ...z, on: true })),
  } };
  settings.indicators = [...list.filter(i => i.type !== 'sessions'), indicator];
  settings.ictPresetVersion = 1;
  return true;
}

/** The zones drawn for these params: the user's own list for the mode, else the defaults. */
export function zonesFor(params) {
  const mode = Math.max(0, Math.min(SESSION_SETS.length - 1, Math.round(params?.mode || 0)));
  const own = params?.[`zones${mode}`];
  return (Array.isArray(own) && own.length ? own : SESSION_SETS[mode].zones).filter((z) => z.on !== false && /^#[0-9a-f]{6}$/i.test(z.color || ''));
}

const inside = (min, z) => (z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to);

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class SessionsPrimitive {
  constructor(tc, params) {
    this.tc = tc;
    this.params = params;
    // drawBackground paints under the candles
    const renderer = { draw: () => {}, drawBackground: (target) => target.useMediaCoordinateSpace((s) => this._draw(s.context, s.mediaSize)) };
    this._views = [{ zOrder: () => 'normal', renderer: () => renderer }];
  }

  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() {}
  updateAllViews() {}
  paneViews() { return this._views; }

  _draw(ctx, size) {
    const tc = this.tc;
    if (!tc.tf || tc.tf.kind !== 'intraday' || tc.tf.seconds > 3600) return;
    const ts = tc.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const bars = tc.bars;
    if (!range || !bars.length) return;
    const zones = zonesFor(this.params);
    const fill = Number.isFinite(this.params.fill) ? Math.max(0, Math.min(0.4, this.params.fill / 100)) : 0.075;
    const labels = this.params.labels !== 0;
    const spacing = ts.options().barSpacing;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(bars.length - 1, Math.ceil(range.to) + 1);
    const light = tc.theme === 'light';
    const family = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';
    // a weekend or data gap ends a band even if both sides are in the zone
    const maxGap = Math.max(tc.tf.seconds * 3, 3 * 3600);
    zones.forEach((z) => {
      let start = null;
      const flush = (end) => {
        const x0 = ts.logicalToCoordinate(start) - spacing / 2;
        const x1 = ts.logicalToCoordinate(end) + spacing / 2;
        const w = x1 - x0;
        if (!(w > 0)) return;
        ctx.fillStyle = rgba(z.color, fill);
        ctx.fillRect(x0, 0, w, size.height);
        ctx.fillStyle = rgba(z.color, 0.55);
        ctx.fillRect(x0, 0, w, 2);
        // the zone's name, faint, just above the volume bars (the legend
        // sits at the top); the short name when the band is narrow
        if (!labels || !z.name) return;
        ctx.save();
        ctx.font = `700 16px ${family}`;
        let label = z.name;
        if (ctx.measureText(label).width > w - 10) label = z.short || z.name.slice(0, 3);
        const full = ctx.measureText(label).width;
        const fontSize = Math.min(16, 16 * ((w - 10) / full));
        if (fontSize < 8) { ctx.restore(); return; }
        ctx.beginPath();
        ctx.rect(x0, 0, w, size.height);
        ctx.clip();
        ctx.font = `700 ${fontSize.toFixed(1)}px ${family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = rgba(z.color, light ? 0.5 : 0.42);
        ctx.fillText(label, x0 + w / 2, Math.round(size.height * 0.85) - 6);
        ctx.restore();
      };
      for (let i = from; i <= to; i++) {
        const t = bars[i].time;
        const min = Math.floor((((t + nyOffset(t)) % 86400) + 86400) % 86400 / 60);
        const hit = inside(min, z);
        if (hit && start !== null && i > 0 && t - bars[i - 1].time > maxGap) { flush(i - 1); start = null; }
        if (hit && start === null) start = i;
        if (!hit && start !== null) { flush(i - 1); start = null; }
      }
      if (start !== null) flush(to);
    });
  }
}
