// Tolerant OHLC CSV import in the browser: server/csv_import.py (parse_csv)
// and the candle helpers of server/bars.py, rule for rule, so a file gives the
// same candles here as it did on the server. tests/fixtures/csv.json
// (make_csv_fixture.py) pins both to the same results.
//
// Candles are columns {t, o, h, l, c, v} of Float64Arrays: t is the bar open
// time in UTC seconds; after normalize() rows are sorted by t, times unique.
//
// Where Python and JS disagree on the basics (what counts as whitespace, what
// float() accepts, the Python `$` that also matches before a final newline)
// the Python meaning is spelled out below.
import { bucket, parseTf, DAY, HOUR, MINUTE, WEEK } from '../core/timeframes.js?v=446247be79';

export class CsvError extends Error {
  constructor(message) { super(message); this.name = 'CsvError'; this.status = 422; }
}

const ROLE_NAMES = {
  time: new Set(['time', 'date', 'datetime', 'timestamp', 'gmt time', 'local time', 'open time',
    'opentime', 'open_time', 'tarih', 'zaman', 'date time', 'date_time', 'dt', 'day']),
  clock: new Set(['time', 'saat', 'hour']),
  open: new Set(['open', 'o', 'açılış', 'acilis', 'first', 'open price', 'opening']),
  high: new Set(['high', 'h', 'yüksek', 'yuksek', 'max', 'high price']),
  low: new Set(['low', 'l', 'düşük', 'dusuk', 'min', 'low price']),
  close: new Set(['close', 'c', 'kapanış', 'kapanis', 'şimdi', 'simdi', 'last', 'price', 'son',
    'close price', 'closing', 'kapanis fiyati']),
  volume: new Set(['volume', 'vol', 'v', 'tickvol', 'tick volume', 'tick_volume', 'hacim', 'hac.',
    'hac', 'real volume', 'real_volume', 'volume usd', 'quote volume', 'tickvolume']),
};

// Python's whitespace (str.strip, str.isspace, \s in re).
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const WS_RUNS = new RegExp(`[${WS}]+`, 'g');
const strip = (s) => s.replace(WS_EDGES, '');
const stripChars = (s, chars) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, 'g'), '');
const stripQuotes = (s) => s.replace(/^"+|"+$/g, '');

const ISO = new RegExp('^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,]\\d+)?)?)?'
  + `[${WS}]*(Z|[+-]\\d{2}:?\\d{2})?$`);
const YMD = /^(\d{4})[./](\d{1,2})[./](\d{1,2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/;
const DMY = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?$/;
const CLOCK = /^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const FIXED_TZ = new RegExp(`^(?:UTC|GMT)?[${WS}]*([+-])(\\d{1,2})(?::?(\\d{2}))?$`, 'i');
const NUM_SUFFIX = { K: 1e3, M: 1e6, B: 1e9 };

/** re.match: anchored at the start, and `$` also matches before a final "\n". */
function match(rx, s) {
  return rx.exec(s) || (s.endsWith('\n') ? rx.exec(s.slice(0, -1)) : null);
}

const DIGITS = '\\d(?:_?\\d)*';
const PY_FLOAT = new RegExp(`^[+-]?(?:(?:${DIGITS}\\.?|(?:${DIGITS})?\\.${DIGITS})(?:e[+-]?${DIGITS})?|inf|infinity|nan)$`, 'i');

/** Python float(s), or null where it raises ValueError. */
function pyFloat(s) {
  s = strip(s);
  if (!PY_FLOAT.test(s)) return null;
  const body = s.replace(/^[+-]/, '').toLowerCase();
  const sign = s[0] === '-' ? -1 : 1;
  if (body === 'nan') return NaN;
  if (body.startsWith('inf')) return sign * Infinity;
  return Number(s.replaceAll('_', ''));
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Python repr() of a string, for error messages. */
function pyRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && NON_PRINTABLE.test(ch)) {
      if (code < 0x100) out += '\\x' + code.toString(16).padStart(2, '0');
      else if (code < 0x10000) out += '\\u' + code.toString(16).padStart(4, '0');
      else out += '\\U' + code.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

function norm(name) {
  let n = stripChars(stripChars(strip(name), '"'), "'");
  n = strip(stripChars(strip(n).toLowerCase(), '<>'));
  return n.replace(WS_RUNS, ' ');
}

// ── numbers ─────────────────────────────────────────────────────────────────
/** 'dot' (1,234.56), 'comma' (1.234,56) - decided from the sample values. */
function numberStyle(samples) {
  let dot = 0, comma = 0;
  for (let s of samples) {
    s = stripQuotes(strip(s));
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) comma++;
      else dot++;
    } else if (s.includes(',')) {
      const parts = s.split(',');
      if ([...parts.at(-1)].length !== 3 || (parts.length === 2 && [...parts[0]].length > 3)) comma++;
    } else if (s.includes('.')) dot++;
  }
  return comma > dot ? 'comma' : 'dot';
}

/** A price or volume; NaN for blanks, null where Python raises ValueError. */
function parseNumber(s, style) {
  s = stripQuotes(strip(s)).replaceAll('\u00a0', '').replaceAll(' ', '');
  if (!s || ['-', 'null', 'None', 'NaN', 'nan'].includes(s)) return NaN;
  let mult = 1;
  const suffix = NUM_SUFFIX[s.at(-1).toUpperCase()];
  if (suffix && s.length > 1) {
    mult = suffix;
    s = s.slice(0, -1);
  }
  s = style === 'comma' ? s.replaceAll('.', '').replaceAll(',', '.') : s.replaceAll(',', '');
  const x = pyFloat(s);
  return x === null ? null : x * mult;
}

function decimalsOf(samples, style) {
  const sep = style === 'comma' ? ',' : '.';
  let best = 0;
  for (let s of samples) {
    s = stripQuotes(strip(s));
    if (s.includes(sep)) best = Math.max(best, [...s.slice(s.lastIndexOf(sep) + 1).replace(/0+$/, '')].length);
  }
  return Math.min(best, 10);
}

// ── timestamps ──────────────────────────────────────────────────────────────
/** Days since 1970-01-01 (proleptic Gregorian). */
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** f(UTC seconds) -> offset seconds of an IANA zone, from Intl. */
function zoneOffsetAt(fmt) {
  return (u) => {
    const p = {};
    for (const { type, value } of fmt.formatToParts(u * 1000)) p[type] = value;
    return daysFromCivil(+p.year, +p.month, +p.day) * DAY + +p.hour * HOUR + +p.minute * MINUTE + +p.second - u;
  };
}

/** Offset of local wall-clock time `local` the way zoneinfo reads it (fold=0):
 *  an ambiguous time takes the earlier instant, a time in a gap the offset
 *  in force before the gap. */
function wallOffset(at, local) {
  // every offset is within 18h, so these two are the offsets either side of
  // any transition `local` could be near
  const cands = [at(local - 18 * HOUR), at(local + 18 * HOUR)];
  const fits = cands.filter((o) => at(local - o) === o);
  if (fits.length) return Math.max(...fits);
  return at(local - Math.max(...cands));
}

/** Returns f(local naive epoch seconds) -> offset seconds. */
function tzOffsetFn(tz) {
  tz = strip(tz || 'UTC');
  if (['UTC', 'GMT', 'Z', ''].includes(tz.toUpperCase())) return () => 0;
  const m = FIXED_TZ.exec(tz);
  if (m) {
    const off = (m[1] === '+' ? 1 : -1) * (Number(m[2]) * HOUR + Number(m[3] || 0) * MINUTE);
    return () => off;
  }
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  } catch {
    throw new CsvError(`bilinmeyen saat dilimi: ${tz}`);
  }
  // zoneinfo names are case-sensitive file names; Intl's are not
  const resolved = fmt.resolvedOptions().timeZone;
  if (resolved !== tz && resolved.toLowerCase() === tz.toLowerCase()) throw new CsvError(`bilinmeyen saat dilimi: ${tz}`);
  const at = zoneOffsetAt(fmt);
  // one offset per local hour, taken at the start of that hour
  const table = new Map();
  return (local) => {
    const h = Math.floor(local / HOUR);
    let off = table.get(h);
    if (off === undefined) table.set(h, off = wallOffset(at, h * HOUR));
    return off;
  };
}

function detectDateFormat(samples, dateOrder) {
  const allMatch = (rx) => samples.every((s) => match(rx, s));
  if (samples.every((s) => /^\d+(\.\d+)?$/.test(s))) {
    const v = Number(samples[0]);
    if (v > 1e14) return 'unix_us';
    if (v > 1e11) return 'unix_ms';
    if (v > 1e8) return 'unix_s';
    if (allMatch(COMPACT)) return 'compact';
    throw new CsvError(`zaman sütunu anlaşılamadı: ${pyRepr(samples[0])}`);
  }
  if (allMatch(ISO)) return 'iso';
  if (allMatch(YMD)) return 'ymd';
  if (allMatch(COMPACT)) return 'compact';
  if (allMatch(DMY)) {
    if (dateOrder === 'dmy' || dateOrder === 'mdy') return dateOrder;
    const groups = samples.map((s) => match(DMY, s));
    const seps = new Set(groups.map((g) => g[2]));
    if (Math.max(...groups.map((g) => Number(g[1]))) > 12) return 'dmy';
    if (Math.max(...groups.map((g) => Number(g[3]))) > 12) return 'mdy';
    return seps.size === 1 && seps.has('/') ? 'mdy' : 'dmy';
  }
  throw new CsvError(`zaman biçimi tanınmadı: ${pyRepr(samples[0])}`);
}

/**
 * Parse timestamp strings. Returns { t, valid, fmt, offsets }: UTC epoch
 * seconds, a valid mask, the detected format and the UTC offsets; the
 * wall-clock time a row was written in is `t + offset`.
 */
export function parseTimes(values, tz = 'UTC', dateOrder = 'auto', fmt = null) {
  values = values.map((v) => stripQuotes(strip(v)));
  const sample = values.slice(0, 500).filter((v) => v).slice(0, 200);
  if (!sample.length) throw new CsvError('zaman sütunu boş');
  fmt = fmt || detectDateFormat(sample, dateOrder);
  const n = values.length;
  const t = new Float64Array(n), offsets = new Float64Array(n);
  const valid = new Uint8Array(n).fill(1);

  if (fmt.startsWith('unix')) {
    const scale = { unix_s: 1, unix_ms: 1000, unix_us: 1_000_000 }[fmt];
    values.forEach((v, i) => {
      const x = pyFloat(v);
      if (x === null || Number.isNaN(x)) valid[i] = 0;
      // the server fails (an OverflowError, not a CsvError) on infinite or past-int64 times
      else if (!Number.isFinite(x)) throw new Error('cannot convert float infinity to integer');
      else {
        t[i] = Math.floor(Math.trunc(x) / scale);
        if (t[i] >= 2 ** 63 || t[i] < -(2 ** 63)) throw new Error('Python int too large to convert to C long');
      }
    });
    return { t, valid, fmt, offsets };
  }

  const rx = { iso: ISO, ymd: YMD, compact: COMPACT, dmy: DMY, mdy: DMY }[fmt];
  const explicit = new Uint8Array(n);
  const offsetFor = (() => { let f; return (local) => (f ||= tzOffsetFn(tz))(local); })();
  for (let i = 0; i < n; i++) {
    const m = match(rx, values[i]);
    if (!m) { valid[i] = 0; continue; }
    let y, mon, day, hh, mm, ss;
    if (fmt === 'dmy' || fmt === 'mdy') {
      const [, a, , b, yy, h, mi, s] = m;
      [day, mon] = fmt === 'dmy' ? [a, b] : [b, a];
      [y, hh, mm, ss] = [yy, h, mi, s];
    } else {
      [, y, mon, day, hh, mm, ss] = m;
      if (fmt === 'iso' && m[7]) {
        let z = m[7];
        let off = 0;
        if (z !== 'Z') {
          z = z.replace(':', '');
          off = (z[0] === '+' ? 1 : -1) * (Number(z.slice(1, 3)) * HOUR + Number(z.slice(3, 5)) * MINUTE);
        }
        offsets[i] = off;
        explicit[i] = 1;
      }
    }
    [y, mon, day, hh, mm, ss] = [y, mon, day, hh, mm, ss].map((x) => Number(x || 0));
    if (mon < 1 || mon > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 60) {
      valid[i] = 0;
      continue;
    }
    const local = daysFromCivil(y, mon, day) * DAY + hh * HOUR + mm * MINUTE + ss;
    // the zone is looked up only when some row has no explicit offset
    if (!explicit[i]) offsets[i] = offsetFor(local);
    t[i] = local - offsets[i];
  }
  return { t, valid, fmt, offsets };
}

// ── table layout ────────────────────────────────────────────────────────────
const START_RECORD = 0, START_FIELD = 1, IN_FIELD = 2, IN_QUOTED = 3, QUOTE_IN_QUOTED = 4, EAT_CRNL = 5;

/** Python's csv.reader (excel dialect, `delim`) over an iterable of lines. */
function readCsv(lines, delim) {
  const rows = [];
  let fields = [], field = '', state = START_RECORD;
  const save = () => { fields.push(field); field = ''; };
  for (const line of lines) {
    for (let k = 0; k <= line.length; k++) {
      const c = k < line.length ? line[k] : null;   // null: end of the line
      const crnl = c === '\n' || c === '\r';
      switch (state) {
        case START_RECORD:
          if (c === null) break;                     // empty line: []
          if (crnl) { state = EAT_CRNL; break; }
          state = START_FIELD;
          // falls through
        case START_FIELD:
          if (crnl || c === null) { save(); state = c === null ? START_RECORD : EAT_CRNL; }
          else if (c === '"') state = IN_QUOTED;
          else if (c === delim) save();
          else { field += c; state = IN_FIELD; }
          break;
        case IN_FIELD:
          if (crnl || c === null) { save(); state = c === null ? START_RECORD : EAT_CRNL; }
          else if (c === delim) { save(); state = START_FIELD; }
          else field += c;
          break;
        case IN_QUOTED:
          if (c === '"') state = QUOTE_IN_QUOTED;
          else if (c !== null) field += c;
          break;
        case QUOTE_IN_QUOTED:
          if (c === '"') { field += c; state = IN_QUOTED; }
          else if (c === delim) { save(); state = START_FIELD; }
          else if (crnl || c === null) { save(); state = c === null ? START_RECORD : EAT_CRNL; }
          else { field += c; state = IN_FIELD; }
          break;
        case EAT_CRNL:
          if (c === null) state = START_RECORD;
          break;
      }
    }
    if (state === START_RECORD) { rows.push(fields); fields = []; }
  }
  if (field.length || state === IN_QUOTED) { save(); rows.push(fields); }
  return rows;
}

/** Iteration order of a CPython set of small non-negative ints built from
 *  `values` - max() over a set breaks ties by it. */
function pySetOrder(values) {
  let table = new Array(8).fill(null), fill = 0;
  const place = (tbl, x, dedupe) => {
    const mask = tbl.length - 1;
    let i = x & mask, perturb = x;
    for (;;) {
      const probes = i + 9 <= mask ? 9 : 0;
      for (let j = i; j <= i + probes; j++) {
        if (tbl[j] === null) { tbl[j] = x; return true; }
        if (dedupe && tbl[j] === x) return false;
      }
      perturb = Math.floor(perturb / 32);
      i = (i * 5 + 1 + perturb) & mask;
    }
  };
  for (const x of values) {
    if (!place(table, x, true)) continue;
    fill++;
    if (fill * 5 < (table.length - 1) * 3) continue;
    let size = 8;
    while (size <= fill * 4) size *= 2;
    const old = table;
    table = new Array(size).fill(null);
    for (const y of old) if (y !== null) place(table, y, false);
  }
  return table.filter((x) => x !== null);
}

function sniffDelimiter(sampleLines) {
  let best = ',', bestScore = -1;
  for (const delim of ['\t', ';', ',', '|']) {
    const counts = readCsv(sampleLines, delim).filter((r) => r.length).map((r) => r.length);
    if (!counts.length) continue;
    const freq = new Map();
    for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
    let common = null;
    for (const c of pySetOrder(counts)) if (common === null || freq.get(c) > freq.get(common)) common = c;
    if (common < 5) continue;
    const score = freq.get(common) / counts.length + common / 100;
    if (score > bestScore) { best = delim; bestScore = score; }
  }
  if (bestScore < 0) {
    throw new CsvError('ayraç bulunamadı: en az 5 sütun (zaman, açılış, yüksek, düşük, kapanış) gerekli');
  }
  return best;
}

function looksLikeHeader(row) {
  const letters = row.filter((f) => /[A-Za-zÇĞİÖŞÜçğıöşü<>]/.test(f)
    && !match(ISO, strip(f)) && !match(DMY, strip(f))).length;
  return letters >= 2;
}

function mapHeader(header) {
  const names = header.map(norm);
  const roles = {};
  const volumes = [];
  names.forEach((n, i) => {
    if (n === 'adj close' || n === 'adj_close' || n === 'adjclose') return;
    for (const role of ['open', 'high', 'low', 'close']) {
      if (ROLE_NAMES[role].has(n) && !(role in roles)) roles[role] = i;
    }
    if (ROLE_NAMES.volume.has(n)) volumes.push(i);
  });
  const dateCols = [], timeCols = [];
  names.forEach((n, i) => {
    if (ROLE_NAMES.time.has(n) && n !== 'time') dateCols.push(i);
    if (ROLE_NAMES.clock.has(n)) timeCols.push(i);
  });
  if (dateCols.length && timeCols.length && timeCols[0] !== dateCols[0]) {
    roles.time = dateCols[0];
    roles.clock = timeCols[0];
  } else if (dateCols.length) roles.time = dateCols[0];
  else if (timeCols.length) roles.time = timeCols[0];
  const missing = ['time', 'open', 'high', 'low', 'close'].filter((r) => !(r in roles));
  if (missing.length) {
    throw new CsvError(`başlıkta eksik sütun(lar): ${missing.join(', ')} (bulunan: ${header.join(', ')})`);
  }
  roles.volumes = volumes;
  return roles;
}

/** Column roles for a header-less file from its first data row. */
function inferPositional(row) {
  const first = stripQuotes(strip(row[0]));
  const second = row.length > 1 ? stripQuotes(strip(row[1])) : '';
  let roles, start;
  if (match(CLOCK, second) || (/^\d{6}$/.test(second) && match(COMPACT, first))) {
    roles = { time: 0, clock: 1, open: 2, high: 3, low: 4, close: 5 };
    start = 6;
  } else {
    roles = { time: 0, open: 1, high: 2, low: 3, close: 4 };
    start = 5;
  }
  roles.volumes = row.length > start ? [start] : [];
  return roles;
}

/**
 * Parse an OHLC CSV export. Returns { candles, rows, skipped, repaired,
 * spacing, decimals, detected } like server/csv_import.ParsedCsv; throws a
 * CsvError (status 422) with the server's message where it would.
 */
export function parseCsv(text, { tz = 'UTC', dateOrder = 'auto' } = {}) {
  text = text.replace(/^\ufeff+/, '');
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).filter((ln) => strip(ln));
  if (lines.length < 2) throw new CsvError('dosyada yeterli satır yok');
  const delim = sniffDelimiter(lines.slice(0, 50));
  let rows = readCsv(lines.map((ln, i) => (i < lines.length - 1 ? ln + '\n' : ln)), delim);
  let header = null, roles;
  if (looksLikeHeader(rows[0])) {
    header = rows[0];
    rows = rows.slice(1);
    roles = mapHeader(header);
  } else {
    roles = inferPositional(rows[0]);
  }
  const width = Math.max(...['time', 'open', 'high', 'low', 'close'].map((r) => roles[r])) + 1;
  rows = rows.filter((r) => r.length >= width);
  if (!rows.length) throw new CsvError('veri satırı bulunamadı');

  let tvals;
  if ('clock' in roles) {
    // the clock column is not counted in `width`: a short row fails the server
    if (rows.some((r) => roles.clock >= r.length)) throw new Error('list index out of range');
    tvals = rows.map((r) => `${strip(r[roles.time])} ${strip(r[roles.clock])}`
      // HistData-style "20240102 000000"
      .replace(/^(\d{8}) (\d{2})(\d{2})(\d{2})$/, '$1 $2:$3:$4')
      .replace(/^(\d{4})(\d{2})(\d{2}) /, '$1-$2-$3 '));
  } else {
    tvals = rows.map((r) => r[roles.time]);
  }
  const { t, valid, fmt, offsets } = parseTimes(tvals, tz, dateOrder);

  const priceSamples = rows.slice(0, 300).flatMap((r) => ['open', 'high', 'low', 'close'].map((k) => r[roles[k]]));
  const style = numberStyle(priceSamples);
  const decimals = Math.max(2, decimalsOf(priceSamples, style));
  const n = rows.length;
  const cols = { o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  rows.forEach((r, i) => {
    for (const [k, role] of [['o', 'open'], ['h', 'high'], ['l', 'low'], ['c', 'close']]) {
      const x = parseNumber(r[roles[role]], style);
      if (x === null) { valid[i] = 0; return; }
      cols[k][i] = x;
    }
    let best = null;
    for (const vi of roles.volumes) {
      const x = vi < r.length ? parseNumber(r[vi], style) : null;
      if (x !== null && x === x && (best === null || x > best)) best = x;
    }
    cols.v[i] = best !== null && Number.isFinite(best) ? best : 0;
  });
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (valid[i] && !['o', 'h', 'l', 'c'].every((k) => Number.isFinite(cols[k][i]))) valid[i] = 0;
    m += valid[i];
  }
  if (!m) throw new CsvError('hiçbir satır okunamadı');

  const keep = [];
  for (let i = 0; i < n; i++) if (valid[i]) keep.push(i);
  let arr = {
    t: Float64Array.from(keep, (i) => t[i]),
    o: Float64Array.from(keep, (i) => cols.o[i]),
    h: Float64Array.from(keep, (i) => cols.h[i]),
    l: Float64Array.from(keep, (i) => cols.l[i]),
    c: Float64Array.from(keep, (i) => cols.c[i]),
    v: Float64Array.from(keep, (i) => cols.v[i]),
  };
  // A file whose high/low columns are swapped or misnamed must not import
  // silently: more than a few inconsistent rows means the layout is wrong.
  let inconsistent = 0;
  for (let i = 0; i < m; i++) {
    const hiBad = arr.h[i] < Math.max(arr.o[i], arr.c[i]) - 1e-12;
    const loBad = arr.l[i] > Math.min(arr.o[i], arr.c[i]) + 1e-12;
    if (hiBad || loBad) inconsistent++;
  }
  if (inconsistent > Math.max(5, 0.02 * m)) {
    throw new CsvError(`${inconsistent} satırda yüksek/düşük, açılış/kapanışı kapsamıyor - `
      + 'sütun sırası yanlış olabilir (beklenen: zaman, açılış, yüksek, düşük, kapanış)');
  }
  const repaired = repairOhlc(arr);
  const spacing = detectSpacing(normalize(arr).t);
  if (spacing >= DAY) {
    // Daily and slower bars are dates, not instants: keep the date the row
    // was written with, at 00:00 UTC, whatever timezone the file used.
    keep.forEach((i, k) => { arr.t[k] = Math.floor((t[i] + offsets[i]) / DAY) * DAY; });
  }
  arr = normalize(arr);
  return {
    candles: arr, rows: n, skipped: n - m, repaired, spacing, decimals,
    detected: {
      delimiter: delim, header: header !== null, time_format: fmt, number_style: style,
      columns: header || null,
    },
  };
}

// ── candles (server/bars.py) ────────────────────────────────────────────────
const FIELDS = ['t', 'o', 'h', 'l', 'c', 'v'];

export function emptyCandles(n = 0) {
  return Object.fromEntries(FIELDS.map((k) => [k, new Float64Array(n)]));
}

/** Sort by time and drop duplicate times, keeping the LAST occurrence.
 *  Returns new columns. */
export function normalize(arr) {
  const n = arr.t.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => arr.t[a] - arr.t[b]);   // stable
  const kept = order.filter((i, k) => k === n - 1 || arr.t[order[k + 1]] !== arr.t[i]);
  const out = emptyCandles(kept.length);
  for (const k of FIELDS) kept.forEach((i, j) => { out[k][j] = arr[k][i]; });
  return out;
}

export function merge(old, nu) {
  const out = emptyCandles(old.t.length + nu.t.length);
  for (const k of FIELDS) { out[k].set(old[k]); out[k].set(nu[k], old.t.length); }
  return normalize(out);
}

/** Widen high/low so they contain open and close (in place). Returns rows touched. */
export function repairOhlc(arr) {
  let bad = 0;
  for (let i = 0; i < arr.t.length; i++) {
    const hi = Math.max(arr.h[i], arr.o[i], arr.c[i]);
    const lo = Math.min(arr.l[i], arr.o[i], arr.c[i]);
    if (hi !== arr.h[i] || lo !== arr.l[i]) bad++;
    arr.h[i] = hi;
    arr.l[i] = lo;
  }
  return bad;
}

/** Most common positive gap between bars, in seconds (the smallest on a tie). */
export function detectSpacing(t) {
  const n = Math.min(t.length, 200_000);
  const counts = new Map();
  for (let i = 1; i < n; i++) {
    const d = t[i] - t[i - 1];
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0, bestCount = 0;
  for (const [d, k] of counts) if (k > bestCount || (k === bestCount && d < best)) { best = d; bestCount = k; }
  return best;
}

/** numpy's pairwise sum of a[i, i + n), as np.add.reduceat adds a bucket. */
function pairwiseSum(a, i, n) {
  if (n < 8) {
    let res = 0;
    for (let k = 0; k < n; k++) res += a[i + k];
    return res;
  }
  if (n <= 128) {
    const r = Array.from({ length: 8 }, (_, j) => a[i + j]);
    let k = 8;
    for (; k < n - (n % 8); k += 8) for (let j = 0; j < 8; j++) r[j] += a[i + k + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; k < n; k++) res += a[i + k];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, i, n2) + pairwiseSum(a, i + n2, n - n2);
}

/** Roll base bars up into `tf` bars labelled by bucket. */
export function aggregate(arr, tf, align) {
  const n = arr.t.length;
  const labels = Float64Array.from(arr.t, (t) => bucket(t, tf, align));
  const starts = [];
  for (let i = 0; i < n; i++) if (i === 0 || labels[i] !== labels[i - 1]) starts.push(i);
  const out = emptyCandles(starts.length);
  starts.forEach((s, g) => {
    const e = g + 1 < starts.length ? starts[g + 1] : n;
    out.t[g] = labels[s];
    out.o[g] = arr.o[s];
    out.c[g] = arr.c[e - 1];
    let h = arr.h[s], l = arr.l[s];
    for (let i = s + 1; i < e; i++) { h = Math.max(h, arr.h[i]); l = Math.min(l, arr.l[i]); }
    out.h[g] = h;
    out.l[g] = l;
    // reduceat starts from the first value and adds the rest pairwise
    out.v[g] = e - s > 1 ? arr.v[s] + pairwiseSum(arr.v, s + 1, e - s - 1) : arr.v[s];
  });
  return out;
}

/** Best timeframe for a detected bar spacing (timeframes.tf_from_seconds). */
export function tfFromSeconds(seconds) {
  if (seconds < DAY) {
    if (seconds % HOUR === 0) return parseTf(`${seconds / HOUR}h`);
    if (seconds % MINUTE === 0) return parseTf(`${seconds / MINUTE}m`);
    throw new Error(`bar spacing of ${seconds}s is not a whole minute`);
  }
  if (seconds < WEEK) return parseTf('1D');
  if (seconds < 28 * DAY) return parseTf('1W');
  return parseTf('1M');
}
