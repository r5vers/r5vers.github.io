// Number / money / time formatting (Turkish locale by default).

const LOCALE = 'tr-TR';
const fmtCache = new Map();

function dtf(tz, opts) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hourCycle: 'h23', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function price(x, decimals = 5) {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toFixed(decimals);
}

export function money(x, currency = 'USD', digits = 2) {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = Math.abs(x).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sym = { USD: '$', EUR: '€', GBP: '£', TRY: '₺', JPY: '¥' }[currency];
  return `${x < 0 ? '−' : ''}${sym ? sym + s : `${s} ${currency}`}`;
}

export function signedMoney(x, currency) {
  if (x == null || !Number.isFinite(x)) return '—';
  return (x > 0 ? '+' : '') + money(x, currency);
}

export function num(x, digits = 2) {
  if (x == null || !Number.isFinite(x)) return x === Infinity ? '∞' : '—';
  return x.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  const v = Math.abs(x * 100).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${x < 0 && Number(v.replace(',', '.')) !== 0 ? '−' : ''}%${v}`;
}

export function signed(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return (x > 0 ? '+' : '') + x.toFixed(digits);
}

export function cls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; }

export function dateTime(t, tz = 'UTC', withSeconds = false) {
  if (t == null) return '—';
  return dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) }).format(new Date(t * 1000));
}

export function dateOnly(t, tz = 'UTC') {
  if (t == null) return '—';
  return dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000));
}

export function clock(t, tz = 'UTC') {
  if (t == null) return '—';
  return dtf(tz, { weekday: 'short', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t * 1000));
}

export function duration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const total = Math.max(0, Math.round(sec / 60));
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  if (d) return `${d} gün ${h} sa`;
  if (h) return `${h} sa ${m} dk`;
  return `${m} dk`;
}

/** Offset (seconds) of `tz` at UTC instant t: local wall time = t + offset. */
export function tzOffset(t, tz) {
  if (tz === 'UTC') return 0;
  const parts = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t * 1000));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) / 1000;
  return wall - t;
}

/** "YYYY-MM-DDTHH:MM" wall time in `tz` -> UTC seconds. */
export function parseLocal(value, tz = 'UTC') {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) / 1000;
  let t = wall - tzOffset(wall, tz);
  t = wall - tzOffset(t, tz); // second pass settles DST edges
  return t;
}

/** UTC seconds -> "YYYY-MM-DDTHH:MM" wall time in `tz` (for datetime-local inputs). */
export function toLocalInput(t, tz = 'UTC') {
  if (t == null) return '';
  const d = new Date((t + tzOffset(t, tz)) * 1000);
  return d.toISOString().slice(0, 16);
}

export function parseNumber(s) {
  if (s == null) return null;
  const v = String(s).trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
