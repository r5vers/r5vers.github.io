// The trade journal: what an entry is, its R and its money, the market
// session it was taken in, the figures of a set of entries, and the quick
// line ("EURUSD long TP 2R A+ FVG") read into an entry.
//
// An entry: { id, account, symbol, side ('buy' | 'sell'), openAt, closeAt,
//   entry, sl, tp, exit, lots, outcome ('tp' | 'sl' | 'be' | 'manual'), r, pnl,
//   setup, grade ('A+' | 'A' | 'B' | 'C'), tf, tags [], mistakes [], emotion,
//   plan (true | false | null), note, links [], source { kind, ref }, created, updated }
// Times are unix seconds, `created` / `updated` milliseconds.
import { SESSION_SETS } from '../chart/sessions.js?v=ac0ce45574';
import { nyOffset } from './timeframes.js?v=ac0ce45574';

export const OUTCOMES = [
  { id: 'tp', label: 'TP', long: 'Hedefte kapandı' },
  { id: 'sl', label: 'SL', long: 'Stop oldu' },
  { id: 'be', label: 'BE', long: 'Başabaş' },
  { id: 'manual', label: 'Elle', long: 'Elle kapatıldı' },
];
export const OUTCOME_NAMES = Object.fromEntries(OUTCOMES.map((o) => [o.id, o.long]));
export const GRADES = ['A+', 'A', 'B', 'C'];
export const SESSIONS = [['ASIA', 'Asya'], ['LONDON', 'Londra'], ['NEW YORK', 'New York']];
export const SESSION_NAMES = Object.fromEntries(SESSIONS);
export const TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D'];
export const SIDE_NAMES = { buy: 'Alış', sell: 'Satış' };

/** A prop firm's numbers (FTMO's two-step 100K): balance, daily and overall loss limits, target. */
export const ACCOUNT_PRESETS = [
  { key: 'ftmo100', name: 'FTMO 100K', kind: 'prop', currency: 'USD', balance: 100000, risk: 500, daily: 5, maxLoss: 10, target: 10 },
  { key: 'ftmo50', name: 'FTMO 50K', kind: 'prop', currency: 'USD', balance: 50000, risk: 250, daily: 5, maxLoss: 10, target: 10 },
  { key: 'personal', name: 'Kişisel hesap', kind: 'personal', currency: 'USD', balance: 1000, risk: 10, daily: null, maxLoss: null, target: null },
  { key: 'replay', name: 'Replay', kind: 'replay', currency: 'USD', balance: 10000, risk: 100, daily: null, maxLoss: null, target: null },
];
export const ACCOUNT_KINDS = [['prop', 'Fon hesabı'], ['personal', 'Kişisel'], ['replay', 'Replay']];

export const DEFAULT_PREFS = {
  v: 1,
  rr: 2,                    // the reward of a TP in R when the prices are not given
  unit: 'r',                // the figures in R ('r') or in money ('money')
  accounts: [],
  account: null,            // the account a new entry goes to
  symbols: ['EURUSD', 'XAUUSD', 'NAS100', 'GBPUSD'],
  setups: ['FVG', 'Order block', 'Likidite sweep', 'CHoCH dönüşü', 'BOS devamı', 'Breaker', 'OTE'],
  mistakes: ['Erken giriş', 'Geç giriş', 'Plan dışı', 'Stopu kaydırdım', 'Erken çıktım', 'Büyük lot', 'Haber saati', 'İntikam işlemi', 'Aşırı işlem'],
  emotions: ['Sakin', 'Odaklı', 'Sabırsız', 'FOMO', 'FOLOSS', 'Aşırı güven', 'Gergin', 'Yorgun'],
  tags: ['Kill zone', 'Trend yönünde', 'Trend karşıtı', 'Haber', 'Bot sinyali'],
  templates: [],
};

export function normalizePrefs(p) {
  const out = { ...structuredClone(DEFAULT_PREFS), ...(p || {}) };
  for (const k of ['accounts', 'symbols', 'setups', 'mistakes', 'emotions', 'tags', 'templates']) if (!Array.isArray(out[k])) out[k] = structuredClone(DEFAULT_PREFS[k]);
  if (!(out.rr > 0)) out.rr = DEFAULT_PREFS.rr;
  if (!['r', 'money'].includes(out.unit)) out.unit = 'r';
  if (out.account && !out.accounts.some((a) => a.id === out.account)) out.account = out.accounts[0]?.id || null;
  return out;
}

export const newId = (p = 'j') => `${p}${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

// ── R and money ─────────────────────────────────────────────────────────────
/** The trade's reward to risk as planned, from its prices. */
export function plannedRR(e) {
  if (!fin(e.entry) || !fin(e.sl) || !fin(e.tp)) return null;
  const risk = Math.abs(e.entry - e.sl);
  return risk > 0 ? Math.abs(e.tp - e.entry) / risk : null;
}

/** R from the prices: what the exit made against the distance to the stop. */
export function priceR(e) {
  if (!fin(e.entry) || !fin(e.sl) || !fin(e.exit)) return null;
  const risk = Math.abs(e.entry - e.sl);
  if (!(risk > Math.abs(e.entry) * 1e-7)) return null;    // a stop at the entry: no R
  const dir = e.side === 'sell' ? -1 : 1;
  return ((e.exit - e.entry) * dir) / risk;
}

/** The R an entry would have from its outcome alone. */
export function outcomeR(outcome, e, rr = 2) {
  if (outcome === 'sl') return -1;
  if (outcome === 'be') return 0;
  if (outcome === 'tp') return plannedRR(e) ?? (fin(e.rr) && e.rr > 0 ? e.rr : rr);
  return null;
}

export const accountOf = (accounts, id) => accounts.find((a) => a.id === id) || null;

/** The entry's R: as written, else from its prices, its outcome or its money. */
export function rOf(e, prefs = DEFAULT_PREFS) {
  if (fin(e.r)) return e.r;
  const p = priceR(e);
  if (p != null) return p;
  const o = outcomeR(e.outcome, e, prefs.rr);
  if (o != null) return o;
  const acc = accountOf(prefs.accounts || [], e.account);
  if (fin(e.pnl) && acc?.risk > 0) return e.pnl / acc.risk;
  return null;
}

/** The entry's money: as written, else its R times the account's risk. */
export function moneyOf(e, prefs = DEFAULT_PREFS) {
  if (fin(e.pnl)) return e.pnl;
  const acc = accountOf(prefs.accounts || [], e.account);
  const r = rOf(e, prefs);
  return r != null && acc?.risk > 0 ? r * acc.risk : null;
}

export function currencyOf(e, prefs) { return accountOf(prefs.accounts || [], e.account)?.currency || 'USD'; }

// ── when ────────────────────────────────────────────────────────────────────
/** The market session at `t`, in New York time as the chart draws it. */
export function sessionOf(t) {
  if (!fin(t)) return null;
  const local = t + nyOffset(t);
  const min = Math.floor((((local % 86400) + 86400) % 86400) / 60);
  const z = SESSION_SETS[0].zones;
  const lon = z.find((x) => x.name === 'LONDON'), ny = z.find((x) => x.name === 'NEW YORK');
  if (min >= ny.from && min < ny.to) return 'NEW YORK';
  if (min >= lon.from && min < ny.from) return 'LONDON';
  return 'ASIA';
}

/** The session an entry was taken in: as written, else from its time. */
export const sessionOfEntry = (e) => e.session || sessionOf(e.openAt);

const dayFmts = new Map();
function partsIn(t, tz) {
  let f = dayFmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dayFmts.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  return o;
}
/** 'YYYY-MM-DD' of `t` in `tz`. */
export function dayKey(t, tz) { const p = partsIn(t, tz); return `${p.year}-${p.month}-${p.day}`; }
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Weekday (0 Sunday) and hour of `t` in `tz`. */
export function weekdayHour(t, tz) { const p = partsIn(t, tz); return { d: WD[p.weekday], hr: Number(p.hour) % 24 }; }
/** Noon UTC of a 'YYYY-MM-DD' day: a safe instant to name that day by. */
export const dayNoon = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12) / 1000;
export const timeOf = (e) => (fin(e.closeAt) ? e.closeAt : e.openAt);

// ── figures ─────────────────────────────────────────────────────────────────
/** Won, lost or even, by its R (else its money); BE as written is even. */
export function resultOf(e, prefs) {
  if (e.outcome === 'be') return 'be';
  const r = rOf(e, prefs);
  const v = r != null ? r : moneyOf(e, prefs);
  if (v == null) return null;
  if (Math.abs(v) < 1e-9) return 'be';
  return v > 0 ? 'win' : 'loss';
}

/** The value of an entry in the unit asked for (R or money); null if unknown. */
export const valueOf = (e, prefs, unit = prefs.unit) => (unit === 'money' ? moneyOf(e, prefs) : rOf(e, prefs));

/**
 * The figures of a set of entries in `unit` ('r' | 'money'): counts, rates,
 * the curve and its deepest fall, the runs. BE is out of the win rate.
 */
export function figures(list, prefs, unit = prefs.unit) {
  const rows = list.map((e) => ({ e, v: valueOf(e, prefs, unit), res: resultOf(e, prefs), t: timeOf(e) }))
    .filter((x) => x.res != null)
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const vals = rows.map((x) => x.v).filter(fin);
  const wins = rows.filter((x) => x.res === 'win'), losses = rows.filter((x) => x.res === 'loss'), bes = rows.filter((x) => x.res === 'be');
  const sum = (xs) => xs.reduce((s, x) => s + (fin(x.v) ? x.v : 0), 0);
  const gw = sum(wins), gl = -sum(losses);
  const decided = wins.length + losses.length;
  let eq = 0, peak = 0, dd = 0;
  const curve = [];
  for (const x of rows) {
    if (!fin(x.v)) continue;
    eq += x.v;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    curve.push({ t: x.t, v: eq, e: x.e });
  }
  // the longest and the current run of wins and of losses
  let best = 0, worst = 0, run = 0, runKind = null;
  for (const x of rows) {
    if (x.res === 'be') continue;
    if (x.res === runKind) run++; else { runKind = x.res; run = 1; }
    if (runKind === 'win') best = Math.max(best, run); else worst = Math.max(worst, run);
  }
  const holds = rows.map((x) => (fin(x.e.closeAt) && fin(x.e.openAt) ? x.e.closeAt - x.e.openAt : null)).filter((x) => x != null && x >= 0);
  return {
    n: rows.length, wins: wins.length, losses: losses.length, bes: bes.length,
    net: vals.reduce((s, v) => s + v, 0),
    winRate: decided ? wins.length / decided : null,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
    expectancy: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
    avgWin: wins.length ? gw / wins.length : null,
    avgLoss: losses.length ? -gl / losses.length : null,
    best: vals.length ? Math.max(...vals) : null,
    worst: vals.length ? Math.min(...vals) : null,
    maxDD: dd, curve,
    runWin: best, runLoss: worst, run: runKind ? { kind: runKind, n: run } : null,
    hold: holds.length ? holds.reduce((s, x) => s + x, 0) / holds.length : null,
  };
}

/** Entries grouped by `keyOf` (one key or several), each group with its figures. */
export function groupBy(list, keyOf, prefs, unit = prefs.unit) {
  const m = new Map();
  for (const e of list) {
    const ks = keyOf(e);
    for (const k of Array.isArray(ks) ? ks : [ks]) {
      if (k == null || k === '') continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
  }
  return [...m.entries()].map(([k, xs]) => ({ key: k, list: xs, f: figures(xs, prefs, unit) }));
}

// ── the quick line ──────────────────────────────────────────────────────────
export const fold = (s) => String(s || '').toLocaleLowerCase('tr-TR')
  .replace(/̇/g, '').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a');

const ALIASES = {
  eu: 'EURUSD', eur: 'EURUSD', fiber: 'EURUSD', gu: 'GBPUSD', gbp: 'GBPUSD', cable: 'GBPUSD', uj: 'USDJPY', jpy: 'USDJPY', uc: 'USDCAD', cad: 'USDCAD',
  au: 'AUDUSD', xau: 'XAUUSD', gold: 'XAUUSD', altin: 'XAUUSD', nq: 'NAS100', nas: 'NAS100', nasdaq: 'NAS100', us100: 'NAS100', ustec: 'NAS100',
  es: 'SPX500', spx: 'SPX500', sp500: 'SPX500', us500: 'SPX500', dj: 'US30', dow: 'US30', us30: 'US30', btc: 'BTCUSD', bitcoin: 'BTCUSD', dax: 'GER40', ger40: 'GER40',
};
/** A broker's name for a market as the site names it ("US100.cash" -> NAS100, "EURUSDm" -> EURUSD). */
export function normalizeSymbol(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/^[A-Z]+:/, '');                       // "FX:EURUSD", "OANDA:XAUUSD"
  s = s.split(/[.\s_#]/)[0] || s;                     // ".cash", ".r", ".pro", "_i"
  const INDEX = { US100: 'NAS100', USTEC: 'NAS100', NDX: 'NAS100', NQ: 'NAS100', NAS100: 'NAS100', USATECHIDXUSD: 'NAS100', US500: 'SPX500', SP500: 'SPX500', SPX: 'SPX500', SPX500: 'SPX500', USA500IDXUSD: 'SPX500', US30: 'US30', DJ30: 'US30', DJI: 'US30', GER40: 'GER40', DE40: 'GER40', DAX40: 'GER40', GOLD: 'XAUUSD', SILVER: 'XAGUSD' };
  if (INDEX[s]) return INDEX[s];
  const pair = /^([A-Z]{3})([A-Z]{3})/.exec(s);
  if (pair && CCY.has(pair[1]) && CCY.has(pair[2])) return pair[1] + pair[2];
  return s;
}

const CCY = new Set(['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU', 'XAG', 'TRY', 'SEK', 'NOK', 'ZAR', 'MXN', 'SGD', 'HKD', 'PLN', 'CNH', 'DKK', 'BTC', 'ETH']);
const SESSION_WORDS = { asya: 'ASIA', asia: 'ASIA', londra: 'LONDON', london: 'LONDON', ldn: 'LONDON', ny: 'NEW YORK', newyork: 'NEW YORK', nyam: 'NEW YORK', nypm: 'NEW YORK' };
const SIDES = { long: 'buy', buy: 'buy', al: 'buy', alis: 'buy', alim: 'buy', short: 'sell', sell: 'sell', sat: 'sell', satis: 'sell' };
const RESULTS = { tp: 'tp', hedef: 'tp', win: 'tp', kazanc: 'tp', sl: 'sl', stop: 'sl', loss: 'sl', zarar: 'sl', be: 'be', basabas: 'be', breakeven: 'be', manuel: 'manual', elle: 'manual' };
const num = (s) => Number(String(s).replace(',', '.'));

/**
 * Read a line such as "EURUSD long TP 2R A+ FVG londra 6★" into fields.
 * Words it does not know are left as the note. `known` lists the symbols
 * the site knows (packs and those used before).
 */
export function parseQuick(text, prefs, known = []) {
  const out = { tags: [], mistakes: [] };
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const folded = words.map((w) => fold(w).replace(/[.,;:!?]+$/, ''));
  const used = words.map(() => false);
  // names of one or more words first (setups, mistakes, feelings, tags), longest first
  const take = (names, put) => {
    for (const n of [...names].sort((a, b) => b.length - a.length)) {
      const parts = fold(n).split(/\s+/).filter(Boolean);
      if (!parts.length || (parts.length === 1 && parts[0].length < 2)) continue;
      for (let i = 0; i + parts.length <= words.length; i++) {
        if (parts.every((x, k) => !used[i + k] && folded[i + k] === x)) {
          for (let k = 0; k < parts.length; k++) used[i + k] = true;
          put(n);
          break;
        }
      }
    }
  };
  take(prefs.setups || [], (n) => { if (!out.setup) out.setup = n; });
  take(prefs.mistakes || [], (n) => out.mistakes.push(n));
  take(prefs.emotions || [], (n) => { if (!out.emotion) out.emotion = n; });
  take(prefs.tags || [], (n) => out.tags.push(n));
  take(['plan dışı', 'plansız'], () => { out.plan = false; });
  take(['plana uydum', 'planlı'], () => { if (out.plan == null) out.plan = true; });
  if (out.mistakes.some((m) => fold(m) === 'plan disi')) out.plan = false;
  const syms = new Set([...(prefs.symbols || []), ...known].map((s) => String(s).toUpperCase()));
  const rest = [];
  words.forEach((w, i) => {
    if (used[i]) return;
    const f = folded[i];
    if (!f) return;
    const up = w.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let m;
    if (!out.symbol && (syms.has(up) || ALIASES[f])) { out.symbol = syms.has(up) ? up : ALIASES[f]; return; }
    if (!out.symbol && /^[a-z]{6}$/i.test(w) && CCY.has(up.slice(0, 3)) && CCY.has(up.slice(3))) { out.symbol = up; return; }
    if (!out.session && SESSION_WORDS[f]) { out.session = SESSION_WORDS[f]; return; }
    if (!out.side && SIDES[f]) { out.side = SIDES[f]; return; }
    if (!out.outcome && RESULTS[f]) { out.outcome = RESULTS[f]; return; }
    if ((m = /^([+\-−]?\d+(?:[.,]\d+)?)r$/.exec(f))) { out.r = num(m[1].replace('−', '-')); return; }
    if ((m = /^1[:/](\d+(?:[.,]\d+)?)$/.exec(f))) { out.rr = num(m[1]); return; }
    if ((m = /^([+\-−]?)\$(\d+(?:[.,]\d+)?)$/.exec(f)) || (m = /^([+\-−]?)(\d+(?:[.,]\d+)?)\$$/.exec(f))) { out.pnl = num(m[2]) * (m[1] && m[1] !== '+' ? -1 : 1); return; }
    if (/^a\+{1,2}$/.test(f)) { out.grade = 'A+'; return; }
    if (/^[ABC]$/.test(w)) { out.grade = w; return; }
    if ((m = /^(\d)(★|\*|yildiz)$/.exec(f))) { const s = +m[1]; out.grade = s >= 6 ? 'A+' : s === 5 ? 'A' : s === 4 ? 'B' : 'C'; out.stars = s; return; }
    if (!out.tf && /^(1|3|5|15|30)m$|^(1|4)h$|^1d$/.test(f)) { out.tf = f.endsWith('d') ? '1D' : f; return; }
    rest.push(w);
  });
  // a result with no outcome word: R's sign, else the money's, tells it
  if (!out.outcome && fin(out.r)) out.outcome = out.r > 0 ? 'tp' : out.r < 0 ? 'sl' : 'be';
  if (!out.outcome && fin(out.pnl)) out.outcome = out.pnl > 0 ? 'tp' : out.pnl < 0 ? 'sl' : 'be';
  out.note = rest.join(' ');
  if (!out.tags.length) delete out.tags;
  if (!out.mistakes.length) delete out.mistakes;
  return out;
}

// ── chart pictures ──────────────────────────────────────────────────────────
/** The picture behind a link: TradingView's snapshot pages are images on its CDN. */
export function imageOf(url) {
  const s = String(url || '').trim();
  let m = /^https?:\/\/(?:[a-z]{2,3}\.)?tradingview\.com\/x\/([A-Za-z0-9]+)\/?/i.exec(s);
  if (m) return `https://s3.tradingview.com/snapshots/${m[1][0].toLowerCase()}/${m[1]}.png`;
  m = /^https?:\/\/s3\.tradingview\.com\/snapshots\/.+\.png/i.exec(s);
  if (m) return s;
  if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(s)) return s;
  if (/^https?:\/\/i\.imgur\.com\/\w+$/i.test(s)) return `${s}.png`;
  return null;
}
export const isLink = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
