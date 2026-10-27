// Replay Terminal - application controller.
import { api } from './api.js?v=fd94038260';
import { columnsToBars } from './core/aggregate.js?v=fd94038260';
import { Broker, lotsForRisk, shareAccount } from './core/broker.js?v=fd94038260';
import { checkpoint, checkpointFor, replayTo, restoreBroker, thinCheckpoints } from './core/rewind.js?v=fd94038260';
import { computeStats } from './core/stats.js?v=fd94038260';
import { bucket, parseTf } from './core/timeframes.js?v=fd94038260';
import { TradingChart } from './chart/chart.js?v=fd94038260';
import { DrawingManager, TOOL_NAMES, FIB_LEVELS, FILLED, POSITION_COLORS, drawingStylePatch } from './chart/drawings.js?v=fd94038260';
import { configureICT } from './chart/sessions.js?v=fd94038260';
import { INDICATORS } from './chart/indicators.js?v=fd94038260';
import { TradeLines } from './chart/tradelines.js?v=fd94038260';
import { OrderLayer, PlusButton } from './chart/orderlayer.js?v=fd94038260';
import * as F from './format.js?v=fd94038260';
import { appearanceSheet } from './rvshell.js?v=fd94038260';
import { liquidGlass } from './ui/liquid.js?v=fd94038260';
import { ReplayEngine } from './replay.js?v=fd94038260';
import * as D from './ui/dialogs.js?v=fd94038260';
import { DataView } from './ui/dataview.js?v=fd94038260';
import { $, $$, avatar, brandMark, confirmBox, flushStorage, h, icon, modal, storage, store, toast, useProfileStorage, wirePointerLight } from './ui/dom.js?v=fd94038260';
import { DEFAULT_APPEARANCE, FONT_PAIRS, PRESETS, applyAppearance, normalizeAppearance, paintLastLook, revealPage } from './ui/look.js?v=fd94038260';
import { openPalette, wirePalette } from './ui/palette.js?v=fd94038260';
import { wireTooltips } from './ui/tooltip.js?v=fd94038260';
import { labelTables, renderHistory, renderOrders, renderPositions } from './ui/panels.js?v=fd94038260';
import { scrubWheel } from './ui/scrubwheel.js?v=fd94038260';
import { StatsView } from './ui/statsview.js?v=fd94038260';
import { StrategyView } from './ui/strategyview.js?v=fd94038260';
import { Ticket } from './ui/ticket.js?v=fd94038260';
import { SidePane } from './ui/sidepane.js?v=fd94038260';

const LW = window.LightweightCharts;
const SPEEDS = [[1, '1x'], [2, '2x'], [4, '4x'], [8, '8x'], [16, '16x'], [40, '40x'], [0, 'Maks']];
const BROWSE_BARS = 3000;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const DEFAULT_SETTINGS = {
  tz: LOCAL_TZ,
  appearance: DEFAULT_APPEARANCE,
  panel: { browse: false, replay: true, live: true },
  fillTf: 'auto',
  tf: '15m',
  datasetId: null,
  indicators: [{ id: 'ema-default', type: 'ema', params: { len: 50 } }],
  volume: true,
  magnet: false,
  speed: 4,
  stepUnit: 'bar',
  pauseOnFill: true,
  account: { balance: 10000, spreadPips: 0.8, commission: 0, sameBar: 'path' },
  // no stop or target of its own: the trader drags them out on the chart, and
  // a % risk sizes the lot once the stop is placed (slOn / tpOn: presets)
  ticket: { lots: 1, sizeMode: 'risk', riskPct: 1, slOn: false, slPips: 15, tpOn: false, tpPips: 30, autoBe: false, beR: 1, v: 2 },
  // drawing favourites (null: not chosen yet, a line, a horizontal line and
  // a box to start with), the floating bar's place, keep the tool after a drawing
  drawFavs: null,
  favBar: null,
  keepDrawing: false,
  bottomHeight: 260,
  bottomCollapsed: true,
  bottomTab: 'data',
};

const TOOLS = ['cursor', 'trend', 'ray', 'arrow', 'hline', 'hray', 'vline', 'channel', 'rect', 'ellipse', 'triangle', 'fib', 'pen', 'long', 'short', 'measure', 'text'];
const TOOL_KEYS = { t: 'trend', h: 'hline', j: 'hray', v: 'vline', r: 'rect', f: 'fib', l: 'long', s: 'short', m: 'measure', x: 'text', b: 'pen', a: 'arrow', e: 'ellipse', c: 'channel' };
// the toolbar: one button per group, the rest of a group a click on its corner away
const TOOL_GROUPS = [['cursor'], 0, ['trend', 'ray', 'arrow', 'hline', 'hray', 'vline', 'channel'], ['rect', 'ellipse', 'triangle'], ['fib'], ['pen'], 0, ['long'], ['short'], ['measure'], ['text']];
const TOOL_ICON = { arrow: 'arrowline', pen: 'brush' };
const toolIcon = (t, size) => icon(TOOL_ICON[t] || t, size);
const toolKey = (t) => { const k = Object.entries(TOOL_KEYS).find(([, v]) => v === t)?.[0]; return k ? `Alt+${['rect', 'long'].includes(t) ? 'Shift+' : ''}${k.toUpperCase()}` : ''; };
const TABS = [
  ['data', 'Veri'], ['positions', 'Pozisyonlar'], ['orders', 'Emirler'], ['history', 'Geçmiş'],
  ['stats', 'İstatistik'], ['strategy', 'Strateji testi'],
];
const TF_FAVORITES = ['1m', '5m', '15m', '1h', '4h', '1D'];
/** Split charts: how many panes each layout has, its name and icon. */
const LAYOUTS = [['1', 1, 'Tek grafik', 'layout1'], ['2v', 2, 'İki yan yana', 'layout2v'], ['2h', 2, 'İki alt alta', 'layout2h'], ['3', 3, 'Üç', 'layout3'], ['4', 4, 'Dört', 'layout4']];
const MODES = [['browse', 'Grafik', 'chart'], ['replay', 'Replay', 'replay'], ['live', 'Canlı', 'live']];
const PACK_NAMES = { EURUSD: 'Euro / Dolar', NAS100: 'NASDAQ 100', XAUUSD: 'Altın / Dolar', GBPUSD: 'Sterlin / Dolar', USDCAD: 'Dolar / Kanada doları', SPX500: 'S&P 500' };
/** What finds a dataset again on another device (as local/sync.js keys it). */
const dsKey = (ds) => (ds.meta?.pack ? `pack:${ds.meta.pack}:${ds.base_tf}` : `ds:${ds.symbol}:${ds.base_tf}:${ds.name}`);
const tradeOrder = (a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime;

const REASON_TEXT = { sl: 'Stop vuruldu', tp: 'Hedef alındı', manual: 'Kapatıldı', partial: 'Kısmi kapatıldı', strategy: 'Kapatıldı', end: 'Kapatıldı' };

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  }
  return out;
}

class App {
  constructor() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.profile = null;
    this.datasets = [];
    this.ds = null;
    this.mode = 'browse';
    this.engine = null;
    this.broker = null;
    // a replay session's markets: { ds, engine, broker, drawings } each, on
    // one clock and one account; `leg` is the one on the chart (and ds,
    // engine, broker are its own)
    this.legs = [];
    this.leg = null;
    this.session = null;
    this.playing = false;
    this.dirty = false;
    this.backtest = null;
    this.plotSeries = [];
    this._tabTimer = null;
    this._picking = null;
    this._lastParam = null;
    this._loadToken = 0;
    // split charts: the slot the main chart is in, and what the others show
    this.layout = { kind: '1', active: 0, slots: [null] };
    this.sidePanes = new Map();
  }

  get tfId() { return this.settings.tf; }
  get theme() { return document.documentElement.dataset.theme || 'dark'; }
  get tf() { return parseTf(this.settings.tf); }
  get bottomTab() { return this.settings.bottomTab; }
  storage(k, d) { return storage(k, d); }
  store(k, v) { store(k, v); }
  toast(m, k, ms) { toast(m, k, ms); }
  saveSettings() {
    // the layout belongs to the screen (a phone and a desktop differ); the rest to the profile
    const { bottomHeight, bottomCollapsed, panel, ...shared } = this.settings;
    store('rt:settings', shared);
    try { localStorage.setItem(this._deviceKey(), JSON.stringify({ bottomHeight, bottomCollapsed, panel })); } catch { /* private mode */ }
    // the profile screen opens in the look of whoever used this browser last
    try { localStorage.setItem('nx-last-look', JSON.stringify(this.settings.appearance)); } catch { /* private mode */ }
  }

  _deviceKey() { return `nx-device:p${this.profile?.id ?? 0}`; }

  // ── boot ────────────────────────────────────────────────────────────────
  async init() {
    paintLastLook();
    // who is trading: everything browser-side is kept per profile
    const me = await api.me();
    if (!me.profile) { window.location.replace('profiles.html'); return; }
    this.profile = me.profile;
    this.auth = me.auth;
    await useProfileStorage(me.profile.id, me.first);
    const saved = storage('rt:settings', null);
    let device = null;
    try { device = JSON.parse(localStorage.getItem(this._deviceKey()) || 'null'); } catch { device = null; }
    this.settings = merge(DEFAULT_SETTINGS, { ...(saved || {}), ...(device || {}) });
    this.settings.appearance = normalizeAppearance(saved?.appearance);
    // RV Next: orders go in without a stop or target of their own (they are
    // dragged out on the chart) and are sized to a % risk by default
    if ((this.settings.ticket.v || 1) < 2) Object.assign(this.settings.ticket, { slOn: false, tpOn: false, sizeMode: 'risk', riskPct: this.settings.ticket.riskPct || 1, v: 2 });
    // ⏭ moves one candle of the chart (Alltra's), once over a copied setting
    if (!this.settings.nxStep) { this.settings.stepUnit = 'bar'; this.settings.nxStep = 1; }
    // the favourites bar starts over again at the chart's top right (it used to sit on the legend)
    if (!this.settings.nxFav2) { delete this.settings.favBar; this.settings.nxFav2 = 1; }
    if (configureICT(this.settings)) this.saveSettings();
    // first visit on this phone: give the chart the room
    if (!device && window.innerWidth < 760) this.settings.bottomCollapsed = true;
    const paint = applyAppearance(this.settings.appearance);
    revealPage();
    liquidGlass();
    this.chart = new TradingChart($('#chart'), {
      tz: this.settings.tz, theme: paint.theme, look: paint.look, host: $('#chart-area'),
      // the legend is redrawn at most once per screen frame
      onCrosshair: (p) => {
        this._lastParam = p;
        this.plus?.update(p?.point);
        this._syncCross(this.chart, p);
        if (!this._legendFrame) this._legendFrame = requestAnimationFrame(() => { this._legendFrame = 0; this.renderLegend(this._lastParam); });
      },
      onNeedOlder: () => this.loadOlder(),
      onNeedNewer: () => this.loadNewer(),
    });
    this.chart.setAccent(paint.appearance.accent);
    this.drawings = new DrawingManager(this.chart, {
      requestText: (initial, submit) => this.textDrawingDialog(initial, submit),
      onChange: () => this.saveDrawings(),
      onSelect: (d) => this.renderDrawingProps(d),
      onToolChange: () => { this.renderToolbar(); this.renderMobile(); },
      format: {
        price: (p) => F.price(p, this.ds ? this.ds.decimals : 5),
        pips: (d) => F.num(Math.abs(d) / (this.ds ? this.ds.pip_size : 0.0001), 1),
        pct: (x) => F.pct(Math.abs(x), 2),
      },
    });
    this.drawings.magnet = this.settings.magnet;
    this.drawings.keepDrawing = !!this.settings.keepDrawing;
    if (!Array.isArray(this.settings.drawFavs)) this.settings.drawFavs = ['trend', 'hline', 'rect'];
    this.drawings.defaults = (type) => this.settings.drawDefaults?.[type] || null;
    this.tradeLines = new TradeLines(this.chart, {
      getBroker: () => (this.mode === 'replay' ? this.broker : null),
      money: (x) => F.signedMoney(x, this.broker ? this.broker.cfg.currency : 'USD'),
      onModify: (kind, id, field, price) => {
        if (field === 'price') this.modifyOrder(id, { price: Number(price.toFixed(this.ds.decimals)) });
        else this.setStop(kind, id, field, price);
      },
      chips: true,
      onSync: () => this.orderLayer?.sync(),
    });
    this.drawings.addInterceptor(this.tradeLines.interceptor());
    // the chips beside the lines: TP / SL to drag out, lot, P&L, close
    this.orderLayer = new OrderLayer(this.chart, {
      getBroker: () => (this.mode === 'replay' ? this.broker : null),
      getDraft: () => this._draftView(),
      money: (x) => F.signedMoney(x, this.broker ? this.broker.cfg.currency : 'USD'),
      num: (x, d) => F.num(x, d),
      preview: (kind, item, field, price) => (kind === 'draft' ? this._draftPreview(field, price) : this._stopPreview(kind, item, field, price)),
      onStop: (kind, id, field, price) => (kind === 'draft' ? this.setDraftStop(field, price) : this.setStop(kind, id, field, price)),
      onPrice: (id, price) => (id === 'draft' ? this.setDraftPrice(price) : this.modifyOrder(id, { price: Number(price.toFixed(this.ds.decimals)) })),
      onClose: (kind, id) => (kind === 'draft' ? this.cancelDraft() : kind === 'pos' ? this.closePosition(id) : this.cancelOrder(id)),
      onMenu: (kind, id, anchor) => (kind === 'draft' ? this.sizeMenu(anchor) : this.tradeMenu(kind, id, anchor)),
      onDrag: (spec, price) => this.tradeLines.moveLine(spec.role === 'entry' ? `o${spec.item.id}:price` : `${spec.kind === 'pos' ? 'p' : 'o'}${spec.item.id}:${spec.role}`, price),
      hint: (text) => toast(text, 'info', 2600),
    });
    this.tradeLines.onDragMove = (spec, price) => {
      const row = this.orderLayer.rows.get(spec.field === 'price' ? `o${spec.id}` : `${spec.kind === 'pos' ? 'p' : 'o'}${spec.id}:${spec.field}`);
      if (row) { row.price = price; if (spec.field !== 'price') this.orderLayer._stopLabel(row, price); this.orderLayer._place(); }
    };
    this.plus = new PlusButton(this.chart, { onClick: (price, anchor) => this.plusMenu(price, anchor) });
    // Buy / lot / Sell at the chart's foot (FX Replay, Alltra): market orders in one tap
    this.tradeBar = h('div.trade-bar', { role: 'group', 'aria-label': 'Hızlı işlem' });
    $('#cs-left').append(this.tradeBar);
    // the account at the strip's right end: balance, open P&L (FX Replay's)
    this.acctEl = h('div.cs-acct', { hidden: true });
    // the replay's time sits with the account on a wide screen (the dock's own on a phone)
    this.clockWide = h('span.clock.cs-clock', { hidden: true });
    $('#cs-right').append(this.clockWide, this.acctEl);
    this.ticket = new Ticket($('#sidepanel'), this);
    this.statsView = new StatsView(h('div'));
    this.strategyView = new StrategyView(h('div'), this);
    this.dataView = new DataView(h('div'), this);

    // canvas text is drawn once the fonts are there
    document.fonts?.ready.then(() => this.chart.applyLook());
    this._paintStatic();
    this._wirePointerLight();
    this.renderToolbar();
    this.renderTabs();
    this.renderProfileChip();
    this.renderModeSwitch();
    this.applyLayout();
    this._wireTopbar();
    this._wireKeyboard();
    wirePalette(() => this._paletteItems(), { typeToSearch: true });
    wireTooltips();
    this._wireBottomResize();
    // phones: the open panel is a sheet over the chart, closed from here
    $('#bottom').append(h('button.tab-close.mobile-only', { type: 'button', title: 'Kapat', 'aria-label': 'Paneli kapat',
      onclick: () => { this.settings.bottomCollapsed = true; this.applyBottomSize(); this.saveSettings(); } }, icon('close', 16)));
    // tables in the bottom panel get column names on their cells (phone cards)
    const tabBody = $('#tab-body');
    let labelling = 0;
    new MutationObserver(() => {
      if (!labelling) labelling = requestAnimationFrame(() => { labelling = 0; labelTables(tabBody); });
    }).observe(tabBody, { childList: true, subtree: true });
    this._wireContextMenu();
    this.applyBottomSize();

    // the side panels start alongside: the chart never waits for them
    this.showMessage('Grafik açılıyor…');
    const sides = Promise.allSettled([this.strategyView.init(), this.dataView.init()]).then(() => this.renderTab());
    // a step that does not end is named on the screen, never a silent blank
    const slow = setTimeout(() => { if (!this.ds) this.showMessage('Veri listesi bekleniyor… Uzun sürerse sayfayı yenile; düzelmezse “Test sürümünü sıfırla” ile baştan başla.'); }, 12000);
    // links from the home screen: /chart.html?ds=..&tf=.., ?session=.., ?backtest=.., ?tab=.., ?new=replay
    const q = new URLSearchParams(location.search);
    if (q.toString()) history.replaceState(null, '', location.pathname);
    if (q.get('tf')) this.settings.tf = q.get('tf');
    // the replay to come back to, as it was when the page opened (one started
    // while the page loads is not reopened over itself)
    const resume = this.settings.resume;
    try {
      await this.loadDatasets(Number(q.get('ds')) || this.settings.datasetId);
      await this._openFromLink(q, resume);
    } catch (err) {
      console.error(err);
      this.showMessage(`Grafik açılamadı: ${err.message || err}`);
    } finally {
      clearTimeout(slow);
    }
    void sides;

    // a cloud profile changed on another device: a replay open here is left
    // alone (the page reload brings the other device's state)
    window.addEventListener('rv-synced', (e) => {
      const open = this.session?.id && e.detail.changed.some((c) => c.kind === 'session' && c.key === this.session.id);
      toast(open ? 'Bu replay başka cihazda ilerledi: sayfayı yenileyince oradan devam eder' : 'Diğer cihazdaki değişiklikler geldi; yenileyince görünür', open ? 'warn' : 'info', 7000);
    });
    setInterval(() => { if (this.dirty) this.save(); }, 2500);
    window.addEventListener('beforeunload', () => { if (this.dirty) this.save(true); });
  }

  async _openFromLink(q, resume = this.settings.resume) {
    // any explicit link (not a plain reload) ends the "come back to the replay" state
    if (this.settings.resume && q.toString() && !q.get('session')) { this.settings.resume = null; this.saveSettings(); }
    try {
      if (q.get('session')) { await this.openSession(q.get('session')); return; }
      if (q.get('backtest')) { await this.openBacktest(q.get('backtest')); return; }
      if (TABS.some(([id]) => id === q.get('tab'))) this.openTab(q.get('tab'));
      if (q.get('new') === 'replay') { this.newSessionDialog(); return; }
      if (q.get('mode') === 'live') { this.switchMode('live'); return; }
      // a reload in the middle of a replay comes back to it
      if (!q.toString() && resume && this.mode !== 'replay') await this.openSession(resume);
    } catch (err) {
      if (this.settings.resume) { this.settings.resume = null; this.saveSettings(); }
      toast(err.status === 404 ? 'Bu kayıt artık yok' : err.message, 'err');
    }
  }

  /** Open a run from the strategy test history. */
  async openBacktest(id) {
    const s = await api.session(id);
    const st = s.state;
    if (!this.datasets.some((d) => d.id === st.dsId)) { toast('Bu testin veri seti silinmiş', 'err'); return; }
    if (this.mode === 'replay') await this.exitReplay(true, false);
    if (this.mode === 'live') await this.exitLive();
    if (!this.ds || this.ds.id !== st.dsId) await this.selectDataset(st.dsId);
    if (st.tf && st.tf !== this.tfId && this.ds.timeframes.includes(st.tf)) await this.setTf(st.tf);
    const r = this.strategyView.showSaved(s);
    this.openTab('strategy');
    this.showBacktest(r, { quiet: true });
  }

  // ── datasets & browsing ────────────────────────────────────────────────
  async loadDatasets(selectId, { keep = false } = {}) {
    try { this.datasets = await api.datasets(); } catch (err) {
      // said on the chart, where it stays, with a way to try again
      this.showMessage(`Veri listesi alınamadı: ${err.message || err}`);
      const msg = $('#chart-msg');
      msg.append(h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
        h('button.btn.small.primary', { onclick: () => { this.showMessage('Grafik açılıyor…'); this.loadDatasets(selectId); } }, 'Tekrar dene'),
        h('a.btn.small', { href: 'sifirla.html' }, 'Test sürümünü sıfırla')));
      return;
    }
    this.renderInstrument();
    if (keep && this.mode === 'live') return;
    if (keep && this.ds && this.datasets.some((d) => d.id === this.ds.id)) {
      const before = this.ds.bar_count;
      this.ds = this.datasets.find((d) => d.id === this.ds.id);
      this.renderInstrument();
      if (this.mode === 'browse') this.renderReplayControls();
      if (this.mode === 'browse' && !before && this.ds.bar_count) await this.loadBrowse();
      if (this.bottomTab === 'data') this.renderTab();
      return;
    }
    // a 15-year pack first, then whatever was used last; a download that
    // stopped half way is passed over for the same market read from the site
    const usable = (d) => !d.meta?.partial;
    const packs = this.datasets.filter((d) => d.meta?.pack && d.bar_count && usable(d));
    const last = this.datasets.find((d) => d.id === selectId);
    const id = last && usable(last) ? last.id
      : (packs.find((d) => d.symbol === last?.symbol && d.stream) || packs.find((d) => d.stream) || packs[0] || this.datasets.find(usable) || this.datasets[0])?.id;
    if (id == null) {
      this.ds = null;
      this.chart.setBars([]);
      this.renderInstrument();
      this.showMessage('Henüz veri yok. Alttaki “Veri” sekmesinden 15 yıllık EURUSD, NASDAQ ve altın paketlerini tek tıkla indirin.');
      this.openTab('data');
      return;
    }
    await this.selectDataset(id);
    // only the synthetic demo so far: show where the real data comes from
    if (!packs.length && this.datasets.every((d) => d.source === 'demo') && !this._packsHinted) {
      this._packsHinted = true;
      this.openTab('data');
    }
  }

  openTab(id) {
    this.settings.bottomTab = id;
    this.settings.bottomCollapsed = false;
    this.applyBottomSize();
    this.renderTabs();
    this.renderTab();
    this.saveSettings();
  }

  /** The instrument button in the top bar. */
  renderInstrument() {
    const btn = $('#instrument-btn');
    btn.classList.toggle('live', this.mode === 'live');
    const ds = this.ds;
    $('#instrument-sym').textContent = ds ? ds.symbol : '—';
    $('#instrument-sub').textContent = !ds ? 'veri seti seçin'
      : this.mode === 'live' ? `canlı · ${ds.source === 'oanda' ? 'OANDA' : 'Binance'}`
        : `${ds.meta?.pack ? `${PACK_NAMES[ds.meta.pack] || ds.name} · ` : ''}${ds.base_tf} · ${ds.first_ts ? `${new Date(ds.first_ts * 1000).getUTCFullYear()}–${new Date(ds.last_ts * 1000).getUTCFullYear()}` : 'boş'}`;
  }

  /** The markets of the replay session as tabs (FX Replay style); the
   *  plus adds one. Open positions show as a count on their tab. */
  renderLegs() {
    const el = $('#legs');
    if (!el) return;
    const on = this.mode === 'replay' && this.legs.length > 0;
    el.classList.toggle('hidden', !on);
    if (!on) { el.replaceChildren(); return; }
    el.replaceChildren(
      ...this.legs.map((leg) => {
        const open = leg.broker.positions.length;
        const pnl = open ? leg.broker.openPnl() : 0;
        return h(`button.leg${leg === this.leg ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(leg === this.leg),
          title: `${leg.ds.symbol}${open ? ` · ${open} açık pozisyon` : ''}`, onclick: () => this.switchLeg(leg) },
        h('span.leg-sym', {}, leg.ds.symbol),
        open ? h(`span.leg-pos.${F.cls(pnl)}`, {}, String(open)) : null);
      }),
      h('button.leg.leg-add', { type: 'button', title: 'Oturuma piyasa ekle', 'aria-label': 'Oturuma piyasa ekle', onclick: () => this.openInstrumentPicker() }, icon('plus', 14)));
  }

  closePopover() {
    this._popover?.remove();
    this._popover = null;
    if (this._popOff) { document.removeEventListener('pointerdown', this._popOff, true); this._popOff = null; }
  }

  popover(anchor, content, { align = 'left' } = {}) {
    this.closePopover();
    const el = h('div.popover.glass-pop', { role: 'menu' }, content);
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = align === 'right' ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
    el.style.left = `${Math.max(8, left)}px`;
    // below the button, or above it when the screen ends first (the replay dock)
    const hgt = el.offsetHeight;
    const below = r.bottom + 8 + hgt <= window.innerHeight - 8 || r.top - 8 - hgt < 8;
    el.style.top = `${below ? r.bottom + 8 : r.top - 8 - hgt}px`;
    el.classList.toggle('above', !below);
    this._popover = el;
    setTimeout(() => {
      if (this._popover !== el) return;
      const off = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) this.closePopover(); };
      this._popOff = off;
      document.addEventListener('pointerdown', off, true);
    }, 0);
    return el;
  }

  openInstrumentPicker() {
    if (this._popover) { this.closePopover(); return; }
    const tz = this.settings.tz;
    const replay = this.mode === 'replay';
    const inSession = (d) => replay && this.legs.some((l) => l.ds.id === d.id);
    const row = (d) => h(`button.item${this.ds && d.id === this.ds.id && this.mode !== 'live' ? '.on' : ''}`, {
      onclick: () => { this.closePopover(); this.selectDataset(d.id); },
    },
    h('span', {}, h('span.t', {}, d.symbol), h('span.s', {}, d.meta?.pack ? (PACK_NAMES[d.meta.pack] || d.name) : d.name)),
    h('span.r', {}, `${d.base_tf} · ${d.source}`, h('br'), d.first_ts ? `${F.dateOnly(d.first_ts, tz)} → ${F.dateOnly(d.last_ts, tz)}` : 'boş'));
    const packs = this.datasets.filter((d) => d.meta?.pack && !inSession(d));
    const mine = this.datasets.filter((d) => !d.meta?.pack && !inSession(d));
    const recent = replay ? [] : storage('rt:live:recent', []).slice(0, 4);
    const legRow = (leg) => h(`div.item.leg-row${leg === this.leg ? '.on' : ''}`, {},
      h('button.leg-go', { type: 'button', onclick: () => { this.closePopover(); this.switchLeg(leg); } },
        h('span', {}, h('span.t', {}, leg.ds.symbol), h('span.s', {}, leg.broker.positions.length ? `${leg.broker.positions.length} açık pozisyon` : leg.ds.meta?.pack ? (PACK_NAMES[leg.ds.meta.pack] || leg.ds.name) : leg.ds.name))),
      this.legs.length > 1 ? h('button.btn.small.outline.leg-remove', { type: 'button', title: 'Oturumdan çıkar', onclick: () => { this.closePopover(); this.removeLeg(leg); } }, 'Çıkar') : null);
    // (in a replay on a wide screen the tabs stand in for the instrument button)
    const anchor = $('#instrument-btn').offsetParent ? $('#instrument-btn') : $('#legs .leg-add') || $('#instrument-btn');
    this.popover(anchor, [
      replay ? [h('h5', {}, 'Bu oturumdaki piyasalar'), ...this.legs.map(legRow), h('hr'), h('h5', {}, 'Oturuma ekle · aynı anda ilerler')] : null,
      packs.length ? [replay ? null : h('h5', {}, 'Veri paketleri · 15 yıl'), ...packs.map(row)] : null,
      packs.length && mine.length ? h('hr') : null,
      mine.length ? [h('h5', {}, 'Veri setlerim'), ...mine.map(row)] : null,
      recent.length ? [h('hr'), h('h5', {}, 'Canlı'), ...recent.map((r) => h('button.item', { onclick: async () => {
        this.closePopover();
        try { await this.startLive(r); } catch (err) { toast(err.message, 'err', 6000); }
      } }, icon('live', 16), h('span', {}, h('span.t', {}, r.symbol), h('span.s', {}, r.provider === 'oanda' ? 'OANDA canlı' : 'Binance canlı'))))] : null,
      replay ? null : h('div.footer', {},
        h('button.btn.small.primary', { onclick: () => { this.closePopover(); this.openTab('data'); } }, icon('download', 14), '15 yıllık veri indir'),
        h('button.btn.small.outline', { onclick: () => { this.closePopover(); D.liveDialog(this); } }, icon('live', 14), 'Canlı grafik')),
    ].flat().filter(Boolean));
  }

  /** Icons in the static markup, the brand mark. */
  _paintStatic() {
    for (const el of $$('[data-icon]')) el.replaceChildren(icon(el.dataset.icon, el.dataset.icon === 'chevron' ? 14 : 18));
  }

  _wirePointerLight() { wirePointerLight(); }

  /** Grafik / Replay / Canlı */
  renderModeSwitch() {
    const el = $('#mode-switch');
    el.replaceChildren(...MODES.map(([mode, label, ic]) => h(`button${this.mode === mode ? '.on' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': this.mode === mode ? 'true' : 'false', title: label,
      // phones show only the mode in use: a tap on it offers the others
      onclick: (e) => (this.mode === mode && window.innerWidth <= 760 ? this.modeMenu(e.currentTarget) : this.switchMode(mode)),
    }, icon(ic, 16), h('span.lbl', {}, label))));
  }

  modeMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    this.popover(anchor, MODES.map(([mode, label, ic]) => h(`button.item${this.mode === mode ? '.on' : ''}`, { onclick: () => { this.closePopover(); if (mode === this.mode && mode !== 'live') return; this.switchMode(mode); } },
      icon(ic, 16), h('span.t.plain', {}, label))), { align: 'left' });
  }

  async switchMode(mode) {
    if (mode === this.mode) {
      if (mode === 'live') D.liveDialog(this);
      return;
    }
    if (mode === 'browse') {
      if (this.mode === 'replay') await this.exitReplay();
      else if (this.mode === 'live') await this.exitLive();
    } else if (mode === 'replay') {
      if (this.mode === 'live') await this.exitLive();
      this.newSessionDialog();
    } else if (mode === 'live') {
      D.liveDialog(this);
    }
  }

  /** Mode classes on #app drive what the layout shows (side panel, dock). */
  applyLayout() {
    const app = $('#app');
    for (const m of ['browse', 'replay', 'live']) app.classList.toggle(`mode-${m}`, this.mode === m);
    const open = !!this.settings.panel?.[this.mode];
    app.classList.toggle('panel-open', open);
    app.classList.toggle('panel-closed', !open);
    $('#btn-panel').classList.toggle('active', open);
    requestAnimationFrame(() => this.chart?.placeAxisZone?.());
  }

  togglePanel() {
    if (window.innerWidth <= 760) { $('#sidepanel').classList.toggle('show'); return; }
    this.settings.panel = { ...this.settings.panel, [this.mode]: !this.settings.panel?.[this.mode] };
    this.saveSettings();
    this.applyLayout();
  }

  renderProfileChip() {
    const p = this.profile;
    $('#btn-profile').replaceChildren(avatar({ ...p, locked: false }, 'sm'), h('span.pname', {}, p.name));
  }

  openProfileMenu() {
    if (this._popover) { this.closePopover(); return; }
    const p = this.profile;
    this.popover($('#btn-profile'), [
      h('div.who', {}, avatar({ ...p, locked: false }, 'md'), h('div', {}, h('b', {}, p.name), h('span.muted', { style: { fontSize: '12px' } }, 'Oturumlar, backtestler ve çizimler bu profile ait'))),
      h('a.item', { href: 'home.html' }, icon('home', 16), h('span', {}, h('span.t.plain', {}, 'Ana ekran'), h('span.s', {}, 'piyasalar, oturumlar, test geçmişi'))),
      h('button.item', { onclick: async () => { this.closePopover(); if (this.dirty) await this.save(); await flushStorage(); await api.leaveProfile(); window.location.replace('profiles.html'); } }, icon('swap', 16), h('span.t.plain', {}, 'Profil değiştir')),
      // phones have no room for these in the top bar, so they live here
      ...(window.innerWidth <= 760 ? [
        h('button.item', { onclick: () => { this.closePopover(); D.indicatorsDialog(this); } }, icon('indicator', 16), h('span', {}, h('span.t.plain', {}, 'İndikatör ekle'), h('span.s', {}, 'EMA, RSI, kill zone…'))),
        h('button.item', { onclick: () => { this.closePopover(); this.sessionsDialog(); } }, icon('sessions', 16), h('span', {}, h('span.t.plain', {}, 'Replay oturumları'), h('span.s', {}, 'kayıtlı oturumlara dön'))),
        h('button.item', { onclick: () => { this.closePopover(); openPalette(() => this._paletteItems()); } }, icon('search', 16), h('span', {}, h('span.t.plain', {}, 'Ara'), h('span.s', {}, 'sembol, zaman dilimi, komut'))),
      ] : []),
      h('button.item', { onclick: () => { this.closePopover(); this.lookSheet(); } }, icon('palette', 16), h('span', {}, h('span.t.plain', {}, 'Görünüm'), h('span.s', {}, 'tema, vurgu rengi, mum renkleri'))),
      h('button.item', { onclick: () => { this.closePopover(); D.settingsDialog(this); } }, icon('sliders', 16), h('span', {}, h('span.t.plain', {}, 'Ayarlar'), h('span.s', {}, 'saat dilimi, hesap, API anahtarı'))),
      this.auth ? h('button.item', { onclick: async () => { if (this.dirty) await this.save(); await flushStorage(); await api.logout(); window.location.replace('profiles.html'); } }, icon('power', 16), h('span.t.plain', {}, 'Siteden çıkış')) : null,
    ].filter(Boolean), { align: 'right' });
  }

  async selectDataset(id) {
    if (this.mode === 'live') this._stopLive();
    if (this.mode === 'replay') {
      // in a replay another market joins the session (or comes on the chart)
      await this.addLeg(this.datasets.find((d) => d.id === id));
      return;
    }
    this.ds = this.datasets.find((d) => d.id === id);
    if (!this.ds) return;
    this.settings.datasetId = id;
    if (!this.ds.timeframes.includes(this.settings.tf)) {
      this.settings.tf = this.ds.timeframes.includes('15m') ? '15m' : this.ds.timeframes[0];
    }
    this.saveSettings();
    this.renderInstrument();
    this.backtest = null;
    this.clearPlots();
    this.chart.setFormat({ tz: this.settings.tz, decimals: this.ds.decimals, tf: this.tf, align: this.ds.align });
    this.drawings.load(storage(`rt:drawings:${id}`, []));
    this.restoreIndicators();
    this.renderTfButtons();
    this.renderReplayControls();
    this.ticket.render();
    try {
      await this.loadBrowse();
    } catch (err) {
      // this copy cannot be read (a download cut short): the same market
      // read from the site, if there is one
      const alt = !this.ds.stream && this.datasets.find((d) => d.stream && d.symbol === this.ds.symbol);
      if (alt) { toast(`${this.ds.symbol}: indirilen kopya okunamadı, siteden açılıyor`, 'warn', 6000); await this.selectDataset(alt.id); return; }
      this.showMessage(`Veri açılamadı: ${err.message || err}`);
    }
    this.renderTab();
  }

  showMessage(text) {
    const el = $('#chart-msg');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  async loadBrowse(around = null) {
    if (!this.ds || this.mode !== 'browse') return;
    const token = ++this._loadToken;
    const stale = () => token !== this._loadToken || this.mode !== 'browse';
    if (!this.ds.bar_count) { this.chart.setBars([]); this.showMessage('Bu veri setinde bar yok.'); return; }
    this.showMessage('');
    let bars;
    if (around != null) {
      const r = await api.bars(this.ds.id, { tf: this.tfId, to: around + 400 * this.tf.seconds, limit: BROWSE_BARS });
      if (stale()) return;
      bars = columnsToBars(r);
      this.chart.setBars(bars);
      this.chart.showTime(around, 160);
    } else {
      const r = await api.bars(this.ds.id, { tf: this.tfId, limit: BROWSE_BARS });
      if (stale()) return;
      bars = columnsToBars(r);
      this.chart.setBars(bars, { fit: true });
    }
    this.updateMarkers();
    this.renderLegend(null);
  }

  // Edge loads answer later; by then the chart may show other bars (a new
  // dataset, timeframe, or the reload after leaving replay). Only apply the
  // answer if the edge it was asked for is still there.
  _edge(which) {
    const bars = this.chart.bars;
    const b = which === 'first' ? bars[0] : bars[bars.length - 1];
    return { time: b?.time, token: this._loadToken, mode: this.mode, ds: this.ds };
  }

  _stillAt(edge, which) {
    const now = this._edge(which);
    return now.time === edge.time && now.token === edge.token && now.mode === edge.mode && now.ds === edge.ds;
  }

  async loadOlder() {
    if (!this.ds || !this.chart.bars.length) return;
    const edge = this._edge('first');
    if (this.mode === 'live') {
      const first = this.chart.bars[0].time;
      const { provider, symbol } = this.liveState;
      const r = await api.live({ provider, symbol, tf: this.tfId, count: 1000, to: first });
      if (!this._stillAt(edge, 'first')) return;
      const older = columnsToBars(r).filter((b) => b.time < first);
      if (older.length) this.chart.prependBars(older);
      return;
    }
    if (this.mode === 'replay') {
      const engine = this.engine;
      const n = await engine.loadOlder(2000);
      if (this.engine !== engine || this.mode !== 'replay') return;
      if (n) {
        const range = this.chart.chart.timeScale().getVisibleLogicalRange();
        this.chart.setBars(this.engine.bars, { keepLogical: range ? { from: range.from + n, to: range.to + n } : null });
        this.updateMarkers();
      }
      return;
    }
    const r = await api.bars(this.ds.id, { tf: this.tfId, before: this.chart.bars[0].time, limit: 2000 });
    if (!this._stillAt(edge, 'first')) return;
    if (r.count) { this.chart.prependBars(columnsToBars(r)); this.updateMarkers(); }
  }

  async loadNewer() {
    if (this.mode !== 'browse' || !this.ds || !this.chart.bars.length) return;
    const last = this.chart.bars[this.chart.bars.length - 1];
    if (last.time >= bucket(this.ds.last_ts, this.tf, this.ds.align)) return;
    const edge = this._edge('last');
    const r = await api.bars(this.ds.id, { tf: this.tfId, after: last.time, limit: 2000 });
    if (!this._stillAt(edge, 'last')) return;
    if (r.count) { this.chart.appendBars(columnsToBars(r)); this.updateMarkers(); }
  }

  async setTf(id) {
    if (!this.ds || id === this.tfId) return;
    const center = this._viewCenterTime();
    this.settings.tf = id;
    this.saveSettings();
    this.chart.setFormat({ tf: this.tf });
    this.renderTfButtons();
    this.renderMobile();
    if (this.mode === 'replay') {
      this.chart.setBars(await this.engine.setTf(id), { fit: true });
      this.updateMarkers();
      this.renderLegend(null);
    } else if (this.mode === 'live') {
      await this._loadLive();
    } else {
      await this.loadBrowse(center);
    }
    if (this.backtest) this.showBacktest(this.backtest, { quiet: true });
  }

  _viewCenterTime() {
    const r = this.chart.chart.timeScale().getVisibleLogicalRange();
    if (!r || !this.chart.bars.length) return null;
    const last = this.chart.bars.length - 1;
    if (r.to >= last) return null; // following the latest bar: stay there
    return this.chart.logicalToTime(Math.max(0, Math.min(last, (r.from + r.to) / 2)));
  }

  // ── live charts ────────────────────────────────────────────────────────
  async startLive({ provider, symbol }) {
    if (this.mode === 'replay') await this.exitReplay(true, false);
    const tfs = await api.liveTimeframes(provider);
    const tf = tfs.includes(this.tfId) ? this.tfId : (tfs.includes('15m') ? '15m' : tfs[0]);
    const token = ++this._loadToken;
    const r = await api.live({ provider, symbol, tf, count: 1000 });
    if (!r.count) throw new Error(`${symbol} için veri gelmedi: sembol doğru mu?`);
    if (token !== this._loadToken) return;
    if (this.mode !== 'live') this._dsBeforeLive = this.ds;
    clearInterval(this._liveTimer);
    this.mode = 'live';
    this.liveState = { provider, symbol: r.symbol };
    this.ds = {
      id: `live:${provider}:${r.symbol}`, symbol: r.display, name: `${r.display} canlı`, source: provider, live: true,
      base_tf: tf, align: r.align, decimals: r.decimals, pip_size: r.pip_size, contract_size: r.contract_size,
      currency: r.currency, quote_conv: r.quote_conv, timeframes: tfs,
    };
    this.settings.tf = tf;
    this.saveSettings();
    const recent = storage('rt:live:recent', []).filter((x) => !(x.provider === provider && x.symbol === r.symbol));
    store('rt:live:recent', [{ provider, symbol: r.symbol }, ...recent].slice(0, 8));
    this.backtest = null;
    this.clearPlots();
    this._liveError = null;
    this.showMessage('');
    this.chart.setFormat({ decimals: r.decimals, tf: this.tf, align: r.align });
    this.drawings.load(storage(`rt:drawings:${this.ds.id}`, []));
    this.chart.setBars(columnsToBars(r), { fit: true });
    this.chart.setMarkers([]);
    this._liveUpdated = Date.now();
    this.renderInstrument();
    this.renderModeSwitch();
    this.applyLayout();
    this.renderTfButtons();
    this.renderReplayControls();
    this.ticket.render();
    this.renderTabs();
    this.renderTab();
    this.renderLegend(null);
    this._liveTimer = setInterval(() => this._livePoll(), 2000);
  }

  async _loadLive() {
    const { provider, symbol } = this.liveState;
    const token = ++this._loadToken;
    const r = await api.live({ provider, symbol, tf: this.tfId, count: 1000 });
    if (token !== this._loadToken || this.mode !== 'live') return;
    this.ds.base_tf = this.tfId;
    this.chart.setBars(columnsToBars(r), { fit: true });
    this.renderLegend(null);
  }

  async _livePoll() {
    if (this.mode !== 'live' || document.hidden || this._livePolling) return;
    this._livePolling = true;
    const { provider, symbol } = this.liveState;
    const tf = this.tfId;
    try {
      const r = await api.live({ provider, symbol, tf, count: 3 });
      if (this.mode !== 'live' || this.tfId !== tf || this.liveState?.symbol !== symbol) return;
      const bars = this.chart.bars;
      let from = bars.length;
      for (const b of columnsToBars(r)) {
        const last = bars[bars.length - 1];
        if (!last || b.time > last.time) { bars.push(b); from = Math.min(from, bars.length - 1); continue; }
        for (let i = bars.length - 1; i >= Math.max(0, bars.length - 5); i--) {
          if (bars[i].time !== b.time) continue;
          const c = bars[i];
          if (c.open !== b.open || c.high !== b.high || c.low !== b.low || c.close !== b.close || c.volume !== b.volume) {
            Object.assign(c, b);
            from = Math.min(from, i);
          }
          break;
        }
      }
      if (from < bars.length) this.chart.updateFrom(from);
      const wasError = this._liveError;
      this._liveError = null;
      this._liveUpdated = Date.now();
      if (wasError) this.renderReplayControls();
      this.renderClock();
      this.ticket.update();
      if (!this._lastParam || !this._lastParam.time) this.renderLegend(null);
      const lastBar = bars[bars.length - 1];
      if (lastBar) document.title = `${this.ds.symbol} ${F.price(lastBar.close, this.ds.decimals)} · RV`;
    } catch (err) {
      if (!this._liveError) { this._liveError = err.message; this.renderReplayControls(); this.renderLegend(null); toast(`Canlı veri alınamadı: ${err.message}`, 'err', 6000); }
    } finally {
      this._livePolling = false;
    }
  }

  _stopLive() {
    clearInterval(this._liveTimer);
    this._liveTimer = null;
    this.mode = 'browse';
    this.ds = this._dsBeforeLive || null;
    this.liveState = null;
    this._liveError = null;
    document.title = 'RV · Replay Terminal';
    this.renderModeSwitch();
    this.applyLayout();
  }

  async exitLive() {
    const prev = this._dsBeforeLive;
    this._stopLive();
    if (prev && this.datasets.some((d) => d.id === prev.id)) await this.selectDataset(prev.id);
    else await this.loadDatasets();
  }

  async downloadLiveHistory() {
    if (this.mode !== 'live') return;
    const { provider, symbol } = this.liveState;
    const end = Math.floor(Date.now() / 1000);
    try {
      // ten years of 1-minute bars (a younger symbol simply starts later)
      await api.download({ provider, symbol, tf: '1m', start: end - Math.round(10 * 365.25 * 86400), end });
      toast('Son 10 yılın 1 dakikalık verisi iniyor (birkaç dakika sürebilir). Bitince veri seti listesinde görünür; oradan replay başlatabilirsiniz.', 'ok', 9000);
      await this.dataView.refreshJobs();
      this.openTab('data');
    } catch (err) { toast(err.message, 'err', 8000); }
  }

  async onApiChanged() {
    await this.dataView.init();
    if (this.bottomTab === 'data') this.renderTab();
  }

  // ── replay sessions ────────────────────────────────────────────────────
  _newBroker(ds = this.ds) {
    const a = this.settings.account;
    return new Broker({
      balance: a.balance, currency: ds.currency, contractSize: ds.contract_size, pipSize: ds.pip_size,
      decimals: ds.decimals, spread: a.spreadPips * ds.pip_size, commission: a.commission,
      quoteConv: ds.quote_conv, sameBar: a.sameBar,
    });
  }

  newSessionDialog(opts) {
    if (this.mode === 'live') { toast('Canlı grafikte replay olmaz: önce “10 yılı indir”, sonra o veri setinde replay başlatın', 'warn', 7000); return; }
    D.newSessionDialog(this, opts);
  }
  sessionsDialog() { D.sessionsDialog(this); }

  _useLeg(leg) {
    // a draft belongs to the market it was made on
    if (this.draft && this.leg !== leg) { this.draft = null; this._draftChanged(); }
    this.leg = leg;
    this.ds = leg.ds;
    this.engine = leg.engine;
    this.broker = leg.broker;
  }

  /** Every market of the session (in browse mode: none). */
  _allLegs() { return this.legs.length ? this.legs : this.broker ? [{ ds: this.ds, engine: this.engine, broker: this.broker }] : []; }

  /** A market of the session at base time `cursor`, with its broker (a
   *  fresh one, or one saved before). */
  async _openLeg(ds, cursor, saved = null) {
    const engine = new ReplayEngine(ds);
    const tf = ds.timeframes.includes(this.tfId) ? this.tfId : ds.timeframes.includes('15m') ? '15m' : ds.timeframes[0];
    await engine.load(tf, cursor);
    const broker = saved?.broker ? Broker.fromJSON(saved.broker) : this._newBroker(ds);
    const c = engine.current;
    if (!saved?.broker && c) broker.onBar({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close });
    return { ds, key: dsKey(ds), engine, broker, drawings: saved?.drawings || [] };
  }

  /** A dataset of this device for a market saved in a session (maybe on
   *  another device, where the ids differ). */
  _legDataset(spec) {
    const byId = this.datasets.find((d) => d.id === spec.datasetId);
    if (byId && (!spec.key || dsKey(byId) === spec.key)) return byId;
    const byKey = spec.key && this.datasets.find((d) => dsKey(d) === spec.key);
    if (byKey) return byKey;
    const [kind, pack] = String(spec.key || '').split(':');
    if (kind === 'pack') return this.datasets.find((d) => d.meta?.pack === pack) || null;
    return spec.symbol ? this.datasets.find((d) => d.symbol === spec.symbol && d.bar_count) || null : null;
  }

  async startReplay({ start, name, extra = [] }) {
    const first = await this._openLeg(this.ds, start);
    const legs = [first];
    // the other markets join at the same moment (where they have data then)
    const others = extra.map((id) => this.datasets.find((d) => d.id === id)).filter((d) => d && d.id !== this.ds.id);
    const opened = await Promise.allSettled(others.map((d) => {
      if (d.last_ts && first.engine.cursor > d.last_ts) return Promise.reject(new Error('bu tarihte verisi yok'));
      return this._openLeg(d, first.engine.cursor);
    }));
    opened.forEach((r, i) => { if (r.status === 'fulfilled') legs.push(r.value); else toast(`${others[i].symbol} eklenemedi: ${r.reason?.message || r.reason}`, 'warn', 6000); });
    shareAccount(legs.map((l) => l.broker), first.broker.balance);
    this.legs = legs;
    this._useLeg(first);
    this.session = { id: null, name, startTime: first.engine.cursor, notes: '' };
    this._rewindStart(null);
    const created = await api.createSession({ name, dataset_id: this.ds.id, state: this._state(), summary: this._summary() });
    this.session.id = created.id;
    this.drawings.load([]);
    this._enterReplay();
    toast(`Replay başladı: ${F.dateTime(first.engine.cursor, this.settings.tz)}${legs.length > 1 ? ` · ${legs.map((l) => l.ds.symbol).join(', ')}` : ''}`, 'ok');
  }

  async openSession(id) {
    const s = await api.session(id);
    const st = s.state;
    if (this.mode === 'replay') await this.exitReplay(true, false);
    if (!this.ds || this.ds.id !== s.dataset_id) {
      // the list may predate the packs read from the site: ask again first
      if (!this.datasets.some((d) => d.id === s.dataset_id)) await this.loadDatasets(undefined, { keep: true });
      if (!this.datasets.some((d) => d.id === s.dataset_id)) {
        // a session from another device whose data pack is not on this one yet
        const [kind, pack, tf] = String(s.dataset_key || '').split(':');
        if (kind === 'pack') {
          try {
            await api.downloadPacks({ ids: [pack], tf });
            toast(`Bu oturum ${pack} (${tf}) verisini kullanıyor: bu cihaza iniyor, bitince oturumu tekrar aç`, 'warn', 9000);
            this.openTab('data');
          } catch (err) { toast(err.message, 'err'); }
          return;
        }
        if (this.settings.resume === id) { this.settings.resume = null; this.saveSettings(); }
        toast('Bu oturumun veri seti silinmiş', 'err');
        return;
      }
      await this.selectDataset(s.dataset_id);
    }
    if (st.tf && this.ds.timeframes.includes(st.tf)) { this.settings.tf = st.tf; this.chart.setFormat({ tf: this.tf }); }
    // a session of one market (before there could be more) is a list of one
    const specs = Array.isArray(st.legs) && st.legs.length ? st.legs : [{ datasetId: s.dataset_id, broker: st.broker, drawings: st.drawings }];
    const found = specs.map((spec, i) => (i === 0 && !st.legs ? this.ds : this._legDataset(spec)));
    // two saved markets that land on one dataset here open once
    found.forEach((d, i) => { if (d && found.indexOf(d) !== i) found[i] = null; });
    const opened = await Promise.allSettled(specs.map((spec, i) => (found[i] ? this._openLeg(found[i], st.cursor, spec) : Promise.reject(new Error('veri seti bu cihazda yok')))));
    const legs = [];
    opened.forEach((r, i) => {
      if (r.status === 'fulfilled') legs.push(r.value);
      else {
        const open = (specs[i].broker?.positions || []).length;
        toast(`${specs[i].symbol || 'Bir piyasa'} açılamadı: ${r.reason?.message || r.reason}${open ? ` (${open} açık pozisyonu var)` : ''}`, 'warn', 8000);
      }
    });
    if (!legs.length) { toast('Bu oturumun verisi açılamadı', 'err'); return; }
    shareAccount(legs.map((l) => l.broker), st.account?.balance ?? legs[0].broker.balance);
    this.legs = legs;
    const want = found[st.active || 0];
    this._useLeg(legs.find((l) => l.ds === want) || legs.find((l) => l.ds === this.ds) || legs[0]);
    this.session = { id: s.id, name: s.name, startTime: st.startTime, notes: st.notes || '' };
    this._rewindStart(st.rewind);
    this.drawings.load(this.leg.drawings || []);
    this._enterReplay();
    if (st.layout?.slots?.length > 1 && LAYOUTS.some(([id]) => id === st.layout.kind)) {
      const slots = st.layout.slots.map((sp) => (sp && this.legs.some((l) => l.key === sp.key) ? sp : sp ? { key: this.leg.key, tf: sp.tf } : null));
      if (slots.filter((x) => x === null).length === 1) { this.layout = { kind: st.layout.kind, active: slots.indexOf(null), slots }; await this.renderPanes(); }
    }
    toast(`“${s.name}” açıldı`, 'ok');
  }

  /** Put another market of the session on the chart. */
  async switchLeg(leg) {
    if (!leg || leg === this.leg || this.mode !== 'replay') return;
    this.pause();
    this.leg.drawings = this.drawings.serialize();
    const tf = leg.ds.timeframes.includes(this.tfId) ? this.tfId : leg.engine.tf.id;
    if (leg.engine.tf.id !== tf) await leg.engine.setTf(tf);
    this.settings.tf = tf;
    this._useLeg(leg);
    this.drawings.load(leg.drawings || []);
    this.chart.setFormat({ tz: this.settings.tz, decimals: leg.ds.decimals, tf: this.tf, align: leg.ds.align });
    this.chart.setBars(leg.engine.bars, { fit: true });
    this.updateMarkers();
    this.tradeLines.sync();
    this.renderInstrument();
    this.renderLegs();
    this.renderTfButtons();
    this.renderReplayControls();
    this.ticket.render();
    this.renderTabs();
    this.renderTab();
    this.renderLegend(null);
    this.markDirty();
  }

  /** Another market into the running session, at its time. */
  async addLeg(ds) {
    if (this.mode !== 'replay' || !ds) return;
    const have = this.legs.find((l) => l.ds.id === ds.id);
    if (have) { await this.switchLeg(have); return; }
    if (ds.last_ts && this.engine.cursor > ds.last_ts) { toast(`${ds.symbol}: bu tarihte verisi yok`, 'err'); return; }
    this.pause();
    this.showMessage(`${ds.symbol} ekleniyor…`);
    try {
      const leg = await this._openLeg(ds, this.engine.cursor);
      this.legs.push(leg);
      shareAccount(this.legs.map((l) => l.broker), this.broker.balance);
      for (const p of this.sidePanes.values()) p._head();
      await this.switchLeg(leg);
      toast(`${ds.symbol} oturuma eklendi: ${this.legs.map((l) => l.ds.symbol).join(' · ')}`, 'ok');
      this.markDirty(true);
    } catch (err) {
      toast(`${ds.symbol} eklenemedi: ${err.message || err}`, 'err', 6000);
    } finally {
      this.showMessage('');
    }
  }

  async removeLeg(leg) {
    if (this.legs.length < 2 || !this.legs.includes(leg)) return;
    const b = leg.broker;
    if (b.positions.length || b.orders.some((o) => o.type !== 'next')) { toast(`Önce ${leg.ds.symbol} pozisyon ve emirlerini kapat`, 'err'); return; }
    const n = b.trades.length;
    if (!(await confirmBox('Piyasayı çıkar', `${leg.ds.symbol} oturumdan çıkarılsın mı?${n ? ` ${n} kapanmış işlemi de listeden kalkar (bakiyedeki etkisi kalır).` : ''}`, 'Çıkar'))) return;
    if (leg === this.leg) await this.switchLeg(this.legs.find((l) => l !== leg));
    this.legs = this.legs.filter((l) => l !== leg);
    shareAccount(this.legs.map((l) => l.broker), this.broker.balance);
    for (const p of this.sidePanes.values()) {
      if (!this.legs.includes(p.leg)) { p._drop(); p.leg = this.leg; p.open(); } else p._head();
    }
    this._savePanes();
    this.renderLegs();
    this.renderTabs();
    this.renderTab();
    this.markDirty(true);
  }

  /** The other markets to the chart's time (after the one on the chart
   *  moved): their fills come back with `r`'s. */
  _syncLegs(r) {
    if (this.legs.length < 2 || !this.engine) return r;
    const t = this.engine.cursor;
    for (const leg of this.legs) {
      if (leg === this.leg) continue;
      const o = leg.engine._advance(leg.broker, (b) => b.time <= t, 1e7);
      for (const e of o.events) { e.leg = leg; r.events.push(e); }
    }
    return r;
  }

  _enterReplay() {
    this.mode = 'replay';
    this.settings.resume = this.session?.id || null;
    this.saveSettings();
    this.backtest = null;
    this.clearPlots();
    if (this.bottomTab === 'data') { this.settings.bottomTab = 'positions'; this.applyBottomSize(); }
    this.renderModeSwitch();
    this.applyLayout();
    this.chart.setFormat({ tz: this.settings.tz, decimals: this.ds.decimals, tf: this.tf, align: this.ds.align });
    this.renderInstrument();
    this.renderLegs();
    this.showMessage('');
    this.chart.setBars(this.engine.bars, { fit: true });
    this.updateMarkers();
    this.tradeLines.sync();
    this.renderTfButtons();
    this.renderReplayControls();
    this.ticket.render();
    this.renderTabs();
    this.renderTab();
    this.renderLegend(null);
  }

  async exitReplay(save = true, reload = true) {
    this.pause();
    if (this.draft) { this.draft = null; this._draftChanged(); }
    if (save && this.session) await this.save();
    this.settings.resume = null;
    this.saveSettings();
    this.mode = 'browse';
    this.engine = null;
    this.broker = null;
    this.legs = [];
    this.leg = null;
    this.session = null;
    this.dirty = false;
    this.tradeLines.clear();
    this.orderLayer.clear();
    await this._singlePane();
    this.renderLegs();
    this.renderModeSwitch();
    this.applyLayout();
    if (this.ds) this.drawings.load(storage(`rt:drawings:${this.ds.id}`, []));
    this.renderReplayControls();
    this.ticket.render();
    this.renderTabs();
    this.renderTab();
    if (reload) await this.loadBrowse();
  }

  _state() {
    if (this.leg) this.leg.drawings = this.drawings.serialize();
    const legs = this._allLegs();
    return {
      version: 2, datasetId: this.ds.id, tf: this.tfId, cursor: this.engine.cursor, startTime: this.session.startTime,
      notes: this.session.notes || '', account: { balance: this.broker.balance }, active: Math.max(0, legs.indexOf(this.leg)),
      legs: legs.map((l) => ({ datasetId: l.ds.id, key: dsKey(l.ds), symbol: l.ds.symbol, broker: l.broker.toJSON(), drawings: l === this.leg ? this.drawings.serialize() : l.drawings || [] })),
      rewind: this.rw ? { start: this.rw.start, actions: this.rw.actions } : null,
      layout: this.layout.slots.length > 1 ? { kind: this.layout.kind, active: this.layout.active, slots: this.layout.slots } : null,
    };
  }

  /** Closed trades of every market, oldest first. */
  _allTrades() {
    const legs = this._allLegs();
    return legs.length > 1 ? legs.flatMap((l) => l.broker.trades).sort(tradeOrder) : (this.broker?.trades || []);
  }

  _summary() {
    const b = this.broker, legs = this._allLegs();
    const trades = this._allTrades();
    const initial = legs[0].broker.cfg.balance;
    const st = computeStats(trades, { initial, tz: this.settings.tz });
    const fin = (x) => (Number.isFinite(x) ? x : null);
    let bal = initial;
    const curve = [bal, ...trades.map((t) => (bal += t.pnl))];
    const step = Math.max(1, Math.ceil(curve.length / 48));
    const spark = curve.filter((_, i) => i % step === 0 || i === curve.length - 1).map((v) => Math.round(v * 100) / 100);
    return {
      symbol: legs.map((l) => l.ds.symbol).join(' · '), symbols: legs.map((l) => l.ds.symbol),
      currency: b.cfg.currency, tf: this.tfId, startTime: this.session.startTime, cursor: this.engine.cursor,
      trades: trades.length, net: st.net, balance: b.balance, initial, winRate: fin(st.winRate),
      profitFactor: st.profitFactor === Infinity ? 'inf' : fin(st.profitFactor), maxDrawdownPct: fin(st.maxDrawdownPct),
      open: legs.reduce((n, l) => n + l.broker.positions.length, 0), spark,
    };
  }

  markDirty(urgent = false) {
    if (this.mode !== 'replay') return;
    this.dirty = true;
    if (urgent && !this._urgent) this._urgent = setTimeout(() => { this._urgent = null; this.save(); }, 400);
  }

  async save(keepalive = false) {
    if (this.mode !== 'replay' || !this.session?.id || this._saving) return;
    this._saving = true;
    this.dirty = false;
    try {
      await api.updateSession(this.session.id, { name: this.session.name, state: this._state(), summary: this._summary() }, keepalive);
    } catch (err) {
      this.dirty = true;
      if (!keepalive) toast(`Kaydedilemedi: ${err.message}`, 'err');
    } finally {
      this._saving = false;
    }
  }

  // ── replay stepping ────────────────────────────────────────────────────
  _stepUnit() {
    return this._syncLegs(this.settings.stepUnit === 'bar' ? this.engine.stepChartBar(this.broker) : this.engine.step(this.broker));
  }

  step(unit = null) {
    if (this.mode !== 'replay') return;
    if (!this.engine.peek()) {
      if (this.engine.atEnd) { toast('Veri sonuna gelindi', 'warn'); this.pause(); } else this.engine.ensureFeed();
      return;
    }
    const r = unit === 'bar' ? this._syncLegs(this.engine.stepChartBar(this.broker)) : unit === 'base' ? this._syncLegs(this.engine.step(this.broker)) : this._stepUnit();
    this.afterAdvance(r);
  }

  /** The replay wheel: up to `n` candles of the chart's timeframe, drawn
   *  once; returns how many it moved (fewer when a fill or the end stops it). */
  scrubSteps(n) {
    if (this.mode !== 'replay' || !this.engine) return 0;
    let total = null;
    let done = 0;
    try {
      for (; done < n; ) {
        if (!this.engine.peek()) {
          if (this.engine.atEnd) {
            if (Date.now() - (this._endToast || 0) > 3000) { this._endToast = Date.now(); toast('Veri sonuna gelindi', 'warn'); }
          } else this.engine.ensureFeed();
          break;
        }
        const r = this._syncLegs(this.engine.stepChartBar(this.broker));
        done++;
        total = total ? { count: total.count + r.count, firstChanged: Math.min(total.firstChanged, r.firstChanged), events: total.events.concat(r.events), trimmed: total.trimmed + r.trimmed } : r;
        if (this.settings.pauseOnFill && r.events.length) break;
      }
    } finally {
      if (total) this.afterAdvance(total);
    }
    return total && this.settings.pauseOnFill && total.events.length ? 0 : done;
  }

  play() {
    if (this.mode !== 'replay' || this.playing || !this.engine) return;
    this.playing = true;
    // each run has its own number: a stale timer from an earlier run can never
    // keep going after a pause, and two runs can never overlap
    const run = (this._playRun = (this._playRun || 0) + 1);
    const engine = this.engine;
    this.renderReplayControls();
    const tick = () => {
      this._timer = 0;
      if (!this.playing || run !== this._playRun || this.engine !== engine || this.mode !== 'replay') return;
      try {
        const speed = this.settings.speed;
        // "Maks": up to 60 steps per screen frame, never more than ~8 ms of work,
        // so the page stays responsive (and it rests while the tab is hidden)
        const budget = speed === 0 ? performance.now() + 8 : 0;
        let total = null;
        let stop = null;
        for (let i = 0; i === 0 || (speed === 0 && performance.now() < budget && i < 60); i++) {
          if (!engine.peek()) {
            if (engine.atEnd) stop = 'end';
            else if (engine.feedError) stop = 'feed';
            else engine.ensureFeed();
            break;
          }
          const r = this._stepUnit();
          total = total ? { count: total.count + r.count, firstChanged: Math.min(total.firstChanged, r.firstChanged), events: total.events.concat(r.events), trimmed: total.trimmed + r.trimmed } : r;
          if (this.settings.pauseOnFill && r.events.length) break;
        }
        // at "Maks" the steps are cheap but redrawing the chart is not: steps
        // pile up and the chart is drawn ~10 times a second (at once on a fill)
        if (total && speed === 0) {
          const acc = this._pendingAdvance;
          this._pendingAdvance = acc ? { count: acc.count + total.count, firstChanged: Math.min(acc.firstChanged, total.firstChanged), events: acc.events.concat(total.events), trimmed: acc.trimmed + total.trimmed } : total;
          const now = performance.now();
          if (stop || total.events.length || now - (this._lastPaint || 0) > 100) { this._lastPaint = now; this._flushAdvance(); }
        } else if (total) this.afterAdvance(total);
        if (stop === 'end') { this.pause(); toast('Veri sonuna gelindi', 'warn'); return; }
        if (stop === 'feed') { this.pause(); toast(`Sonraki barlar yüklenemedi: ${engine.feedError}`, 'err', 7000); return; }
        if (total && this.settings.pauseOnFill && total.events.length) { this.pause(); return; }
        if (!this.playing || run !== this._playRun) return;
        if (speed === 0) this._raf = requestAnimationFrame(tick);
        else this._timer = setTimeout(tick, 1000 / speed);
      } catch (err) {
        console.error(err);
        this.pause();
        toast(`Replay durdu: ${err.message}`, 'err', 7000);
      }
    };
    tick();
  }

  _flushAdvance() {
    const acc = this._pendingAdvance;
    this._pendingAdvance = null;
    if (acc && this.engine) this.afterAdvance(acc);
  }

  pause() {
    // always safe to call: stops any pending step even if the state got out of step
    this._flushAdvance();
    const was = this.playing;
    this.playing = false;
    this._playRun = (this._playRun || 0) + 1;
    clearTimeout(this._timer);
    cancelAnimationFrame(this._raf);
    this._timer = 0;
    this._raf = 0;
    if (was) this.renderReplayControls();
  }

  togglePlay() { if (this.playing) this.pause(); else this.play(); }

  async jumpTo(t) {
    this.pause();
    this.showMessage('İleri sarılıyor…');
    try {
      const r = await this.engine.advanceTo(this.broker, t);
      for (const leg of this.legs) {
        if (leg === this.leg) continue;
        const o = await leg.engine.advanceTo(leg.broker, this.engine.cursor);
        for (const e of o.events) { e.leg = leg; r.events.push(e); }
      }
      this.chart.setBars(this.engine.bars, { fit: true });
      this.afterAdvance({ ...r, count: 0 }, true, true);
      const closed = r.events.filter((e) => e.type === 'close').map((e) => e.trade);
      const opened = r.events.filter((e) => e.type === 'open').length;
      if (r.events.length) {
        const net = closed.reduce((s, t) => s + t.pnl, 0);
        toast(`İleri sarıldı: ${opened} açıldı, ${closed.length} kapandı${closed.length ? ` (${F.signedMoney(net, this.broker.cfg.currency)})` : ''}`, net >= 0 ? 'ok' : 'err');
        this.renderLegs();
      }
    } finally {
      this.showMessage('');
    }
  }

  afterAdvance(r, force = false, quiet = false) {
    if (!r.count && !force) return;
    this._rewindTick(r);
    if (r.count) {
      if (r.trimmed || r.count > 400) {
        // a long jump: the view stays where it was, unless it was following the last bar
        const ts = this.chart.chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        const shown = this.chart.candles.data().length;
        this.chart.setBars(this.engine.bars, { keepLogical: range });
        if (range && range.to >= shown - 1.5 && !r.trimmed) ts.scrollToRealTime();
      } else this.chart.updateFrom(r.firstChanged);
    }
    const tradeEvents = r.events.length > 0;
    if (!quiet) for (const e of r.events.slice(-4)) this._eventToast(e);
    this._autoBreakeven();
    this.tradeLines.sync();
    if (this.draft) this.renderDraftBar();
    this.ticket.update();
    this.updateTradeBar();
    this.renderClock();
    this._paneUpdate();
    if (tradeEvents) { this.updateMarkers(); this.renderTabs(); this.renderLegs(); this._paneDecorate(); }
    if (!this._lastParam || !this._lastParam.time) this.renderLegend(null);
    this._scheduleTab(tradeEvents);
    this.markDirty(tradeEvents);
  }

  _eventToast(e) {
    // a fill in another market of the session says which
    const ds = e.leg?.ds || this.ds, b = e.leg?.broker || this.broker;
    const ccy = b.cfg.currency, dec = ds.decimals, pre = e.leg ? `${ds.symbol} · ` : '';
    if (e.type === 'open' && e.position.orderId != null) {
      const p = e.position;
      toast(`${pre}Emir doldu: ${p.side === 'buy' ? 'alış' : 'satış'} ${F.num(p.qty, 2)} lot @ ${F.price(p.entryPrice, dec)}`, 'ok');
    } else if (e.type === 'close' && e.trade && ['sl', 'tp', 'strategy'].includes(e.trade.reason)) {
      const t = e.trade;
      toast(`${pre}${REASON_TEXT[t.reason]}: ${F.signedMoney(t.pnl, ccy)} (${F.signed(t.pips, 1)} pip)`, t.pnl >= 0 ? 'ok' : 'err');
    }
  }

  _scheduleTab(now = false) {
    const tab = this.bottomTab;
    if (!['positions', 'orders', 'history', 'stats'].includes(tab)) return;
    // stats and the journal only change when trades do
    if (!now && (tab === 'stats' || tab === 'history')) return;
    if (now) { clearTimeout(this._tabTimer); this._tabTimer = null; this._renderTabUnlessEditing(); return; }
    if (this._tabTimer) return;
    this._tabTimer = setTimeout(() => { this._tabTimer = null; this._renderTabUnlessEditing(); }, 300);
  }

  /** Re-rendering would throw away a SL / TP / note the user is typing. */
  _renderTabUnlessEditing() {
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT' && $('#tab-body').contains(active)) {
      active.addEventListener('blur', () => this._scheduleTab(), { once: true });
      return;
    }
    this.renderTab();
  }

  // ── split charts (ui/sidepane.js) ─────────────────────────────────────
  /** A market's drawings as they are now (the main chart's live, the others' kept). */
  _legDrawings(leg) { return leg === this.leg ? this.drawings.serialize() : leg.drawings || []; }

  layoutMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    if (this.mode !== 'replay') { toast('Ekranı bölmek için bir replay oturumu aç: her bölme aynı anda ilerler', 'warn', 5000); return; }
    const narrow = window.innerWidth <= 760;
    this.popover(anchor, [
      h('h5', {}, 'Grafik düzeni'),
      h('div.layout-grid', {}, LAYOUTS.filter(([id]) => !narrow || ['1', '2h'].includes(id)).map(([id, , name, ic]) => h(`button.layout-tile${this.layout.kind === id ? '.on' : ''}`, { type: 'button', title: name, onclick: () => { this.closePopover(); this.setLayout(id); } }, icon(ic, 26), h('span', {}, name)))),
      h('p.muted.rw-note', {}, 'Her bölme oturumun bir piyasasını kendi zaman diliminde gösterir; hepsi aynı anda ilerler. Bir bölmeye tıklayınca ana grafik (çizim ve işlem) o olur.'),
    ], { align: 'right' });
  }

  /** What a new pane shows: a market of the session not on screen yet,
   *  else the main market one timeframe up. */
  _paneSpec(taken) {
    const shown = new Set(taken.map((s) => s.key));
    const leg = this.legs.find((l) => !shown.has(l.key));
    if (leg) return { key: leg.key, tf: leg.ds.timeframes.includes(this.tfId) ? this.tfId : leg.engine.tf.id };
    const used = new Set(taken.filter((s) => s.key === this.leg.key).map((s) => s.tf));
    const ladder = ['1h', '4h', '1D', '15m', '5m', '1m', '30m', '1W'];
    const tf = ladder.find((t) => !used.has(t) && this.ds.timeframes.includes(t)) || this.tfId;
    return { key: this.leg.key, tf };
  }

  async setLayout(kind) {
    const def = LAYOUTS.find(([id]) => id === kind);
    if (!def || this.mode !== 'replay') return;
    this.pause();
    const L = this.layout;
    let list = L.slots.map((sp, i) => (i === L.active ? { main: true, key: this.leg.key, tf: this.tfId } : sp));
    while (list.length > def[1]) list.splice(list.map((x) => !!x.main).lastIndexOf(false), 1);
    while (list.length < def[1]) list.push(this._paneSpec(list));
    this.layout = { kind, active: list.findIndex((x) => x.main), slots: list.map((x) => (x.main ? null : { key: x.key, tf: x.tf })) };
    await this.renderPanes();
    this._savePanes();
  }

  /** Lay the panes out: the main chart moves into its slot, the others are made. */
  async renderPanes() {
    const box = $('#panes');
    const L = this.layout;
    for (const p of this.sidePanes.values()) p.destroy();
    this.sidePanes.clear();
    const slots = L.slots.map((_, i) => h(`div.pane-slot.${i === L.active ? 'main' : 'side'}`, { 'data-i': i }));
    slots[L.active].append($('#chart'), $('#legend'));
    box.replaceChildren(...slots);
    box.className = `panes layout-${L.kind}`;
    $('#app').classList.toggle('split', slots.length > 1);
    this.chart.moved();
    await Promise.all(L.slots.map(async (spec, i) => {
      if (i === L.active || !spec) return;
      const leg = this.legs.find((l) => l.key === spec.key) || this.leg;
      const pane = new SidePane(this, slots[i], leg, spec.tf);
      this.sidePanes.set(i, pane);
      try { await pane.open(); } catch (err) { toast(`Bölme açılamadı: ${err.message || err}`, 'err'); }
    }));
    this.renderFavBar();
  }

  /** Make pane `i` the main chart: it keeps its place, the main chart moves there. */
  async activatePane(i) {
    const L = this.layout;
    if (i === L.active || this.mode !== 'replay' || this._activating || !L.slots[i]) return;
    this._activating = true;
    this.pause();
    try {
      this._savePanes();
      const spec = L.slots[i];
      const leg = this.legs.find((l) => l.key === spec.key) || this.leg;
      L.slots[L.active] = { key: this.leg.key, tf: this.tfId };
      L.slots[i] = null;
      L.active = i;
      await this.renderPanes();
      if (leg !== this.leg) await this.switchLeg(leg);
      if (spec.tf !== this.tfId && this.ds.timeframes.includes(spec.tf)) await this.setTf(spec.tf);
      this._savePanes();
    } finally { this._activating = false; }
  }

  /** The panes' choices into the layout (kept with the session). */
  _savePanes() {
    for (const [i, p] of this.sidePanes) this.layout.slots[i] = { key: p.leg.key, tf: p.tf };
    this.markDirty();
  }

  _paneUpdate() { for (const p of this.sidePanes.values()) p.update(); }

  /** The crosshair's time on every chart of the layout, as TradingView syncs it. */
  _syncCross(src, param) {
    if (this._crossing || !this.sidePanes?.size) return;
    this._crossing = true;
    try {
      const time = param?.time ?? null;
      for (const tc of [this.chart, ...[...this.sidePanes.values()].map((p) => p.tc)]) if (tc !== src) tc.crossAt(time);
    } finally { this._crossing = false; }
  }

  /** A picture of the charts (all panes of a split layout) as a PNG file. */
  async screenshot() {
    const area = $('#panes') || $('#chart-area');
    const box = area.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const out = document.createElement('canvas');
    out.width = Math.round(box.width * dpr);
    out.height = Math.round(box.height * dpr);
    const g = out.getContext('2d');
    g.fillStyle = getComputedStyle(document.body).backgroundColor || '#000';
    g.fillRect(0, 0, out.width, out.height);
    const charts = [{ tc: this.chart, ds: this.ds, tf: this.tfId }, ...[...this.sidePanes.values()].map((p) => ({ tc: p.tc, ds: p.leg.ds, tf: p.tf }))];
    const font = getComputedStyle(document.body).fontFamily;
    for (const { tc, ds, tf } of charts) {
      const r = tc.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x = (r.left - box.left) * dpr, y = (r.top - box.top) * dpr;
      g.drawImage(tc.screenshot(), x, y, r.width * dpr, r.height * dpr);
      const bar = tc.bars[tc.bars.length - 1];
      g.font = `600 ${13 * dpr}px ${font}`;
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillText(`${ds?.symbol || ''} · ${tf || ''}${bar ? ` · ${F.dateTime(bar.time, this.settings.tz)}` : ''}`, x + 12 * dpr, y + 22 * dpr);
    }
    g.font = `500 ${11 * dpr}px ${font}`;
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.textAlign = 'right';
    g.fillText('ReplayView', out.width - 84 * dpr, out.height - 38 * dpr);
    const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
    if (!blob) { toast('Ekran görüntüsü alınamadı', 'err'); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `RV_${this.ds?.symbol || 'grafik'}_${this.tfId || ''}_${stamp}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    // phones: the share sheet (save to photos); elsewhere a download
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file] }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Ekran görüntüsü indirildi', 'ok');
  }
  _paneDecorate() { for (const p of this.sidePanes.values()) p.decorate(); }

  /** Back to one chart (leaving the replay). */
  async _singlePane() {
    if (this.layout.slots.length === 1 && !this.sidePanes.size) return;
    this.layout = { kind: '1', active: 0, slots: [null] };
    await this.renderPanes();
  }

  // ── rewind (core/rewind.js) ───────────────────────────────────────────
  /** The session's checkpoints and the log of what the trader did. A saved
   *  session brings its log and the checkpoint it started from; one saved
   *  before there was a rewind can go back as far as it was opened. */
  _rewindStart(saved) {
    const now = checkpoint(this.engine.cursor, saved?.actions?.length || 0, this._allLegs());
    this.rw = { start: saved?.start || (saved ? null : now), actions: saved?.actions ? [...saved.actions] : [], points: [], since: 0 };
    if (this.rw.start && this.rw.start !== now) this.rw.points.push(this.rw.start);
    this.rw.points.push(now);
    if (!this.rw.start) this.rw.start = now;
  }

  /** What the trader did, at the replay's time, to be done again on a rewind. */
  _log(leg, op, args) {
    if (!this.rw || this.mode !== 'replay') return;
    this.rw.actions.push({ t: this.engine.cursor, leg: (leg || this.leg).key, op, ...(args ? { args: JSON.parse(JSON.stringify(args)) } : {}) });
  }

  /** A checkpoint now and then (each fill, and every few hundred bars). */
  _rewindTick(r) {
    if (!this.rw || this.mode !== 'replay') return;
    this.rw.since += r.count || 0;
    if (this.rw.since < 240 && !r.events.length) return;
    this.rw.since = 0;
    this.rw.points.push(checkpoint(this.engine.cursor, this.rw.actions.length, this._allLegs()));
    this.rw.points = thinCheckpoints(this.rw.points);
  }

  /** Base bars of `ds` after `from`, up to and including `to`, as the broker takes them. */
  async _baseBars(ds, from, to) {
    const out = [];
    let after = from;
    for (;;) {
      const rows = columnsToBars(await api.bars(ds.id, { tf: ds.base_tf, after, limit: 5000 }));
      for (const b of rows) {
        if (b.time > to) return out;
        out.push({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close });
      }
      if (rows.length < 5000) return out;
      after = rows[rows.length - 1].time;
    }
  }

  /** Stand at base time `T` again, earlier in the session: the trades and
   *  orders after it are undone (as if the replay had stopped there). */
  async rewindTo(T, { keepView = false, quiet = false } = {}) {
    if (this.mode !== 'replay' || !this.rw || !this.engine) return false;
    if (this._rewinding) return false;
    if (!(T < this.engine.cursor)) return false;
    const earliest = this.rw.points[0];
    const cp = checkpointFor(this.rw.points, T);
    if (!cp) {
      toast(`Bu oturumda en fazla ${F.dateTime(earliest.t, this.settings.tz)} anına geri sarılabilir`, 'warn', 6000);
      return false;
    }
    this.pause();
    this._rewinding = true;
    const slow = setTimeout(() => this.showMessage('Geri sarılıyor…'), 300);
    try {
      const legs = this._allLegs();
      // everything is read first: a failed read leaves the session as it was
      const bars = new Map();
      const engines = new Map();
      await Promise.all(legs.map(async (l) => {
        bars.set(l.key, await this._baseBars(l.ds, cp.t, T));
        const e = new ReplayEngine(l.ds);
        await e.load(l.engine.tf.id, T);
        engines.set(l.key, e);
      }));
      // notes written on trades that close again keep their text
      const notes = new Map();
      const noteKey = (l, t) => `${l.key}|${t.positionId}|${t.exitTime}|${t.qty}`;
      for (const l of legs) for (const t of l.broker.trades) if (t.note) notes.set(noteKey(l, t), t.note);
      for (const l of legs) restoreBroker(l.broker, cp.legs[l.key] || null);
      legs[0].broker.balance = cp.balance;
      replayTo({ brokers: new Map(legs.map((l) => [l.key, l.broker])), bars, actions: this.rw.actions.slice(cp.n).filter((a) => a.t <= T), to: T });
      for (const l of legs) for (const t of l.broker.trades) { const n = notes.get(noteKey(l, t)); if (n) t.note = n; }
      // the future after T did not happen: its log and checkpoints go
      this.rw.actions = this.rw.actions.filter((a) => a.t <= T);
      const n = this.rw.actions.length;
      this.rw.points = this.rw.points.filter((p) => p.t < T || (p.t === T && p.n <= n));
      if (!this.rw.points.length) this.rw.points.push(checkpoint(T, n, legs));
      this.rw.since = 0;
      const range = keepView ? this.chart.chart.timeScale().getVisibleLogicalRange() : null;
      for (const l of legs) {
        l.engine = engines.get(l.key);
        const c = l.engine.current;
        if (!l.broker.last && c) l.broker.onBar({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close });
      }
      this.engine = this.leg ? this.leg.engine : legs[0].engine;
      this.chart.setBars(this.engine.bars, range ? { keepLogical: range } : { fit: true });
      // the view ran past the new last bar: back onto it
      if (range && range.to > this.engine.bars.length + 3) this.chart.chart.timeScale().scrollToRealTime();
      this._paneUpdate();
      this.updateMarkers();
      this.tradeLines.sync();
      this.ticket.update();
      this.renderClock();
      this.renderTabs();
      this.renderLegs();
      this._scheduleTab(true);
      this.renderLegend(null);
      this.markDirty(true);
      if (this.draft) this._draftChanged();
      if (!quiet) toast(`Geri sarıldı: ${F.dateTime(this.engine.cursor, this.settings.tz)}`, 'ok', 2200);
      return true;
    } catch (err) {
      console.error(err);
      toast(`Geri sarılamadı: ${err.message || err}`, 'err', 7000);
      return false;
    } finally {
      clearTimeout(slow);
      this.showMessage('');
      this._rewinding = false;
    }
  }

  /** Back `n` bars of the chart (the candle the replay is in goes first). */
  async rewindBars(n = 1, opts = {}) {
    if (this.mode !== 'replay' || !this.engine) return false;
    const bars = this.engine.bars;
    const target = bars[bars.length - 1 - n];
    if (!target) { toast('Grafikte bu kadar geride bar yok', 'warn'); return false; }
    return this.rewindTo(target.time + this.tf.seconds - 1, { keepView: true, quiet: true, ...opts });
  }

  /** One step back, as the step forward goes: a base bar or a chart bar.
   *  Presses while a rewind runs are counted and done after it. */
  async stepBack(unit = null) {
    if (this.mode !== 'replay' || !this.engine) return;
    if (this._rewinding) { this._backQueue = (this._backQueue || 0) + 1; return; }
    const bar = (unit || (this.settings.stepUnit === 'bar' ? 'bar' : 'base')) === 'bar';
    let steps = 1;
    for (;;) {
      const ok = bar ? await this.rewindBars(steps) : await this.rewindTo(this.engine.cursor - 1 - (steps - 1) * parseTf(this.ds.base_tf).seconds, { keepView: true, quiet: true });
      steps = this._backQueue || 0;
      this._backQueue = 0;
      if (!ok || !steps) break;
    }
  }

  /** "Replay to this candle": the chart ends with `bar` (a chart bar). */
  rewindToBar(bar) {
    if (!bar) return;
    const T = bar.time + this.tf.seconds - 1;
    if (T >= this.engine.cursor) { toast('Bu bar henüz kapanmadı: daha eski bir bar seç', 'warn'); return; }
    this.rewindTo(T, { keepView: true });
  }

  /** The rewind button's menu. */
  rewindMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const tz = this.settings.tz;
    const go = (fn) => () => { this.closePopover(); fn(); };
    const day = (() => {
      // the start of the replay's day in the chosen zone: the last bar of the day before
      const d = new Date(this.engine.cursor * 1000);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const g = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
      return this.engine.cursor - (g('hour') * 3600 + g('minute') * 60 + g('second')) - 1;
    })();
    const first = this.rw?.points[0]?.t;
    this.popover(anchor, [
      h('button.item', { onclick: go(() => D.jumpDialog(this)) }, icon('ffwd', 16), h('span', {}, h('span.t.plain', {}, 'İleri sar'), h('span.s', {}, 'bir tarihe ya da saate (Alt+G)'))),
      h('hr'),
      h('h5', {}, `Geri sar · ${this.tfId} bar`),
      h('div.rw-grid', {}, [1, 3, 5, 10, 20, 50].map((n) => h('button.chip', { type: 'button', onclick: go(() => this.rewindBars(n, { quiet: false })) }, `−${n}`))),
      h('button.item', { onclick: go(() => this.pickRewind()) }, icon('scissors', 16), h('span', {}, h('span.t.plain', {}, 'Grafikten bar seç'), h('span.s', {}, 'grafik o barda biter (sağ tık: “Buraya geri sar”)'))),
      h('button.item', { onclick: go(() => this.rewindTo(day)) }, icon('clock', 16), h('span', {}, h('span.t.plain', {}, 'Günün başına'), h('span.s', {}, F.dateTime(day + 1, tz)))),
      first != null && first < this.engine.cursor ? h('button.item', { onclick: go(() => this.rewindTo(first)) }, icon('replay', 16), h('span', {}, h('span.t.plain', {}, 'En başa'), h('span.s', {}, F.dateTime(first, tz)))) : null,
      h('p.muted.rw-note', {}, 'Geri sarınca o andan sonra açılan / kapanan işlemler ve emirler geri alınır.'),
    ].filter(Boolean), { align: 'left' });
  }

  pickRewind() {
    if (this.mode !== 'replay') return;
    this.pickPrice((_, bar) => this.rewindToBar(bar), 'Geri sarmak için bir bara tıklayın: grafik o barda biter · Esc: iptal');
  }

  // ── trading ────────────────────────────────────────────────────────────
  _afterTrade() {
    this.tradeLines.sync();
    this.ticket.update();
    this.updateTradeBar();
    this._paneDecorate();
    this.updateMarkers();
    this.renderTabs();
    this.renderLegs();
    this._scheduleTab(true);
    this.markDirty(true);
  }

  placeOrder(params) {
    if (this.mode !== 'replay') { toast('Önce replay başlatın', 'err'); return null; }
    const r = this.broker.placeOrder(params);
    if (!r.ok) { toast(r.error, 'err'); return null; }
    this._log(this.leg, 'place', params);
    const dec = this.ds.decimals;
    if (r.position) toast(`${r.position.side === 'buy' ? 'Alış' : 'Satış'} ${F.num(r.position.qty, 2)} lot @ ${F.price(r.position.entryPrice, dec)}`, 'ok');
    else toast(`${r.order.side === 'buy' ? 'Alış' : 'Satış'} ${r.order.type === 'limit' ? 'limit' : 'stop'} emri: ${r.order.qty} @ ${F.price(r.order.price, dec)}`, 'ok');
    this._afterTrade();
    return r;
  }

  // (each market of a session has its own positions and numbers: `leg`
  // says whose, the one on the chart by default)
  modifyPosition(id, stops, leg = null) {
    const r = (leg?.broker || this.broker).modifyPosition(id, stops);
    if (!r.ok) toast(r.error, 'err'); else this._log(leg, 'modPos', { id, stops });
    this._afterTrade();
    return r;
  }

  modifyOrder(id, fields, leg = null) {
    const r = (leg?.broker || this.broker).modifyOrder(id, fields);
    if (!r.ok) toast(r.error, 'err'); else this._log(leg, 'modOrd', { id, fields });
    this._afterTrade();
    return r;
  }

  resizePosition(id, qty, leg = null) {
    const r = (leg?.broker || this.broker).resizePosition(id, qty);
    if (r.ok) this._log(leg, 'resize', { id, qty: r.position.qty });
    return r;
  }

  breakeven(id, leg = null) {
    const p = (leg?.broker || this.broker).positions.find((x) => x.id === id);
    if (p) this.modifyPosition(id, { sl: p.entryPrice }, leg);
  }

  closePosition(id, fraction = 1, leg = null) {
    const b = leg?.broker || this.broker;
    const r = b.closePosition(id, { fraction });
    if (!r.ok) { toast(r.error, 'err'); return; }
    this._log(leg, 'close', { id, fraction });
    if (r.trade) toast(`${leg && leg !== this.leg ? `${leg.ds.symbol} · ` : ''}Kapatıldı: ${F.signedMoney(r.trade.pnl, b.cfg.currency)}`, r.trade.pnl >= 0 ? 'ok' : 'err');
    this._afterTrade();
  }

  closeAll() {
    const trades = this._allLegs().flatMap((l) => {
      if (!l.broker.positions.length) return [];
      this._log(l, 'closeAll');
      return l.broker.closeAll();
    });
    if (trades.length) toast(`${trades.length} pozisyon kapatıldı: ${F.signedMoney(trades.reduce((s, t) => s + t.pnl, 0), this.broker.cfg.currency)}`, 'ok');
    this._afterTrade();
  }

  cancelOrder(id, leg = null) { if ((leg?.broker || this.broker).cancelOrder(id).ok) this._log(leg, 'cancel', { id }); this._afterTrade(); }
  cancelAll() {
    for (const l of this._allLegs()) if (l.broker.orders.length) { this._log(l, 'cancelAll'); l.broker.cancelAll(); }
    this._afterTrade();
  }

  // ── trading on the chart (orderlayer.js) ─────────────────────────────
  /** Lots for `pct` % of the balance between `entry` and `sl`, within the broker's limits. */
  _lotsFor(b, entry, sl, pct) {
    const q = lotsForRisk({ balance: b.balance, riskPct: pct, entry, sl, contractSize: b.cfg.contractSize, quoteConv: b.cfg.quoteConv, lotStep: b.cfg.lotStep });
    return Number(Math.min(b.cfg.maxLots || 100, Math.max(b.cfg.lotStep, q)).toFixed(6));
  }

  /** A position sized to a % risk takes its lot from its stop: the first
   *  stop placed, or the stop moved while still on the bar it opened in. */
  _sizesWithStop(p, b) {
    return !!p.autoRisk && Math.abs(p.qty - p.initialQty) < 1e-9 && (p.sl == null || b.last?.t === p.entryTime);
  }

  /** What a stop or target at `price` would mean: money, R, and the lot it sizes to. */
  _stopPreview(kind, item, field, price) {
    const b = this.broker;
    if (!b || price == null) return null;
    const entry = kind === 'pos' ? item.entryPrice : item.price;
    let qty = item.qty, resized = false;
    if (field === 'sl' && (kind === 'ord' ? item.autoRisk : this._sizesWithStop(item, b))) {
      const dist = item.side === 'buy' ? entry - price : price - entry;
      if (dist > 0) { qty = this._lotsFor(b, entry, price, item.autoRisk); resized = qty !== item.qty; }
    }
    const pnl = b.pnlAt({ side: item.side, entryPrice: entry, qty }, price) - b.cfg.commission * qty * (kind === 'pos' ? 1 : 2);
    const sl = field === 'sl' ? price : item.sl;
    const risk = sl != null ? (item.side === 'buy' ? entry - sl : sl - entry) : null;
    const r = field === 'tp' && risk > 0 ? (item.side === 'buy' ? price - entry : entry - price) / risk : null;
    return { qty, pnl, r, resized };
  }

  /** Place, move (price) or take away (null) a stop or target from the
   *  chart. A position or order sized to a % risk takes the lot that risk
   *  asks for with this stop. */
  setStop(kind, id, field, price, leg = null) {
    if (this.mode !== 'replay') return;
    const b = leg?.broker || this.broker;
    const p = price == null ? null : Number(price.toFixed(this.ds.decimals));
    if (kind === 'pos') {
      const pos = b.positions.find((x) => x.id === id);
      if (!pos) return;
      const resize = field === 'sl' && p != null && this._sizesWithStop(pos, b);
      const r = this.modifyPosition(id, { [field]: p }, leg);
      if (r.ok && resize) {
        const qty = this._lotsFor(b, pos.entryPrice, p, pos.autoRisk);
        if (Math.abs(qty - pos.qty) > 1e-9 && this.resizePosition(id, qty, leg).ok) {
          toast(`Lot %${F.num(pos.autoRisk, 2)} riske göre ayarlandı: ${qty}`, 'ok', 2600);
          this._afterTrade();
        }
      }
      return;
    }
    const o = b.orders.find((x) => x.id === id);
    if (!o) return;
    const fields = { [field]: p };
    if (field === 'sl' && p != null && o.autoRisk) fields.qty = this._lotsFor(b, o.price, p, o.autoRisk);
    this.modifyOrder(id, fields, leg);
  }

  /** Auto breakeven (FX Replay): once a trade has gone `beR` times its
   *  risk in its favour, its stop goes to the entry. Done as the trader's
   *  own modify (logged), so a rewind does it again at the same bar. */
  _autoBreakeven() {
    const t = this.settings.ticket;
    if (!t.autoBe || this.mode !== 'replay') return;
    for (const l of this._allLegs()) {
      const b = l.broker;
      for (const p of [...b.positions]) {
        if (p.sl == null || p.beDone || !(p.initialSl != null)) continue;
        const risk = p.side === 'buy' ? p.entryPrice - p.initialSl : p.initialSl - p.entryPrice;
        if (!(risk > 0)) continue;
        const run = p.side === 'buy' ? p.best - p.entryPrice : p.entryPrice - p.best;
        const already = p.side === 'buy' ? p.sl >= p.entryPrice : p.sl <= p.entryPrice;
        if (already || run < (t.beR || 1) * risk) continue;
        const r = b.modifyPosition(p.id, { sl: p.entryPrice });
        if (r.ok) {
          p.beDone = true;
          this._log(l, 'modPos', { id: p.id, stops: { sl: p.entryPrice } });
          toast(`${l === this.leg ? '' : `${l.ds.symbol} · `}Başabaş: stop girişe çekildi`, 'ok', 2400);
        }
      }
    }
  }

  /** The lot chip's menu: part of the position off, stop to entry, or the order's lot. */
  tradeMenu(kind, id, anchor) {
    if (this._popover) { this.closePopover(); return; }
    const b = this.broker;
    const go = (fn) => () => { this.closePopover(); fn(); };
    if (kind === 'pos') {
      const p = b.positions.find((x) => x.id === id);
      if (!p) return;
      this.popover(anchor, [
        h('h5', {}, `${p.side === 'buy' ? 'Alış' : 'Satış'} ${F.num(p.qty, 2)} lot · ${F.price(p.entryPrice, this.ds.decimals)}`),
        h('div.rw-grid.three', {}, [25, 50, 75].map((pc) => h('button.chip', { type: 'button', onclick: go(() => this.closePosition(id, pc / 100)) }, `%${pc} kapat`))),
        h('button.item', { onclick: go(() => this.breakeven(id)) }, icon('shield', 16), h('span', {}, h('span.t.plain', {}, 'Başabaş'), h('span.s', {}, 'stop giriş fiyatına'))),
        h('button.item', { onclick: go(() => this.closePosition(id)) }, icon('close', 16), h('span.t.plain', {}, 'Pozisyonu kapat')),
      ], { align: 'right' });
      return;
    }
    const o = b.orders.find((x) => x.id === id);
    if (!o) return;
    const input = h('input.ctl.sm.mono', { type: 'number', step: b.cfg.lotStep, min: b.cfg.lotStep, value: o.qty, style: { width: '100px' } });
    const apply = () => { const q = Number(input.value); if (q > 0) { this.closePopover(); this.modifyOrder(id, { qty: q }); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    this.popover(anchor, [
      h('h5', {}, `${o.side === 'buy' ? 'Al' : 'Sat'} ${o.type === 'limit' ? 'limit' : 'stop'} · ${F.price(o.price, this.ds.decimals)}`),
      h('div.pop-row', {}, h('span.muted', {}, 'Lot'), input, h('button.btn.small.primary', { onclick: apply }, 'Uygula')),
      o.autoRisk ? h('p.muted.rw-note', {}, `SL koyunca lot %${F.num(o.autoRisk, 2)} riske göre ayarlanır.`) : null,
      h('button.item', { onclick: go(() => this.cancelOrder(id)) }, icon('close', 16), h('span.t.plain', {}, 'Emri iptal et')),
    ].filter(Boolean), { align: 'right' });
  }

  /** The "+" at the axis: orders at that price, a line, rewind. */
  plusMenu(price, anchor) {
    if (this._popover) { this.closePopover(); return; }
    const dec = this.ds?.decimals ?? 5;
    const px = F.price(price, dec);
    const go = (fn) => () => { this.closePopover(); this.plus.hide(); fn(); };
    const items = [h('h5', {}, px)];
    if (this.mode === 'replay' && this.broker) {
      const b = this.broker;
      const buyType = price < b.ask() ? 'Limit' : 'Stop';
      const sellType = price > b.bid() ? 'Limit' : 'Stop';
      const size = this._sizeText();
      items.push(
        h('button.item.buy-item', { onclick: go(() => this.orderAtPrice('buy', price)) }, icon('buy', 16), h('span', {}, h('span.t.plain', {}, `Al ${buyType} @ ${px}`), h('span.s', {}, size))),
        h('button.item.sell-item', { onclick: go(() => this.orderAtPrice('sell', price)) }, icon('sell', 16), h('span', {}, h('span.t.plain', {}, `Sat ${sellType} @ ${px}`), h('span.s', {}, size))),
        h('hr'));
    }
    items.push(
      h('button.item', { onclick: go(() => this._lineAt('hline', price)) }, icon('hline', 16), h('span.t.plain', {}, 'Yatay çizgi')),
      h('button.item', { onclick: go(() => this._lineAt('hray', price)) }, icon('hray', 16), h('span.t.plain', {}, 'Yatay ışın')));
    this.popover(anchor, items, { align: 'right' });
  }

  _lineAt(type, price) {
    const bars = this.chart.bars;
    const bar = this.chart.barAt(this.chart.paneWidth() * 0.6) || bars[bars.length - 1];
    if (!bar) return;
    this.drawings.drawings.push({ id: this.drawings._newId(), type, color: type === 'hline' ? '#f5a623' : '#f5a623', width: 1.5, ...(this.settings.drawDefaults?.[type] || {}), points: [{ time: bar.time, price }] });
    this.drawings.redraw();
    this.drawings._changed();
  }

  /** How the next order is sized, in words. */
  _sizeText() {
    const t = this.settings.ticket;
    return t.sizeMode === 'risk' ? `%${F.num(t.riskPct, 2)} risk · SL koyunca lot ayarlanır` : `${F.num(t.lots, 2)} lot`;
  }

  /** Buy / Sell (bar, keys, phone sheet): a draft at the market, not a trade yet. */
  quickOrder(side) { this.startDraft(side); }

  /** "+" at the axis: a draft limit or stop at that price. */
  orderAtPrice(side, price) { this.startDraft(side, { type: 'pending', price }); }

  // ── the draft order (TradingView's order preview) ──────────────────────
  // Buy / Sell puts only the entry line on the chart. The trader drags the
  // TP and SL chips out of it; with the stop the lot is worked out (% risk
  // of the balance, or the fixed lot), and only "confirm" trades. Nothing is
  // placed on its own.

  /** Start (or turn round) a draft: `type` market, or 'pending' at `price`. */
  startDraft(side, { type = 'market', price = null } = {}) {
    if (this.mode !== 'replay' || !this.broker) { toast('İşlem için önce replay başlatın', 'err'); return; }
    if (this.engine?.atEnd) { toast('Verinin sonuna gelindi: işlem açılamaz', 'warn'); return; }
    const dec = this.ds.decimals;
    const prev = this.draft;
    const d = { side, type: type === 'market' ? 'market' : 'pending', price: type === 'market' ? null : Number(price.toFixed(dec)), sl: null, tp: null };
    const t = this.settings.ticket;
    const entry = this._draftEntry(d);
    // the same side keeps the stops already dragged out; the other side
    // takes them mirrored round the entry (as TradingView does)
    if (prev && prev.side === side) { d.sl = prev.sl; d.tp = prev.tp; }
    else if (prev && entry != null) {
      const old = this._draftEntry(prev);
      for (const k of ['sl', 'tp']) if (prev[k] != null && old != null) d[k] = Number((entry + (old - prev[k])).toFixed(dec));
    }
    const pip = this.ds.pip_size, dir = side === 'buy' ? 1 : -1;
    // stops come only from the trader: the ones set in the size menu on purpose
    if (d.sl == null && t.slOn && t.slPips > 0) d.sl = Number((entry - dir * t.slPips * pip).toFixed(dec));
    if (d.tp == null && t.tpOn && t.tpPips > 0) d.tp = Number((entry + dir * t.tpPips * pip).toFixed(dec));
    this.draft = d;
    this.plus?.hide();
    // the trader sees the price being traded
    if (d.type === 'market') this.chart.chart.timeScale().scrollToRealTime();
    this._draftChanged();
  }

  /** The draft's entry: the market's side now, or its own price. */
  _draftEntry(d = this.draft) {
    const b = this.broker;
    if (!d || !b) return null;
    return d.type === 'market' ? (d.side === 'buy' ? b.ask() : b.bid()) : d.price;
  }

  /** What confirming would do: the order, its lot, risk and reward, or why it cannot go yet. */
  _draftPlan(d = this.draft) {
    const b = this.broker;
    if (!d || !b) return null;
    const t = this.settings.ticket;
    const entry = this._draftEntry(d);
    const buy = d.side === 'buy';
    let type = 'market';
    if (d.type !== 'market') type = buy ? (entry < b.ask() ? 'limit' : 'stop') : (entry > b.bid() ? 'limit' : 'stop');
    let why = null;
    const slOk = d.sl == null || (buy ? d.sl < entry : d.sl > entry);
    const tpOk = d.tp == null || (buy ? d.tp > entry : d.tp < entry);
    if (!slOk) why = buy ? 'SL girişin altında olmalı' : 'SL girişin üstünde olmalı';
    else if (!tpOk) why = buy ? 'TP girişin üstünde olmalı' : 'TP girişin altında olmalı';
    let qty = null;
    if (t.sizeMode === 'risk') {
      if (d.sl != null && slOk) qty = this._lotsFor(b, entry, d.sl, t.riskPct);
      else if (!why) why = `Lot için SL’yi sürükleyip koy (%${F.num(t.riskPct, 2)} risk)`;
    } else qty = Number(t.lots) > 0 ? Number(t.lots) : null;
    if (!why && !(qty > 0)) why = 'Lot geçersiz';
    const comm = b.cfg.commission * (qty || 0) * 2;
    const risk = d.sl != null && qty ? -(b.pnlAt({ side: d.side, entryPrice: entry, qty }, d.sl)) + comm : null;
    const reward = d.tp != null && qty ? b.pnlAt({ side: d.side, entryPrice: entry, qty }, d.tp) - comm : null;
    const r = risk > 0 && reward != null ? reward / risk : null;
    return { side: d.side, type, entry, qty, sl: d.sl, tp: d.tp, slOk, tpOk, risk, riskPct: risk != null ? (risk / b.balance) * 100 : null, reward, r, ok: !why, why };
  }

  /** The draft as the order layer shows it. */
  _draftView() {
    const d = this.draft;
    if (!d || this.mode !== 'replay' || !this.broker) return null;
    const p = this._draftPlan(d);
    return { id: 'draft', side: d.side, type: p.type, entry: p.entry, qty: p.qty, sl: d.sl, tp: d.tp };
  }

  /** A stop of the draft dragged to `price`: money, R and the lot it gives. */
  _draftPreview(field, price) {
    const d = this.draft;
    if (!d || price == null) return null;
    const p = this._draftPlan({ ...d, [field]: price });
    const b = this.broker;
    const qty = p.qty || (this.settings.ticket.sizeMode === 'lots' ? Number(this.settings.ticket.lots) : 0);
    // no lot yet (a target before the stop): the distance in pips says enough
    if (!qty) {
      const pips = (d.side === 'buy' ? price - p.entry : p.entry - price) / this.ds.pip_size;
      return { label: `${field.toUpperCase()} ${F.signed(pips, 1)} pip` };
    }
    const pnl = b.pnlAt({ side: d.side, entryPrice: p.entry, qty }, price) - b.cfg.commission * qty * 2;
    const r = field === 'tp' && p.risk > 0 ? pnl / p.risk : null;
    return { qty, pnl, r, resized: field === 'sl' && this.settings.ticket.sizeMode === 'risk' && qty > 0 };
  }

  setDraftStop(field, price) {
    if (!this.draft) return;
    this.draft[field] = price == null ? null : Number(price.toFixed(this.ds.decimals));
    this._draftChanged();
  }

  setDraftPrice(price) {
    if (!this.draft) return;
    const dec = this.ds.decimals;
    const old = this._draftEntry();
    const np = Number(price.toFixed(dec));
    // the stops move with the entry, as on TradingView
    const shift = old != null ? np - old : 0;
    this.draft.type = 'pending';
    this.draft.price = np;
    for (const k of ['sl', 'tp']) if (this.draft[k] != null) this.draft[k] = Number((this.draft[k] + shift).toFixed(dec));
    this._draftChanged();
  }

  cancelDraft() {
    if (!this.draft) return;
    this.draft = null;
    this._draftChanged();
  }

  confirmDraft() {
    const p = this._draftPlan();
    if (!p) return;
    if (!p.ok) { toast(p.why, 'warn'); return; }
    const r = this.placeOrder({ side: p.side, type: p.type, qty: p.qty, price: p.type === 'market' ? null : p.entry, sl: p.sl, tp: p.tp });
    if (r) { this.draft = null; this._draftChanged(); }
  }

  _draftChanged() {
    this.orderLayer?.sync();
    this.renderDraftBar();
    if (this.mode === 'replay') this.ticket?.update();
  }

  /** The bar that says what the draft will do, with confirm and cancel. */
  renderDraftBar() {
    let bar = this._draftBar;
    const p = this.mode === 'replay' ? this._draftPlan() : null;
    if (!p) { if (bar) bar.hidden = true; document.body.classList.remove('has-draft'); return; }
    if (!bar) {
      bar = this._draftBar = h('div.draft-bar', { role: 'group', 'aria-label': 'Emir taslağı' });
      $('#chart-area').append(bar);
    }
    bar.hidden = false;
    document.body.classList.add('has-draft');
    const ccy = this.broker.cfg.currency, dec = this.ds.decimals;
    const buy = p.side === 'buy';
    const typeName = { market: 'Piyasa', limit: 'Limit', stop: 'Stop' }[p.type];
    const sig = JSON.stringify([p.side, p.type, p.entry, p.qty, p.sl, p.tp, p.why, Math.round(p.risk ?? 0), Math.round(p.reward ?? 0), this.settings.ticket.sizeMode]);
    if (sig === this._draftSig && bar.firstChild) return;
    this._draftSig = sig;
    bar.className = `draft-bar ${buy ? 'buy' : 'sell'}${p.ok ? '' : ' blocked'}`;
    const item = (k, v, cls = '') => h(`div.db-item${cls}`, {}, h('span.db-k', {}, k), h('span.db-v', {}, v));
    bar.replaceChildren(
      h('div.db-head', {}, h('b', {}, buy ? 'AL' : 'SAT'), h('span', {}, `${typeName}${p.type === 'market' ? '' : ` · ${F.price(p.entry, dec)}`}`)),
      h('div.db-items', {},
        item('Lot', p.qty ? F.num(p.qty, 2) : '—'),
        item('Risk', p.sl != null && !p.slOk ? 'yanlış taraf' : p.risk != null ? `${F.money(p.risk, ccy)} · %${F.num(p.riskPct, 2)}` : p.sl != null ? `${F.num(Math.abs(p.entry - p.sl) / this.ds.pip_size, 1)} pip` : 'SL yok', p.sl != null && !p.slOk ? '.bad' : p.risk != null ? '' : '.muted'),
        item('Hedef', p.tp != null && !p.tpOk ? 'yanlış taraf' : p.reward != null ? `${F.money(p.reward, ccy)}${p.r != null ? ` · ${F.num(p.r, 2)}R` : ''}` : p.tp != null ? `${F.num(Math.abs(p.tp - p.entry) / this.ds.pip_size, 1)} pip` : 'TP yok', p.tp != null && !p.tpOk ? '.bad' : p.reward != null ? '.up' : '.muted')),
      h('div.db-compact', {}, p.why ? h('span.db-cwhy', {}, p.why)
        : [h('b', {}, `${F.num(p.qty, 2)} lot`), h('span', {}, ` · ${F.money(p.risk, ccy)} risk`), p.r != null ? h('span', {}, ` · ${F.num(p.r, 2)}R`) : null]),
      ...(p.why ? [h('div.db-why', {}, p.why)] : []),
      h('div.db-actions', {},
        h('button.db-cancel', { type: 'button', title: 'Taslağı sil (Esc)', onclick: () => this.cancelDraft() }, 'İptal'),
        h('button.db-go', { type: 'button', disabled: !p.ok, title: p.ok ? 'Emri gönder (Enter)' : p.why, onclick: () => this.confirmDraft() },
          `${buy ? 'Al' : 'Sat'}${p.qty ? ` ${F.num(p.qty, 2)}` : ''}`)));
  }

  orderFromTool(d) {
    if (this.mode !== 'replay') { toast('Emir için replay başlatın', 'err'); return; }
    const side = d.type === 'long' ? 'buy' : 'sell';
    const b = this.broker;
    const entry = Number(d.points[0].price.toFixed(this.ds.decimals));
    const ref = side === 'buy' ? b.ask() : b.bid();
    const t = this.settings.ticket;
    const nearMarket = Math.abs(entry - ref) < this.ds.pip_size * 0.5;
    const type = nearMarket ? 'market' : (side === 'buy') === (entry < ref) ? 'limit' : 'stop';
    const sl = Number(d.stop.toFixed(this.ds.decimals)), tp = Number(d.target.toFixed(this.ds.decimals));
    let qty = t.lots;
    if (t.sizeMode === 'risk') {
      qty = Math.floor((b.balance * t.riskPct / 100) / Math.abs(b.riskAmount(side, nearMarket ? ref : entry, sl, 1)) / b.cfg.lotStep) * b.cfg.lotStep;
      qty = Number(qty.toFixed(6));
    }
    this.placeOrder({ side, type, qty, price: type === 'market' ? null : entry, sl, tp });
  }

  // ── chart decorations ──────────────────────────────────────────────────
  /** The bars the chart holds now, as [first, end): marks and lines outside
   *  it would only make the chart work (a five-year test has thousands). */
  _span() {
    const bars = this.chart.bars;
    return bars.length ? [bars[0].time, bars[bars.length - 1].time + this.tf.seconds] : [Infinity, -Infinity];
  }

  _markers(trades, open = []) {
    const tf = this.tf, align = this.ds.align;
    const [first, end] = this._span();
    const inside = (t) => t >= first && t < end;
    const out = [];
    for (const t of trades) {
      const buy = t.side === 'buy';
      if (inside(t.entryTime)) out.push({ time: bucket(t.entryTime, tf, align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#26a69a' : '#ef5350', shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'AL' : 'SAT'} ${t.qty}` });
      if (inside(t.exitTime)) out.push({ time: bucket(t.exitTime, tf, align), position: buy ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#26a69a' : '#ef5350', shape: 'circle', text: F.signed(t.pnl, 2) });
    }
    for (const p of open) {
      const buy = p.side === 'buy';
      if (inside(p.entryTime)) out.push({ time: bucket(p.entryTime, tf, align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#26a69a' : '#ef5350', shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'AL' : 'SAT'} ${p.qty}` });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  /** A test's lines over the bars the chart holds (again when it loads more). */
  _paintPlots() {
    const r = this.backtest;
    if (!r || this.mode === 'replay' || r.tf !== this.tfId || !this.plotSeries.length) return;
    const [first, end] = this._span();
    const key = `${first}:${end}`;
    if (this._plotSpan === key) return;
    this._plotSpan = key;
    // line points come as columns (t, v) from the test's worker
    (r.plots || []).forEach((p, i) => {
      const data = [];
      if (p.data) { for (const d of p.data) if (d.time >= first && d.time < end) data.push(d); }
      else for (let k = 0; k < p.t.length; k++) if (p.t[k] >= first && p.t[k] < end) data.push({ time: p.t[k], value: p.v[k] });
      this.plotSeries[i]?.setData(data);
    });
  }

  updateMarkers() {
    if (!this.ds) return;
    if (this.mode === 'replay' && this.broker) this.chart.setMarkers(this._markers(this.broker.trades, this.broker.positions));
    else if (this.backtest && this.backtest.dsId === this.ds.id) { this._paintPlots(); this.chart.setMarkers(this._markers(this.backtest.trades)); }
    else this.chart.setMarkers([]);
  }

  clearPlots() {
    for (const s of this.plotSeries) this.chart.chart.removeSeries(s);
    this.plotSeries = [];
  }

  showBacktest(result, { quiet = false } = {}) {
    this.clearPlots();
    this.backtest = result;
    if (!result) { this.updateMarkers(); return; }
    if (this.mode === 'replay') { if (!quiet) toast('Sonuçlar replay dışında grafikte gösterilir', 'warn'); return; }
    if (result.tf === this.tfId) {
      for (const p of result.plots || []) {
        this.plotSeries.push(this.chart.chart.addSeries(LW.LineSeries, { color: p.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: p.title }));
      }
      this._plotSpan = null;
    } else if (!quiet) toast(`Strateji çizgileri ${result.tf} grafiğinde görünür`, 'warn');
    this.updateMarkers();
  }

  async showTrade(t, leg = null) {
    if (leg && leg !== this.leg) await this.switchLeg(leg);
    const time = t.entryTime;
    if (this.mode !== 'replay' && this.chart.bars.length && (time < this.chart.bars[0].time || time > this.chart.bars[this.chart.bars.length - 1].time)) {
      await this.loadBrowse(time);
    }
    const span = Math.max(80, Math.round((t.exitTime - t.entryTime) / this.tf.seconds) + 60);
    const l0 = this.chart.timeToLogical(t.entryTime), l1 = this.chart.timeToLogical(t.exitTime);
    if (l0 != null && l1 != null) this.chart.chart.timeScale().setVisibleLogicalRange({ from: l0 - span * 0.3, to: l1 + span * 0.3 });
  }

  // ── indicators ─────────────────────────────────────────────────────────
  restoreIndicators() {
    for (const ind of [...this.chart.indicators]) this.chart.removeIndicator(ind.id);
    let sessions = false;
    for (const s of this.settings.indicators) {
      if (s.type === 'sessions') { if (sessions) continue; sessions = true; }
      this.chart.addIndicator(s.type, s.params, s.colors, s.id);
    }
    this.renderLegend(null);
  }

  _saveIndicators() {
    this.settings.indicators = this.chart.indicators.map((i) => ({ id: i.id, type: i.type, params: i.params, colors: i.autoColor ? null : i.colors }));
    this.saveSettings();
    this.renderLegend(null);
  }

  addIndicator(type, params = {}) {
    // one session overlay is enough: switching kill zone / sessions updates it
    const same = type === 'sessions' && this.chart.indicators.find((i) => i.type === 'sessions');
    if (same) { this.updateIndicator(same.id, { ...same.params, ...params }); return; }
    this.chart.addIndicator(type, params);
    this._saveIndicators();
  }
  removeIndicator(id) { this.chart.removeIndicator(id); this._saveIndicators(); }
  updateIndicator(id, params) { this.chart.updateIndicator(id, params); this._saveIndicators(); }

  // ── drawings ───────────────────────────────────────────────────────────
  saveDrawings() {
    for (const p of this.sidePanes.values()) if (p.leg === this.leg) p.drawings.load(this.drawings.serialize());
    if (this.mode === 'replay') this.markDirty();
    else if (this.ds) store(`rt:drawings:${this.ds.id}`, this.drawings.serialize());
    if (this.drawings.selected) this.renderDrawingProps(this.drawings.selected);
  }

  renderDrawingProps(d) {
    const el = $('#drawing-props');
    if (!d) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    // every change also becomes this tool's default for the next drawing
    const set = (patch) => {
      patch = drawingStylePatch(d, patch);
      this.drawings.update(d.id, patch);
      const keep = Object.fromEntries(Object.entries(patch).filter(([k]) => ['color', 'width', 'dash', 'fill', 'size', 'bold', 'bg', 'opacity', 'lineOpacity', 'textOpacity', 'levels', 'profitColor', 'lossColor', 'posLabels', 'border', 'lineColor', 'mid'].includes(k)));
      if (Object.keys(keep).length) {
        this.settings.drawDefaults = { ...(this.settings.drawDefaults || {}), [d.type]: { ...(this.settings.drawDefaults?.[d.type] || {}), ...keep } };
        this.saveSettings();
      }
      this.renderDrawingProps(d);
    };
    const SWATCHES = ['#2962ff', '#9fa8ff', '#c77dff', '#ef5350', '#f5a623', '#26a69a', '#ffffff', '#111318'];
    const colorRow = h('div.dp-colors', {},
      SWATCHES.map((c) => h(`button.dp-swatch${(d.color || '').toLowerCase() === c ? '.on' : ''}`, { type: 'button', title: c, 'aria-label': `Renk ${c}`, style: { background: c }, onclick: () => set({ color: c }) })),
      h('input', { type: 'color', value: d.color || '#2962ff', title: 'Özel renk', oninput: (e) => this.drawings.update(d.id, { color: e.target.value }), onchange: (e) => set({ color: e.target.value }) }));
    const width = h('select.ctl.sm', { title: 'Kalınlık', onchange: (e) => set({ width: Number(e.target.value) }) }, (d.type === 'rect' ? [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8] : [0.5, 1, 1.5, 2, 3, 4, 6, 8]).map((w) => h('option', { value: w }, `${w}px`)));
    width.value = d.width ?? 1.5;
    const dash = d.dash === 'dot' ? 'dot' : d.dash ? 'dash' : 'solid';
    const styleSeg = h('div.dp-seg', { title: 'Çizgi stili' }, [['solid', '—', 'Düz'], ['dash', '‒ ‒', 'Kesikli'], ['dot', '···', 'Noktalı']].map(([v, l, t]) =>
      h(`button${dash === v ? '.on' : ''}`, { type: 'button', title: t, onclick: () => set({ dash: v === 'solid' ? false : v === 'dot' ? 'dot' : true }) }, l)));
    const position = d.type === 'long' || d.type === 'short';
    const fillOf = (x) => x.fill ?? (x.type === 'fib' ? 7 : x.type === 'channel' ? 10 : x.type === 'long' || x.type === 'short' ? 22 : 18);
    const fill = h('select.ctl.sm', { title: position ? 'Bölge opaklığı' : 'Dolgu', onchange: (e) => set({ fill: Number(e.target.value) }) }, [...new Set([0, 7, 10, 18, 22, 30, 50, 75, 100, fillOf(d)])].sort((a,b)=>a-b).map((v) => h('option', { value: v }, v ? `${position ? 'bölge' : 'dolgu'} %${v}` : (position ? 'bölgesiz' : 'dolgusuz'))));
    fill.value = fillOf(d);
    // a position: its own colours for the profit and the loss side, and how much it says
    const swatch = (key, label, fallback) => h('label.dp-zone', { title: `${label} rengi` }, h('i', { style: { background: d[key] || fallback } }), label,
      h('input', { type: 'color', value: d[key] || fallback, 'aria-label': `${label} rengi`, oninput: (e) => this.drawings.update(d.id, { [key]: e.target.value }), onchange: (e) => set({ [key]: e.target.value }) }));
    const posLabels = h('select.ctl.sm', { title: 'Etiketler', onchange: (e) => set({ posLabels: e.target.value }) }, [['full', 'tam etiket'], ['compact', 'kısa etiket'], ['none', 'etiketsiz']].map(([v, l]) => h('option', { value: v }, l)));
    posLabels.value = d.posLabels || 'full';
    const size = h('select.ctl.sm', { title: 'Yazı boyutu', onchange: (e) => set({ size: Number(e.target.value) }) }, [11, 13, 16, 20, 28].map((v) => h('option', { value: v }, `${v}px`)));
    size.value = d.size || 13;
    const text = d.type === 'text';
    el.replaceChildren(...[
      h('button.btn.small.dp-name', { title: 'Ayrıntılı çizim ayarları', onclick: () => this.drawingSettings(d) }, toolIcon(d.type, 15), TOOL_NAMES[d.type], icon('sliders', 13)),
      ['long', 'short', 'measure'].includes(d.type) ? null : colorRow,
      position ? swatch('profitColor', 'TP', POSITION_COLORS.profit) : null,
      position ? swatch('lossColor', 'SL', POSITION_COLORS.loss) : null,
      ['long', 'short', 'text'].includes(d.type) ? null : width,
      ['trend', 'ray', 'arrow', 'hline', 'hray', 'vline', 'rect', 'ellipse', 'triangle', 'channel', 'fib', 'pen'].includes(d.type) ? styleSeg : null,
      FILLED.includes(d.type) ? fill : null,
      position ? posLabels : null,
      text ? size : null,
      text ? h(`button.btn.small${d.bold ? '.active' : ''}`, { title: 'Kalın', onclick: () => set({ bold: !d.bold }), style: { fontWeight: '800' } }, 'B') : null,
      text ? h(`button.btn.small${d.bg ? '.active' : ''}`, { title: 'Arka plan (açık zeminde okunur)', onclick: () => set({ bg: !d.bg }) }, 'Zemin') : null,
      text ? h('button.btn.icon.small', { title: 'Metni düzenle', onclick: () => this.textDrawingDialog(d.text || '', text => this.drawings.update(d.id, { text })) }, icon('edit', 14)) : null,
      ['rect', 'fib'].includes(d.type) ? h(`button.btn.icon.small${d.extend ? '.active' : ''}`, { title: 'Sağa uzat', onclick: () => this.drawings.update(d.id, { extend: !d.extend }) }, icon('extend', 15)) : null,
      d.type === 'long' || d.type === 'short' ? h('button.btn.small.primary', { onclick: () => this.orderFromTool(d) }, 'Emir ver') : null,
      h(`button.btn.small.dp-lock${d.locked ? '.active' : ''}`, { title: 'Kilitle', onclick: () => this.drawings.update(d.id, { locked: !d.locked }) }, icon('lock', 14)),
      h('button.btn.small.danger', { title: 'Sil (Delete)', onclick: () => this.drawings.remove(d.id) }, icon('trash', 14)),
    ].filter(Boolean));
  }

  textDrawingDialog(initial, submit) {
    const input = h('input.ctl', { type: 'text', value: initial, maxlength: 500, placeholder: 'Grafiğe eklemek istediğin metin', 'aria-label': 'Grafik metni', style: { width:'100%' } });
    const dlg = modal({ title: initial ? 'Metni düzenle' : 'Grafiğe metin ekle', body: input, actions: [
      { label: 'Vazgeç' }, { label: initial ? 'Kaydet' : 'Ekle', kind: 'primary', onClick: () => {
        const text = input.value.trim(); if (!text) { input.focus(); return false; } submit(text);
      } },
    ] });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); dlg.el.querySelector('footer .primary')?.click(); } });
  }

  drawingSettings(d) {
    const draft = JSON.parse(JSON.stringify(d));
    const body = h('div.drawing-settings');
    const field = (name, node) => body.append(h('label', {}, name, node));
    const number = (key, value, min, max, step = 1) => h('input.ctl', { type: 'number', value, min, max, step, onchange: e => {
      const n = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) { Object.assign(draft, drawingStylePatch(draft, { [key]: n })); repaintLevels(); }
      else e.target.value = draft[key] ?? value;
    } });
    const check = (key, value) => h('input', { type: 'checkbox', checked: value, onchange: e => { draft[key] = e.target.checked; } });
    let repaintLevels = () => {};
    const position = d.type === 'long' || d.type === 'short';
    const color = (key, fallback) => h('input', { type: 'color', value: draft[key] || fallback, oninput: e => { draft[key] = e.target.value; } });
    if (position) {
      field('Kâr bölgesi (TP) rengi', color('profitColor', POSITION_COLORS.profit));
      field('Zarar bölgesi (SL) rengi', color('lossColor', POSITION_COLORS.loss));
      field('Giriş çizgisi rengi', color('lineColor', '#9598a1'));
      field('Bölge kenarlığı', check('border', draft.border !== false));
      const labels = h('select.ctl', { onchange: e => { draft.posLabels = e.target.value; } }, [['full', 'Tam (fiyat, pip, %)'], ['compact', 'Kısa (pip, R:R)'], ['none', 'Gizli (seçince görünür)']].map(([v, l]) => h('option', { value: v }, l)));
      labels.value = draft.posLabels || 'full';
      field('Etiketler', labels);
    } else {
      field(d.type === 'fib' ? 'Tüm seviyelerin rengi' : 'Çizgi rengi', h('input', { type: 'color', value: draft.color || '#2962ff', oninput: e => { Object.assign(draft, drawingStylePatch(draft, { color: e.target.value })); repaintLevels(); } }));
    }
    field(position ? 'Giriş çizgisi kalınlığı (px)' : 'Kalınlık (px)', number('width', draft.width ?? 1.5, ['rect', 'ellipse', 'triangle'].includes(d.type) ? 0 : 0.5, 12, 0.5));
    const opacityField = (label, key, fallback=100) => {
      const input = h('input', { type:'range', min:0, max:100, step:1, value:draft[key] ?? fallback, 'aria-label':label });
      const value = h('output', {}, `${input.value}%`);
      input.addEventListener('input', () => { draft[key]=Number(input.value); value.textContent=`${input.value}%`; });
      field(label, h('span.drawing-opacity', {}, input, value));
    };
    opacityField('Genel opaklık', 'opacity');
    if (!position) opacityField(['rect', 'ellipse', 'triangle'].includes(d.type) ? 'Kenarlık opaklığı' : 'Çizgi opaklığı', 'lineOpacity');
    if (['fib', 'text'].includes(d.type)) opacityField('Yazı opaklığı', 'textOpacity');
    if (FILLED.includes(d.type)) opacityField(d.type === 'fib' ? 'Fibonacci kutusu / dolgu opaklığı' : position ? 'Bölge opaklığı' : 'Dolgu opaklığı', 'fill', d.type === 'fib' ? 7 : d.type === 'channel' ? 10 : position ? 22 : 18);
    if (d.type === 'channel') field('Orta çizgi', check('mid', draft.mid !== false));
    const styles = [['', 'Düz'], ['dash', 'Kesikli'], ['dot', 'Noktalı']];
    const styleInput = (value, change) => {
      const el = h('select.ctl', { onchange: e => change(e.target.value || false) }, styles.map(([v, label]) => h('option', { value: v }, label)));
      el.value = value === 'dot' ? 'dot' : value ? 'dash' : ''; return el;
    };
    field('Çizgi stili', styleInput(draft.dash, v => { Object.assign(draft, drawingStylePatch(draft, { dash:v })); repaintLevels(); }));
    if (['rect', 'fib'].includes(d.type)) field('Sağa uzat', check('extend', !!draft.extend));
    field('Kilitle', check('locked', !!draft.locked));
    if (d.type === 'fib') {
      field('Yazı rengi', h('input', { type:'color', value:draft.textColor || draft.color || '#9598a1', oninput:e=>{draft.textColor=e.target.value;} }));
      field('Çapraz başlangıç çizgisi', check('baseline', draft.baseline !== false));
      field('Seviye etiketleri', check('labels', draft.labels !== false));
      field('Fiyatları göster', check('prices', draft.prices !== false));
      field('Yüzde olarak göster', check('percent', !!draft.percent));
      draft.levels ||= FIB_LEVELS.map(value => ({ value, visible: true, color: draft.color || '#9598a1', width: draft.width ?? 1.5, dash: draft.dash || false }));
      const rows = h('div.drawing-settings');
      const paint = () => rows.replaceChildren(...draft.levels.map((level, i) => {
        const val = h('input.ctl', { type: 'number', step: 'any', value: level.value, 'aria-label': 'Seviye oranı', onchange: e => {
          if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) level.value = Number(e.target.value);
          else e.target.value = level.value;
        } });
        return h('div.fib-level-row', {},
          h('input', { type: 'checkbox', checked: level.visible !== false, 'aria-label': 'Seviyeyi göster', onchange: e => { level.visible = e.target.checked; } }), val,
          h('input', { type: 'color', value: level.color || draft.color || '#9598a1', 'aria-label': 'Seviye rengi', oninput: e => { level.color = e.target.value; } }),
          h('input.ctl', { type: 'number', min: .5, max: 12, step: .5, value: level.width ?? draft.width ?? 1.5, 'aria-label': 'Seviye kalınlığı', onchange: e => { const n = Number(e.target.value); if (n >= .5 && n <= 12) level.width = n; else e.target.value = level.width ?? 1.5; } }),
          styleInput(level.dash, v => { level.dash = v; }),
          h('button.btn.small', { title: 'Seviyeyi sil', onclick: () => { draft.levels.splice(i, 1); paint(); } }, '×'));
      }));
      repaintLevels = paint;
      paint(); body.append(h('strong', {}, 'Fibonacci seviyeleri'), rows,
        h('button.btn', { onclick: () => { draft.levels.push({ value: 1.618, color: draft.color || '#9598a1', visible: true }); paint(); } }, '+ Seviye ekle'));
    }
    // prices as the market quotes them (a dragged point sits between ticks)
    const dec = this.ds?.decimals ?? 5;
    const priceField = (label, get, put) => field(label, h('input.ctl', { type: 'number', step: 'any', value: Number(get().toFixed(dec)), onchange: e => {
      if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) put(Number(e.target.value));
      else e.target.value = get();
    } }));
    if (position) {
      priceField('Giriş fiyatı', () => draft.points[0].price, v => { draft.points[0].price = v; draft.points[1].price = v; });
      priceField('Hedef (TP) fiyatı', () => draft.target, v => { draft.target = v; });
      priceField('Stop (SL) fiyatı', () => draft.stop, v => { draft.stop = v; });
    } else if (d.type !== 'pen') {
      for (const [i, point] of draft.points.entries()) priceField(`Nokta ${i + 1} · fiyat`, () => point.price, v => { point.price = v; });
    }
    modal({ title: `${TOOL_NAMES[d.type]} · Ayarlar`, body, wide: d.type === 'fib', actions: [
      { label: 'Vazgeç' }, { label: 'Uygula', kind: 'primary', onClick: () => {
        this.drawings.update(d.id, draft); this.renderDrawingProps(d);
        const keys = ['color', 'width', 'dash', 'fill', 'size', 'bold', 'bg', 'extend', 'levels', 'labels', 'prices', 'percent', 'opacity', 'lineOpacity', 'textOpacity', 'textColor', 'baseline', 'profitColor', 'lossColor', 'lineColor', 'border', 'posLabels', 'mid'];
        const defaults = Object.fromEntries(keys.filter(key => key in draft).map(key => [key, draft[key]]));
        this.settings.drawDefaults = { ...this.settings.drawDefaults, [draft.type]: defaults }; this.saveSettings();
      } },
    ] });
  }

  pickPrice(cb, message = 'Fiyat seçmek için grafiğe tıklayın · Esc: iptal') {
    this.cancelPick();
    this.showMessage(message);
    $('#chart').classList.add('picking');
    const remove = this.drawings.addInterceptor({
      hover: () => 'crosshair',
      start: () => ({ end: (x, y) => {
        this.cancelPick();
        const price = this.chart.priceAt(y);
        const bar = this.chart.barAt(x);
        if (price != null) cb(price, bar);
      } }),
    });
    // picking must win over trade lines
    this.drawings.interceptors.unshift(this.drawings.interceptors.pop());
    this._picking = remove;
  }

  cancelPick() {
    if (!this._picking) return;
    this._picking();
    this._picking = null;
    $('#chart').classList.remove('picking');
    this.showMessage('');
  }

  pickReplayStart() {
    if (this.mode !== 'browse') return;
    this.pickPrice((_, bar) => { if (bar) this.newSessionDialog({ start: bar.time }); }, 'Replay başlangıcı için bir bara tıklayın · Esc: iptal');
  }

  // ── rendering: top bar, toolbar, legend, tabs ──────────────────────────
  renderTfButtons() {
    this.chart.setWatermark(this.ds ? `${this.ds.symbol} ${this.tfId}` : '');
    const el = $('#tf-group');
    const tfs = this.ds ? this.ds.timeframes : [];
    const fav = tfs.filter((tf) => TF_FAVORITES.includes(tf));
    const rest = tfs.filter((tf) => !TF_FAVORITES.includes(tf));
    const more = rest.length ? h(`select.more${rest.includes(this.tfId) ? '.on' : ''}`, { title: 'Diğer zaman dilimleri', onchange: (e) => { if (e.target.value) this.setTf(e.target.value); } },
      h('option', { value: '' }, rest.includes(this.tfId) ? this.tfId : '···'), rest.map((tf) => h('option', { value: tf }, tf))) : null;
    el.replaceChildren(...fav.map((tf) => h(`button.btn${tf === this.tfId ? '.active' : ''}`, { onclick: () => this.setTf(tf), title: tf }, tf)), ...(more ? [more] : []));
    const sel = $('#tf-select');
    sel.replaceChildren(...tfs.map((tf) => h('option', { value: tf }, tf)));
    sel.value = this.tfId;
  }

  /** Buy · lot · Sell: shown in a replay, prices kept current. */
  renderTradeBar() {
    const el = this.tradeBar;
    if (!el) return;
    const on = this.mode === 'replay' && !!this.broker;
    el.classList.toggle('on', on);
    if (!on) { el.replaceChildren(); this._tb = null; this.renderAccount(); return; }
    const buy = h('button.tb-buy', { type: 'button', title: 'Piyasadan al (Shift+B)', onclick: () => this.quickOrder('buy') }, icon('buy', 16), h('span.tb-k', {}, 'Al'), h('span.tb-p', {}));
    const sell = h('button.tb-sell', { type: 'button', title: 'Piyasadan sat (Shift+S)', onclick: () => this.quickOrder('sell') }, icon('sell', 16), h('span.tb-k', {}, 'Sat'), h('span.tb-p', {}));
    const size = h('button.tb-size', { type: 'button', title: 'Lot / % risk, hazır SL-TP, otomatik başabaş', onclick: (e) => this.sizeMenu(e.currentTarget) });
    el.replaceChildren(buy, size, sell);
    this._tb = { buy, sell, size };
    this.updateTradeBar();
  }

  updateTradeBar() {
    this.renderAccount();
    const tb = this._tb, b = this.broker;
    if (!tb || !b) return;
    const dec = this.ds.decimals;
    tb.buy.lastChild.textContent = F.price(b.ask(), dec);
    tb.sell.lastChild.textContent = F.price(b.bid(), dec);
    const t = this.settings.ticket;
    tb.size.textContent = t.sizeMode === 'risk' ? `%${F.num(t.riskPct, 2)}` : `${F.num(t.lots, 2)} lot`;
    tb.size.classList.toggle('risk', t.sizeMode === 'risk');
    const end = this.engine?.atEnd;
    tb.buy.disabled = tb.sell.disabled = !!end;
  }

  /** Balance and what the open trades are worth now (every market of the session). */
  renderAccount() {
    const el = this.acctEl;
    if (!el) return;
    const b = this.broker;
    if (this.mode !== 'replay' || !b) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const ccy = b.cfg.currency;
    const open = this._allLegs().reduce((s, l) => s + l.broker.openPnl(), 0);
    const sig = `${b.balance.toFixed(2)}|${open.toFixed(2)}`;
    if (sig === this._acctSig && el.firstChild) return;
    this._acctSig = sig;
    el.title = `Bakiye ${F.money(b.balance, ccy)} · varlık ${F.money(b.equity(), ccy)}`;
    el.replaceChildren(
      h('span.cs-bal.mono', {}, F.money(b.balance, ccy)),
      h(`span.cs-dot${F.cls(open) ? `.${F.cls(open)}` : ''}`),
      h(`span.cs-open.mono${F.cls(open) ? `.${F.cls(open)}` : ''}`, {}, F.signedMoney(open, ccy)));
  }

  /** Sizing: lots or % of the balance, the optional preset stop / target, and auto breakeven. */
  sizeMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const t = this.settings.ticket;
    const save = () => { this.saveSettings(); this.updateTradeBar(); this.ticket.render(); if (this.draft) this._draftChanged(); };
    const paint = () => {
      const risk = t.sizeMode === 'risk';
      const value = h('input.ctl.sm.mono', { type: 'number', step: risk ? 0.05 : 0.01, min: risk ? 0.05 : 0.01, value: risk ? t.riskPct : t.lots, 'aria-label': risk ? 'Risk yüzdesi' : 'Lot',
        oninput: (e) => { const v = Number(e.target.value); if (v > 0) { if (risk) t.riskPct = v; else t.lots = v; save(); } } });
      const presets = (risk ? [0.25, 0.5, 1, 2] : [0.1, 0.5, 1, 2]).map((v) => h(`button.chip${(risk ? t.riskPct : t.lots) === v ? '.on' : ''}`, { type: 'button', onclick: () => { if (risk) t.riskPct = v; else t.lots = v; save(); paint(); } }, risk ? `%${v}` : `${v}`));
      const toggle = (key, label, sub, extra = null) => h('label.pop-toggle', {}, h('span', {}, h('span.t', {}, label), h('span.s', {}, sub)), extra,
        h('input', { type: 'checkbox', checked: !!t[key], onchange: (e) => { t[key] = e.target.checked; save(); paint(); } }));
      const pips = (key) => h('input.ctl.sm.mono', { type: 'number', step: 0.1, min: 0.1, value: t[key], style: { width: '72px' }, onclick: (e) => e.stopPropagation(), oninput: (e) => { const v = Number(e.target.value); if (v > 0) { t[key] = v; save(); } } });
      pop.replaceChildren(
        h('h5', {}, 'İşlem büyüklüğü'),
        h('div.seg.pop-seg', {}, [['risk', '% Risk'], ['lots', 'Lot']].map(([v, l]) => h(`button${t.sizeMode === v ? '.on' : ''}`, { type: 'button', onclick: () => { t.sizeMode = v; save(); paint(); } }, l))),
        h('div.pop-row', {}, value, h('span.muted', {}, risk ? 'bakiyenin yüzdesi' : 'lot')),
        h('div.rw-grid.four', {}, presets),
        h('p.muted.rw-note', {}, risk ? `Al / Sat önce taslak açar. SL’yi çizgiden sürükleyince lot, bakiyenin %${F.num(t.riskPct, 2)}’i riske girecek şekilde hesaplanır; onaylayınca işleme girer.` : 'Al / Sat önce taslak açar; SL / TP’yi çizgiden sürükleyip onaylayınca bu lotla girer.'),
        h('hr'),
        toggle('slOn', 'Hazır SL', `her emre ${F.num(t.slPips, 1)} pip stop`, t.slOn ? pips('slPips') : null),
        toggle('tpOn', 'Hazır TP', `her emre ${F.num(t.tpPips, 1)} pip hedef`, t.tpOn ? pips('tpPips') : null),
        toggle('autoBe', 'Otomatik başabaş', `fiyat ${F.num(t.beR || 1, 1)}R gidince stop girişe`, t.autoBe ? pips('beR') : null),
      );
      // above the bar, grown or shrunk with its content
      const r = anchor.getBoundingClientRect();
      pop.style.top = `${Math.max(8, r.top - 10 - pop.offsetHeight)}px`;
    };
    const pop = this.popover(anchor, [], { align: 'left' });
    pop.classList.add('size-pop');
    paint();
  }

  renderReplayControls() {
    this.renderTradeBar();
    this.renderMobile();
    const el = $('#replay-controls');
    if (!this.scrubEl) {
      this.scrubEl = scrubWheel({ getLook: () => this.chart.look || {}, onSteps: (n) => this.scrubSteps(n), onStart: () => { if (this.playing) this.pause(); } });
      $('#chart-area').append(this.scrubEl);
    }
    this.scrubEl.hidden = this.mode !== 'replay' || this.settings.scrubWheel === false;
    el.classList.toggle('on', this.mode === 'replay');
    el.classList.toggle('live', this.mode === 'live');
    if (this.mode === 'live') {
      this.clockEl = h('span.clock', {});
      el.replaceChildren(
        h(`span.badge.live${this._liveError ? '.error' : ''}`, { title: this._liveError || 'Fiyatlar birkaç saniyede bir güncellenir' }, this._liveError ? 'Bağlantı yok' : 'Canlı'),
        h('span.dock-label', {}, this.liveState.provider === 'oanda' ? 'OANDA' : 'Binance'),
        this.clockEl,
        h('span.vr'),
        h('button.btn', { title: 'Bu sembolün son 10 yılını indir (replay için)', onclick: () => this.downloadLiveHistory() }, icon('download', 16), h('span.lbl', {}, '10 yılı indir')),
        h('button.btn.icon', { title: 'Başka sembol', onclick: () => D.liveDialog(this) }, icon('swap', 16)),
        h('button.btn', { title: 'Canlıdan çık', onclick: () => this.exitLive() }, icon('close', 16)));
      this.renderClock();
      return;
    }
    if (this.mode !== 'replay') {
      if (!this.ds || !this.ds.bar_count) { el.replaceChildren(); return; }
      el.replaceChildren(
        h('span.dock-label', {}, 'Replay'),
        h('button.btn', { title: 'Grafikte bir bara tıklayarak başlangıç seçin', onclick: () => this.pickReplayStart() }, icon('scissors', 16), h('span.lbl', {}, 'Grafikten seç')),
        h('button.btn.small.primary', { title: 'Geçmişte bir tarihten replay başlat', onclick: () => this.newSessionDialog() }, icon('play', 14), 'Başlat'));
      return;
    }
    const speed = h('select.ctl.sm', { title: 'Hız (adım / sn)', onchange: (e) => { e.target.blur(); this.settings.speed = Number(e.target.value); this.saveSettings(); if (this.playing) { this.pause(); this.play(); } } },
      SPEEDS.map(([v, l]) => h('option', { value: v }, l)));
    speed.value = this.settings.speed;
    const unit = h('select.ctl.sm.unit', { title: 'Adım: ileri / geri her basışta bir taban barı ya da bir grafik barı', onchange: (e) => { e.target.blur(); this.settings.stepUnit = e.target.value; this.saveSettings(); this.renderReplayControls(); } },
      h('option', { value: 'base' }, `${this.ds.base_tf} adım`), h('option', { value: 'bar' }, `${this.tfId} bar`));
    unit.value = this.settings.stepUnit;
    const pauseFill = h(`button.btn.small${this.settings.pauseOnFill ? '.active' : ''}`, { title: `Dolunca dur: emir dolunca / pozisyon kapanınca duraklat (${this.settings.pauseOnFill ? 'açık' : 'kapalı'})`, onclick: () => { this.settings.pauseOnFill = !this.settings.pauseOnFill; this.saveSettings(); this.renderReplayControls(); } }, icon('bolt', 15));
    this.clockEl = h('span.clock', {});
    const unitName = this.settings.stepUnit === 'bar' ? `${this.tfId} bar` : this.ds.base_tf;
    el.replaceChildren(
      h('button.btn', { title: 'Zamanda git: geri sar (N bar, grafikten bar, gün / oturum başı) ya da ileri sar', onclick: (e) => this.rewindMenu(e.currentTarget) }, icon('rewind')),
      h('button.btn', { title: `Geri: 1 ${unitName} (←, grafik barı: Shift+←) · işlemler de geri alınır`, onclick: () => this.stepBack() }, icon('stepback')),
      h('button.btn.play', { title: this.playing ? 'Duraklat (Space)' : 'Oynat (Space)', onclick: () => this.togglePlay() }, icon(this.playing ? 'pause' : 'play')),
      h('button.btn', { title: `İleri: 1 ${unitName} (→, grafik barı: Shift+→)`, onclick: () => this.step() }, icon('step')),
      h('span.vr'), speed, unit, pauseFill, h('span.vr'),
      this.clockEl,
      h('button.btn.dock-exit', { title: 'Replay’den çık (oturum kaydedilir)', onclick: () => this.exitReplay() }, icon('stop', 16)));
    this.renderClock();
  }

  // ── phones: Alltra's chart (a pill of actions at the top, one floating
  // bar at the foot: trade · the replay · draw) ─────────────────────────
  renderMobile() {
    const acts = $('#m-acts'), info = $('#m-info'), bar = $('#m-bar');
    if (!acts || !bar) return;
    // the round RV mark and the search pill with the price (Alltra's top)
    const hl = $('.home-link');
    if (hl && !hl.querySelector('.hl-mark')) hl.append(h('span.hl-mark', { 'aria-hidden': 'true' }, brandMark(24)));
    const ib = $('#instrument-btn');
    if (ib && !ib.querySelector('.m-ic')) { ib.prepend(h('span.m-ic', { 'aria-hidden': 'true' }, icon('search', 20))); ib.append(h('span.m-px.rv-num', { id: 'instrument-px' })); }
    const replay = this.mode === 'replay' && !!this.engine;
    const btn = (ic, label, onclick, cls = '') => h(`button.m-btn${cls}`, { type: 'button', title: label, 'aria-label': label, onclick }, icon(ic, 20));
    acts.replaceChildren(
      btn('indicator', 'İndikatör ekle', () => D.indicatorsDialog(this)),
      btn(replay ? 'rewind' : 'replay', replay ? 'Zamanda git: geri / ileri sar' : 'Replay', (e) => (replay ? this.rewindMenu(e.currentTarget) : this.replayStartMenu(e.currentTarget))),
      btn('more', 'Diğer', (e) => this.mobileMoreMenu(e.currentTarget)));
    // the timeframe and the replay's time over the bar
    this.mClock = h('span.m-clock.mono');
    info.replaceChildren(h('button.m-tf', { type: 'button', title: 'Zaman dilimi', onclick: (e) => this.tfMenu(e.currentTarget) }, this.tfId || '—'), this.mClock);
    const round = (ic, label, onclick, cls = '') => h(`button.m-round${cls}`, { type: 'button', title: label, 'aria-label': label, onclick }, icon(ic, 22));
    const draw = round('draw', 'Çizim araçları', () => this.drawSheet(), this.drawings?.tool && this.drawings.tool !== 'cursor' ? '.on' : '');
    if (this.mode === 'live') {
      bar.replaceChildren(round('swap', 'Başka sembol', () => D.liveDialog(this)),
        h('div.m-pill', {}, h('span.m-live', {}, h('i'), 'Canlı'), h('button.m-pbtn', { type: 'button', title: 'Canlıdan çık', 'aria-label': 'Canlıdan çık', onclick: () => this.exitLive() }, icon('close', 20))), draw);
    } else if (!replay) {
      const ok = !!this.ds?.bar_count;
      bar.replaceChildren(round('sessions', 'Kayıtlı oturumlar', () => this.sessionsDialog()),
        h('div.m-pill', {},
          h('button.m-pbtn.wide', { type: 'button', disabled: !ok, onclick: () => this.newSessionDialog() }, icon('play', 18), h('span', {}, 'Replay başlat')),
          h('span.m-sep'),
          h('button.m-pbtn', { type: 'button', disabled: !ok, title: 'Grafikte bir bara dokunarak başla', 'aria-label': 'Grafikten başlangıç seç', onclick: () => this.pickReplayStart() }, icon('scissors', 19))),
        draw);
    } else {
      const open = this._allLegs().reduce((n, l) => n + l.broker.positions.length, 0);
      const trade = round('swap', 'Al / Sat', (e) => this.tradeSheet(e.currentTarget), open ? '.badge' : '');
      if (open) trade.dataset.n = String(open);
      bar.replaceChildren(trade,
        h('div.m-pill', {},
          h('button.m-pbtn', { type: 'button', title: 'Geri', 'aria-label': 'Geri', onclick: () => this.stepBack() }, icon('stepback', 20)),
          h('span.m-sep'),
          h('button.m-pbtn.play', { type: 'button', title: this.playing ? 'Duraklat' : 'Oynat', 'aria-label': this.playing ? 'Duraklat' : 'Oynat', onclick: () => this.togglePlay() }, icon(this.playing ? 'pause' : 'play', 22)),
          h('span.m-sep'),
          h('button.m-pbtn', { type: 'button', title: 'İleri', 'aria-label': 'İleri', onclick: () => this.step() }, icon('step', 20)),
          h('span.m-sep'),
          h('button.m-pbtn', { type: 'button', title: 'Hız ve adım', 'aria-label': 'Hız ve adım', onclick: (e) => this.replayMoreMenu(e.currentTarget) }, icon('more', 20))),
        draw);
    }
    document.body.classList.toggle('m-replay', replay);
    this.renderClock();
  }

  /** The RV appearance sheet, painting the chart as it changes. */
  lookSheet() {
    appearanceSheet({ a: this.settings.appearance, apply: (x) => { this.settings.appearance = x; this.previewAppearance(x); }, save: () => this.saveSettings() });
  }

  /** Phones: the timeframes as a grid. */
  tfMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    if (!this.ds) return;
    this.popover(anchor, [h('h5', {}, 'Zaman dilimi'), h('div.rw-grid.four', {}, this.ds.timeframes.map((t) => h(`button.chip${t === this.tfId ? '.on' : ''}`, { type: 'button', onclick: () => { this.closePopover(); this.setTf(t); } }, t)))], { align: 'left' });
  }

  /** Not in a replay: the ways to start one. */
  replayStartMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const go = (fn) => () => { this.closePopover(); fn(); };
    this.popover(anchor, [
      h('button.item', { onclick: go(() => this.newSessionDialog()) }, icon('play', 16), h('span', {}, h('span.t.plain', {}, 'Yeni replay'), h('span.s', {}, 'bir tarih seçip başla'))),
      h('button.item', { onclick: go(() => this.pickReplayStart()) }, icon('scissors', 16), h('span', {}, h('span.t.plain', {}, 'Grafikten seç'), h('span.s', {}, 'bir bara dokun, oradan başlasın'))),
      h('button.item', { onclick: go(() => this.sessionsDialog()) }, icon('sessions', 16), h('span', {}, h('span.t.plain', {}, 'Kayıtlı oturumlar'), h('span.s', {}, 'kaldığın yerden devam et'))),
    ], { align: 'right' });
  }

  /** Phones: everything the top bar of a wide screen holds. */
  mobileMoreMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const go = (fn) => () => { this.closePopover(); fn(); };
    const item = (ic, t, sub, fn) => h('button.item', { onclick: go(fn) }, icon(ic, 16), h('span', {}, h('span.t.plain', {}, t), sub ? h('span.s', {}, sub) : null));
    this.popover(anchor, [
      h('div.seg.pop-seg', {}, MODES.map(([mode, label]) => h(`button${this.mode === mode ? '.on' : ''}`, { type: 'button', onclick: go(() => this.switchMode(mode)) }, label))),
      item('panel', 'Pozisyonlar ve geçmiş', 'emirler, istatistik, veri', () => this.openTab(this.mode === 'replay' ? 'positions' : (this.settings.bottomTab || 'data'))),
      this.mode === 'replay' ? item('layouts', 'Ekranı böl', 'iki grafik alt alta', () => this.layoutMenu(anchor)) : null,
      item('sessions', 'Kayıtlı oturumlar', null, () => this.sessionsDialog()),
      item('search', 'Ara', 'sembol, zaman dilimi, komut', () => openPalette(() => this._paletteItems())),
      item('palette', 'Görünüm', 'tema, vurgu rengi, mum renkleri', () => this.lookSheet()),
      item('sliders', 'Ayarlar', 'saat dilimi, hesap, grafik', () => D.settingsDialog(this)),
      this.mode === 'replay' ? item('stop', 'Replay’den çık', 'oturum kaydedilir', () => this.exitReplay()) : null,
      item('home', 'Ana ekran', null, () => { window.location.href = 'home.html'; }),
    ].filter(Boolean), { align: 'right' });
  }

  /** Phones: speed, step and the stops of the replay. */
  replayMoreMenu(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const save = () => { this.saveSettings(); if (this.playing) { this.pause(); this.play(); } };
    const paint = () => {
      pop.replaceChildren(
        h('h5', {}, 'Hız'),
        h('div.rw-grid.four', {}, SPEEDS.map(([v, l]) => h(`button.chip${this.settings.speed === v ? '.on' : ''}`, { type: 'button', onclick: () => { this.settings.speed = v; save(); paint(); } }, l))),
        h('h5', {}, 'Adım'),
        h('div.seg.pop-seg', {}, [['base', `${this.ds.base_tf} adım`], ['bar', `${this.tfId} bar`]].map(([v, l]) => h(`button${this.settings.stepUnit === v ? '.on' : ''}`, { type: 'button', onclick: () => { this.settings.stepUnit = v; this.saveSettings(); paint(); } }, l))),
        h('label.pop-toggle', {}, h('span', {}, h('span.t', {}, 'Dolunca dur'), h('span.s', {}, 'emir dolunca ya da pozisyon kapanınca duraklat')),
          h('input', { type: 'checkbox', checked: !!this.settings.pauseOnFill, onchange: (e) => { this.settings.pauseOnFill = e.target.checked; this.saveSettings(); } })),
        h('hr'),
        h('button.item', { onclick: (e) => { this.closePopover(); this.rewindMenu(anchor); } }, icon('rewind', 16), h('span.t.plain', {}, 'Zamanda git')),
        h('button.item', { onclick: () => { this.closePopover(); this.exitReplay(); } }, icon('stop', 16), h('span', {}, h('span.t.plain', {}, 'Replay’den çık'), h('span.s', {}, 'oturum kaydedilir'))));
    };
    const pop = this.popover(anchor, [], { align: 'right' });
    pop.classList.add('size-pop');
    paint();
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(8, r.top - 10 - pop.offsetHeight)}px`;
  }

  /** Phones: Buy and Sell with their prices and the size; a tap opens a draft. */
  tradeSheet(anchor) {
    if (this._popover) { this.closePopover(); return; }
    const b = this.broker;
    if (!b) return;
    const dec = this.ds.decimals, t = this.settings.ticket;
    const go = (side) => () => { this.closePopover(); this.startDraft(side); };
    const open = b.positions.length, pend = b.orders.filter((o) => o.type !== 'next').length;
    const pop = this.popover(anchor, [
      h('div.ts-row', {},
        h('button.ts-sell', { type: 'button', disabled: !!this.engine?.atEnd, onclick: go('sell') }, h('span', {}, 'Sat'), h('b.mono', {}, F.price(b.bid(), dec))),
        h('button.ts-buy', { type: 'button', disabled: !!this.engine?.atEnd, onclick: go('buy') }, h('span', {}, 'Al'), h('b.mono', {}, F.price(b.ask(), dec)))),
      h('button.item', { onclick: () => { this.closePopover(); this.sizeMenu(anchor); } }, icon('sliders', 16), h('span', {}, h('span.t.plain', {}, t.sizeMode === 'risk' ? `Risk %${F.num(t.riskPct, 2)}` : `${F.num(t.lots, 2)} lot`), h('span.s', {}, 'işlem büyüklüğü, otomatik başabaş'))),
      h('button.item', { onclick: () => { this.closePopover(); this.openTab('positions'); } }, icon('panel', 16), h('span', {}, h('span.t.plain', {}, 'Pozisyonlar'), h('span.s', {}, `${open} açık · ${pend} bekleyen emir`))),
      h('p.muted.rw-note', {}, 'Al / Sat taslak açar: TP ve SL’yi çizgiden sürükle, sonra onayla.'),
    ], { align: 'left' });
    pop.classList.add('trade-pop');
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(8, r.top - 10 - pop.offsetHeight)}px`;
  }

  renderClock() {
    const px = document.getElementById('instrument-px');
    if (px) {
      const last = this.mode === 'replay' && this.broker ? this.broker.bid() : this.chart?.bars?.[this.chart.bars.length - 1]?.close;
      px.textContent = last != null && this.ds ? F.price(last, this.ds.decimals) : '';
    }
    if (this.mClock) this.mClock.textContent = this.mode === 'replay' && this.engine ? F.clock(this.engine.cursor, this.settings.tz) : '';
    if (this.clockWide) {
      const on = this.mode === 'replay' && !!this.engine;
      this.clockWide.hidden = !on;
      if (on) this.clockWide.textContent = F.clock(this.engine.cursor, this.settings.tz);
    }
    if (!this.clockEl) return;
    if (this.mode === 'replay' && this.engine) this.clockEl.textContent = F.clock(this.engine.cursor, this.settings.tz);
    else if (this.mode === 'live' && this._liveUpdated) this.clockEl.textContent = `güncelleme ${F.dateTime(Math.floor(this._liveUpdated / 1000), this.settings.tz, true).slice(-8)}`;
  }

  renderToolbar() {
    const el = $('#draw-toolbar');
    const tool = this.drawings.tool;
    const picks = this.settings.toolPicks || {};
    let i = 0;
    const tools = [];
    for (const group of TOOL_GROUPS) {
      if (!group) { tools.push(h('hr', { style: { '--i': i++ } })); continue; }
      const shown = group.includes(tool) ? tool : group.includes(picks[group[0]]) ? picks[group[0]] : group[0];
      const btn = h(`button.btn${group.includes(tool) ? '.active' : ''}${group.length > 1 ? '.has-more' : ''}`, {
        type: 'button', style: { '--i': i++ },
        title: `${TOOL_NAMES[shown]}${toolKey(shown) ? ` (${toolKey(shown)})` : ''}${group.length > 1 ? ' · diğerleri için köşeye tıkla ya da basılı tut' : ''}`,
        onclick: (e) => {
          if (group.length > 1 && e.target.closest('.tb-more')) { this.toolFlyout(btn, group); return; }
          this.drawings.setTool(tool === shown ? 'cursor' : shown);
        },
        oncontextmenu: (e) => { e.preventDefault(); this.toolFlyout(btn, group); },
      }, toolIcon(shown), group.length > 1 ? h('span.tb-more', { 'aria-hidden': 'true' }) : null);
      if (group.length > 1) {
        // touch: hold for the rest of the group
        let timer = null;
        btn.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') timer = setTimeout(() => { timer = null; btn.dataset.held = '1'; this.toolFlyout(btn, group); }, 420); });
        btn.addEventListener('pointerup', () => clearTimeout(timer));
        btn.addEventListener('pointerleave', () => clearTimeout(timer));
        btn.addEventListener('click', (e) => { if (btn.dataset.held) { delete btn.dataset.held; e.stopImmediatePropagation(); } }, true);
      }
      tools.push(btn);
    }
    tools.push(
      h('hr', { style: { '--i': i++ } }),
      h(`button.btn${this.drawings.magnet ? '.active' : ''}`, { style: { '--i': i++ }, title: 'Mıknatıs: OHLC’ye yapış', onclick: () => { this.drawings.magnet = !this.drawings.magnet; this.settings.magnet = this.drawings.magnet; this.saveSettings(); this.renderToolbar(); } }, icon('magnet')),
      h(`button.btn${this.drawings.keepDrawing ? '.active' : ''}`, { style: { '--i': i++ }, title: `Sürekli çizim: ${this.drawings.keepDrawing ? 'açık' : 'kapalı'} (araç çizimden sonra elde kalır)`, onclick: () => { this.drawings.keepDrawing = !this.drawings.keepDrawing; this.settings.keepDrawing = this.drawings.keepDrawing; this.saveSettings(); this.renderToolbar(); } }, icon('lock')),
      h(`button.btn${this.drawings.hideAll ? '.active' : ''}`, { style: { '--i': i++ }, title: 'Çizimleri gizle / göster (Ctrl+Alt+H)', onclick: () => { this.drawings.hideAll = !this.drawings.hideAll; this.drawings.select(null); this.drawings.redraw(); this.renderToolbar(); } }, icon('eye')),
      h('button.btn', { style: { '--i': i++ }, title: 'Tüm çizimleri sil', onclick: async () => { if (this.drawings.drawings.length && await confirmBox('Çizimleri sil', 'Bu grafikteki tüm çizimler silinsin mi?', 'Sil', 'danger')) this.drawings.clear(); } }, icon('trash')),
      // phones: the indicator button lives here, the top bar has no room
      h('hr.mobile-only', { style: { '--i': i++ } }),
      h('button.btn.mobile-only', { style: { '--i': i++ }, title: 'İndikatör ekle', onclick: () => { $('#draw-toolbar').classList.remove('show'); D.indicatorsDialog(this); } }, icon('indicator')));
    const collapsed = !!this.settings.drawbarCollapsed;
    el.classList.toggle('collapsed', collapsed);
    const logo = h('button.tb-logo', {
      type: 'button', 'aria-expanded': String(!collapsed), 'aria-controls': 'draw-tools',
      title: collapsed ? 'Çizim araçlarını aç' : 'Çizim araçlarını kapat',
      onclick: () => {
        const now = !el.classList.contains('collapsed');
        el.classList.toggle('collapsed', now);
        logo.setAttribute('aria-expanded', String(!now));
        logo.title = now ? 'Çizim araçlarını aç' : 'Çizim araçlarını kapat';
        this.settings.drawbarCollapsed = now; this.saveSettings();
        if (now) this.closeToolFlyout();
      },
    }, brandMark(20));
    el.replaceChildren(logo, h('div.tb-tools', { id: 'draw-tools' }, h('div.tb-inner', {}, tools)));
    this.renderFavBar();
  }

  /** The rest of a tool group, in a small menu beside its button. */
  toolFlyout(anchor, group) {
    this.closeToolFlyout();
    const r = anchor.getBoundingClientRect();
    const favs = this.settings.drawFavs || [];
    const menu = h('div.tool-flyout.glass-pop', { role: 'menu' }, group.map((t) => h(`button.item${this.drawings.tool === t ? '.on' : ''}`, {
      type: 'button', role: 'menuitem',
      onclick: (e) => {
        if (e.target.closest('.fav-star')) {
          // the star: in or out of the favourites, the menu stays
          this.toggleFav(t);
          e.target.closest('.fav-star').replaceWith(this._star(t));
          return;
        }
        this.settings.toolPicks = { ...(this.settings.toolPicks || {}), [group[0]]: t }; this.saveSettings();
        this.closeToolFlyout();
        this.drawings.setTool(t);
      },
    }, toolIcon(t, 17), h('span', {}, TOOL_NAMES[t]), toolKey(t) ? h('kbd', {}, toolKey(t)) : null, t === 'cursor' ? null : this._star(t, favs))));
    document.body.append(menu);
    const top = Math.max(8, Math.min(r.top - 6, innerHeight - menu.offsetHeight - 8));
    menu.style.left = `${Math.min(r.right + 10, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${top}px`;
    const away = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) this.closeToolFlyout(); };
    const esc = (e) => { if (e.key === 'Escape') this.closeToolFlyout(); };
    setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true); });
    this._flyout = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }

  closeToolFlyout() { this._flyout?.(); this._flyout = null; }

  // ── drawing favourites ─────────────────────────────────────────────────
  _star(t, favs = this.settings.drawFavs || []) {
    const on = favs.includes(t);
    return h(`span.fav-star${on ? '.on' : ''}`, { role: 'button', title: on ? 'Favorilerden çıkar' : 'Favorilere ekle', 'aria-label': on ? 'Favorilerden çıkar' : 'Favorilere ekle' }, icon(on ? 'starfill' : 'star', 15));
  }

  toggleFav(t) {
    const favs = [...(this.settings.drawFavs || [])];
    const i = favs.indexOf(t);
    if (i >= 0) favs.splice(i, 1); else favs.push(t);
    this.settings.drawFavs = favs;
    this.saveSettings();
    this.renderFavBar();
    toast(i >= 0 ? `${TOOL_NAMES[t]} favorilerden çıktı` : `${TOOL_NAMES[t]} favorilere eklendi`, 'ok', 1800);
  }

  /** The favourites as a small bar over the chart (FX Replay's), to be
   *  dragged by its grip; with no favourites there is no bar. */
  renderFavBar() {
    let bar = this._favBar;
    const favs = (this.settings.drawFavs || []).filter((t) => TOOL_NAMES[t]);
    if (!bar) {
      bar = this._favBar = h('div.fav-bar', { role: 'toolbar', 'aria-label': 'Favori çizim araçları' });
      $('#chart-area').append(bar);
    }
    bar.hidden = !favs.length || this.drawings.hideAll;
    if (bar.hidden) return;
    const grip = h('span.fav-grip', { title: 'Taşı', 'aria-hidden': 'true' }, icon('grip', 14));
    bar.replaceChildren(grip, ...favs.map((t) => {
      const b = h(`button.fav-tool${this.drawings.tool === t ? '.on' : ''}`, {
        type: 'button', title: `${TOOL_NAMES[t]}${toolKey(t) ? ` (${toolKey(t)})` : ''} · sağ tık: favoriden çıkar`,
        onclick: () => this.drawings.setTool(this.drawings.tool === t ? 'cursor' : t),
        oncontextmenu: (e) => { e.preventDefault(); this.toggleFav(t); },
      }, toolIcon(t, 17));
      // touch: hold to take it out of the favourites
      let timer = null;
      b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') timer = setTimeout(() => { timer = null; b.dataset.held = '1'; this.toggleFav(t); }, 550); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
      b.addEventListener('click', (e) => { if (b.dataset.held) { delete b.dataset.held; e.stopImmediatePropagation(); } }, true);
      return b;
    }));
    const area = $('#chart-area');
    const place = (x, y) => {
      const maxX = area.clientWidth - bar.offsetWidth - 6, maxY = area.clientHeight - bar.offsetHeight - 6;
      x = Math.max(6, Math.min(maxX, x)); y = Math.max(6, Math.min(maxY, y));
      bar.style.left = `${x}px`; bar.style.top = `${y}px`;
      return { x, y };
    };
    // the first place is the chart's top right, clear of the legend and the price axis
    const pos = this.settings.favBar || { x: area.clientWidth - bar.offsetWidth - 86, y: 12 };
    requestAnimationFrame(() => place(pos.x, pos.y));
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const r = bar.getBoundingClientRect(), a = area.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      bar.classList.add('dragging');
      const move = (ev) => place(ev.clientX - a.left - dx, ev.clientY - a.top - dy);
      const up = (ev) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        bar.classList.remove('dragging');
        this.settings.favBar = place(ev.clientX - a.left - dx, ev.clientY - a.top - dy);
        this.saveSettings();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  /** Phones: the drawing tools as a sheet from the bottom (Alltra's), by
   *  kind; a tool held down goes into (or out of) the favourites. */
  drawSheet(anchor = null) {
    const KINDS = [
      ['fav', 'Favoriler', null],
      ['lines', 'Çizgiler', ['trend', 'ray', 'arrow', 'hline', 'hray', 'vline', 'channel']],
      ['shapes', 'Şekiller', ['rect', 'ellipse', 'triangle', 'pen', 'text']],
      ['fib', 'Fibonacci', ['fib']],
      ['pos', 'Pozisyon', ['long', 'short', 'measure']],
    ];
    let kind = (this.settings.drawFavs || []).length ? 'fav' : 'lines';
    const close = () => { back.classList.remove('open'); setTimeout(() => back.remove(), 220); };
    const tools = h('div.ds-grid');
    const chips = h('div.ds-chips');
    const foot = h('div.ds-foot');
    const paint = () => {
      const favs = this.settings.drawFavs || [];
      chips.replaceChildren(...KINDS.map(([id, label]) => h(`button.ds-chip${kind === id ? '.on' : ''}`, { type: 'button', onclick: () => { kind = id; paint(); } }, label)));
      const list = kind === 'fav' ? favs : KINDS.find((k) => k[0] === kind)[2];
      if (!list.length) {
        tools.replaceChildren(h('div.ds-empty', {}, h('b', {}, 'Henüz favori yok'), h('span', {}, 'Bir aracı basılı tutarak buraya ekle.')));
      } else {
        tools.replaceChildren(...list.map((t) => {
          const b = h(`button.ds-tool${this.drawings.tool === t ? '.on' : ''}`, { type: 'button' }, toolIcon(t, 22), h('span', {}, TOOL_NAMES[t]), favs.includes(t) ? h('i.ds-fav', {}, icon('starfill', 11)) : null);
          let timer = null, held = false;
          b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; this.toggleFav(t); paint(); }, 500); });
          for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
          b.addEventListener('click', () => { if (held) return; this.drawings.setTool(t); close(); });
          b.addEventListener('contextmenu', (e) => e.preventDefault());
          return b;
        }));
      }
      foot.replaceChildren(
        h(`button.ds-cursor${this.drawings.tool === 'cursor' ? '.on' : ''}`, { type: 'button', onclick: () => { this.drawings.setTool('cursor'); close(); } }, icon('cursor', 18), 'İmleç'),
        h(`button.ds-magnet${this.drawings.magnet ? '.on' : ''}`, { type: 'button', onclick: () => { this.drawings.magnet = !this.drawings.magnet; this.settings.magnet = this.drawings.magnet; this.saveSettings(); paint(); } }, icon('magnet', 18), this.drawings.magnet ? 'Mıknatıs açık' : 'Mıknatıs kapalı'),
        h(`button${this.drawings.hideAll ? '.on' : ''}`, { type: 'button', onclick: () => { this.drawings.hideAll = !this.drawings.hideAll; this.drawings.select(null); this.drawings.redraw(); this.renderFavBar(); paint(); } }, icon('eye', 18), this.drawings.hideAll ? 'Çizimler gizli' : 'Çizimleri gizle'),
        h('button.ds-danger', { type: 'button', disabled: !this.drawings.drawings.length, onclick: async () => { close(); if (await confirmBox('Çizimleri sil', 'Bu grafikteki tüm çizimler silinsin mi?', 'Sil', 'danger')) this.drawings.clear(); } }, icon('trash', 18), 'Tümünü sil'));
    };
    const sheet = h('div.ds-sheet', { role: 'dialog', 'aria-label': 'Çizim araçları' },
      h('span.ds-grab'),
      h('div.ds-head', {}, h('button.ds-round', { type: 'button', 'aria-label': 'Kapat', onclick: close }, icon('close', 18)), h('h3', {}, 'Çizim araçları'),
        h(`button.ds-round${this.drawings.keepDrawing ? '.on' : ''}`, { type: 'button', title: 'Sürekli çizim: araç çizimden sonra elde kalır', onclick: (e) => { this.drawings.keepDrawing = !this.drawings.keepDrawing; this.settings.keepDrawing = this.drawings.keepDrawing; this.saveSettings(); e.currentTarget.classList.toggle('on', this.drawings.keepDrawing); } }, icon('lock', 17))),
      chips, tools, foot);
    const back = h('div.ds-back', { onclick: (e) => { if (e.target === back) close(); } }, sheet);
    // wide screens: a panel under the button that opened it, not a sheet from the foot
    if (anchor && window.innerWidth > 760) {
      const r = anchor.getBoundingClientRect();
      back.classList.add('ds-pop');
      sheet.style.top = `${Math.round(r.bottom + 10)}px`;
      sheet.style.left = `${Math.round(Math.max(12, Math.min(window.innerWidth - 452, r.left + r.width / 2 - 220)))}px`;
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    paint();
    requestAnimationFrame(() => back.classList.add('open'));
  }

  renderLegend(param) {
    const el = $('#legend');
    if (!this.ds) { el.replaceChildren(); return; }
    const bars = this.chart.bars;
    let bar = null;
    if (param && param.time != null) bar = param.seriesData?.get(this.chart.candles) || null;
    if (!bar) bar = bars[bars.length - 1];
    const dec = this.ds.decimals;
    const values = this.chart.indicatorValues(param);
    // the crosshair moves many times within one bar: redraw only when what it shows changes
    const sig = JSON.stringify([this.ds.id, this.tfId, this.mode, this._liveError, bar && [bar.time, bar.open, bar.high, bar.low, bar.close], values.map(({ ind, vals }) => [ind.id, ind.params, ind.colors, vals])]);
    if (sig === this._legendSig && el.firstChild) return;
    this._legendSig = sig;
    const row = [h('span.sym', {}, this.ds.symbol), h('span.tag', {}, `${this.tfId} · ${this.ds.source}`)];
    if (this.mode === 'replay') row.push(h('span.badge.replay', {}, 'REPLAY'));
    if (this.mode === 'live') row.push(h(`span.badge.live${this._liveError ? '.error' : ''}`, {}, this._liveError ? 'BAĞLANTI YOK' : 'CANLI'));
    if (bar && bar.open != null) {
      const ch = bar.close - bar.open;
      const c = ch >= 0 ? 'up' : 'down';
      row.push(
        h('span', {}, 'A ', h(`span.${c}`, {}, F.price(bar.open, dec))),
        h('span', {}, 'Y ', h(`span.${c}`, {}, F.price(bar.high, dec))),
        h('span', {}, 'D ', h(`span.${c}`, {}, F.price(bar.low, dec))),
        h('span', {}, 'K ', h(`span.${c}`, {}, F.price(bar.close, dec))),
        h(`span.${c}`, {}, `${ch >= 0 ? '+' : ''}${F.price(ch, dec)} (${F.pct(ch / bar.open, 2)})`));
    }
    const inds = values.map(({ ind, vals }) => {
      const def = INDICATORS[ind.type];
      return h('div.ind', {},
        h('button', { style: { color: 'var(--text)' }, title: 'Ayarlar', onclick: () => D.indicatorParamsDialog(this, ind) }, def.label(ind.params)),
        h('span.mono', { style: { color: ind.colors[0] } }, vals.filter((v) => v != null).map((v) => v.toFixed(def.overlay ? dec : 2)).join(' ')),
        h('button', { title: 'Kaldır', 'aria-label': 'İndikatörü kaldır', onclick: () => this.removeIndicator(ind.id) }, icon('close', 12)));
    });
    el.replaceChildren(h('div.row', {}, row), ...inds);
  }

  renderTabs() {
    const legs = this._allLegs();
    const counts = {
      positions: legs.reduce((n, l) => n + l.broker.positions.length, 0),
      orders: legs.reduce((n, l) => n + l.broker.orders.filter((o) => o.type !== 'next').length, 0),
      history: legs.reduce((n, l) => n + l.broker.trades.length, 0),
    };
    $('#tabs').replaceChildren(...TABS.map(([id, label]) => h(`button.tab${this.bottomTab === id ? '.on' : ''}`, {
      onclick: () => {
        if (this.bottomTab === id) { this.settings.bottomCollapsed = !this.settings.bottomCollapsed; this.applyBottomSize(); }
        else { this.settings.bottomTab = id; this.settings.bottomCollapsed = false; this.applyBottomSize(); this.renderTabs(); this.renderTab(); }
        this.saveSettings();
      },
    }, label, counts[id] ? h('span.count', {}, counts[id]) : null,
    id === 'data' && this.dataView?.busy ? h('span.pip', { title: 'İndirme sürüyor' }) : null)));
  }

  renderTab() {
    const body = $('#tab-body');
    const tab = this.bottomTab;
    body.dataset.panel = tab;
    if (tab !== 'stats') this.statsView.destroy();
    if (tab === 'positions') { const el = h('div'); renderPositions(el, this); body.replaceChildren(el); }
    else if (tab === 'orders') { const el = h('div'); renderOrders(el, this); body.replaceChildren(el); }
    else if (tab === 'history') {
      const el = h('div');
      if (this.mode === 'replay') renderHistory(el, this); else el.append(h('div.empty', {}, 'Replay oturumu yok. Strateji testi işlemleri “Strateji testi” sekmesinde.'));
      body.replaceChildren(el);
    } else if (tab === 'stats') {
      const el = h('div.pane');
      body.replaceChildren(el);
      this.statsView.el = el;
      if (this.mode !== 'replay') { el.append(h('div.empty', {}, 'İstatistikler replay oturumundaki işlemlerden hesaplanır.')); return; }
      const b = this.broker, legs = this._allLegs();
      const stats = computeStats(this._allTrades(), { initial: legs[0].broker.cfg.balance, tz: this.settings.tz });
      // every market's broker follows the one shared equity: the deepest fall any saw
      const dd = legs.reduce((m, l) => (l.broker.maxDrawdown > m.maxDrawdown ? l.broker : m), b);
      this.statsView.render({ stats, ccy: b.cfg.currency, initial: legs[0].broker.cfg.balance, theme: this.theme,
        extra: [h('div.kpi', {}, h('div.label', {}, 'Maks. düşüş (varlık)'), h('div.value.down', {}, `${F.money(dd.maxDrawdown, b.cfg.currency)} · ${F.pct(dd.maxDrawdownPct, 1)}`))] });
    } else if (tab === 'strategy') {
      if (body.firstChild !== this.strategyView.el) body.replaceChildren(this.strategyView.el);
      this.strategyView.render();
    } else if (tab === 'data') {
      if (body.firstChild !== this.dataView.el) body.replaceChildren(this.dataView.el);
      this.dataView.render();
    }
  }

  applyBottomSize() {
    const el = $('#bottom');
    el.classList.toggle('collapsed', this.settings.bottomCollapsed);
    const want = this.bottomTab === 'data' || this.bottomTab === 'strategy' ? Math.max(this.settings.bottomHeight, 430) : this.settings.bottomHeight;
    // phones: the bar keeps its place and an open tab rises over the chart
    // as a half-page sheet (sized in CSS), so the chart is never squeezed
    if (window.matchMedia('(max-width: 760px)').matches) {
      el.style.height = this.settings.bottomCollapsed ? '42px' : '';
      document.documentElement.style.setProperty('--bottom-h', '42px');
      return;
    }
    const hgt = this.settings.bottomCollapsed ? 42 : Math.min(want, Math.round(window.innerHeight * 0.62));
    el.style.height = `${hgt}px`;
    document.documentElement.style.setProperty('--bottom-h', `${hgt}px`);
  }

  /** Repaint with an appearance (the settings dialog previews through here). */
  previewAppearance(a) {
    const paint = applyAppearance(a);
    this.chart.setAccent(paint.appearance.accent);
    this.chart.applyLook(paint.look, paint.theme);
    for (const p of this.sidePanes.values()) p.applyLook();
    this.statsView?.chart && this.bottomTab === 'stats' && this.renderTab();
  }

  applySettings() {
    this.previewAppearance(this.settings.appearance);
    this.chart.setFormat({ tz: this.settings.tz });
    this.chart.volume.applyOptions({ visible: this.settings.volume });
    if (this.mode === 'replay' && this.broker) {
      const a = this.settings.account;
      this.broker.cfg.spread = a.spreadPips * this.ds.pip_size;
      this.broker.cfg.commission = a.commission;
      this.broker.cfg.sameBar = a.sameBar;
      this.markDirty();
    }
    this.renderClock();
    this.ticket.render();
    this.renderTab();
    this.renderLegend(null);
  }

  // ── wiring ─────────────────────────────────────────────────────────────
  _wireTopbar() {
    $('#instrument-btn').addEventListener('click', () => this.openInstrumentPicker());
    $('#btn-profile').addEventListener('click', () => this.openProfileMenu());
    $('#tf-select').addEventListener('change', (e) => this.setTf(e.target.value));
    $('#btn-draw').addEventListener('click', (e) => this.drawSheet(e.currentTarget));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.mode === 'live') this._livePoll(); });
    $('#btn-search').addEventListener('click', () => openPalette(() => this._paletteItems()));
    $('#btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
    if (!document.fullscreenEnabled) $('#btn-fullscreen').classList.add('hidden');
    document.addEventListener('fullscreenchange', () => {
      const on = !!document.fullscreenElement;
      $('#btn-fullscreen').replaceChildren(icon(on ? 'shrink' : 'expand', 18));
      $('#btn-fullscreen').removeAttribute('title');
      $('#btn-fullscreen').dataset.tip = on ? 'Tam ekrandan çık (Shift+F)' : 'Tam ekran (Shift+F)';
    });
    $('#btn-indicators').addEventListener('click', () => D.indicatorsDialog(this));
    $('#btn-layout').addEventListener('click', (e) => this.layoutMenu(e.currentTarget));
    $('#btn-shot').addEventListener('click', () => this.screenshot());
    $('#btn-sessions').addEventListener('click', () => this.sessionsDialog());
    $('#btn-settings').addEventListener('click', () => D.settingsDialog(this));
    $('#btn-panel').addEventListener('click', () => this.togglePanel());
    window.addEventListener('resize', () => { this.closePopover(); this.applyBottomSize(); });
    this.chart.volume.applyOptions({ visible: this.settings.volume });
  }

  _wireBottomResize() {
    const handle = $('#bottom-resizer');
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY, startH = this.settings.bottomCollapsed ? 42 : $('#bottom').offsetHeight;
      const move = (ev) => {
        const hgt = Math.max(42, Math.min(window.innerHeight - 200, startH + startY - ev.clientY));
        this.settings.bottomCollapsed = hgt < 60;
        if (!this.settings.bottomCollapsed) this.settings.bottomHeight = hgt;
        this.applyBottomSize();
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); this.saveSettings(); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  _wireContextMenu() {
    const menu = $('#context-menu');
    const hide = () => menu.classList.add('hidden');
    document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) hide(); });
    $('#chart').addEventListener('contextmenu', (e) => {
      if (!this.ds) return;
      e.preventDefault();
      const r = $('#chart').getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const price = this.chart.priceAt(y);
      const bar = this.chart.barAt(x);
      if (price == null) return;
      const dec = this.ds.decimals;
      const px = F.price(price, dec);
      const item = (label, fn, hint = '') => h('button', { onclick: () => { hide(); fn(); } }, h('span', {}, label), h('span.muted', {}, hint));
      const items = [];
      if (this.mode === 'replay') {
        const b = this.broker;
        const buyType = price < b.ask() ? 'Limit' : 'Stop';
        const sellType = price > b.bid() ? 'Limit' : 'Stop';
        if (bar && bar.time + this.tf.seconds - 1 < this.engine.cursor) {
          items.push(item('Buraya geri sar', () => this.rewindToBar(bar), F.dateTime(bar.time, this.chart._zone())), h('hr'));
        }
        items.push(
          item(`Alış ${buyType} @ ${px}`, () => this.orderAtPrice('buy', price), 'ticket ayarlarıyla'),
          item(`Satış ${sellType} @ ${px}`, () => this.orderAtPrice('sell', price), 'ticket ayarlarıyla'),
          h('hr'));
      } else if (bar && this.mode === 'browse') {
        items.push(item('Replay’i bu bardan başlat', () => this.newSessionDialog({ start: bar.time }), F.dateTime(bar.time, this.chart._zone())), h('hr'));
      }
      items.push(
        item(`Yatay çizgi @ ${px}`, () => {
          this.drawings.drawings.push({ id: `d${Date.now().toString(36)}`, type: 'hline', color: '#f5a623', width: 1.5, points: [{ time: bar ? bar.time : this.chart.bars[0].time, price }] });
          this.drawings.redraw();
          this.saveDrawings();
        }),
        item('Grafiği sona kaydır', () => this.chart.scrollToEnd()));
      menu.replaceChildren(...items);
      menu.classList.remove('hidden');
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - 240)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8)}px`;
    });
  }

  /** Everything the command palette can open or do. */
  _paletteItems() {
    const out = [];
    const add = (group, label, run, extra = {}) => out.push({ group, label, run, ...extra });
    for (const d of this.datasets.filter((x) => x.bar_count)) {
      add('Semboller', d.symbol, () => this.selectDataset(d.id), { sub: `${PACK_NAMES[d.symbol] || d.name}${d.id === this.ds?.id ? ' · açık' : ''}`, icon: 'chart', keys: d.name });
    }
    for (const tf of this.ds?.timeframes || []) add('Zaman dilimi', tf, () => this.setTf(tf), { sub: tf === this.tfId ? 'şu an' : '', icon: 'clock' });
    const cmd = (label, run, ic, extra) => add('Komutlar', label, run, { icon: ic, ...extra });
    if (this.mode === 'replay') {
      cmd('Oynat / duraklat', () => this.togglePlay(), 'play', { kbd: 'Space' });
      cmd('Bir bar ilerle', () => this.step(), 'step', { kbd: '→' });
      cmd('Replay’den çık', () => this.switchMode('browse'), 'close');
    } else cmd('Replay başlat', () => this.newSessionDialog(), 'replay', { keys: 'yeni oturum' });
    cmd('Replay oturumları', () => this.sessionsDialog(), 'sessions');
    cmd('Strateji testi', () => this.openTab('strategy'), 'flask', { keys: 'backtest' });
    cmd('Veri paketleri', () => this.openTab('data'), 'data', { keys: 'indir 15 yıl' });
    cmd('İstatistik', () => this.openTab('stats'), 'chart');
    cmd('İndikatör ekle', () => D.indicatorsDialog(this), 'indicator');
    cmd('Canlı grafik', () => D.liveDialog(this), 'live', { keys: 'oanda binance' });
    cmd('Otomatik ölçek', () => this.chart.autoScale(), 'refresh', { keys: 'fiyat ekseni A' });
    cmd('Son bara git', () => this.chart.scrollToEnd(), 'ffwd');
    cmd('Görünüm', () => this.lookSheet(), 'palette', { keys: 'tema renk font yazı' });
    cmd('Ayarlar', () => D.settingsDialog(this), 'sliders', { keys: 'saat dilimi hesap api' });
    cmd('Ana ekran', () => { window.location.href = 'home.html'; }, 'home');
    cmd('Klavye kısayolları', () => this.shortcutsDialog(), 'sliders', { kbd: '?' });
    if (document.fullscreenEnabled) cmd(document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekran', () => this.toggleFullscreen(), 'expand', { kbd: 'Shift+F' });
    for (const [group, items] of D.PICKS) {
      for (const it of items) add('İndikatör ekle', it.name, () => this.addIndicator(it.type, it.params), { sub: `${group} · ${it.desc}`, icon: 'plus' });
    }
    const keyOf = Object.fromEntries(Object.entries(TOOL_KEYS).map(([k, t]) => [t, k.toUpperCase()]));
    for (const t of TOOLS) add('Çizim', TOOL_NAMES[t], () => this.drawings.setTool(t), { icon: TOOL_ICON[t] || t, kbd: keyOf[t] ? `Alt+${['rect', 'long'].includes(t) ? 'Shift+' : ''}${keyOf[t]}` : null });
    for (const p of PRESETS) {
      add('Tema', p.name, () => {
        Object.assign(this.settings.appearance, { preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down, font: p.font });
        this.saveSettings();
        this.applySettings();
      }, { sub: 'hazır görünüm', icon: 'palette', keys: 'tema' });
    }
    for (const [id, f] of Object.entries(FONT_PAIRS)) {
      add('Yazı tipi', f.name, () => { this.settings.appearance.font = id; this.settings.appearance.preset = null; this.saveSettings(); this.applySettings(); }, { sub: f.note, icon: 'text', keys: 'font' });
    }
    return out;
  }

  toggleFullscreen() {
    if (!document.fullscreenEnabled) { toast('Bu tarayıcı tam ekranı desteklemiyor', 'warn'); return; }
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch((err) => toast(`Tam ekran açılamadı: ${err.message}`, 'err'));
  }

  shortcutsDialog() {
    const rows = [
      ['Arama: sembol, zaman dilimi, komut', 'Ctrl+K', '/ ya da yazmaya başla'],
      ['Replay: oynat / duraklat', 'Space'], ['Replay: bir adım', '→'], ['Replay: bir grafik barı', 'Shift+→'],
      ['Replay: bir adım geri (işlemler de)', '←'], ['Replay: bir grafik barı geri', 'Shift+←'],
      ['Replay: hızlı al / sat', 'Shift+B', 'Shift+S'], ['Tam ekran', 'Shift+F'],
      ['Trend çizgisi', 'Alt+T'], ['Yatay çizgi', 'Alt+H'], ['Yatay ışın', 'Alt+J'], ['Dikey çizgi', 'Alt+V'], ['Dikdörtgen', 'Alt+Shift+R'],
      ['Fibonacci', 'Alt+F'], ['Long / short pozisyon', 'Alt+Shift+L', 'Alt+S'], ['Ölçüm', 'Alt+M'], ['Metin', 'Alt+X'],
      ['Çizimi kopyala / yapıştır', 'Ctrl+C', 'Ctrl+V'], ['Seçili çizimi taşı', '← ↑ → ↓'], ['Çizimi geri al / yinele', 'Ctrl+Z', 'Ctrl+Y'], ['Çizimleri gizle / göster', 'Ctrl+Alt+H'], ['Grafiği sıfırla', 'Alt+R'], ['Replay tarihine git', 'Alt+G'], ['Ölçeği ters çevir', 'Alt+I'], ['Logaritmik / yüzde ölçeği', 'Alt+L', 'Alt+P'], ['Yakınlaştır / uzaklaştır', 'Ctrl+↑', 'Ctrl+↓'], ['Seçili çizimi sil', 'Delete'], ['Vazgeç / kapat', 'Esc'],
      ['Grafik: yakınlaştır', 'Tekerlek'], ['Fiyat eksenini esnet', 'Eksende sürükle'], ['Otomatik ölçek', 'Eksene çift tık'],
    ];
    const key = (k) => h('span.keys', {}, k.split('+').map((p) => h('kbd', {}, p)));
    modal({ title: 'Klavye kısayolları', body: h('div.shortcuts', {}, rows.map(([label, ...keys]) => h('div.sc-row', {}, h('span', {}, label), h('span.sc-keys', {}, keys.map((k, i) => [i ? h('span.muted', {}, 'ya da') : null, /^[A-Za-z/]|Space|Ctrl|Shift|Alt|Delete|Esc|[→]/.test(k) && !/ /.test(k) ? key(k) : h('span.muted', {}, k)]).flat().filter(Boolean))))) });
  }

  _wireKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.defaultPrevented || e.target.isContentEditable || ['input', 'textarea', 'select'].includes(tag) || document.querySelector('.modal-back')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.code === 'KeyC' && this.drawings.selected) { e.preventDefault(); this._drawingClipboard = JSON.parse(JSON.stringify(this.drawings.selected)); return; }
      if (mod && !e.altKey && e.code === 'KeyV' && this._drawingClipboard) {
        e.preventDefault(); this.drawings.cancel(); const d = JSON.parse(JSON.stringify(this._drawingClipboard)); d.id = this.drawings._newId();
        d.points = d.points.map(p => this.drawings._shift(p, 2, 0)); this.drawings.drawings.push(d);
        this.drawings.select(d.id); this.drawings._changed(); return;
      }
      if (!e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.drawings.selected && !mod) {
        const d = this.drawings.selected; e.preventDefault(); if (d.locked) return;
        const dl = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
        const dp = dl ? 0 : (this.chart.priceAt(100) - this.chart.priceAt(101)) * (e.code === 'ArrowUp' ? 1 : -1);
        const patch = { points: d.points.map(p => this.drawings._shift(p, dl, dp)) };
        if (d.stop != null) patch.stop = d.stop + dp; if (d.target != null) patch.target = d.target + dp;
        this.drawings.update(d.id, patch); return;
      }
      if (!e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.code) && (mod || this.mode !== 'replay')) {
        e.preventDefault(); const ts = this.chart.chart.timeScale(), r = ts.getVisibleLogicalRange();
        if (r) { const delta = (e.code === 'ArrowLeft' ? -1 : 1) * (mod ? (r.to - r.from) * .2 : 1); ts.setVisibleLogicalRange({ from: r.from + delta, to: r.to + delta }); } return;
      }
      if (mod && !e.altKey && ['KeyZ', 'KeyY'].includes(e.code)) { e.preventDefault(); this.drawings.historyStep(e.code === 'KeyY' || e.shiftKey ? 1 : -1); return; }
      if (mod && e.altKey && e.code === 'KeyH') { e.preventDefault(); this.drawings.hideAll = !this.drawings.hideAll; this.drawings.select(null); this.drawings.redraw(); this.renderToolbar(); return; }
      if (e.altKey && !mod && e.code === 'KeyG') { e.preventDefault(); if (this.mode === 'replay') D.jumpDialog(this); return; }
      if (e.altKey && !mod && e.code === 'KeyR') { e.preventDefault(); if (e.shiftKey) this.drawings.setTool('rect'); else { this.chart.chart.timeScale().resetTimeScale(); this.chart.autoScale(); } return; }
      if (e.altKey && !mod && e.code === 'KeyI') { e.preventDefault(); const ps = this.chart.chart.priceScale('right'); ps.applyOptions({ invertScale: !ps.options().invertScale }); return; }
      if (e.altKey && !mod && ['KeyL', 'KeyP'].includes(e.code)) { e.preventDefault(); if (e.shiftKey && e.code === 'KeyL') { this.drawings.setTool('long'); return; } const ps = this.chart.chart.priceScale('right'), mode = e.code === 'KeyL' ? 1 : 2; ps.applyOptions({ mode: ps.options().mode === mode ? 0 : mode }); return; }
      if ((mod && ['ArrowUp', 'ArrowDown'].includes(e.code)) || (e.altKey && !mod && ['Equal', 'Minus'].includes(e.code))) {
        e.preventDefault(); const ts = this.chart.chart.timeScale(), r = ts.getVisibleLogicalRange();
        if (r) { const mid = (r.from + r.to) / 2, half = (r.to - r.from) * (['Equal', 'ArrowUp'].includes(e.code) ? .4 : .625); ts.setVisibleLogicalRange({ from: mid - half, to: mid + half }); } return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.shortcutsDialog(); return; }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyF') { e.preventDefault(); this.toggleFullscreen(); return; }
      if (e.key === 'Escape' && this.draft) { this.cancelDraft(); return; }
      if (e.key === 'Enter' && this.draft && !e.target.closest?.('input, textarea, select, button')) { e.preventDefault(); this.confirmDraft(); return; }
      if (e.key === 'Escape') { this.cancelPick(); this.drawings.cancel(); this.drawings.select(null); $('#context-menu').classList.add('hidden'); this.closePopover(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.drawings.selected) { e.preventDefault(); this.drawings.remove(this.drawings.selected.id); return; }
      const letter = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : '';
      if (e.altKey && e.shiftKey && letter === 's') { e.preventDefault(); this.screenshot(); return; }
      if (e.altKey && TOOL_KEYS[letter]) { e.preventDefault(); this.drawings.setTool(TOOL_KEYS[letter]); return; }
      if (this.mode !== 'replay') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(e.shiftKey ? 'bar' : null); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.stepBack(e.shiftKey ? 'bar' : null); }
      else if (e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); this.quickOrder('buy'); }
      else if (e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.quickOrder('sell'); }
    });
  }
}

const app = new App();
window.app = app;
app.init().catch((err) => {
  console.error(err);
  revealPage();
  toast(`Başlatılamadı: ${err.message}`, 'err', 10000);
});
