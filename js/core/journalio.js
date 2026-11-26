// Trade histories into journal entries, and the journal out again.
//
// In: MetaTrader 4/5 reports (History -> Report, HTML or Excel), CSV files
// with a header row (FTMO MetriX's Trading Journal export, cTrader, the
// site's own CSV), the site's backup (JSON). Out: CSV for a spreadsheet and
// the backup.
//
// A report's times are the wall clock of where it was made; `zone` says
// whose: 'server' (MetaTrader servers, FTMO's among them: New York time plus
// seven hours, GMT+2 in winter and GMT+3 in summer), 'UTC' or a time zone.
import { nyOffset } from './timeframes.js?v=fb1de5ff64';
import { tzOffset } from '../format.js?v=fb1de5ff64';
import { normalizeSymbol } from './journal.js?v=fb1de5ff64';

// ── files ───────────────────────────────────────────────────────────────────
/** A file's text, whatever its encoding (MetaTrader writes its HTML in UTF-16). */
export function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  // UTF-16 without its mark: every other byte of plain text is zero
  let zeros = 0;
  for (let i = 1; i < Math.min(u8.length, 400); i += 2) if (u8[i] === 0) zeros++;
  if (u8.length > 40 && zeros > Math.min(u8.length, 400) / 2 * 0.6) return new TextDecoder('utf-16le').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}

/** What a file is: 'json' | 'html' | 'xlsx' | 'csv'. */
export function kindOf(name, buf) {
  const u8 = new Uint8Array(buf.slice(0, 4));
  if (u8[0] === 0x50 && u8[1] === 0x4b) return 'xlsx';           // a zip (Excel)
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.json')) return 'json';
  if (/\.html?$/.test(n)) return 'html';
  const head = decodeText(buf.slice(0, 2000)).trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('{')) return 'json';
  if (head.startsWith('<') || head.includes('<html') || head.includes('<table')) return 'html';
  return 'csv';
}

// ── tables ──────────────────────────────────────────────────────────────────
/** The rows of every table of an HTML page, as arrays of cell texts. A row
 *  with one cell across the table (a section's title) is { title }. */
export function htmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const out = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.cells];
    const shown = cells.filter((c) => !/\bhidden\b/.test(c.className) && c.style.display !== 'none');
    const texts = shown.map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    const filled = texts.filter(Boolean);
    if (!filled.length) continue;
    if (filled.length === 1 && (cells.length === 1 || cells.some((c) => c.colSpan >= 4) || tr.querySelector('th'))) out.push({ title: filled[0] });
    else out.push(texts);
  }
  return out;
}

/** The rows of the first sheet of an Excel file (fflate unzips it). */
export async function xlsxRows(buf) {
  const { unzipSync, strFromU8 } = await import('../../vendor/fflate.js?v=fb1de5ff64');
  const files = unzipSync(new Uint8Array(buf));
  const read = (name) => (files[name] ? strFromU8(files[name]) : null);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [];
  const ss = read('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) return [];
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const out = [];
  for (const row of xml(read(sheetName)).getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const i = c.getAttribute('r') ? col(c.getAttribute('r')) : cells.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text = v;
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      cells[i] = String(text).trim();
    }
    const texts = Array.from(cells, (x) => x ?? '');
    const filled = texts.filter(Boolean);
    if (!filled.length) continue;
    out.push(filled.length === 1 && texts.length <= 2 ? { title: filled[0] } : texts);
  }
  return out;
}

/** CSV (comma, semicolon or tab; quoted fields) into rows. */
export function csvRows(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

// ── values ──────────────────────────────────────────────────────────────────
/** A number as reports write it: "1 234.56", "1.234,56", "(12.50)", "−3", "$40". */
export function parseNum(s) {
  if (s == null) return null;
  let t = String(s).replace(/[\s   $€£₺%]/g, '').replace('−', '-');
  if (!t || t === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.includes('.') && t.includes(',')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = /,\d{3}$/.test(t) && !/^-?0,/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const pad = (n) => String(n).padStart(2, '0');
/**
 * A date as reports write it, as its wall clock { y, mo, d, h, mi, s } or, with
 * a zone of its own ("...Z", "+03:00"), as unix seconds { t }.
 */
export function parseDate(s) {
  const v = String(s ?? '').trim();
  if (!v) return null;
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(v);
  if (m) {
    const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    if (m[7]) {
      const z = m[7].toUpperCase() === 'Z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(-2))) * 60;
      return { t: Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) / 1000 - z };
    }
    return w;
  }
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(v);
  if (m) {
    let a = +m[1], b = +m[2];
    // day first unless the first can only be a month and the second a day
    if (a <= 12 && b > 12 && v.includes('/')) [a, b] = [b, a];
    let hh = +(m[4] || 0);
    if (m[7]) hh = (hh % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return { y: +m[3], mo: b, d: a, h: hh, mi: +(m[5] || 0), s: +(m[6] || 0) };
  }
  // an Excel serial date
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const t = Math.round((n - 25569) * 86400);
    const d = new Date(t * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  return null;
}

/** A wall clock in `zone` as unix seconds. */
export function wallToUnix(w, zone = 'server') {
  if (!w) return null;
  if (w.t != null) return w.t;
  const naive = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s || 0) / 1000;
  if (!Number.isFinite(naive)) return null;
  if (zone === 'UTC') return naive;
  if (zone === 'server') {
    // the server's clock is New York's plus seven hours
    const guess = naive - 7 * 3600 - nyOffset(naive);
    return naive - 7 * 3600 - nyOffset(guess);
  }
  const guess = naive - tzOffset(naive, zone);
  return naive - tzOffset(guess, zone);
}
export const wallText = (w) => (w ? (w.t != null ? new Date(w.t * 1000).toISOString().slice(0, 16).replace('T', ' ') : `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`) : '—');

const sideOf = (s) => {
  const f = String(s || '').trim().toLowerCase();
  if (/^(buy|long|al|alış|alis|alım)\b/.test(f)) return 'buy';
  if (/^(sell|short|sat|satış|satis)\b/.test(f)) return 'sell';
  return null;
};
const isDate = (s) => { const d = parseDate(s); return !!d && /\d{1,2}:\d{2}/.test(String(s)); };

// ── MetaTrader reports: closed positions by the shape of their rows ─────────
// A closed position's row has two times (open, close), a buy or sell between
// them with the market, the volume, the open price and the stops, and after
// the close time its price, the costs and the profit (last). The section's
// title row (Positions / Pozisyonlar / Closed Transactions) keeps the
// orders and deals of the report out.
const POSITION_TITLES = /^(positions|pozisyonlar|closed transactions|kapanan işlemler|позиции|positionen|posiciones|posizioni|historique des positions)$/i;
const OTHER_TITLES = /^(orders|deals|emirler|işlemler|anlaşmalar|open positions|açık pozisyonlar|working orders|summary|results|özet|sonuçlar|ордера|сделки)$/i;

export function mtTrades(rows) {
  const name = (r) => String(r.title).replace(/[:：]\s*$/, '').trim();
  const titled = rows.some((r) => r.title && POSITION_TITLES.test(name(r)));
  let inPositions = !titled;
  const out = [];
  for (const r of rows) {
    if (r.title) {
      if (POSITION_TITLES.test(name(r))) inPositions = true;
      else if (OTHER_TITLES.test(name(r)) || titled) inPositions = false;
      continue;
    }
    if (!inPositions) continue;
    const dates = r.map((c, i) => (isDate(c) ? i : -1)).filter((i) => i >= 0);
    if (dates.length !== 2) continue;
    const [a, b] = dates;
    const sideAt = r.findIndex((c, i) => i > a && i < b && sideOf(c) && !/limit|stop/i.test(c));
    // MT4 puts the type first and the times around the rest; MT5 the time first
    const typeAt = sideAt >= 0 ? sideAt : r.findIndex((c) => sideOf(c) && !/limit|stop/i.test(c));
    if (typeAt < 0) continue;
    const side = sideOf(r[typeAt]);
    const between = r.slice(Math.min(a, typeAt) + 1, b).filter((_, k) => Math.min(a, typeAt) + 1 + k !== typeAt);
    const symbol = between.find((c) => /^[A-Za-z][A-Za-z0-9._#-]{2,}$/.test(c) && !sideOf(c));
    const nums = between.filter((c) => c !== symbol).map(parseNum).filter((x) => x != null);
    const after = r.slice(b + 1).map(parseNum).filter((x) => x != null);
    if (!symbol || nums.length < 2 || after.length < 2) continue;
    // the ticket, when it sits among them, is a whole number before the volume
    let k = 0;
    if (nums.length >= 3 && Number.isInteger(nums[0]) && nums[0] > 1000) k = 1;
    const lots = nums[k], entry = nums[k + 1];
    let sl = null, tp = null;
    for (const x of nums.slice(k + 2, k + 4)) {
      if (!(x > 0)) continue;
      const below = x < entry;
      if ((side === 'buy') === below) sl = x; else tp = x;
    }
    const exit = after[0];
    const profit = after[after.length - 1];
    const costs = after.slice(1, -1).reduce((s, x) => s + x, 0);   // commission, taxes, swap
    const ticket = r.find((c, i) => i !== a && i !== b && /^\d{5,}$/.test(c)) || null;
    out.push({ symbol: normalizeSymbol(symbol), side, lots, entry, exit, sl, tp, pnl: profit + costs, open: parseDate(r[a]), close: parseDate(r[b]), ticket });
  }
  return out;
}

// ── tables with a header row ────────────────────────────────────────────────
const HEADERS = {
  open: ['open', 'open time', 'opening time', 'open date', 'entry time', 'entry date', 'time', 'date', 'açılış', 'açılış zamanı', 'açılış tarihi', 'giriş zamanı', 'tarih', 'zaman', 'opened', 'created'],
  close: ['close', 'close time', 'closing time', 'close date', 'exit time', 'exit date', 'kapanış', 'kapanış zamanı', 'kapanış tarihi', 'çıkış zamanı', 'closed'],
  symbol: ['symbol', 'sembol', 'item', 'instrument', 'market', 'pair', 'enstrüman', 'parite', 'ticker'],
  side: ['type', 'side', 'direction', 'yön', 'tip', 'action', 'buy/sell', 'işlem tipi'],
  lots: ['volume', 'lots', 'lot', 'size', 'quantity', 'qty', 'hacim', 'miktar', 'amount'],
  entry: ['price', 'open price', 'entry price', 'entry', 'opening price', 'giriş', 'giriş fiyatı', 'açılış fiyatı'],
  exit: ['close price', 'exit price', 'exit', 'closing price', 'çıkış', 'çıkış fiyatı', 'kapanış fiyatı'],
  sl: ['sl', 's/l', 's / l', 'stop loss', 'stoploss', 'stop'],
  tp: ['tp', 't/p', 't / p', 'take profit', 'takeprofit', 'target', 'hedef'],
  pnl: ['profit', 'net profit', 'p/l', 'pnl', 'p&l', 'net p/l', 'profit/loss', 'kâr', 'kar', 'k/z', 'kâr/zarar', 'net', 'result', 'sonuç ($)'],
  commission: ['commission', 'commissions', 'komisyon', 'fee', 'fees'],
  swap: ['swap', 'swaps'],
  r: ['r', 'r multiple', 'r-multiple', 'rmultiple'],
  outcome: ['outcome', 'sonuç'],
  setup: ['setup', 'strategy', 'strateji', 'playbook'],
  grade: ['grade', 'kalite', 'rating'],
  note: ['note', 'notes', 'comment', 'comments', 'not', 'notlar', 'yorum'],
  tags: ['tags', 'etiketler'],
  mistakes: ['mistakes', 'hatalar'],
  emotion: ['emotion', 'duygu'],
  account: ['account', 'hesap'],
  tf: ['timeframe', 'zaman dilimi', 'tf'],
  session: ['session', 'seans'],
  plan: ['plan', 'plana uydu'],
  links: ['links', 'bağlantılar', 'chart', 'screenshot'],
  ticket: ['ticket', 'position', 'position id', 'pozisyon', 'deal', 'order', 'id'],
};
const normHead = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[()[\]]/g, '').trim();

/** The columns of a header row: { field: index }; a second "price" or "time" is the exit's. */
export function mapHeader(head) {
  const map = {};
  head.forEach((h0, i) => {
    const h = normHead(h0);
    if (!h) return;
    if (h === 'price' || h === 'fiyat') { if (map.entry == null) map.entry = i; else if (map.exit == null) map.exit = i; return; }
    if (h === 'time' || h === 'zaman') { if (map.open == null) map.open = i; else if (map.close == null) map.close = i; return; }
    for (const [field, names] of Object.entries(HEADERS)) {
      if (map[field] != null) continue;
      if (names.includes(h)) { map[field] = i; return; }
    }
  });
  return map;
}

function headerAt(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (r.title) continue;
    const map = mapHeader(r);
    if (map.symbol != null && map.open != null && (map.pnl != null || map.r != null || map.entry != null || map.outcome != null)) return { at: i, map };
  }
  return null;
}

const listOf = (s) => String(s || '').split(/[|;]/).map((x) => x.trim()).filter(Boolean);

/** Rows under a header row, as raw trades. */
export function headerTrades(rows) {
  const found = headerAt(rows);
  if (!found) return [];
  const { at, map } = found;
  const get = (r, f) => (map[f] != null ? r[map[f]] : undefined);
  const out = [];
  for (const r of rows.slice(at + 1)) {
    if (r.title) break;
    const symbol = normalizeSymbol(get(r, 'symbol'));
    const open = parseDate(get(r, 'open'));
    if (!symbol || !open) continue;
    let side = sideOf(get(r, 'side'));
    const lotsRaw = parseNum(get(r, 'lots'));
    if (!side && lotsRaw != null && map.side == null) side = lotsRaw < 0 ? 'sell' : 'buy';
    const pnl0 = parseNum(get(r, 'pnl'));
    const costs = (parseNum(get(r, 'commission')) || 0) + (parseNum(get(r, 'swap')) || 0);
    const outcomeRaw = String(get(r, 'outcome') || '').trim().toLowerCase();
    const outcome = { tp: 'tp', sl: 'sl', be: 'be', elle: 'manual', manual: 'manual', manuel: 'manual', 'hedefte kapandı': 'tp', 'stop oldu': 'sl', 'başabaş': 'be', 'elle kapatıldı': 'manual' }[outcomeRaw] || null;
    const plan = String(get(r, 'plan') || '').trim().toLowerCase();
    out.push({
      symbol, side: side || 'buy', lots: lotsRaw != null ? Math.abs(lotsRaw) : null,
      entry: parseNum(get(r, 'entry')), exit: parseNum(get(r, 'exit')), sl: parseNum(get(r, 'sl')), tp: parseNum(get(r, 'tp')),
      pnl: pnl0 != null ? pnl0 + (map.commission != null || map.swap != null ? costs : 0) : null,
      r: parseNum(get(r, 'r')), outcome,
      open, close: parseDate(get(r, 'close')),
      setup: get(r, 'setup') || null, grade: ['A+', 'A', 'B', 'C'].includes(String(get(r, 'grade') || '').trim().toUpperCase()) ? String(get(r, 'grade')).trim().toUpperCase() : null,
      note: get(r, 'note') || '', tags: listOf(get(r, 'tags')), mistakes: listOf(get(r, 'mistakes')), emotion: get(r, 'emotion') || null,
      tf: get(r, 'tf') || null, account: get(r, 'account') || null, links: listOf(get(r, 'links')),
      plan: ['evet', 'yes', 'true', '1'].includes(plan) ? true : ['hayır', 'hayir', 'no', 'false', '0'].includes(plan) ? false : null,
      ticket: get(r, 'ticket') || null,
    });
  }
  return out;
}

/** Raw trades of any table: a header row first, else MetaTrader's row shape. */
export function tradesOf(rows, prefer = 'header') {
  const a = prefer === 'mt' ? mtTrades(rows) : headerTrades(rows);
  if (a.length) return { trades: a, how: prefer };
  const b = prefer === 'mt' ? headerTrades(rows) : mtTrades(rows);
  return { trades: b, how: b.length ? (prefer === 'mt' ? 'header' : 'mt') : null };
}

// ── out ─────────────────────────────────────────────────────────────────────
const CSV_HEAD = ['Açılış zamanı', 'Kapanış zamanı', 'Hesap', 'Sembol', 'Yön', 'Sonuç', 'R', 'K/Z', 'Giriş', 'Stop', 'Hedef', 'Çıkış', 'Lot', 'Setup', 'Kalite', 'Seans', 'Zaman dilimi', 'Etiketler', 'Hatalar', 'Duygu', 'Plan', 'Not', 'Bağlantılar'];
/** The entries as CSV (UTC times, ISO), read back by headerTrades. */
export function toCsv(entries, { accountName, rOf, moneyOf, sessionName }) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t == null ? '' : new Date(t * 1000).toISOString().slice(0, 19) + 'Z');
  const n = (x, d = 2) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(d));
  const lines = entries.map((e) => [
    iso(e.openAt), iso(e.closeAt), q(accountName(e.account)), e.symbol, e.side === 'sell' ? 'sell' : 'buy', e.outcome || '',
    n(rOf(e)), n(moneyOf(e)), e.entry ?? '', e.sl ?? '', e.tp ?? '', e.exit ?? '', e.lots ?? '', q(e.setup), e.grade || '', q(sessionName(e)), e.tf || '',
    q((e.tags || []).join(' | ')), q((e.mistakes || []).join(' | ')), q(e.emotion), e.plan == null ? '' : e.plan ? 'evet' : 'hayır', q(e.note), q((e.links || []).join(' | ')),
  ].join(','));
  return [CSV_HEAD.join(','), ...lines].join('\n');
}
