// Data tab: the 15-year data packs up top, then the user's datasets and
// (folded away) CSV import and custom downloads.
import { api } from '../api.js?v=efec4daadb';
import * as F from '../format.js?v=efec4daadb';
import { confirmBox, field, h, icon, modal, toast } from './dom.js?v=efec4daadb';

const DAY = 86400;
const PACK_COLORS = { EURUSD: '#5b8cff', NAS100: '#c6ff3d', XAUUSD: '#ffd23f', GBPUSD: '#c77dff', USDCAD: '#ff6b6b', SPX500: '#4fd1c5' };
const MB = 2 ** 20;

function bytes(n) {
  if (n == null) return '—';
  if (n >= 1024 * MB) return `${(n / 1024 / MB).toFixed(2)} GB`;
  return `${Math.max(0, n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

function duration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sn`;
  if (sec < 3600) return `${Math.round(sec / 60)} dk`;
  return `${Math.floor(sec / 3600)} sa ${Math.round((sec % 3600) / 60)} dk`;
}
const TZS = ['UTC', 'Europe/Istanbul', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', '-05:00', '+02:00', '+03:00'];

export class DataView {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.providers = [];
    this.jobs = [];
    this.poll = null;
    this.file = null;
    this.packs = null;
    this.packTf = app.storage('rt:packTf', null);
    this.advancedOpen = false;
  }

  get busy() { return this.jobs.some((j) => j.status === 'running' || j.status === 'queued'); }

  async init() {
    try { this.providers = await api.providers(); } catch { this.providers = []; }
    await Promise.all([this.refreshJobs(), this.refreshPacks()]);
  }

  async refreshPacks() {
    try { this.packs = await api.packs(); } catch { this.packs = null; }
    this._watchMirror();
  }

  // while the mirror brings packs back, refresh every two seconds; when it is
  // done, the chart's dataset list is reloaded so the packs show up there
  _watchMirror() {
    const running = this.packs?.mirror?.status === 'running';
    if (running && !this._mirrorPoll) {
      this._mirrorPoll = setInterval(async () => {
        await this.refreshPacks();
        if (this.packs?.mirror?.status !== 'running') {
          clearInterval(this._mirrorPoll);
          this._mirrorPoll = null;
          const m = this.packs?.mirror || {};
          toast(m.message || 'Veri yedeği tamamlandı', m.status === 'error' ? 'err' : 'ok', 7000);
          await this.app.loadDatasets(undefined, { keep: true });
        }
        this.renderLive();
      }, 2000);
    }
  }

  async restoreMirror(force = false) {
    try {
      await api.mirrorRestore({ force });
      await this.refreshPacks();
      this.renderLive();
    } catch (err) { toast(err.message, 'err', 9000); }
  }

  _mirrorBox(m) {
    if (!m?.enabled) return null;
    const running = m.status === 'running';
    const built = m.built_at ? `yedek tarihi ${F.dateOnly(m.built_at, 'UTC')}` : '';
    const line = running ? `%${Math.round((m.progress || 0) * 100)} · ${m.message}`
      : m.status === 'error' ? `Hata: ${m.message}` : m.status === 'done' ? `${m.message}${built ? ` · ${built}` : ''}` : 'Hazır';
    return h(`div.mirror-box${m.status === 'error' ? '.err' : ''}`, {},
      h('div.mirror-ic', {}, icon(running ? 'download' : m.status === 'error' ? 'warn' : 'check', 16)),
      h('div.mirror-text', {},
        h('b', {}, 'GitHub veri yedeği'),
        h('span', {}, `Paketler ${m.repo} deposundaki “${m.tag}” sürümünden gelir; her güncellemeden sonra kendiliğinden geri yüklenir. `),
        h('span.mirror-line', {}, line),
        running ? h('div.mirror-bar', {}, h('i', { style: { width: `${Math.round((m.progress || 0) * 100)}%` } })) : null),
      running ? null : h('div.mirror-actions', {},
        h('button.btn.small.primary', { onclick: () => this.restoreMirror(false) }, icon('download', 14), 'Eksikleri yükle'),
        h('button.btn.small.outline', { title: 'Hepsini yedekten yeniden indir', onclick: () => this.restoreMirror(true) }, icon('refresh', 14), 'Yeniden yükle')));
  }

  async refreshJobs() {
    try { this.jobs = await api.jobs(); } catch { this.jobs = []; }
    const running = this.busy;
    if (running && !this.poll) {
      this.poll = setInterval(async () => {
        const before = this.jobs.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => j.id);
        await Promise.all([this.refreshJobs(), this.refreshPacks()]);
        const finished = this.jobs.filter((j) => before.includes(j.id) && !['running', 'queued'].includes(j.status));
        for (const j of finished) {
          toast(`${j.label || `${j.symbol} ${j.tf}`}: ${j.message}`, j.status === 'done' ? 'ok' : j.status === 'cancelled' ? 'warn' : 'err', 7000);
          await this.app.loadDatasets(j.dataset_id ?? undefined, { keep: true });
        }
        if (finished.length) this.app.renderTabs();
        if (this.app.bottomTab === 'data') this.renderLive();
      }, 1500);
      this.app.renderTabs?.();
    } else if (!running && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
      this.app.renderTabs?.();
    }
  }

  render() {
    this.el.innerHTML = '';
    this.jobsEl = h('div', {});
    this.packsEl = h('div', {});
    const advanced = h('details.advanced', { ontoggle: (e) => { this.advancedOpen = e.target.open; } },
      h('summary', {}, this.providers.length ? 'Gelişmiş · CSV içe aktar, başka sembol indir' : 'Gelişmiş · CSV içe aktar'),
      // without a server (local mode) only files can be brought in
      h('div.inner', {}, h('div.data-layout', {}, this._importCard(), this.providers.length ? this._downloadCard() : null)));
    advanced.open = this.advancedOpen;
    this.el.append(h('div.pane', {}, h('div.data-wrap', {}, this.packsEl, this._datasets(), advanced)));
    this.renderPacks();
    this.renderJobs();
  }

  /** Refresh the parts that change while downloads run, keeping inputs intact. */
  renderLive() {
    if (!this.packsEl || !this.el.isConnected) return;
    this.renderPacks();
    this.renderJobs();
  }

  _tf() {
    return this.packTf || this.packs?.recommended || '1m';
  }

  async downloadPacks(ids) {
    try {
      const res = await api.downloadPacks({ ids, tf: this._tf(), years: this.packs?.years || 15 });
      this.packs = res;
      if (!res.jobs.length) toast('Seçilen paketler zaten güncel', 'ok');
      else toast(`${res.jobs.length} paket iniyor: ${res.jobs.map((j) => j.label).join(', ')}`, 'ok', 6000);
      await this.refreshJobs();
      this.renderLive();
    } catch (err) { toast(err.message, 'err', 9000); }
  }

  renderPacks() {
    const st = this.packs;
    if (!this.packsEl) return;
    if (!st) { this.packsEl.replaceChildren(h('div.muted', {}, 'Paket bilgisi alınamadı.')); return; }
    const tf = this._tf();
    const tz = 'UTC';
    const now = Date.now() / 1000;
    const span = now - st.start;
    const startYear = new Date(st.start * 1000).getUTCFullYear();
    const endYear = new Date().getUTCFullYear();
    const disk = st.disk;
    const dataBytes = this.app.datasets.reduce((sum, d) => sum + (d.bytes || 0), 0);
    const need = st.packs.reduce((sum, p) => {
      const ds = p.datasets.find((d) => d.tf === tf);
      return sum + p.estimate[tf] * (1 - (ds?.coverage || 0));
    }, 0);
    const used = Math.max(0, disk.used - dataBytes);
    const pct = (x) => `${Math.max(0, Math.min(100, (x / disk.total) * 100))}%`;
    const seg = h('div.seg', { title: 'Çözünürlük' },
      ...[['1m', '1 dakika'], ['5m', '5 dakika']].map(([v, label]) => h(`button${tf === v ? '.on' : ''}`, {
        onclick: () => { this.packTf = v; this.app.store('rt:packTf', v); this.renderPacks(); },
      }, label, st.recommended === v ? h('span.rec', { title: 'Diskine göre önerilen' }, 'önerilen') : null)));
    const allDone = st.packs.every((p) => (p.datasets.find((d) => d.tf === tf)?.coverage || 0) > 0.985);
    const anyRunning = st.packs.some((p) => p.job && ['running', 'queued'].includes(p.job.status));
    const head = h('div.data-head', {},
      h('h2.title', {}, `Veri paketleri · ${st.years} yıl`,
        st.local
          ? h('small', {}, `EUR/USD, GBP/USD, USD/CAD, NASDAQ 100, S&P 500 ve altın · ${startYear}–${endYear} · `,
            h('b', {}, 'bu cihaza iner'), ' · kaynak: RV veri deposu')
          : h('small', {}, `EUR/USD, GBP/USD, USD/CAD, NASDAQ 100, S&P 500 ve altın · ${startYear}–${endYear} · kaynak: `,
            h('b', {}, st.provider === 'oanda' ? 'OANDA (bağlı hesabınız)' : 'Dukascopy (ücretsiz, anahtarsız)'),
            st.provider === 'oanda' ? ' · OANDA vermezse Dukascopy devreye girer' : '')),
      h('div.controls', {},
        seg,
        h('div.disk', { title: st.local ? 'Bu cihazda bu siteye ayrılan yer' : 'Disk kullanımı' },
          h('div.bar', {},
            h('i', { style: { width: pct(used), background: 'var(--fill-3)' } }),
            h('i', { style: { width: pct(dataBytes), background: 'var(--accent)' } }),
            h('i', { style: { width: pct(Math.min(need, disk.free)), background: 'repeating-linear-gradient(-45deg, var(--accent) 0 3px, transparent 3px 6px)', opacity: 0.6 } })),
          h('div.legend-row', {}, h('span', {}, 'veri ', h('b', {}, bytes(dataBytes))), h('span', {}, 'boş ', h('b', {}, bytes(disk.free))),
            need > 0 ? h('span', {}, 'gerekli ', h('b', {}, bytes(need))) : null)),
        st.light ? null : h('button.btn.primary', { disabled: allDone || anyRunning, onclick: () => this.downloadPacks(st.packs.map((p) => p.id)) },
          anyRunning ? 'İniyor…' : allDone ? [icon('check', 15), 'Hepsi güncel'] : [icon('download', 15), 'Hepsini indir'])));
    const warns = [];
    const mirrorOn = !!st.mirror?.enabled;
    if (st.light) {
      warns.push(h('div.warn-box', {}, h('b', {}, 'Hafif mod: '), 'Bu cihaz veriyi indirmeden, siteden okur; açtığın yıllar tarayıcının önbelleğinde kalır. Profiller, ayarlar ve oturumlar bulutta.'));
    } else if (st.local) {
      if (!disk.persistent) warns.push(h('div.warn-box', {}, h('b', {}, 'Veriler kalıcı değil: '), 'Tarayıcı yer daralınca bu sitenin verisini silebilir. Siteyi uygulama olarak yükle (telefonda Paylaş → Ana Ekrana Ekle, bilgisayarda adres çubuğundaki “Yükle”); yüklü uygulamanın verisi korunur.'));
      if (tf === '1m' && need + 25 * MB > disk.free) warns.push(h('div.warn-box', {}, h('b', {}, 'Cihazda yer yetmeyebilir: '), `1 dakikalık 15 yıl için ~${bytes(need)} gerekli, ${bytes(disk.free)} boş. 5 dakikalık çözünürlük ~5 kat az yer tutar.`));
    } else {
      if (!disk.persistent && !mirrorOn) warns.push(h('div.warn-box', {}, h('b', {}, 'Kalıcı disk yok: '), 'Railway’de bu servise volume bağlanmamış. İndirilen veri her yeniden başlatmada silinir. Railway → servis → Settings → Volumes → “Add volume” (mount path: /data).'));
      if (tf === '1m' && need + 25 * MB > disk.free) warns.push(h('div.warn-box', {}, h('b', {}, 'Disk yetmeyebilir: '), `1 dakikalık 15 yıl için ~${bytes(need)} gerekli, ${bytes(disk.free)} boş. 5 dakikalık çözünürlük ~5 kat az yer tutar; Railway Hobby planında volume 5 GB’a kadar büyütülebilir.`));
    }
    const cards = h('div.packs', {}, st.packs.map((p) => {
      const ds = p.datasets.find((d) => d.tf === tf);
      const other = p.datasets.find((d) => d.tf !== tf);
      const job = p.job;
      const running = job && ['running', 'queued'].includes(job.status);
      const cov = ds?.coverage || 0;
      const left = ds?.first_ts ? Math.max(0, (ds.first_ts - st.start) / span) : 0;
      const width = ds?.first_ts ? Math.max(0.004, (Math.min(ds.last_ts, now) - Math.max(ds.first_ts, st.start)) / span) : 0;
      const timeline = h('div.timeline', {}, h('div.ticks'),
        width ? h('div.cov', { style: { left: `${left * 100}%`, width: `${width * 100}%` } }) : null,
        running ? h('div.run', { style: { left: `${(job.ranges?.[0]?.[0] - st.start) / span * 100 || 0}%`, width: `${Math.max(2, job.progress * 100 * ((job.end - job.start) / span))}%` } }) : null);
      let status = '';
      if (running) status = `${job.status === 'queued' ? 'sırada' : `%${Math.round(job.progress * 100)} · ${job.message}`}${job.eta ? ` · kalan ~${duration(job.eta)}` : ''} · ${job.provider}`;
      else if (job && job.status === 'error') status = `Hata: ${job.message}`;
      else if (ds?.stream) status = 'Hazır · siteden okunur, indirmen gerekmez (açtığın yıllar cihazda saklanır)';
      else if (ds) status = cov > 0.985 ? 'Güncel' : `%${Math.round(cov * 100)} dolu`;
      else status = `İndirilmedi · ~${bytes(p.estimate[tf])}`;
      const actions = running
        ? [h('button.btn.small.outline', { onclick: async () => { await api.cancelJob(job.id); await this.refreshJobs(); await this.refreshPacks(); this.renderLive(); } }, 'Durdur')]
        : [
          ds && ds.bar_count ? h('button.btn.small.outline', { onclick: () => this.app.selectDataset(ds.id) }, 'Grafikte aç') : null,
          st.light ? null
            : ds?.stream ? h('button.btn.small', { title: 'İnternetsiz kullanmak için 15 yılın hepsini cihaza indir (isteğe bağlı)', onclick: () => this.downloadPacks([p.id]) }, icon('download', 14), 'Cihaza indir')
            : cov > 0.985 ? h('button.btn.small', { title: 'Son günleri ekle', onclick: () => this.downloadPacks([p.id]) }, icon('refresh', 14), 'Güncelle')
            : h('button.btn.small.primary', { onclick: () => this.downloadPacks([p.id]) }, icon('download', 14), ds ? 'Tamamla' : 'İndir'),
          other && !ds ? h('span.muted', { style: { fontSize: '11px' } }, `${other.tf} hazır`) : null,
        ];
      return h('div.pack', { style: { '--pack-c': PACK_COLORS[p.id] } },
        h('div.top', {}, h('div', {}, h('div.sym', {}, p.name), h('div.name', {}, p.title)), h('span.kind', {}, p.kind)),
        timeline,
        h('div.timeline-labels', {}, h('span', {}, startYear), h('span', {}, endYear)),
        h('div.meta', {},
          h('span', {}, ds?.bar_count ? `${ds.bar_count.toLocaleString('tr-TR')} bar` : `${tf} · ${st.years} yıl`),
          h('span', {}, ds?.stream ? 'internetten' : ds?.bar_count ? bytes(ds.bytes) : `~${bytes(p.estimate[tf])}`),
          ds?.first_ts ? h('span', {}, `${F.dateOnly(ds.first_ts, tz)} → ${F.dateOnly(ds.last_ts, tz)}`) : null,
          ds ? h('span', {}, ds.source) : null),
        h('div.status', {}, status),
        h('div.actions', {}, actions.filter(Boolean)));
    }));
    this.packsEl.replaceChildren(h('div.data-wrap', {}, head, this._mirrorBox(st.mirror), ...warns, cards));
  }

  _datasets() {
    const app = this.app;
    const tz = app.settings.tz;
    const rows = app.datasets.map((d) => h(`tr${d.id === app.ds?.id ? '' : '.clickable'}`, { onclick: (e) => { if (e.target.tagName !== 'BUTTON') app.selectDataset(d.id); } },
      h('td', {}, h('strong', {}, d.symbol), h('div.muted', { style: { fontSize: '11px' } }, d.name)),
      h('td', {}, d.source),
      h('td', {}, d.base_tf),
      h('td', {}, d.first_ts ? `${F.dateOnly(d.first_ts, tz)} → ${F.dateOnly(d.last_ts, tz)}` : '—'),
      h('td.num', {}, (d.bar_count || 0).toLocaleString('tr-TR')),
      h('td.num', {}, bytes(d.bytes)),
      h('td.actions', {},
        h('button.btn.small.outline', { onclick: () => this.editDataset(d) }, 'Ayar'),
        h('button.btn.small.outline.danger', { onclick: () => this.deleteDataset(d) }, 'Sil'))));
    return h('div', {},
      h('h4', { style: { marginTop: 0 } }, 'Veri setlerim'),
      app.datasets.length
        ? h('table.grid', {}, h('thead', {}, h('tr', {}, ['Sembol', 'Kaynak', 'Taban TF', 'Aralık', 'Bar', 'Boyut', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))
        : h('div.empty', {}, 'Henüz veri yok.'),
      h('h4', {}, 'İndirme işleri'),
      this.jobsEl);
  }

  renderJobs() {
    if (!this.jobsEl) return;
    const tz = this.app.settings.tz;
    const STATUS = { queued: 'sırada', running: 'iniyor', done: 'bitti', error: 'hata', cancelled: 'durduruldu' };
    this.jobsEl.replaceChildren(...(this.jobs.length ? this.jobs.slice(0, 8).map((j) => h('div.job', {},
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
        h('span', {}, h('strong', {}, j.label || `${j.symbol} ${j.tf}`), h('span.muted', {}, ` · ${j.provider} · ${F.dateOnly(j.start, tz)} → ${F.dateOnly(j.end, tz)}`)),
        ['running', 'queued'].includes(j.status) ? h('button.btn.small.outline', { onclick: async () => { await api.cancelJob(j.id); this.refreshJobs(); } }, 'Durdur') : h('span.badge', {}, STATUS[j.status] || j.status)),
      h('div.progress', {}, h('div', { style: { width: `${Math.round(j.progress * 100)}%`, background: j.status === 'error' ? 'var(--down)' : undefined } })),
      h('span.muted', {}, `${j.message}${j.eta ? ` · kalan ~${duration(j.eta)}` : ''}`))) : [h('div.muted', {}, 'İş yok.')]));
  }

  _importCard() {
    const app = this.app;
    const symbol = h('input.ctl.sm', { placeholder: 'ör. EURUSD, THYAO', style: { width: '100%' } });
    const tz = h('select.ctl.sm', {}, TZS.map((z) => h('option', { value: z }, z)));
    const order = h('select.ctl.sm', {}, h('option', { value: 'auto' }, 'otomatik'), h('option', { value: 'dmy' }, 'gün.ay.yıl'), h('option', { value: 'mdy' }, 'ay/gün/yıl'));
    const target = h('select.ctl.sm', {}, h('option', { value: '' }, 'Yeni veri seti'), app.datasets.map((d) => h('option', { value: d.id }, `${d.symbol} (${d.base_tf}) içine ekle`)));
    const label = h('span', {}, 'CSV dosyasını buraya bırakın ya da tıklayın');
    const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.tsv', style: { display: 'none' }, onchange: (e) => setFile(e.target.files[0]) });
    const setFile = (f) => {
      if (!f) return;
      this.file = f;
      label.textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`;
      if (!symbol.value) symbol.value = (f.name.match(/[A-Z]{6}|[A-Z]{3,5}(?=[^A-Z]|$)/i)?.[0] || '').toUpperCase();
    };
    const drop = h('div.drop', {
      onclick: () => fileInput.click(),
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); },
    }, label, fileInput);
    const go = h('button.btn.primary.small', { onclick: async () => {
      if (!this.file) { toast('Önce bir dosya seçin', 'err'); return; }
      go.disabled = true;
      go.textContent = 'Yükleniyor…';
      try {
        const res = await api.importCsv(this.file, { symbol: symbol.value, tz: tz.value, date_order: order.value, dataset_id: target.value || undefined });
        toast(`${res.rows.toLocaleString('tr-TR')} satır okundu (${res.base_tf})${res.skipped ? `, ${res.skipped} satır atlandı` : ''}`, 'ok', 6000);
        this.file = null;
        await app.loadDatasets(res.dataset.id);
      } catch (err) {
        toast(`İçe aktarma hatası: ${err.message}`, 'err', 8000);
      } finally {
        go.disabled = false;
        go.textContent = 'İçe aktar';
      }
    } }, 'İçe aktar');
    return h('div', {},
      h('h4', { style: { marginTop: 0 } }, 'CSV içe aktar'),
      h('div.form-grid', {},
        h('div.full', {}, drop),
        h('label', {}, 'Sembol'), symbol,
        h('label', {}, 'Saat dilimi'), tz,
        h('label', {}, 'Tarih sırası'), order,
        h('label', {}, 'Hedef'), target,
        h('div.full', {}, go),
        h('div.full.muted', { style: { fontSize: '11px' } },
          'MT4/MT5 dışa aktarımı, HistData, Dukascopy, TradingView, Binance, Yahoo ve investing.com (TR) biçimleri otomatik tanınır. ',
          'HistData dosyaları EST (UTC-5, yaz saati yok) kullanır: saat dilimini -05:00 seçin.')));
  }

  _downloadCard() {
    const app = this.app;
    const prov = h('select.ctl.sm', {}, this.providers.filter((p) => p.id !== 'demo').concat(this.providers.filter((p) => p.id === 'demo')).map((p) => h('option', { value: p.id }, p.name)));
    const symbol = h('input.ctl.sm', { style: { width: '100%' } });
    const tf = h('select.ctl.sm', {});
    const now = Math.floor(Date.now() / 1000);
    const from = h('input.ctl.sm', { type: 'date', value: F.toLocalInput(now - 365 * DAY, 'UTC').slice(0, 10) });
    const to = h('input.ctl.sm', { type: 'date', value: F.toLocalInput(now, 'UTC').slice(0, 10) });
    const token = h('input.ctl.sm', { type: 'password', placeholder: 'OANDA API token (kaydedilmez)', style: { width: '100%' } });
    const price = h('select.ctl.sm', {}, h('option', { value: 'bid' }, 'bid (MT4 gibi)'), h('option', { value: 'mid' }, 'mid'), h('option', { value: 'ask' }, 'ask'));
    const note = h('div.full.muted', { style: { fontSize: '11px' } });
    const tokenRow = [h('label', {}, 'Token'), token];
    const priceRow = [h('label', {}, 'Fiyat'), price];
    const sync = () => {
      const p = this.providers.find((x) => x.id === prov.value);
      if (!p) return;
      tf.replaceChildren(...p.timeframes.map((x) => h('option', { value: x }, x)));
      tf.value = p.timeframes[0];
      symbol.placeholder = p.examples.join(', ');
      if (!symbol.value || this._lastExample === symbol.value) { symbol.value = p.examples[0]; this._lastExample = symbol.value; }
      note.textContent = p.note + (p.id === 'oanda' && p.configured ? ' Token sunucuda tanımlı (OANDA_TOKEN).' : '');
      const showToken = p.id === 'oanda' && !p.configured;
      tokenRow.forEach((e) => e.classList.toggle('hidden', !showToken));
      priceRow.forEach((e) => e.classList.toggle('hidden', p.id !== 'oanda'));
    };
    prov.addEventListener('change', sync);
    const go = h('button.btn.primary.small', { onclick: async () => {
      const start = F.parseLocal(from.value, 'UTC'), end = F.parseLocal(to.value, 'UTC');
      if (start == null || end == null) { toast('Tarih seçin', 'err'); return; }
      try {
        await api.download({ provider: prov.value, symbol: symbol.value, tf: tf.value, start, end: end + DAY, token: token.value || undefined, price: prov.value === 'oanda' ? price.value : undefined });
        toast('İndirme başladı', 'ok');
        await this.refreshJobs();
        this.renderJobs();
      } catch (err) { toast(err.message, 'err', 6000); }
    } }, 'İndir');
    const card = h('div', {},
      h('h4', { style: { marginTop: 0 } }, 'İnternetten indir'),
      h('div.form-grid', {},
        h('label', {}, 'Kaynak'), prov,
        h('label', {}, 'Sembol'), symbol,
        h('label', {}, 'Zaman dilimi'), tf,
        h('label', {}, 'Başlangıç'), from,
        h('label', {}, 'Bitiş'), to,
        ...tokenRow, ...priceRow,
        note,
        h('div.full', {}, go),
        h('div.full.muted', { style: { fontSize: '11px' } }, 'Replay için 1m indirin: üst zaman dilimleri bundan üretilir ve SL/TP dakika içinde doğru sırayla kontrol edilir. Aynı sembol tekrar indirilirse mevcut setin üzerine eklenir.')));
    setTimeout(sync, 0);
    return card;
  }

  editDataset(d) {
    const inputs = {
      symbol: h('input.ctl', { value: d.symbol }),
      name: h('input.ctl', { value: d.name }),
      decimals: h('input.ctl', { type: 'number', min: 0, max: 10, value: d.decimals }),
      pip_size: h('input.ctl', { type: 'number', step: 'any', value: d.pip_size }),
      contract_size: h('input.ctl', { type: 'number', step: 'any', value: d.contract_size }),
      currency: h('input.ctl', { value: d.currency }),
      align: h('select.ctl', {}, h('option', { value: 'utc' }, 'UTC 00:00 (kripto, hisse)'), h('option', { value: 'fx' }, 'Forex: 17:00 New York')),
      quote_conv: h('select.ctl', {}, h('option', { value: 'none' }, 'K/Z kotasyon para biriminde'), h('option', { value: 'divide' }, 'Fiyata böl (USDJPY, USDCHF…)')),
      price_type: h('select.ctl', {}, h('option', { value: 'bid' }, 'bid'), h('option', { value: 'mid' }, 'mid'), h('option', { value: 'last' }, 'son işlem (hisse/kripto)')),
    };
    inputs.align.value = d.align;
    inputs.quote_conv.value = d.quote_conv;
    inputs.price_type.value = d.price_type;
    modal({
      title: `${d.symbol} ayarları`,
      body: h('div', { style: { display: 'grid', gap: '10px' } },
        h('div.row2', {}, field('Sembol', inputs.symbol), field('Ad', inputs.name)),
        h('div.row2', {}, field('Ondalık', inputs.decimals), field('Pip büyüklüğü', inputs.pip_size, 'EURUSD 0.0001, USDJPY 0.01, XAUUSD 0.1')),
        h('div.row2', {}, field('Lot büyüklüğü (kontrat)', inputs.contract_size, 'Forex 100000, altın 100, hisse/kripto 1'), field('K/Z para birimi', inputs.currency)),
        h('div.row2', {}, field('Gün başlangıcı', inputs.align), field('K/Z dönüşümü', inputs.quote_conv)),
        field('Fiyat tipi', inputs.price_type)),
      actions: [
        { label: 'Vazgeç' },
        { label: 'Kaydet', kind: 'primary', onClick: async () => {
          const body = {};
          for (const [k, el] of Object.entries(inputs)) body[k] = ['decimals', 'pip_size', 'contract_size'].includes(k) ? Number(el.value) : el.value;
          await api.patchDataset(d.id, body);
          await this.app.loadDatasets(this.app.ds?.id === d.id ? d.id : undefined, { keep: this.app.ds?.id !== d.id });
          toast('Kaydedildi', 'ok');
        } },
      ],
    });
  }

  async deleteDataset(d) {
    if (!(await confirmBox('Veri setini sil', `${d.name} ve tüm barları silinsin mi? Bu geri alınamaz.`, 'Sil', 'danger'))) return;
    try {
      await api.deleteDataset(d.id);
      toast('Silindi', 'ok');
      await this.app.loadDatasets(this.app.ds?.id === d.id ? undefined : this.app.ds?.id);
    } catch (err) { toast(err.message, 'err'); }
  }
}
