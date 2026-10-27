// Modal dialogs: new replay session, saved sessions, settings, indicators, jump.
import { api } from '../api.js?v=446247be79';
import { INDICATORS } from '../chart/indicators.js?v=446247be79';
import { SESSION_SETS } from '../chart/sessions.js?v=446247be79';
import * as F from '../format.js?v=446247be79';
import { confirmBox, field, flushStorage, h, icon, modal, storage, toast } from './dom.js?v=446247be79';
import { appearanceSection } from './look.js?v=446247be79';

const TIMEZONES = ['Europe/Istanbul', 'UTC', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Dubai', 'Australia/Sydney'];

export function newSessionDialog(app, { start = null } = {}) {
  const ds = app.ds;
  if (!ds || !ds.first_ts) { toast('Önce veri içeren bir veri seti seçin', 'err'); return; }
  const tz = app.settings.tz;
  const acct = app.settings.account;
  // default: a month before the end of the data, leaving room to trade forward
  const def = start ?? Math.max(ds.first_ts + 7 * 86400, ds.last_ts - 30 * 86400);
  const when = h('input.ctl', { type: 'datetime-local', value: F.toLocalInput(def, tz), min: F.toLocalInput(ds.first_ts, tz), max: F.toLocalInput(ds.last_ts, tz) });
  const name = h('input.ctl', { value: `${ds.symbol} replay ${F.dateOnly(def, tz)}` });
  when.addEventListener('change', () => { const t = F.parseLocal(when.value, tz); if (t) name.value = `${ds.symbol} replay ${F.dateOnly(t, tz)}`; });
  const balance = h('input.ctl', { type: 'number', min: 1, step: 100, value: acct.balance });
  const spread = h('input.ctl', { type: 'number', min: 0, step: 0.1, value: acct.spreadPips });
  const comm = h('input.ctl', { type: 'number', min: 0, step: 0.1, value: acct.commission });
  const sameBar = h('select.ctl', {}, h('option', { value: 'path' }, 'Açılışa yakın uç önce (TradingView)'), h('option', { value: 'worst' }, 'Kötümser: önce stop'));
  sameBar.value = acct.sameBar;
  // more markets on the same clock and account (as on FX Replay): the ones
  // with data at the chosen moment can join
  const extra = new Set();
  const others = app.datasets.filter((d) => d.id !== ds.id && d.bar_count && d.first_ts);
  const marketChips = h('div.market-chips');
  const paintChips = () => {
    const t = F.parseLocal(when.value, tz);
    marketChips.replaceChildren(...others.map((d) => {
      const ok = t == null || (t >= d.first_ts && t <= d.last_ts);
      if (!ok) extra.delete(d.id);
      return h(`button.chip${extra.has(d.id) ? '.on' : ''}`, { type: 'button', disabled: !ok, title: ok ? `${d.symbol} oturuma eklensin` : `${d.symbol}: bu tarihte verisi yok`,
        onclick: () => { if (extra.has(d.id)) extra.delete(d.id); else extra.add(d.id); paintChips(); } },
      extra.has(d.id) ? icon('check', 13) : icon('plus', 13), d.symbol);
    }));
  };
  when.addEventListener('change', paintChips);
  paintChips();
  const random = h('button.btn.small.outline', { onclick: () => {
    const lo = ds.first_ts + 14 * 86400, hi = ds.last_ts - 14 * 86400;
    const t = Math.floor(lo + Math.random() * Math.max(0, hi - lo));
    when.value = F.toLocalInput(t, tz);
    when.dispatchEvent(new Event('change'));
  } }, icon('dice', 15), 'Rastgele tarih');
  modal({
    title: 'Yeni replay oturumu',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.muted', { style: { margin: 0 } }, `${ds.name} · veri: ${F.dateOnly(ds.first_ts, tz)} → ${F.dateOnly(ds.last_ts, tz)}`),
      h('div.row2', {}, field(`Başlangıç (${tz})`, when, 'Grafik bu ana kadar olanı gösterir'), h('div', { style: { alignSelf: 'center' } }, random)),
      field('Oturum adı', name),
      others.length ? field(`Başka piyasalar (${ds.symbol} ile aynı anda ilerler, tek hesap)`, marketChips, 'Sonradan da eklenebilir: replay sırasında üstteki + ile') : null,
      h('div.row2', {}, field(`Başlangıç bakiyesi (${ds.currency})`, balance), field('Spread (pip)', spread)),
      h('div.row2', {}, field(`Komisyon (${ds.currency} / lot / yön)`, comm), field('Aynı mumda SL ve TP', sameBar))),
    actions: [
      { label: 'Vazgeç' },
      { label: 'Başlat', kind: 'primary', onClick: async () => {
        const t = F.parseLocal(when.value, tz);
        if (t == null) { toast('Tarih seçin', 'err'); return false; }
        Object.assign(acct, { balance: Number(balance.value), spreadPips: Number(spread.value), commission: Number(comm.value), sameBar: sameBar.value });
        app.saveSettings();
        await app.startReplay({ start: t, name: name.value || 'Replay', extra: [...extra] });
        return true;
      } },
    ],
  });
}

export async function sessionsDialog(app) {
  let list = [];
  try { list = (await api.sessions()).filter((x) => x.kind !== 'backtest'); } catch (err) { toast(err.message, 'err'); return; }
  const tz = app.settings.tz;
  const body = h('div', {});
  const dlg = { close: () => {} };
  const render = () => {
    body.replaceChildren(list.length ? h('table.grid', {},
      h('thead', {}, h('tr', {}, ['Ad', 'Sembol', 'Başlangıç', 'Şimdi', 'İşlem', 'Net', 'Güncelleme', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((s) => {
        const sm = s.summary || {};
        return h('tr', {},
          h('td', {}, h('strong', {}, s.name)),
          h('td', {}, sm.symbol || '—'),
          h('td', {}, F.dateTime(sm.startTime, tz)),
          h('td', {}, F.dateTime(sm.cursor, tz)),
          h('td.num', {}, sm.trades ?? 0),
          h(`td.num.${F.cls(sm.net)}`, {}, sm.net == null ? '—' : F.signedMoney(sm.net, sm.currency || 'USD')),
          h('td', {}, F.dateTime(s.updated_at, tz)),
          h('td.actions', {},
            h('button.btn.small.primary', { onclick: async () => { dlg.close(); await app.openSession(s.id); } }, 'Aç'),
            h('button.btn.small.outline', { onclick: async () => {
              const nm = window.prompt('Yeni ad', s.name);
              if (!nm) return;
              await api.updateSession(s.id, { name: nm });
              s.name = nm;
              if (app.session?.id === s.id) app.session.name = nm;
              render();
            } }, 'Ad'),
            h('button.btn.small.outline.danger', { onclick: async () => {
              if (!(await confirmBox('Oturumu sil', `“${s.name}” silinsin mi?`, 'Sil', 'danger'))) return;
              await api.deleteSession(s.id);
              list = list.filter((x) => x.id !== s.id);
              if (app.session?.id === s.id) app.exitReplay(false);
              render();
            } }, 'Sil')));
      }))) : h('div.empty', {}, 'Kayıtlı oturum yok.'));
  };
  render();
  Object.assign(dlg, modal({
    title: 'Replay oturumları', wide: true, body,
    actions: [{ label: 'Kapat' }, { label: 'Yeni oturum', kind: 'primary', onClick: () => { setTimeout(() => newSessionDialog(app), 0); } }],
  }));
}

function apiSection(app, info) {
  const box = h('div', { style: { display: 'grid', gap: '10px' } });
  const render = (st) => {
    const o = st.oanda;
    const token = h('input.ctl', { type: 'password', autocomplete: 'off', placeholder: o.configured ? `kayıtlı: ${o.token}` : 'OANDA API anahtarını yapıştırın' });
    const env = h('select.ctl', {}, h('option', { value: 'practice' }, 'Demo (fxTrade Practice)'), h('option', { value: 'live' }, 'Gerçek hesap (fxTrade)'));
    env.value = o.env || 'practice';
    const price = h('select.ctl', {}, h('option', { value: 'bid' }, 'bid (MT4 gibi)'), h('option', { value: 'mid' }, 'mid'), h('option', { value: 'ask' }, 'ask'));
    price.value = o.price || 'bid';
    const status = h('div', { style: { fontSize: '12px' } },
      o.configured
        ? h('span.up', {}, `Bağlı · ${o.env === 'live' ? 'gerçek hesap' : 'demo'}${o.accounts?.length ? ` · hesap ${o.accounts.join(', ')}` : ''}${o.from_env ? ' · sunucu ortam değişkeninden' : ''}`)
        : h('span.muted', {}, 'Bağlı değil'));
    const save = h('button.btn.primary.small', { onclick: async () => {
      if (!token.value.trim()) { toast('Anahtarı yapıştırın', 'err'); return; }
      save.disabled = true; save.textContent = 'Test ediliyor…';
      try {
        const next = await api.saveOanda({ token: token.value.trim(), env: env.value, price: price.value });
        toast('OANDA bağlandı: canlı grafik hazır', 'ok');
        render(next);
        app.onApiChanged?.();
      } catch (err) {
        toast(err.message, 'err', 8000);
        save.disabled = false; save.textContent = 'Kaydet ve test et';
      }
    } }, 'Kaydet ve test et');
    const remove = o.configured && !o.from_env ? h('button.btn.small.outline.danger', { onclick: async () => {
      if (!(await confirmBox('Anahtarı kaldır', 'Kayıtlı OANDA anahtarı silinsin mi?', 'Sil', 'danger'))) return;
      render(await api.deleteOanda());
      app.onApiChanged?.();
    } }, 'Kaldır') : null;
    box.replaceChildren(
      h('div.api-card', {},
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } }, h('strong', {}, 'OANDA'), status),
        h('p.muted', { style: { margin: '4px 0 8px', fontSize: '12px' } },
          window.RV_SERVER
            ? 'Canlı forex / altın / endeks grafiği ve geçmiş veri indirme. Anahtar: OANDA hesabınız → “Manage API Access” (fxTrade Practice demo hesapta ücretsizdir). Anahtar yalnızca bu sunucuda saklanır, tarayıcıya geri gönderilmez.'
            : 'Canlı forex / altın / endeks grafiği. Anahtar: OANDA hesabınız → “Manage API Access” (demo hesapta ücretsiz). Bir kez girmen yeter: grubun kendi bulutunda saklanır, gruptaki her cihaz canlı grafiği açar.'),
        h('div', { style: { display: 'grid', gap: '8px' } },
          field('API anahtarı (token)', token),
          h('div.row2', {}, field('Hesap türü', env, 'Yanlış seçilirse diğeri otomatik denenir'), field('Fiyat', price)),
          h('div', { style: { display: 'flex', gap: '8px' } }, save, remove))),
      h('div.api-card', {},
        h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('strong', {}, 'Dukascopy'), h('span.up', { style: { fontSize: '12px' } }, 'Anahtar gerekmez')),
        h('p.muted', { style: { margin: '4px 0 0', fontSize: '12px' } },
          'Dukascopy API anahtarı vermez; geçmiş forex/altın verisi herkese açıktır ve “Veri” sekmesinden doğrudan indirilir. Canlı veri sunmaz, canlı grafik için OANDA kullanın.')),
      h('div.api-card', {},
        h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('strong', {}, 'Binance'), h('span.up', { style: { fontSize: '12px' } }, 'Anahtar gerekmez')),
        h('p.muted', { style: { margin: '4px 0 0', fontSize: '12px' } }, 'Kripto için canlı grafik ve geçmiş veri anahtarsız çalışır (BTCUSDT, ETHUSDT…).')));
  };
  render(info);
  return box;
}

/** Settings save as you change them (no Save button to forget). */
export async function settingsDialog(app, { section = null } = {}) {
  let info = null;
  try { info = await api.settings(); } catch (err) { toast(err.message, 'err'); return; }
  const s = app.settings;
  const commit = () => { app.saveSettings(); app.applySettings(); };
  const tzList = [...new Set([s.tz, Intl.DateTimeFormat().resolvedOptions().timeZone, ...TIMEZONES])];
  const tz = h('select.ctl', { onchange: () => { s.tz = tz.value; commit(); } }, tzList.map((z) => h('option', { value: z }, z)));
  tz.value = s.tz;
  const vol = h('input', { type: 'checkbox', checked: s.volume, onchange: () => { s.volume = vol.checked; commit(); } });
  const num = (key, step, min) => {
    const el = h('input.ctl', { type: 'number', step, min, value: s.account[key], onchange: () => {
      const v = Number(el.value);
      if (!Number.isFinite(v) || (min != null && v < min)) { el.value = s.account[key]; toast('Geçerli bir sayı girin', 'err'); return; }
      s.account[key] = v;
      commit();
    } });
    return el;
  };
  const balance = num('balance', 100, 1);
  const spread = num('spreadPips', 0.1, 0);
  const comm = num('commission', 0.1, 0);
  const sameBar = h('select.ctl', { onchange: () => { s.account.sameBar = sameBar.value; commit(); } },
    h('option', { value: 'path' }, 'Açılışa yakın uç önce'), h('option', { value: 'worst' }, 'Kötümser: önce stop'));
  sameBar.value = s.account.sameBar;
  const inSession = app.mode === 'replay';
  const general = h('div', { style: { display: 'grid', gap: '10px' } },
    field('Saat dilimi (gösterim)', tz),
    h('label.check', {}, vol, 'Hacim çubuklarını göster'),
    h('h4', {}, inSession ? 'Hesap varsayılanları (bu oturumun spread/komisyonu da güncellenir)' : 'Hesap varsayılanları (yeni oturumlar ve strateji testi)'),
    h('div.row2', {}, field('Başlangıç bakiyesi', balance), field('Spread (pip)', spread)),
    h('div.row2', {}, field('Komisyon (lot / yön)', comm), field('Aynı mumda SL ve TP', sameBar)),
    info.auth ? h('div', {}, h('h4', {}, 'Oturum'), h('button.btn.small.outline', { onclick: async () => { await flushStorage(); await api.logout(); window.location.replace('profiles.html'); } }, 'Siteden çıkış')) : null);
  const api_ = apiSection(app, info);
  // the look applies and saves as you go; it is this profile's from then on
  const look = appearanceSection(s.appearance, (a) => { s.appearance = a; app.saveSettings(); app.previewAppearance(a); });
  const tabs = h('div.seg', { style: { marginBottom: '4px' } });
  const body = h('div', {});
  let dlg = null;
  const show = (which) => {
    dlg?.el.parentElement?.classList.toggle('clear', which === 'look');
    tabs.replaceChildren(
      h(`button${which === 'general' ? '.on' : ''}`, { onclick: () => show('general') }, 'Genel'),
      h(`button${which === 'api' ? '.on' : ''}`, { onclick: () => show('api') }, 'API bağlantıları'));
    body.replaceChildren(which === 'api' ? api_ : which === 'look' ? look.el : general);
  };
  show(section === 'api' ? 'api' : 'general');
  dlg = modal({
    title: 'Ayarlar',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, tabs, body),
    onClose: () => app.applySettings(),
    actions: [{ label: 'Bitti', kind: 'primary' }],
    note: 'Değişiklikler bu profile otomatik kaydedilir',
  });
  show(section || 'general');
}

const LIVE_EXAMPLES = {
  oanda: ['EUR_USD', 'GBP_USD', 'USD_JPY', 'XAU_USD', 'GBP_JPY', 'US30_USD', 'NAS100_USD', 'DE30_EUR'],
  binance: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
};

export async function liveDialog(app) {
  let info = null;
  try { info = await api.settings(); } catch (err) { toast(err.message, 'err'); return; }
  const oandaOk = info.oanda.configured;
  const prov = h('select.ctl', {},
    h('option', { value: 'oanda' }, `OANDA: forex / altın / endeks${oandaOk ? '' : ' (anahtar gerekli)'}`),
    h('option', { value: 'binance' }, 'Binance: kripto (anahtarsız)'));
  prov.value = app.liveState?.provider || (oandaOk ? 'oanda' : 'binance');
  const symbol = h('input.ctl', { autocapitalize: 'characters', spellcheck: false });
  const chips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const notice = h('div', {});
  const recent = storage('rt:live:recent', []);
  const sync = () => {
    const p = prov.value;
    if (!symbol.value || symbol.dataset.auto === '1') { symbol.value = LIVE_EXAMPLES[p][0]; symbol.dataset.auto = '1'; }
    const list = [...new Set([...recent.filter((r) => r.provider === p).map((r) => r.symbol), ...LIVE_EXAMPLES[p]])];
    chips.replaceChildren(...list.map((x) => h('button.btn.small.outline', { onclick: () => { symbol.value = x; symbol.dataset.auto = '0'; } }, x)));
    notice.replaceChildren(p === 'oanda' && !oandaOk
      ? h('div.notice', {}, 'OANDA anahtarı henüz yok. ',
        h('button.btn.small.primary', { onclick: () => { dlg.close(); D_settings(app); } }, 'Ayarlar → API’ye git'))
      : h('div.muted', { style: { fontSize: '12px' } }, p === 'oanda' ? 'Sembol OANDA biçiminde: EUR_USD, XAU_USD, US30_USD.' : 'Sembol Binance biçiminde: BTCUSDT.'));
  };
  symbol.addEventListener('input', () => { symbol.dataset.auto = '0'; });
  prov.addEventListener('change', () => { symbol.dataset.auto = '1'; symbol.value = ''; sync(); });
  sync();
  const dlg = modal({
    title: 'Canlı grafik',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      field('Kaynak', prov), field('Sembol', symbol), chips, notice,
      h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'Fiyatlar birkaç saniyede bir güncellenir. Çizim ve indikatörler çalışır; geriye kaydırdıkça eski barlar yüklenir.')),
    actions: [
      { label: 'Vazgeç' },
      { label: 'Aç', kind: 'primary', onClick: async () => {
        if (prov.value === 'oanda' && !oandaOk) { toast('Önce Ayarlar → API bölümüne OANDA anahtarını girin', 'err'); return false; }
        if (!symbol.value.trim()) { toast('Sembol girin', 'err'); return false; }
        await app.startLive({ provider: prov.value, symbol: symbol.value.trim() });
        return true;
      } },
    ],
  });
}

function D_settings(app) { settingsDialog(app, { section: 'api' }); }

// what the indicator picker offers (kill zones and sessions are one indicator in two modes)
export const PICKS = [
  ['Seans', [
    { type: 'sessions', params: { mode: 1 }, name: 'ICT kill zone', desc: 'Asia, London, NY AM, London Close, NY PM · New York saati' },
    { type: 'sessions', params: { mode: 0 }, name: 'Seanslar', desc: 'Asya, Londra ve New York işlem saatleri' },
  ]],
  ['Trend', [
    { type: 'ema', name: 'EMA', desc: 'Üssel hareketli ortalama' },
    { type: 'sma', name: 'SMA', desc: 'Basit hareketli ortalama' },
    { type: 'vwap', name: 'VWAP', desc: 'Günlük hacim ağırlıklı ortalama fiyat' },
  ]],
  ['Volatilite', [
    { type: 'bb', name: 'Bollinger Bantları', desc: 'Ortalama ± standart sapma' },
    { type: 'donchian', name: 'Donchian Kanalı', desc: 'Son N barın en yüksek / en düşüğü' },
    { type: 'atr', name: 'ATR', desc: 'Ortalama gerçek aralık · ayrı panel' },
  ]],
  ['Momentum', [
    { type: 'rsi', name: 'RSI', desc: 'Göreceli güç endeksi · ayrı panel' },
    { type: 'macd', name: 'MACD', desc: 'Hızlı / yavaş EMA farkı · ayrı panel' },
    { type: 'stoch', name: 'Stokastik', desc: '%K ve %D · ayrı panel' },
  ]],
];

export function indicatorsDialog(app) {
  const list = h('div.ind-picker', {}, PICKS.map(([group, items]) => h('div.ind-group', {},
    h('h4', {}, group),
    h('div.ind-items', {}, items.filter((it) => INDICATORS[it.type]).map((it) => h('button.ind-item', {
      type: 'button', onclick: () => { app.addIndicator(it.type, it.params); dlg.close(); },
    }, h('span.n', {}, it.name), h('span.d', {}, it.desc), icon('plus', 15)))))));
  const dlg = modal({ title: 'İndikatör ekle', body: list });
}

const PARAM_LABELS = { len: 'Periyot', mult: 'Standart sapma çarpanı', fast: 'Hızlı periyot', slow: 'Yavaş periyot', signal: 'Sinyal periyodu', k: '%K yumuşatma', d: '%D periyodu' };
const PARAM_CHOICES = { sessions: { mode: [[1, 'ICT kill zone'], [0, 'Seanslar (Asya / Londra / New York)']] } };

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minutes = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : null; };

/** Kill zones / sessions: which bands, their names, hours (New York time) and colours. */
function killZoneDialog(app, ind) {
  const p = structuredClone(ind.params);
  let mode = Math.round(p.mode || 0) === 0 ? 0 : 1;
  const zonesOf = (m) => structuredClone(Array.isArray(p[`zones${m}`]) && p[`zones${m}`].length ? p[`zones${m}`] : SESSION_SETS[m].zones).map((z) => ({ on: true, ...z }));
  const work = { 0: zonesOf(0), 1: zonesOf(1) };
  const list = h('div.kz-list', {});
  const modeSeg = h('div.seg', {});
  const fill = h('input', { type: 'range', min: 2, max: 25, step: 1, value: Number.isFinite(p.fill) ? p.fill : 7.5 });
  const fillVal = h('span.slider-val', {}, `%${fill.value}`);
  const setFill = () => { fillVal.textContent = `%${fill.value}`; fill.style.setProperty('--p', `${((fill.value - 2) / 23) * 100}%`); };
  fill.addEventListener('input', setFill);
  setFill();
  const labels = h('input', { type: 'checkbox', checked: p.labels !== 0 });
  const render = () => {
    modeSeg.replaceChildren(...[[1, 'ICT kill zone'], [0, 'Seanslar']].map(([m, l]) => h(`button${mode === m ? '.on' : ''}`, { type: 'button', onclick: () => { mode = m; render(); } }, l)));
    list.replaceChildren(
      h('div.kz-row.kz-head', {}, h('span', {}), h('span', {}, 'Ad'), h('span', {}, 'Başlangıç'), h('span', {}, 'Bitiş'), h('span', {}, 'Renk')),
      ...work[mode].map((z) => h(`div.kz-row${z.on ? '' : '.off'}`, {},
        h('input', { type: 'checkbox', checked: z.on, title: 'Göster', onchange: (e) => { z.on = e.target.checked; render(); } }),
        h('input.ctl.sm', { value: z.name, maxlength: 16, oninput: (e) => { z.name = e.target.value.toUpperCase(); z.short = z.name.slice(0, 3); } }),
        h('input.ctl.sm', { type: 'time', value: hhmm(z.from), onchange: (e) => { const v = minutes(e.target.value); if (v != null) z.from = v; } }),
        h('input.ctl.sm', { type: 'time', value: hhmm(z.to), onchange: (e) => { const v = minutes(e.target.value); if (v != null) z.to = v; } }),
        h('input.color', { type: 'color', value: z.color, oninput: (e) => { z.color = e.target.value; } }))));
  };
  render();
  modal({
    title: 'Kill zone ve seanslar',
    body: h('div', { style: { display: 'grid', gap: '12px' } },
      modeSeg,
      h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'Saatler New York saatidir (yaz saati otomatik). Gece yarısını geçen bölge için bitişi başlangıçtan küçük yazın (ör. 20:00 → 00:00). 1 saat ve altı grafiklerde görünür.'),
      list,
      h('div.slider', {}, h('span.slider-label', {}, 'Bant yoğunluğu'), fillVal, fill),
      h('label.check', {}, labels, 'Bantların içine adını yaz'),
      h('div', {}, h('button.btn.small.outline', { type: 'button', onclick: () => { work[mode] = structuredClone(SESSION_SETS[mode].zones).map((z) => ({ on: true, ...z })); render(); } }, icon('refresh', 14), 'Bu görünümü varsayılana döndür'))),
    actions: [
      { label: 'Kaldır', kind: 'danger', onClick: () => app.removeIndicator(ind.id) },
      { label: 'Kaydet', kind: 'primary', onClick: () => {
        for (const m of [0, 1]) for (const z of work[m]) if (z.from === z.to) { toast(`${z.name || 'Bölge'}: başlangıç ve bitiş aynı olamaz`, 'err'); return false; }
        const next = { ...p, mode, fill: Number(fill.value), labels: labels.checked ? 1 : 0, zones0: work[0], zones1: work[1] };
        app.updateIndicator(ind.id, next);
        return true;
      } },
    ],
  });
}

export function indicatorParamsDialog(app, ind) {
  if (ind.type === 'sessions') { killZoneDialog(app, ind); return; }
  const def = INDICATORS[ind.type];
  const inputs = Object.entries(def.params).map(([k]) => {
    const choices = PARAM_CHOICES[ind.type]?.[k];
    const el = choices
      ? h('select.ctl', {}, choices.map(([v, l]) => h('option', { value: v }, l)))
      : h('input.ctl', { type: 'number', step: 'any', min: 1, value: ind.params[k] });
    el.value = String(ind.params[k]);
    return [k, el];
  });
  // the session bands have fixed colours of their own
  const colors = def.primitive ? [] : (ind.colors || def.colors).map((c) => h('input.color', { type: 'color', value: c }));
  if (!inputs.length && !colors.length) return;
  modal({
    title: def.primitive ? 'Seanslar ve kill zone' : def.name,
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      def.help ? h('p.muted', { style: { margin: 0, fontSize: '12px' } }, def.help) : null,
      ...inputs.map(([k, el]) => field(k === 'mode' ? 'Görünüm' : PARAM_LABELS[k] || k, el)),
      colors.length ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span.muted', {}, 'Renk'), ...colors) : null),
    actions: [
      { label: 'Kaldır', kind: 'danger', onClick: () => app.removeIndicator(ind.id) },
      { label: 'Kaydet', kind: 'primary', onClick: () => {
        const params = {};
        for (const [k, el] of inputs) {
          const v = Number(el.value);
          if (!Number.isFinite(v) || (k !== 'mode' && v <= 0)) { toast(`${PARAM_LABELS[k] || k}: geçerli bir sayı girin`, 'err'); return false; }
          params[k] = v;
        }
        if (colors.length) ind.colors = colors.map((c) => c.value);
        app.updateIndicator(ind.id, params);
        return true;
      } },
    ],
  });
}

export function jumpDialog(app) {
  const tz = app.settings.tz;
  const cur = app.engine.cursor;
  const when = h('input.ctl', { type: 'datetime-local', value: F.toLocalInput(cur + 86400, tz), min: F.toLocalInput(cur, tz), max: F.toLocalInput(app.engine.lastTs, tz) });
  const quick = (label, sec) => h('button.btn.small.outline', { onclick: () => { when.value = F.toLocalInput(cur + sec, tz); } }, label);
  modal({
    title: 'İleri sar',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.muted', { style: { margin: 0 } }, 'Aradaki tüm barlar işlenir: bekleyen emirler dolar, SL/TP tetiklenir. Geri sarmak için yeni oturum açın.'),
      field(`Hedef zaman (${tz})`, when),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, quick('+1 saat', 3600), quick('+4 saat', 14400), quick('+1 gün', 86400), quick('+1 hafta', 7 * 86400))),
    actions: [
      { label: 'Vazgeç' },
      { label: 'İlerle', kind: 'primary', onClick: async () => {
        const t = F.parseLocal(when.value, tz);
        if (t == null || t <= cur) { toast('İleri bir zaman seçin', 'err'); return false; }
        await app.jumpTo(t);
        return true;
      } },
    ],
  });
}
