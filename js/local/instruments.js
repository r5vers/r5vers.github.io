// Sensible per-instrument defaults (all of them editable later in the UI).
// Mirrors server/instruments.py; tests/fixtures/csv.json pins both.

const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'TRY', 'SEK', 'NOK',
  'DKK', 'PLN', 'HUF', 'CZK', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNH', 'CNY']);
const METALS = { XAU: 100.0, XAG: 5000.0, XPT: 100.0, XPD: 100.0 };

const PAIR = /^([A-Z]{3})[/_-]?([A-Z]{3})$/;

// Python truthiness of an optional number (NaN is truthy there).
const truthy = (x) => x != null && x !== 0;

/** [base, quote] of a currency or metal pair, else null. */
export function splitPair(symbol) {
  const m = PAIR.exec(symbol.toUpperCase().trim());
  if (!m) return null;
  const [, base, quote] = m;
  if (base in METALS && CURRENCIES.has(quote)) return [base, quote];
  if (CURRENCIES.has(base) && CURRENCIES.has(quote)) return [base, quote];
  return null;
}

/** One pip ~ 1/10000 of the price, rounded to a power of ten.
 *  1.08 -> 0.0001, 150 -> 0.01, 2000 -> 0.1, 60000 -> 1. */
export function pipFromPrice(price) {
  if (!truthy(price) || price <= 0 || !Number.isFinite(price)) return 0.0001;
  const e = Math.floor(Math.log10(price)) - 4;
  // 1 / 10^-e is the correctly rounded 10^e, as C's pow gives it
  return e >= 0 ? 10 ** e : 1 / 10 ** -e;
}

/** Dataset fields for a symbol: pip size, contract size, alignment, P&L currency. */
export function defaults(symbol, price = null, decimals = null) {
  const pair = splitPair(symbol);
  if (pair) {
    const [base, quote] = pair;
    let out;
    if (base in METALS) {
      out = { contract_size: METALS[base], pip_size: base === 'XAU' ? 0.1 : 0.01,
        decimals: truthy(decimals) ? decimals : (base === 'XAU' ? 2 : 3) };
    } else {
      const jpy = quote === 'JPY';
      out = { contract_size: 100000.0, pip_size: jpy ? 0.01 : 0.0001, decimals: truthy(decimals) ? decimals : (jpy ? 3 : 5) };
    }
    out.align = 'fx';
    if (quote === 'USD') Object.assign(out, { currency: 'USD', quote_conv: 'none' });
    // P&L is in the quote currency; dividing by the price turns it into USD.
    else if (base === 'USD') Object.assign(out, { currency: 'USD', quote_conv: 'divide' });
    else Object.assign(out, { currency: quote, quote_conv: 'none' });
    return out;
  }
  return {
    contract_size: 1.0,
    pip_size: truthy(price) ? pipFromPrice(price) : 0.01,
    decimals: decimals != null ? decimals : 2,
    align: 'utc', currency: 'USD', quote_conv: 'none',
  };
}
