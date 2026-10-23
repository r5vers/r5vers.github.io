// Replay Terminal - application controller.
import { api } from './api.js';
import { columnsToBars } from './core/aggregate.js';
import { Broker } from './core/broker.js';
import { computeStats } from './core/stats.js';
import { bucket, parseTf } from './core/timeframes.js';
import { TradingChart } from './chart/chart.js';
import { DrawingManager, TOOL_NAMES, FIB_LEVELS, FILLED, POSITION_COLORS, drawingStylePatch } from './chart/drawings.js';
import { configureICT } from './chart/sessions.js';
import { INDICATORS } from './chart/indicators.js';
import { TradeLines } from './chart/tradelines.js';
import * as F from './format.js';
import { ReplayEngine } from './replay.js';
import * as D from './ui/dialogs.js';
import { DataView } from './ui/dataview.js';
import { $, $$, avatar, brandMark, confirmBox, flushStorage, h, icon, modal, storage, store, toast, useProfileStorage, wirePointerLight } from './ui/dom.js';
import { DEFAULT_APPEARANCE, FONT_PAIRS, PRESETS, applyAppearance, normalizeAppearance, paintLastLook, revealPage } from './ui/look.js';
import { openPalette, wirePalette } from './ui/palette.js';
import { wireTooltips } from './ui/tooltip.js';
import { labelTables, renderHistory, renderOrders, renderPositions } from './ui/panels.js';
import { scrubWheel } from './ui/scrubwheel.js';
import { StatsView } from './ui/statsview.js';
import { StrategyView } from './ui/strategyview.js';
import { Ticket } from './ui/ticket.js';

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
  stepUnit: 'base',
  pauseOnFill: true,
  account: { balance: 10000, spreadPips: 0.8, commission: 0, sameBar: 'path' },
  ticket: { lots: 1, sizeMode: 'risk', riskPct: 1, slOn: true, slPips: 15, tpOn: true, tpPips: 30 },
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
const MODES = [['browse', 'Grafik', 'chart'], ['replay', 'Replay', 'replay'], ['live', 'Canlı', 'live']];
const PACK_NAMES = { EURUSD: 'Euro / Dolar', NAS100: 'NASDAQ 100', XAUUSD: 'Altın / Dolar', GBPUSD: 'Sterlin / Dolar', USDCAD: 'Dolar / Kanada doları', SPX500: 'S&P 500' };
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
    this.session = null;
    this.playing = false;
    this.dirty = false;
    this.backtest = null;
    this.plotSeries = [];
    this._tabTimer = null;
    this._picking = null;
    this._lastParam = null;
    this._loadToken = 0;
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
    try { localStorage.setItem('rt-last-look', JSON.stringify(this.settings.appearance)); } catch { /* private mode */ }
  }

  _deviceKey() { return `rt-device:p${this.profile?.id ?? 0}`; }

  // ── boot ────────────────────────────────────────────────────────────────
  async init() {
    paintLastLook();
    // who is trading: everything browser-side is kept per profile
    const me = await api.me();
    if (!me.profile) { window.location.replace('/profiles.html'); return; }
    this.profile = me.profile;
    this.auth = me.auth;
    await useProfileStorage(me.profile.id, me.first);
    const saved = storage('rt:settings', null);
    let device = null;
    try { device = JSON.parse(localStorage.getItem(this._deviceKey()) || 'null'); } catch { device = null; }
    this.settings = merge(DEFAULT_SETTINGS, { ...(saved || {}), ...(device || {}) });
    this.settings.appearance = normalizeAppearance(saved?.appearance);
    if (configureICT(this.settings)) this.saveSettings();
    // first visit on this phone: give the chart the room
    if (!device && window.innerWidth < 760) this.settings.bottomCollapsed = true;
    const paint = applyAppearance(this.settings.appearance);
    revealPage();
    this.chart = new TradingChart($('#chart'), {
      tz: this.settings.tz, theme: paint.theme, look: paint.look,
      // the legend is redrawn at most once per screen frame
      onCrosshair: (p) => {
        this._lastParam = p;
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
      onToolChange: () => this.renderToolbar(),
      format: {
        price: (p) => F.price(p, this.ds ? this.ds.decimals : 5),
        pips: (d) => F.num(Math.abs(d) / (this.ds ? this.ds.pip_size : 0.0001), 1),
        pct: (x) => F.pct(Math.abs(x), 2),
      },
    });
    this.drawings.magnet = this.settings.magnet;
    this.drawings.defaults = (type) => this.settings.drawDefaults?.[type] || null;
    this.tradeLines = new TradeLines(this.chart, {
      getBroker: () => (this.mode === 'replay' ? this.broker : null),
      money: (x) => F.signedMoney(x, this.broker ? this.broker.cfg.currency : 'USD'),
      onModify: (kind, id, field, price) => {
        const p = Number(price.toFixed(this.ds.decimals));
        if (kind === 'pos') this.modifyPosition(id, { [field]: p });
        else this.modifyOrder(id, { [field]: p });
      },
    });
    this.drawings.addInterceptor(this.tradeLines.interceptor());
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

    await Promise.all([this.strategyView.init(), this.dataView.init()]);
    // links from the home screen: /chart.html?ds=..&tf=.., ?session=.., ?backtest=.., ?tab=.., ?new=replay
    const q = new URLSearchParams(location.search);
    if (q.toString()) history.replaceState(null, '', location.pathname);
    if (q.get('tf')) this.settings.tf = q.get('tf');
    await this.loadDatasets(Number(q.get('ds')) || this.settings.datasetId);
    await this._openFromLink(q);

    // a cloud profile changed on another device: a replay open here is left
    // alone (the page reload brings the other device's state)
    window.addEventListener('rv-synced', (e) => {
      const open = this.session?.id && e.detail.changed.some((c) => c.kind === 'session' && c.key === this.session.id);
      toast(open ? 'Bu replay başka cihazda ilerledi: sayfayı yenileyince oradan devam eder' : 'Diğer cihazdaki değişiklikler geldi; yenileyince görünür', open ? 'warn' : 'info', 7000);
    });
    setInterval(() => { if (this.dirty) this.save(); }, 2500);
    window.addEventListener('beforeunload', () => { if (this.dirty) this.save(true); });
  }

  async _openFromLink(q) {
    // any explicit link (not a plain reload) ends the "come back to the replay" state
    if (this.settings.resume && q.toString() && !q.get('session')) { this.settings.resume = null; this.saveSettings(); }
    try {
      if (q.get('session')) { await this.openSession(q.get('session')); return; }
      if (q.get('backtest')) { await this.openBacktest(q.get('backtest')); return; }
      if (TABS.some(([id]) => id === q.get('tab'))) this.openTab(q.get('tab'));
      if (q.get('new') === 'replay') { this.newSessionDialog(); return; }
      if (q.get('mode') === 'live') { this.switchMode('live'); return; }
      // a reload in the middle of a replay comes back to it
      if (!q.toString() && this.settings.resume) await this.openSession(this.settings.resume);
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
    try { this.datasets = await api.datasets(); } catch (err) { toast(`Sunucuya ulaşılamadı: ${err.message}`, 'err', 8000); return; }
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
    // a 15-year pack first, then whatever was used last
    const packs = this.datasets.filter((d) => d.meta?.pack && d.bar_count);
    const id = this.datasets.some((d) => d.id === selectId) ? selectId : (packs[0] || this.datasets[0])?.id;
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

  closePopover() {
    this._popover?.remove();
    this._popover = null;
  }

  popover(anchor, content, { align = 'left' } = {}) {
    this.closePopover();
    const el = h('div.popover.glass-pop', { role: 'menu' }, content);
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = align === 'right' ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${r.bottom + 8}px`;
    this._popover = el;
    setTimeout(() => {
      const off = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) { this.closePopover(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    }, 0);
    return el;
  }

  openInstrumentPicker() {
    if (this._popover) { this.closePopover(); return; }
    const tz = this.settings.tz;
    const row = (d) => h(`button.item${this.ds && d.id === this.ds.id && this.mode !== 'live' ? '.on' : ''}`, {
      onclick: () => { this.closePopover(); this.selectDataset(d.id); },
    },
    h('span', {}, h('span.t', {}, d.symbol), h('span.s', {}, d.meta?.pack ? (PACK_NAMES[d.meta.pack] || d.name) : d.name)),
    h('span.r', {}, `${d.base_tf} · ${d.source}`, h('br'), d.first_ts ? `${F.dateOnly(d.first_ts, tz)} → ${F.dateOnly(d.last_ts, tz)}` : 'boş'));
    const packs = this.datasets.filter((d) => d.meta?.pack);
    const mine = this.datasets.filter((d) => !d.meta?.pack);
    const recent = storage('rt:live:recent', []).slice(0, 4);
    this.popover($('#instrument-btn'), [
      packs.length ? [h('h5', {}, 'Veri paketleri · 15 yıl'), ...packs.map(row)] : null,
      packs.length && mine.length ? h('hr') : null,
      mine.length ? [h('h5', {}, 'Veri setlerim'), ...mine.map(row)] : null,
      recent.length ? [h('hr'), h('h5', {}, 'Canlı'), ...recent.map((r) => h('button.item', { onclick: async () => {
        this.closePopover();
        try { await this.startLive(r); } catch (err) { toast(err.message, 'err', 6000); }
      } }, icon('live', 16), h('span', {}, h('span.t', {}, r.symbol), h('span.s', {}, r.provider === 'oanda' ? 'OANDA canlı' : 'Binance canlı'))))] : null,
      h('div.footer', {},
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
      type: 'button', role: 'tab', 'aria-selected': this.mode === mode ? 'true' : 'false', title: label, onclick: () => this.switchMode(mode),
    }, icon(ic, 16), h('span.lbl', {}, label))));
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
      h('a.item', { href: '/home.html' }, icon('home', 16), h('span', {}, h('span.t.plain', {}, 'Ana ekran'), h('span.s', {}, 'piyasalar, oturumlar, test geçmişi'))),
      h('button.item', { onclick: async () => { this.closePopover(); if (this.dirty) await this.save(); await flushStorage(); await api.leaveProfile(); window.location.replace('/profiles.html'); } }, icon('swap', 16), h('span.t.plain', {}, 'Profil değiştir')),
      // phones have no room for these in the top bar, so they live here
      ...(window.innerWidth <= 760 ? [
        h('button.item', { onclick: () => { this.closePopover(); D.indicatorsDialog(this); } }, icon('indicator', 16), h('span', {}, h('span.t.plain', {}, 'İndikatör ekle'), h('span.s', {}, 'EMA, RSI, kill zone…'))),
        h('button.item', { onclick: () => { this.closePopover(); this.sessionsDialog(); } }, icon('sessions', 16), h('span', {}, h('span.t.plain', {}, 'Replay oturumları'), h('span.s', {}, 'kayıtlı oturumlara dön'))),
        h('button.item', { onclick: () => { this.closePopover(); openPalette(() => this._paletteItems()); } }, icon('search', 16), h('span', {}, h('span.t.plain', {}, 'Ara'), h('span.s', {}, 'sembol, zaman dilimi, komut'))),
      ] : []),
      h('button.item', { onclick: () => { this.closePopover(); D.settingsDialog(this, { section: 'look' }); } }, icon('palette', 16), h('span', {}, h('span.t.plain', {}, 'Görünüm'), h('span.s', {}, 'tema, renkler, cam, yazı tipi'))),
      h('button.item', { onclick: () => { this.closePopover(); D.settingsDialog(this); } }, icon('sliders', 16), h('span', {}, h('span.t.plain', {}, 'Ayarlar'), h('span.s', {}, 'saat dilimi, hesap, API anahtarı'))),
      this.auth ? h('button.item', { onclick: async () => { if (this.dirty) await this.save(); await flushStorage(); await api.logout(); window.location.replace('/login.html'); } }, icon('power', 16), h('span.t.plain', {}, 'Siteden çıkış')) : null,
    ].filter(Boolean), { align: 'right' });
  }

  async selectDataset(id) {
    if (this.mode === 'live') this._stopLive();
    if (this.mode === 'replay') {
      if (!(await confirmBox('Replay açık', 'Veri setini değiştirmek için replay oturumundan çıkılacak (oturum kaydedilir).', 'Çık'))) return;
      await this.exitReplay(true, false);
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
    await this.loadBrowse();
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
  _newBroker() {
    const ds = this.ds, a = this.settings.account;
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

  async startReplay({ start, name }) {
    const engine = new ReplayEngine(this.ds);
    await engine.load(this.tfId, start);
    const broker = this._newBroker();
    if (engine.current) broker.onBar({ t: engine.current.time, o: engine.current.open, h: engine.current.high, l: engine.current.low, c: engine.current.close });
    this.engine = engine;
    this.broker = broker;
    this.session = { id: null, name, startTime: engine.cursor, notes: '' };
    const created = await api.createSession({ name, dataset_id: this.ds.id, state: this._state(), summary: this._summary() });
    this.session.id = created.id;
    this.drawings.load([]);
    this._enterReplay();
    toast(`Replay başladı: ${F.dateTime(engine.cursor, this.settings.tz)}`, 'ok');
  }

  async openSession(id) {
    const s = await api.session(id);
    const st = s.state;
    if (this.mode === 'replay') await this.exitReplay(true, false);
    if (!this.ds || this.ds.id !== s.dataset_id) {
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
    const engine = new ReplayEngine(this.ds);
    await engine.load(this.tfId, st.cursor);
    this.engine = engine;
    this.broker = Broker.fromJSON(st.broker);
    this.session = { id: s.id, name: s.name, startTime: st.startTime, notes: st.notes || '' };
    this.drawings.load(st.drawings || []);
    this._enterReplay();
    toast(`“${s.name}” açıldı`, 'ok');
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
    this.renderInstrument();
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
    if (save && this.session) await this.save();
    this.settings.resume = null;
    this.saveSettings();
    this.mode = 'browse';
    this.engine = null;
    this.broker = null;
    this.session = null;
    this.dirty = false;
    this.tradeLines.clear();
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
    return {
      version: 1, datasetId: this.ds.id, tf: this.tfId, cursor: this.engine.cursor, startTime: this.session.startTime,
      broker: this.broker.toJSON(), drawings: this.drawings.serialize(), notes: this.session.notes || '',
    };
  }

  _summary() {
    const b = this.broker;
    const st = computeStats(b.trades, { initial: b.cfg.balance, tz: this.settings.tz });
    const fin = (x) => (Number.isFinite(x) ? x : null);
    let bal = b.cfg.balance;
    const curve = [bal, ...b.trades.map((t) => (bal += t.pnl))];
    const step = Math.max(1, Math.ceil(curve.length / 48));
    const spark = curve.filter((_, i) => i % step === 0 || i === curve.length - 1).map((v) => Math.round(v * 100) / 100);
    return {
      symbol: this.ds.symbol, currency: b.cfg.currency, tf: this.tfId, startTime: this.session.startTime, cursor: this.engine.cursor,
      trades: b.trades.length, net: st.net, balance: b.balance, initial: b.cfg.balance, winRate: fin(st.winRate),
      profitFactor: st.profitFactor === Infinity ? 'inf' : fin(st.profitFactor), maxDrawdownPct: fin(st.maxDrawdownPct),
      open: b.positions.length, spark,
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
    return this.settings.stepUnit === 'bar' ? this.engine.stepChartBar(this.broker) : this.engine.step(this.broker);
  }

  step(unit = null) {
    if (this.mode !== 'replay') return;
    if (!this.engine.peek()) {
      if (this.engine.atEnd) { toast('Veri sonuna gelindi', 'warn'); this.pause(); } else this.engine.ensureFeed();
      return;
    }
    const r = unit === 'bar' ? this.engine.stepChartBar(this.broker) : unit === 'base' ? this.engine.step(this.broker) : this._stepUnit();
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
        const r = this.engine.stepChartBar(this.broker);
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
      this.chart.setBars(this.engine.bars, { fit: true });
      this.afterAdvance({ ...r, count: 0 }, true, true);
      const closed = r.events.filter((e) => e.type === 'close').map((e) => e.trade);
      const opened = r.events.filter((e) => e.type === 'open').length;
      if (r.events.length) {
        const net = closed.reduce((s, t) => s + t.pnl, 0);
        toast(`İleri sarıldı: ${opened} açıldı, ${closed.length} kapandı${closed.length ? ` (${F.signedMoney(net, this.broker.cfg.currency)})` : ''}`, net >= 0 ? 'ok' : 'err');
      }
    } finally {
      this.showMessage('');
    }
  }

  afterAdvance(r, force = false, quiet = false) {
    if (!r.count && !force) return;
    if (r.count) {
      if (r.trimmed || r.count > 400) this.chart.setBars(this.engine.bars, { keepLogical: this.chart.chart.timeScale().getVisibleLogicalRange() });
      else this.chart.updateFrom(r.firstChanged);
    }
    const tradeEvents = r.events.length > 0;
    if (!quiet) for (const e of r.events.slice(-4)) this._eventToast(e);
    this.tradeLines.sync();
    this.ticket.update();
    this.renderClock();
    if (tradeEvents) { this.updateMarkers(); this.renderTabs(); }
    if (!this._lastParam || !this._lastParam.time) this.renderLegend(null);
    this._scheduleTab(tradeEvents);
    this.markDirty(tradeEvents);
  }

  _eventToast(e) {
    const ccy = this.broker.cfg.currency, dec = this.ds.decimals;
    if (e.type === 'open' && e.position.orderId != null) {
      const p = e.position;
      toast(`Emir doldu: ${p.side === 'buy' ? 'LONG' : 'SHORT'} ${p.qty} @ ${F.price(p.entryPrice, dec)}`, 'ok');
    } else if (e.type === 'close' && e.trade && ['sl', 'tp', 'strategy'].includes(e.trade.reason)) {
      const t = e.trade;
      toast(`${REASON_TEXT[t.reason]}: ${F.signedMoney(t.pnl, ccy)} (${F.signed(t.pips, 1)} pip)`, t.pnl >= 0 ? 'ok' : 'err');
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

  // ── trading ────────────────────────────────────────────────────────────
  _afterTrade() {
    this.tradeLines.sync();
    this.ticket.update();
    this.updateMarkers();
    this.renderTabs();
    this._scheduleTab(true);
    this.markDirty(true);
  }

  placeOrder(params) {
    if (this.mode !== 'replay') { toast('Önce replay başlatın', 'err'); return null; }
    const r = this.broker.placeOrder(params);
    if (!r.ok) { toast(r.error, 'err'); return null; }
    const dec = this.ds.decimals;
    if (r.position) toast(`${r.position.side === 'buy' ? 'LONG' : 'SHORT'} ${r.position.qty} @ ${F.price(r.position.entryPrice, dec)}`, 'ok');
    else toast(`${r.order.side === 'buy' ? 'Alış' : 'Satış'} ${r.order.type === 'limit' ? 'limit' : 'stop'} emri: ${r.order.qty} @ ${F.price(r.order.price, dec)}`, 'ok');
    this._afterTrade();
    return r;
  }

  modifyPosition(id, stops) {
    const r = this.broker.modifyPosition(id, stops);
    if (!r.ok) toast(r.error, 'err');
    this._afterTrade();
  }

  modifyOrder(id, fields) {
    const r = this.broker.modifyOrder(id, fields);
    if (!r.ok) toast(r.error, 'err');
    this._afterTrade();
  }

  breakeven(id) {
    const p = this.broker.positions.find((x) => x.id === id);
    if (p) this.modifyPosition(id, { sl: p.entryPrice });
  }

  closePosition(id, fraction = 1) {
    const r = this.broker.closePosition(id, { fraction });
    if (!r.ok) { toast(r.error, 'err'); return; }
    if (r.trade) toast(`Kapatıldı: ${F.signedMoney(r.trade.pnl, this.broker.cfg.currency)}`, r.trade.pnl >= 0 ? 'ok' : 'err');
    this._afterTrade();
  }

  closeAll() {
    const trades = this.broker.closeAll();
    if (trades.length) toast(`${trades.length} pozisyon kapatıldı: ${F.signedMoney(trades.reduce((s, t) => s + t.pnl, 0), this.broker.cfg.currency)}`, 'ok');
    this._afterTrade();
  }

  cancelOrder(id) { this.broker.cancelOrder(id); this._afterTrade(); }
  cancelAll() { this.broker.cancelAll(); this._afterTrade(); }

  quickOrder(side) {
    if (this.mode !== 'replay') return;
    const mode = this.ticket.mode;
    this.ticket.mode = 'market';
    try { this.ticket.submit(side); } finally { this.ticket.mode = mode; this.ticket.update(); }
  }

  orderAtPrice(side, price) {
    const prev = [this.ticket.mode, this.ticket.pendingPrice];
    this.ticket.mode = 'pending';
    this.ticket.pendingPrice = Number(price.toFixed(this.ds.decimals));
    try { this.ticket.submit(side); } finally { [this.ticket.mode, this.ticket.pendingPrice] = prev; this.ticket.update(); }
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
  _markers(trades, open = []) {
    const tf = this.tf, align = this.ds.align;
    const out = [];
    for (const t of trades) {
      const buy = t.side === 'buy';
      out.push({ time: bucket(t.entryTime, tf, align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#26a69a' : '#ef5350', shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'AL' : 'SAT'} ${t.qty}` });
      out.push({ time: bucket(t.exitTime, tf, align), position: buy ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#26a69a' : '#ef5350', shape: 'circle', text: F.signed(t.pnl, 2) });
    }
    for (const p of open) {
      const buy = p.side === 'buy';
      out.push({ time: bucket(p.entryTime, tf, align), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#26a69a' : '#ef5350', shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'AL' : 'SAT'} ${p.qty}` });
    }
    const first = this.chart.bars[0]?.time ?? Infinity;
    return out.filter((m) => m.time >= first).sort((a, b) => a.time - b.time);
  }

  updateMarkers() {
    if (!this.ds) return;
    if (this.mode === 'replay' && this.broker) this.chart.setMarkers(this._markers(this.broker.trades, this.broker.positions));
    else if (this.backtest && this.backtest.dsId === this.ds.id) this.chart.setMarkers(this._markers(this.backtest.trades));
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
        const s = this.chart.chart.addSeries(LW.LineSeries, { color: p.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: p.title });
        s.setData(p.data);
        this.plotSeries.push(s);
      }
    } else if (!quiet) toast(`Strateji çizgileri ${result.tf} grafiğinde görünür`, 'warn');
    this.updateMarkers();
  }

  async showTrade(t) {
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
      h(`button.btn.small${d.locked ? '.active' : ''}`, { title: 'Kilitle', onclick: () => this.drawings.update(d.id, { locked: !d.locked }) }, icon('lock', 14)),
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

  renderReplayControls() {
    const el = $('#replay-controls');
    if (!this.scrubEl) {
      this.scrubEl = scrubWheel({ getLook: () => this.chart.look || {}, onSteps: (n) => this.scrubSteps(n), onStart: () => { if (this.playing) this.pause(); } });
      el.after(this.scrubEl);
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
    const unit = h('select.ctl.sm', { title: 'Adım', onchange: (e) => { e.target.blur(); this.settings.stepUnit = e.target.value; this.saveSettings(); } },
      h('option', { value: 'base' }, `${this.ds.base_tf} adım`), h('option', { value: 'bar' }, `${this.tfId} bar adım`));
    unit.value = this.settings.stepUnit;
    const pauseFill = h(`button.btn.small${this.settings.pauseOnFill ? '.active' : ''}`, { title: `Emir dolunca / pozisyon kapanınca duraklat: ${this.settings.pauseOnFill ? 'açık' : 'kapalı'}`, onclick: () => { this.settings.pauseOnFill = !this.settings.pauseOnFill; this.saveSettings(); this.renderReplayControls(); } }, icon('bolt', 15), h('span.lbl', {}, 'Dolunca dur'));
    this.clockEl = h('span.clock', {});
    el.replaceChildren(
      h('button.btn.play', { title: this.playing ? 'Duraklat (Space)' : 'Oynat (Space)', onclick: () => this.togglePlay() }, icon(this.playing ? 'pause' : 'play')),
      h('button.btn', { title: `İleri: 1 ${this.ds.base_tf} (→)`, onclick: () => this.step('base') }, icon('step')),
      h('button.btn', { title: `İleri: 1 ${this.tfId} bar (Shift+→)`, onclick: () => this.step('bar') }, icon('stepbar')),
      h('button.btn', { title: 'İleri sar', onclick: () => D.jumpDialog(this) }, icon('ffwd')),
      h('span.vr'), speed, unit, pauseFill, h('span.vr'),
      this.clockEl,
      h('button.btn.small.sell.mobile-only', { onclick: () => this.quickOrder('sell') }, 'SAT'),
      h('button.btn.small.buy.mobile-only', { onclick: () => this.quickOrder('buy') }, 'AL'),
      h('button.btn', { title: 'Replay’den çık (oturum kaydedilir)', onclick: () => this.exitReplay() }, icon('stop', 16)));
    this.renderClock();
  }

  renderClock() {
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
        oncontextmenu: (e) => { if (group.length > 1) { e.preventDefault(); this.toolFlyout(btn, group); } },
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
  }

  /** The rest of a tool group, in a small menu beside its button. */
  toolFlyout(anchor, group) {
    this.closeToolFlyout();
    const r = anchor.getBoundingClientRect();
    const menu = h('div.tool-flyout.glass-pop', { role: 'menu' }, group.map((t) => h(`button.item${this.drawings.tool === t ? '.on' : ''}`, {
      type: 'button', role: 'menuitem',
      onclick: () => {
        this.settings.toolPicks = { ...(this.settings.toolPicks || {}), [group[0]]: t }; this.saveSettings();
        this.closeToolFlyout();
        this.drawings.setTool(t);
      },
    }, toolIcon(t, 17), h('span', {}, TOOL_NAMES[t]), toolKey(t) ? h('kbd', {}, toolKey(t)) : null)));
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
    const b = this.broker;
    const counts = {
      positions: b ? b.positions.length : 0,
      orders: b ? b.orders.filter((o) => o.type !== 'next').length : 0,
      history: b ? b.trades.length : 0,
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
      const b = this.broker;
      const stats = computeStats(b.trades, { initial: b.cfg.balance, tz: this.settings.tz });
      this.statsView.render({ stats, ccy: b.cfg.currency, initial: b.cfg.balance, theme: this.theme,
        extra: [h('div.kpi', {}, h('div.label', {}, 'Maks. düşüş (varlık)'), h('div.value.down', {}, `${F.money(b.maxDrawdown, b.cfg.currency)} · ${F.pct(b.maxDrawdownPct, 1)}`))] });
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
    $('#btn-draw').addEventListener('click', () => $('#draw-toolbar').classList.toggle('show'));
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
    cmd('Görünüm', () => D.settingsDialog(this, { section: 'look' }), 'palette', { keys: 'tema renk font yazı' });
    cmd('Ayarlar', () => D.settingsDialog(this), 'sliders', { keys: 'saat dilimi hesap api' });
    cmd('Ana ekran', () => { window.location.href = '/home.html'; }, 'home');
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
      if (e.key === 'Escape') { this.cancelPick(); this.drawings.cancel(); this.drawings.select(null); $('#context-menu').classList.add('hidden'); this.closePopover(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.drawings.selected) { e.preventDefault(); this.drawings.remove(this.drawings.selected.id); return; }
      const letter = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : '';
      if (e.altKey && TOOL_KEYS[letter]) { e.preventDefault(); this.drawings.setTool(TOOL_KEYS[letter]); return; }
      if (this.mode !== 'replay') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(e.shiftKey ? 'bar' : null); }
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
