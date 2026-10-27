// CSV upload on the device: the server's POST /api/datasets/import, with
// the file parsed in the browser (csv.js mirrors csv_import.py).
import { parseTf } from '../core/timeframes.js?v=43f704a38f';
import { aggregate, normalize, parseCsv, tfFromSeconds } from './csv.js?v=43f704a38f';
import { defaults } from './instruments.js?v=43f704a38f';
import { chooseScale, encode } from './rtc.js?v=43f704a38f';
import { mergeCols, readAll, replaceSeries } from './series.js?v=43f704a38f';
import { createDataset, datasetJson, HttpError } from './server.js?v=43f704a38f';

const MAX_UPLOAD = 300 * 1024 * 1024;
const UNIT_MAX = 2 ** 31 - 1;

function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1254').decode(buf); }
}

const median = (xs) => {
  const s = Float64Array.from(xs).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function peak(cols) {
  let p = 0;
  for (const f of ['o', 'h', 'l', 'c']) for (const x of cols[f]) if (Math.abs(x) > p) p = Math.abs(x);
  return p;
}

export async function importCsvFile(db, query, body) {
  if (!body) throw new HttpError(422, 'boş dosya');
  if (body.byteLength > MAX_UPLOAD) throw new HttpError(413, 'dosya çok büyük');
  let parsed;
  try {
    parsed = parseCsv(decodeText(body), { tz: query.tz || 'UTC', dateOrder: query.date_order || 'auto' });
  } catch (e) {
    throw new HttpError(e.status || 422, e.message);
  }
  if (parsed.spacing <= 0) throw new HttpError(422, 'zaman aralığı belirlenemedi (en az iki farklı zamanlı satır gerekli)');
  const baseTf = tfFromSeconds(parsed.spacing).id;
  let ds;
  if (query.dataset_id != null && query.dataset_id !== '') {
    ds = await db.get('datasets', String(query.dataset_id));
    if (!ds) throw new HttpError(404, `dataset ${query.dataset_id} not found`);
    if (ds.base_tf !== baseTf) throw new HttpError(422, `dosya ${baseTf} verisi, veri seti ${ds.base_tf} - aynı zaman dilimi olmalı`);
  } else {
    const symbol = String(query.symbol || '').trim().toUpperCase() || 'CSV';
    const fields = defaults(symbol, median(parsed.candles.c), parsed.decimals);
    ds = await createDataset(db, { symbol, name: query.name || `${symbol} · CSV · ${baseTf}`, source: 'csv', base_tf: baseTf, ...fields });
  }
  // store.write_candles: normalized onto the base timeframe, merged, new bars win
  const fresh = aggregate(normalize(parsed.candles), parseTf(ds.base_tf), ds.align);
  let cols, scale;
  if (ds.bar_count) {
    // Series._scale_for: keep the stored scale while the new prices fit it
    const old = await readAll(db, ds);
    scale = peak(fresh) * 10 ** old.scale <= UNIT_MAX ? old.scale : chooseScale(peak(fresh), old.scale);
    let stored = old.cols;
    if (scale !== old.scale) {
      const step = 10 ** (old.scale - scale);
      stored = { ...old.cols };
      for (const f of ['o', 'h', 'l', 'c']) stored[f] = Int32Array.from(old.cols[f], (x) => Math.round(x / step));
    }
    cols = mergeCols(stored, encode(fresh, scale));
  } else {
    scale = chooseScale(peak(fresh), ds.decimals);
    cols = encode(fresh, scale);
  }
  ds = await replaceSeries(db, ds, cols, scale);
  return { dataset: datasetJson(ds), rows: parsed.rows, skipped: parsed.skipped, repaired: parsed.repaired, base_tf: baseTf, detected: parsed.detected };
}
