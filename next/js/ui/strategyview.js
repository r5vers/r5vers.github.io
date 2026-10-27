// Strategy tester tab: code editor, templates, run in a worker, results.
import { api } from '../api.js?v=352a97af6c';
import { backtestRecord, resultFromRecord } from '../core/backtests.js?v=352a97af6c';
import { autoFill, fillChoices } from '../core/fill.js?v=352a97af6c';
import { parseTf } from '../core/timeframes.js?v=352a97af6c';
import * as F from '../format.js?v=352a97af6c';
import { confirmBox, h, icon, toast } from './dom.js?v=352a97af6c';
import { renderHistory } from './panels.js?v=352a97af6c';
import { StatsView } from './statsview.js?v=352a97af6c';

const DAY = 86400;
/** `fn` once the browser has painted (a new frame, not the same task). */
const afterPaint = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));

export class StrategyView {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.templates = [];
    this.saved = [];
    this.code = app.storage('rt:strategy:code', '');
    this.name = app.storage('rt:strategy:name', 'Stratejim');
    this.result = null;
    this.worker = null;
    this.statsView = null;
    this.range = { from: null, to: null };
  }

  async init() {
    try {
      this.templates = await (await fetch('strategies/index.json')).json();
      if (!this.code) this.code = await (await fetch(`strategies/${this.templates[0].file}`)).text();
    } catch { /* offline file:// use */ }
    await this.refreshSaved();
  }

  async refreshSaved() {
    try { this.saved = await api.strategies(); } catch { this.saved = []; }
  }

  _defaultRange() {
    const ds = this.app.ds;
    if (!ds || ds.first_ts == null) return { from: null, to: null };
    const to = ds.last_ts;
    const span = ds.base_tf.endsWith('m') ? 60 * DAY : 5 * 365 * DAY;
    return { from: Math.max(ds.first_ts, to - span), to };
  }

  render() {
    const app = this.app;
    this.statsView?.destroy();
    this.el.innerHTML = '';
    if (!app.ds) { this.el.append(h('div.empty', {}, 'Önce bir veri seti seçin.')); return; }
    if (app.mode === 'live') { this.el.append(h('div.empty', {}, 'Strateji testi kayıtlı veri setlerinde çalışır. Canlı sembolün geçmişini indirip o veri setini seçin.')); return; }
    if (this.range.from == null || this.range.dsId !== app.ds.id) this.range = { ...this._defaultRange(), dsId: app.ds.id };
    const tz = app.settings.tz;

    const editor = h('textarea.editor', { spellcheck: false, value: this.code });
    editor.value = this.code;
    editor.addEventListener('input', () => { this.code = editor.value; app.store('rt:strategy:code', this.code); });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = editor;
        editor.setRangeText('  ', a, b, 'end');
        editor.dispatchEvent(new Event('input'));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run(); }
    });

    const tpl = h('select.ctl.sm', { onchange: async (e) => {
      const v = e.target.value;
      e.target.value = '';
      if (!v) return;
      if (this.code.trim() && !(await confirmBox('Şablon yükle', 'Editördeki kod değiştirilecek. Devam edilsin mi?', 'Yükle'))) return;
      if (v.startsWith('tpl:')) this.code = await (await fetch(`strategies/${v.slice(4)}`)).text();
      else { const s = this.saved.find((x) => x.name === v.slice(5)); if (s) { this.code = s.code; this.name = s.name; } }
      app.store('rt:strategy:code', this.code);
      this.render();
    } },
      h('option', { value: '' }, 'Şablon / kayıtlı strateji…'),
      h('optgroup', { label: 'Örnekler' }, this.templates.map((t) => h('option', { value: `tpl:${t.file}` }, t.name))),
      this.saved.length ? h('optgroup', { label: 'Kayıtlı' }, this.saved.map((s) => h('option', { value: `save:${s.name}` }, s.name))) : null);

    const nameInput = h('input.ctl.sm', { value: this.name, style: { width: '150px' }, oninput: (e) => { this.name = e.target.value; app.store('rt:strategy:name', this.name); } });
    const save = h('button.btn.small.outline', { onclick: async () => {
      try { await api.saveStrategy(this.name, this.code); await this.refreshSaved(); toast('Strateji kaydedildi', 'ok'); this.render(); } catch (err) { toast(err.message, 'err'); }
    } }, 'Kaydet');

    const fromIn = h('input.ctl.sm', { type: 'date', value: F.toLocalInput(this.range.from, 'UTC').slice(0, 10) });
    const toIn = h('input.ctl.sm', { type: 'date', value: F.toLocalInput(this.range.to, 'UTC').slice(0, 10) });
    fromIn.addEventListener('change', () => { this.range.from = F.parseLocal(fromIn.value, 'UTC'); });
    toIn.addEventListener('change', () => { const t = F.parseLocal(toIn.value, 'UTC'); this.range.to = t == null ? null : t + DAY - 1; });

    const choices = fillChoices(app.ds, app.tfId);
    const auto = autoFill(app.ds, app.tfId, this.range.from, this.range.to);
    const fill = h('select.ctl.sm', { title: 'SL / TP ve emirlerin arandığı bar çözünürlüğü', onchange: (e) => { app.settings.fillTf = e.target.value; app.saveSettings(); } },
      h('option', { value: 'auto' }, `Dolum: otomatik (${auto})`),
      choices.map((tf) => h('option', { value: tf.id }, `Dolum: ${tf.id}`)));
    fill.value = choices.some((tf) => tf.id === app.settings.fillTf) ? app.settings.fillTf : 'auto';
    this.fillSelect = fill;
    this.progress = h('div.progress', {}, h('div'));
    this.runBtn = h('button.btn.primary.small', { onclick: () => (this.worker ? this.stop() : this.run()) });
    this._runLabel(!!this.worker);
    this.out = h('div', {});

    const acct = app.settings.account;
    const left = h('div.left', {},
      h('div.toolbar-row', {}, tpl, nameInput, save,
        h('span.muted', { style: { fontSize: '11px' } }, 'Ctrl+Enter çalıştırır')),
      editor);
    const right = h('div.right', {},
      h('div.toolbar-row', {},
        h('span.muted', {}, 'Aralık'), fromIn, '→', toIn,
        h('span.muted', {}, `TF ${app.tfId}`), fill,
        this.runBtn),
      h('div.muted', { style: { fontSize: '11px', marginBottom: '6px' } },
        `Bakiye ${F.money(acct.balance, app.ds.currency)} · spread ${acct.spreadPips} pip · komisyon ${acct.commission}/lot · ayarlardan değiştirilebilir. Market emirleri sonraki bar açılışında dolar; SL/TP dolum barları içinde aranır. Uzun aralıklarda otomatik dolum tarayıcıyı yormayacak çözünürlüğü seçer (en fazla ~600 bin bar).`),
      this.progress,
      this.out);
    this.el.append(h('div.pane', { style: { height: '100%' } }, h('div.strategy-layout', {}, left, right)));
    if (this.result) this._renderResult();
    else this.out.append(h('div.empty', {}, 'Bir şablon seçin ya da kendi stratejinizi yazın, sonra çalıştırın.'));
  }

  _runLabel(running) {
    this.runBtn?.replaceChildren(icon(running ? 'stop' : 'play', 13), running ? 'Durdur' : 'Testi çalıştır');
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.render();
    toast('Test durduruldu', 'warn');
  }

  async run() {
    const app = this.app;
    const ds = app.ds;
    const { from, to } = this.range;
    if (from == null || to == null || to <= from) { toast('Geçerli bir tarih aralığı seçin', 'err'); return; }
    this.result = null;
    this.out.replaceChildren(h('div.muted', {}, 'Veri yükleniyor…'));
    this._runLabel(true);
    let base;
    const pick = this.fillSelect?.value || 'auto';
    const fillTf = pick === 'auto' || !fillChoices(ds, app.tfId).some((tf) => tf.id === pick) ? autoFill(ds, app.tfId, from, to) : pick;
    const estimate = ((to - from) / parseTf(fillTf).seconds) * 0.72;
    if (estimate > 2_500_000) {
      this.out.replaceChildren(h('div.error-box', {}, `Bu aralık ${fillTf} barlarıyla ~${Math.round(estimate / 1e6 * 10) / 10} milyon bar eder; tarayıcı için fazla. Grafikte daha büyük bir zaman dilimi seçin (ör. 1h: dolum 15m olur) ya da aralığı kısaltın.`));
      this._runLabel(false);
      return;
    }
    try {
      // a little history before `from` so indicators are warmed up
      const warm = Math.max(app.tf.seconds * 300, 0);
      // the records go to the test's worker as they are: reading them into
      // columns here froze the page for a moment on long ranges
      base = await api.barsBin(ds.id, { tf: fillTf, start: from - warm, end: to, limit: 6000000 }, true);
    } catch (err) {
      this.out.replaceChildren(h('div.error-box', {}, err.message));
      this._runLabel(false);
      return;
    }
    if (!base.n) { this.out.replaceChildren(h('div.empty', {}, 'Bu aralıkta veri yok.')); this._runLabel(false); return; }
    this.out.replaceChildren(h('div.muted', {}, `${base.n.toLocaleString('tr-TR')} ${fillTf} bar üzerinde test ediliyor…`));
    const runInfo = {};
    const worker = new Worker(new URL('../workers/backtest.worker.js?v=352a97af6c', import.meta.url), { type: 'module' });
    this.worker = worker;
    const started = performance.now();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { this.progress.firstChild.style.width = `${Math.round(m.value * 100)}%`; return; }
      worker.terminate();
      this.worker = null;
      this.progress.firstChild.style.width = '0';
      this._runLabel(false);
      if (m.type === 'error') {
        this.out.replaceChildren(h('div.error-box', {}, `Hata: ${m.message}\n\n${(m.stack || '').split('\n').slice(0, 4).join('\n')}`));
        return;
      }
      const result = { ...m.result, ms: performance.now() - started, tf: app.tfId, dsId: ds.id, from, to };
      this.result = result;
      // chart, figures and saving each in a frame of their own: done in one
      // go after a long test, the page froze for a moment
      app.showBacktest(result);
      afterPaint(() => {
        if (this.result !== result) return;
        this._renderResult();
        afterPaint(() => this._save(result, ds, fillTf, runInfo));
      });
    };
    worker.onerror = (e) => {
      this.worker = null;
      this._runLabel(false);
      this.out.replaceChildren(h('div.error-box', {}, `Worker hatası: ${e.message || 'bilinmiyor'}`));
    };
    const acct = app.settings.account;
    runInfo.code = this.code;
    runInfo.account = { ...acct };
    worker.postMessage({
      code: this.code, base, tf: app.tfId, align: ds.align, from,
      broker: {
        balance: acct.balance, currency: ds.currency, contractSize: ds.contract_size, pipSize: ds.pip_size,
        decimals: ds.decimals, spread: acct.spreadPips * ds.pip_size, commission: acct.commission,
        quoteConv: ds.quote_conv, sameBar: acct.sameBar, tz: app.settings.tz,
      },
    }, [base.buf]);
  }

  /** Every finished run is kept in this profile's test history. */
  async _save(result, ds, fillTf, run) {
    try {
      const rec = backtestRecord(result, { ds, account: run.account, code: run.code, fillTf });
      const saved = await api.createSession(rec);
      result.savedId = saved.id;
      result.savedAt = saved.created_at;
      // only the badge changes: drawing the whole result again froze the page
      if (this.result === result) this._savedSlot?.replaceChildren(...[this._savedBadge(result)].filter(Boolean));
    } catch (err) {
      toast(`Test geçmişe kaydedilemedi: ${err.message}`, 'warn');
    }
  }

  /** Show a run from the test history. */
  showSaved(session) {
    const r = resultFromRecord(session.state);
    r.savedId = session.id;
    r.savedAt = session.created_at;
    r.code = session.state.code;
    this.result = r;
    this.range = { from: r.from, to: r.to, dsId: r.dsId };
    return r;
  }

  _savedBadge(r) {
    if (!r.savedId) return '';
    return h('span.saved', {}, icon('check', 13), r.saved ? `Geçmişten · ${F.dateTime(r.savedAt, this.app.settings.tz)}` : 'Geçmişe kaydedildi');
  }

  _renderResult() {
    const r = this.result;
    const app = this.app;
    const ccy = app.ds.currency;
    const statsBox = h('div', {});
    const tradesBox = h('div.later', { style: { marginTop: '12px' } });
    const logs = r.logs?.length ? h('div', {}, h('h4', {}, 'Günlük (ctx.log)'), h('div.log', {}, r.logs.map((l) => `${F.dateTime(l.time, app.settings.tz)}  ${l.msg}`).join('\n'))) : null;
    const total = r.tradesTotal ?? r.trades.length;
    this.out.replaceChildren(...[
      h('div.result-head', {},
        h('div', {},
          h('strong', {}, r.name),
          h('div.muted', {}, `${app.tfId === r.tf ? '' : `${r.tf} · `}${F.dateOnly(r.from, 'UTC')} → ${F.dateOnly(r.to, 'UTC')} · ${(r.bars || 0).toLocaleString('tr-TR')} bar · ${total} işlem${r.ms ? ` · ${(r.ms / 1000).toFixed(2)} sn` : ''}`),
          Object.keys(r.params || {}).length ? h('div.params', {}, Object.entries(r.params).map(([k, v]) => h('span', {}, `${k} ${v}`))) : null),
        h('div.actions', {},
          this._savedSlot = h('span', { style: { display: 'contents' } }, this._savedBadge(r)),
          r.saved && r.code ? h('button.btn.small.outline', { onclick: async () => {
            if (this.code.trim() && this.code !== r.code && !(await confirmBox('Kodu yükle', 'Editördeki kod bu testin koduyla değiştirilsin mi?', 'Yükle'))) return;
            this.code = r.code; app.store('rt:strategy:code', this.code); this.render();
          } }, 'Kodu editöre al') : null,
          h('button.btn.small.outline', { onclick: () => app.showBacktest(r) }, 'Grafikte göster'),
          h('button.btn.small.outline', { onclick: () => app.showBacktest(null) }, 'Grafikten kaldır'))),
      total > r.trades.length ? h('div.notice', {}, `İlk ${r.trades.length.toLocaleString('tr-TR')} işlem saklandı (toplam ${total.toLocaleString('tr-TR')}); istatistikler hepsini kapsar.`) : null,
      statsBox, logs, tradesBox,
    ].filter(Boolean));
    this.statsView = new StatsView(statsBox);
    this.statsView.render({
      stats: r.stats, ccy, initial: app.settings.account.balance, equity: r.equity, theme: app.theme,
      extra: [h('div.kpi', {}, h('div.label', {}, 'Maks. düşüş (varlık)'), h('div.value.down', {}, `${F.money(r.maxDrawdownEquity, ccy)} · ${F.pct(r.maxDrawdownEquityPct, 1)}`))],
    });
    renderHistory(tradesBox, app, { trades: r.trades, editable: false, ccy, title: 'İşlemler' });
  }
}
