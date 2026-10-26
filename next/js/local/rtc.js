// The compact candle format of server/candlestore.py, in the browser.
//
// A file is a 16-byte header ("RTC1", u16 version, u16 scale, 8 bytes pad)
// followed by 24-byte records: u32 time, four i32 prices in units of
// 10^-scale, f32 volume. Here records are held as columns (typed arrays).

export const MAGIC = 'RTC1';
export const HEADER_SIZE = 16;
export const ROW = 24;
export const FORMAT_VERSION = 1;
const UNIT_MAX = 2 ** 31 - 1;
const HEADROOM = 8;

/** Empty columns of `n` rows. */
export function emptyCols(n = 0) {
  return { t: new Uint32Array(n), o: new Int32Array(n), h: new Int32Array(n), l: new Int32Array(n), c: new Int32Array(n), v: new Float32Array(n) };
}

/** Rows [i, j) of `cols`, sharing memory. */
export function sliceCols(cols, i, j) {
  return { t: cols.t.subarray(i, j), o: cols.o.subarray(i, j), h: cols.h.subarray(i, j), l: cols.l.subarray(i, j), c: cols.c.subarray(i, j), v: cols.v.subarray(i, j) };
}

export function concatCols(parts) {
  const n = parts.reduce((s, p) => s + p.t.length, 0);
  const out = emptyCols(n);
  let at = 0;
  for (const p of parts) {
    for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) out[k].set(p[k], at);
    at += p.t.length;
  }
  return out;
}

/** Header of an RTC1 file: { scale } (throws on another format). */
export function readHeader(buf) {
  const u8 = new Uint8Array(buf, 0, Math.min(HEADER_SIZE, buf.byteLength));
  if (u8.length < HEADER_SIZE) throw new Error('mum dosyası çok kısa');
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  const dv = new DataView(buf);
  const version = dv.getUint16(4, true);
  if (magic !== MAGIC || version !== FORMAT_VERSION) throw new Error('tanınmayan mum dosyası');
  return { scale: dv.getUint16(6, true) };
}

/** Records (no header) -> columns. */
export function recordsToCols(buf, offset = 0, length = buf.byteLength - offset) {
  const n = Math.floor(length / ROW);
  const dv = new DataView(buf, offset, n * ROW);
  const out = emptyCols(n);
  for (let i = 0, p = 0; i < n; i++, p += ROW) {
    out.t[i] = dv.getUint32(p, true);
    out.o[i] = dv.getInt32(p + 4, true);
    out.h[i] = dv.getInt32(p + 8, true);
    out.l[i] = dv.getInt32(p + 12, true);
    out.c[i] = dv.getInt32(p + 16, true);
    out.v[i] = dv.getFloat32(p + 20, true);
  }
  return out;
}

/** Columns -> records (no header), the server's fmt=bin body. */
export function colsToRecords(cols) {
  const n = cols.t.length;
  const buf = new ArrayBuffer(n * ROW);
  const dv = new DataView(buf);
  for (let i = 0, p = 0; i < n; i++, p += ROW) {
    dv.setUint32(p, cols.t[i], true);
    dv.setInt32(p + 4, cols.o[i], true);
    dv.setInt32(p + 8, cols.h[i], true);
    dv.setInt32(p + 12, cols.l[i], true);
    dv.setInt32(p + 16, cols.c[i], true);
    dv.setFloat32(p + 20, cols.v[i], true);
  }
  return buf;
}

/** A whole RTC1 file -> { scale, cols }. */
export function parseFile(buf) {
  const { scale } = readHeader(buf);
  return { scale, cols: recordsToCols(buf, HEADER_SIZE) };
}

export function fileBytes(cols, scale) {
  const body = new Uint8Array(colsToRecords(cols));
  const out = new Uint8Array(HEADER_SIZE + body.length);
  out.set([82, 84, 67, 49], 0); // "RTC1"
  const dv = new DataView(out.buffer);
  dv.setUint16(4, FORMAT_VERSION, true);
  dv.setUint16(6, scale, true);
  out.set(body, HEADER_SIZE);
  return out.buffer;
}

/** Largest scale <= decimals that leaves HEADROOM above `peak` (candlestore.choose_scale). */
export function chooseScale(peak, decimals) {
  peak = Math.max(Math.abs(Number(peak)), 1e-12);
  for (let s = Math.min(Math.max(decimals | 0, 0), 9); s >= 0; s--) {
    if (peak * 10 ** s * HEADROOM <= UNIT_MAX) return s;
  }
  if (peak <= UNIT_MAX) return 0;
  throw new Error('fiyatlar bu depolama biçimi için çok büyük');
}

/** Float candles {t,o,h,l,c,v: arrays} -> integer columns at `scale`. */
export function encode(candles, scale) {
  const n = candles.t.length;
  const out = emptyCols(n);
  const k = 10 ** scale;
  for (let i = 0; i < n; i++) {
    out.t[i] = candles.t[i];
    out.o[i] = Math.round(candles.o[i] * k);
    out.h[i] = Math.round(candles.h[i] * k);
    out.l[i] = Math.round(candles.l[i] * k);
    out.c[i] = Math.round(candles.c[i] * k);
    out.v[i] = candles.v[i];
  }
  return out;
}

const round = (x, d) => { const k = 10 ** d; return Math.round(x * k) / k; };

/** Integer columns -> the API's JSON columns (bars.to_columns), prices
 *  rounded to the instrument precision `decimals`. */
export function toJsonColumns(cols, scale, decimals) {
  const n = cols.t.length;
  const k = 10 ** scale;
  const t = new Array(n), o = new Array(n), h = new Array(n), l = new Array(n), c = new Array(n), v = new Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = cols.t[i];
    o[i] = round(cols.o[i] / k, decimals);
    h[i] = round(cols.h[i] / k, decimals);
    l[i] = round(cols.l[i] / k, decimals);
    c[i] = round(cols.c[i] / k, decimals);
    v[i] = round(cols.v[i], 4);
  }
  return { t, o, h, l, c, v };
}
