// Timeframes and bar-bucket alignment. Mirrors server/timeframes.py exactly;
// tests/fixtures/buckets.json pins both to the same labels.

export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const WEEK = 7 * DAY;
const MONDAY_OFFSET = 4 * DAY; // 1970-01-01 was a Thursday
const FX_DAY_SHIFT = 7 * HOUR; // 17:00 New York + 7h = next local midnight
const EST = -5 * HOUR;
const EDT = -4 * HOUR;

const TF_RE = /^(\d+)(m|h|D|W|M)$/;

export function parseTf(id) {
  const m = TF_RE.exec(id || '');
  if (!m) throw new Error(`unknown timeframe ${id}`);
  const n = Number(m[1]);
  const unit = m[2];
  if (n <= 0) throw new Error(`unknown timeframe ${id}`);
  if (unit === 'm' || unit === 'h') {
    const seconds = n * (unit === 'm' ? MINUTE : HOUR);
    if (seconds > DAY || DAY % seconds) throw new Error(`intraday timeframe must divide a day: ${id}`);
    if (seconds === DAY) return { id: '1D', kind: 'day', seconds: DAY };
    return { id, kind: 'intraday', seconds };
  }
  if (n !== 1) throw new Error(`only 1${unit} is supported: ${id}`);
  return {
    D: { id: '1D', kind: 'day', seconds: DAY },
    W: { id: '1W', kind: 'week', seconds: WEEK },
    M: { id: '1M', kind: 'month', seconds: 30 * DAY },
  }[unit];
}

export function canAggregate(base, target) {
  if (base.kind === 'intraday' && target.kind === 'intraday') return target.seconds % base.seconds === 0;
  if (base.kind === 'intraday') return true;
  if (target.kind === 'intraday') return false;
  const order = { day: 0, week: 1, month: 2 };
  if (base.kind === 'week' && target.kind === 'month') return false;
  return order[target.kind] >= order[base.kind];
}

const floorDiv = (a, b) => Math.floor(a / b);
const floorTo = (t, step, offset = 0) => floorDiv(t - offset, step) * step + offset;

// ── New York DST ──────────────────────────────────────────────────────────
function firstSunday(year, month) {
  const wd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  return 1 + ((7 - wd) % 7);
}
function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
}

const dstCache = new Map();
export function nyDstBounds(year) {
  let b = dstCache.get(year);
  if (b) return b;
  let sm, sd, em, ed;
  if (year >= 2007) {
    sm = 3; sd = firstSunday(year, 3) + 7;
    em = 11; ed = firstSunday(year, 11);
  } else if (year >= 1987) {
    sm = 4; sd = firstSunday(year, 4);
    em = 10; ed = lastSunday(year, 10);
  } else {
    sm = 4; sd = lastSunday(year, 4);
    em = 10; ed = lastSunday(year, 10);
  }
  // 02:00 EST = 07:00 UTC, 02:00 EDT = 06:00 UTC
  b = [Date.UTC(year, sm - 1, sd, 7) / 1000, Date.UTC(year, em - 1, ed, 6) / 1000];
  dstCache.set(year, b);
  return b;
}

export function nyOffset(t) {
  const [start, end] = nyDstBounds(new Date(t * 1000).getUTCFullYear());
  return t >= start && t < end ? EDT : EST;
}

export function tradingDay(t, align) {
  if (align === 'fx') return floorTo(t + nyOffset(t) + FX_DAY_SHIFT, DAY);
  return floorTo(t, DAY);
}

export function fxSessionStart(t) {
  const localOpen = tradingDay(t, 'fx') - FX_DAY_SHIFT;
  return localOpen - nyOffset(localOpen - EST);
}

/** Label (UTC seconds) of the `tf` bar that time `t` belongs to. */
export function bucket(t, tf, align = 'utc') {
  if (tf.kind === 'intraday') {
    if (align === 'utc' || HOUR % tf.seconds === 0) return floorTo(t, tf.seconds);
    const anchor = fxSessionStart(t);
    return anchor + floorDiv(t - anchor, tf.seconds) * tf.seconds;
  }
  const day = tradingDay(t, align);
  if (tf.kind === 'day') return day;
  if (tf.kind === 'week') return floorTo(day, WEEK, MONDAY_OFFSET);
  const d = new Date(day * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

export const CHART_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M'];
