// Live charts on the device: the latest candles straight from the provider,
// the forming one included (server/live.py, in the browser). OANDA answers
// pages on r5vers.github.io directly (it allows them: CORS), with the
// group's key; Binance needs none. Nothing here is stored.
import { bucket, parseTf } from '../core/timeframes.js?v=279ddf48f5';
import { defaults } from './instruments.js?v=279ddf48f5';

export const OANDA_SERVERS = { practice: 'https://api-fxpractice.oanda.com', live: 'https://api-fxtrade.oanda.com' };
const GRANULARITY = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '2h': 'H2', '4h': 'H4', '1D': 'D', '1W': 'W', '1M': 'M' };
const PRICE = { bid: 'B', mid: 'M', ask: 'A' };
const BINANCE = 'https://api.binance.com';
const INTERVAL = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };
const MAX_COUNT = { oanda: 5000, binance: 1000 };
const FRESH_TTL = 1000;          // a "latest" answer is reused this long (fast polling)
const HISTORY_TTL = 300_000;     // older pages do not change

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function timeframes(provider) {
  if (provider === 'oanda') return Object.keys(GRANULARITY);
  if (provider === 'binance') return Object.keys(INTERVAL);
  throw fail('canlı veri için kaynak: oanda, binance');
}

export function oandaSymbol(symbol) {
  let s = String(symbol).toUpperCase().trim().replace(/[/-]/g, '_');
  if (!s.includes('_') && s.length === 6) s = `${s.slice(0, 3)}_${s.slice(3)}`;
  return s;
}

const decimalsOf = (text) => (text && String(text).includes('.') ? String(text).split('.')[1].length : null);

async function getJson(fetchFn, url, headers = {}) {
  let r;
  try { r = await fetchFn(url, { headers }); } catch { throw fail('canlı veriye ulaşılamadı (internet?)', 503); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d.errorMessage || d.msg || `HTTP ${r.status}`;
    throw fail(r.status === 401 || r.status === 403 ? `OANDA anahtarı kabul edilmedi: ${msg}` : `canlı veri alınamadı: ${msg}`, r.status === 404 ? 404 : 502);
  }
  return d;
}

/** Rows [t, o, h, l, c, v] as the chart's columns: labelled like stored bars,
 *  in time order, one bar per label. */
function finish({ provider, symbol, display, tf, align, rows, decimals, lastComplete }) {
  const t = parseTf(tf);
  const merged = [];
  for (const r of rows.map(([time, ...rest]) => [bucket(time, t, align), ...rest]).sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && last[0] === r[0]) { last[2] = Math.max(last[2], r[2]); last[3] = Math.min(last[3], r[3]); last[4] = r[4]; last[5] += r[5]; } else merged.push(r);
  }
  const price = merged.length ? merged[merged.length - 1][4] : null;
  const meta = defaults(display, price, decimals);
  const dec = decimals ?? meta.decimals;
  const k = 10 ** (dec + 2);
  const round = (x) => Math.round(x * k) / k;
  const col = (i, f = round) => merged.map((r) => f(r[i]));
  return {
    provider, symbol, display, tf, align, decimals: dec, pip_size: meta.pip_size, contract_size: meta.contract_size,
    currency: meta.currency, quote_conv: meta.quote_conv, last_complete: lastComplete, server_time: Math.floor(Date.now() / 1000),
    count: merged.length, t: col(0, (x) => x), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5, (x) => x),
  };
}

async function fromOanda(cred, symbol, tf, count, to, fetchFn) {
  if (!cred?.token) throw fail('OANDA anahtarı yok: Ayarlar → API bölümüne yapıştırın');
  const server = OANDA_SERVERS[cred.env] || OANDA_SERVERS.practice;
  const inst = oandaSymbol(symbol);
  const side = PRICE[cred.price] || 'B';
  const key = { B: 'bid', M: 'mid', A: 'ask' }[side];
  const q = new URLSearchParams({ granularity: GRANULARITY[tf], price: side, count: String(count), dailyAlignment: '17', alignmentTimezone: 'America/New_York', weeklyAlignment: 'Friday' });
  if (to) q.set('to', String(Math.floor(to)));
  const d = await getJson(fetchFn, `${server}/v3/instruments/${inst}/candles?${q}`, { Authorization: `Bearer ${cred.token}`, 'Accept-Datetime-Format': 'UNIX' });
  const candles = (d.candles || []).filter((c) => c[key]);
  const rows = candles.map((c) => [Math.floor(Number(c.time)), +c[key].o, +c[key].h, +c[key].l, +c[key].c, Number(c.volume || 0)]);
  return finish({
    provider: 'oanda', symbol: inst, display: inst.replace(/_/g, ''), tf, align: 'fx', rows,
    decimals: candles.length ? decimalsOf(candles[candles.length - 1][key].c) : null,
    lastComplete: candles.length ? !!candles[candles.length - 1].complete : true,
  });
}

async function fromBinance(symbol, tf, count, to, fetchFn) {
  const sym = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const q = new URLSearchParams({ symbol: sym, interval: INTERVAL[tf], limit: String(count) });
  if (to) q.set('endTime', String(Math.floor(to) * 1000 - 1));
  const raw = await getJson(fetchFn, `${BINANCE}/api/v3/klines?${q}`);
  const rows = (raw || []).map((r) => [Math.floor(r[0] / 1000), +r[1], +r[2], +r[3], +r[4], +r[5]]);
  const dec = Math.max(2, ...raw.slice(-50).map((r) => decimalsOf(String(r[4]).replace(/0+$/, '')) || 0));
  return finish({ provider: 'binance', symbol: sym, display: sym, tf, align: 'utc', rows, decimals: dec, lastComplete: raw.length ? raw[raw.length - 1][6] < Date.now() : true });
}

const cache = new Map();

/** The latest `count` candles (or those before `to`) of `symbol` at `tf`. */
export async function candles(cred, provider, symbol, tf, count = 500, to = null, fetchFn = (...a) => fetch(...a)) {
  if (!timeframes(provider).includes(tf)) throw fail(`${provider} canlı grafikte ${tf} desteklemiyor`);
  count = Math.max(1, Math.min(Number(count) || 500, MAX_COUNT[provider]));
  const key = `${provider}|${String(symbol).toUpperCase()}|${tf}|${count}|${to || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (to ? HISTORY_TTL : FRESH_TTL)) return hit.value;
  const value = provider === 'oanda' ? await fromOanda(cred, symbol, tf, count, to, fetchFn) : await fromBinance(symbol, tf, count, to, fetchFn);
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** A pasted key: tried on the chosen server, then the other (a live
 *  account's key pasted as "demo" still works). Returns { env, accounts }. */
export async function checkOanda(token, env = 'practice', fetchFn = (...a) => fetch(...a)) {
  let last = null;
  for (const e of [env, ...Object.keys(OANDA_SERVERS).filter((x) => x !== env)]) {
    try {
      const d = await getJson(fetchFn, `${OANDA_SERVERS[e]}/v3/accounts`, { Authorization: `Bearer ${token}` });
      return { env: e, accounts: (d.accounts || []).map((a) => a.id) };
    } catch (err) { last = err; }
  }
  throw fail(`OANDA anahtarı doğrulanamadı: ${last?.message || ''}`);
}
