import { h, icon, storage, store, modal } from './dom.js?v=1f79c2a121';
import { SESSION_SETS } from '../chart/sessions.js?v=1f79c2a121';
import * as F from '../format.js?v=1f79c2a121';

export const EXTRA_WIDGETS = [
  ['notes', 'İşlem notları', 'Kendi analizini ve günün planını yaz.'],
  ['checklist', 'İşlem öncesi kontrol', 'Düzenlenebilir kontrol listenle hazırlığını takip et.'],
  ['clocks', 'Dünya saatleri', 'İstanbul, New York, Londra ve Tokyo saatleri.'],
  ['risk', 'Risk bütçesi', 'Bakiye ve risk yüzdesinden işlem bütçeni hesapla.'],
  ['goal', 'Çalışma hedefi', 'Replay çalışma hedefini ve ilerlemeni takip et.'],
  ['killzones', 'ICT saat rehberi', 'New York saatindeki killzone aralıklarını tek yerde gör.'],
];
export function riskBudget(balance, percent) {
  return Number.isFinite(balance) && balance > 0 && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? balance * percent / 100 : null;
}
const config = id => storage(`rt:widget:${id}`, {}) || {};
const save = (id, patch) => store(`rt:widget:${id}`, { ...config(id), ...patch });
const time = (zone, now = new Date()) => new Intl.DateTimeFormat('tr-TR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
const hm = m => `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;

// minutes past midnight and the UTC offset of a zone, at `now`
function zoneNow(zone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZoneName: 'shortOffset' })
    .formatToParts(now).map(p => [p.type, p.value]));
  const day = new Intl.DateTimeFormat('tr-TR', { timeZone: zone, weekday: 'short' }).format(now);
  return { min: Number(parts.hour) * 60 + Number(parts.minute), day, gmt: (parts.timeZoneName || 'GMT').replace('GMT', 'GMT ').trim() };
}
const inZone = (min, z) => (z.from < z.to ? min >= z.from && min < z.to : min >= z.from || min < z.to);
const until = (from, to) => ((to - from) % 1440 + 1440) % 1440;
const span = m => (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60 ? `${m % 60} dk` : ''}`.trim() : `${m} dk`);

// the markets each city's clock stands for (ICT session names, NY time)
const CITIES = [
  ['İstanbul', 'Europe/Istanbul', null],
  ['Londra', 'Europe/London', 'LONDON'],
  ['New York', 'America/New_York', 'NEW YORK'],
  ['Tokyo', 'Asia/Tokyo', 'ASIA'],
];

/** Every live widget on the page re-reads the time (home.js, every few seconds). */
export function refreshWidgetClocks(root = document) {
  root.querySelectorAll('[data-world-clock]').forEach(el => { el.textContent = time(el.dataset.worldClock); });
  root.querySelectorAll('[data-widget-tick]').forEach(el => el.rvTick?.());
}

function clocksBody() {
  const grid = h('div.wclock-grid');
  const ny = () => zoneNow('America/New_York').min;
  const cells = CITIES.map(([label, zone, session]) => {
    const t = h('strong.wclock-time', { dataset: { worldClock: zone } }, time(zone));
    const meta = h('span.wclock-meta'), state = h('span.wclock-state');
    const cell = h('div.wclock', {}, h('div.wclock-top', {}, h('span.wclock-city', {}, label), h('i.wclock-sky')), t, h('div.wclock-foot', {}, meta, state));
    const tick = () => {
      const z = zoneNow(zone), hour = z.min / 60;
      cell.classList.toggle('night', hour < 6 || hour >= 19);
      meta.textContent = `${z.day} · ${z.gmt}`;
      const s = session && SESSION_SETS[0].zones.find(x => x.name === session);
      const open = s && inZone(ny(), s);
      cell.style.setProperty('--c', s ? s.color : 'var(--widget-accent)');
      cell.classList.toggle('open', !!open);
      state.textContent = !s ? 'Yerel' : open ? 'Seans açık' : 'Kapalı';
    };
    tick();
    cell.dataset.widgetTick = '';
    cell.rvTick = tick;
    return cell;
  });
  grid.append(...cells);
  return [grid, h('small.muted.wfoot-note', {}, 'Canlı · yaz/kış saati otomatik · seans durumu forex saatlerine göre')];
}

function killzonesBody() {
  const zones = SESSION_SETS[1].zones;
  const pct = m => `${(m / 1440) * 100}%`;
  const track = h('div.kz-track');
  for (const z of zones) {
    const parts = z.from < z.to ? [[z.from, z.to]] : [[z.from, 1440], [0, z.to]].filter(([a, b]) => b > a);
    for (const [a, b] of parts) track.append(h('i.kz-seg', { style: { left: pct(a), width: pct(b - a), '--c': z.color }, title: `${z.name} ${hm(z.from)} – ${hm(z.to)}` }));
  }
  const now = h('b.kz-now'), nowLabel = h('span.kz-now-label');
  track.append(now);
  const scale = h('div.kz-scale', {}, ...[0, 6, 12, 18, 24].map(x => h('span', { style: { left: pct(x * 60) } }, String(x).padStart(2, '0'))));
  const rows = zones.map(z => {
    const state = h('span.kz-state');
    const row = h('div.kz-row', { style: { '--c': z.color } }, h('i.kz-dot'), h('span.kz-name', {}, z.name), h('span.kz-range', {}, `${hm(z.from)} – ${hm(z.to)}`), state);
    return { z, row, state };
  });
  const head = h('div.kz-head', {}, h('span.muted', {}, 'New York saati · EST / EDT otomatik'), nowLabel);
  const wrap = h('div.kz', {}, head, h('div.kz-timeline', {}, track, scale), h('div.kz-list', {}, rows.map(r => r.row)));
  const tick = () => {
    const min = zoneNow('America/New_York').min;
    now.style.left = pct(min);
    nowLabel.textContent = `NY ${hm(min)}`;
    for (const { z, row, state } of rows) {
      const open = inZone(min, z);
      row.classList.toggle('open', open);
      state.textContent = open ? `açık · ${span(until(min, z.to))} kaldı` : `${span(until(min, z.from))} sonra`;
    }
  };
  tick();
  wrap.dataset.widgetTick = '';
  wrap.rvTick = tick;
  return [wrap];
}

export function widgetSettings(id, done) {
  const c = config(id), fallback = EXTRA_WIDGETS.find(w => w[0] === id)?.[1] || 'Widget';
  const title = h('input.ctl', { value: c.title || fallback, maxlength: 60 });
  const color = h('input', { type: 'color', value: c.color || '#9fa8ff' });
  const body = h('div.drawing-settings', {}, h('label', {}, 'Başlık', title), h('label', {}, 'Vurgu rengi', color));
  let items;
  if (id === 'checklist') {
    items = h('textarea.ctl', { rows: 6, value: (c.items || ['Üst zaman dilimini incele', 'Likidite ve killzone kontrolü', 'Risk ve stop mesafesini doğrula']).join('\n') });
    body.append(h('label', {}, 'Her satıra bir kontrol maddesi', items));
  }
  modal({ title: 'Widget ayarları', body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', kind: 'primary', onClick: () => {
    const patch = { title: title.value.trim() || fallback, color: color.value };
    if (items) { patch.items = items.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20); patch.checked = []; }
    save(id, patch); done();
  } }] });
}

export function extraWidget(id, settings) {
  const spec = EXTRA_WIDGETS.find(w => w[0] === id), c = config(id);
  const root = h('section.extra-widget.glass', { style: { '--widget-accent': c.color || 'var(--accent)' } });
  const body = h('div.extra-widget-body');
  root.append(h('div.sec-head', {}, h('h3', {}, h('i.widget-mark'), c.title || spec[1]), h('button.btn.small.ghost.widget-gear', { title: 'Widget ayarları', 'aria-label': 'Widget ayarları', onclick: () => root.dispatchEvent(new CustomEvent('widget-config', { bubbles: true, detail: id })) }, icon('sliders', 15))), body);
  if (id === 'notes') {
    body.append(h('textarea.widget-note', { rows: 5, maxlength: 12000, placeholder: 'Bugünün planı, önemli seviyeler, öğrendiklerin…', 'aria-label': 'İşlem notları', value: c.text || '', oninput: e => save(id, { text: e.target.value }) }), h('small.muted', {}, 'Yazdıkların profiline otomatik kaydedilir.'));
  } else if (id === 'checklist') {
    const items = c.items || ['Üst zaman dilimini incele', 'Likidite ve killzone kontrolü', 'Risk ve stop mesafesini doğrula'];
    const checked = new Set(c.checked || []), progress = h('span.muted');
    const paint = () => { progress.textContent = `${checked.size} / ${items.length} tamamlandı`; };
    items.forEach((label,i) => body.append(h('label.widget-check', {}, h('input', { type: 'checkbox', checked: checked.has(i), onchange: e => { e.target.checked ? checked.add(i) : checked.delete(i); save(id, { checked: [...checked] }); paint(); } }), h('span', {}, label))));
    paint(); body.append(h('div.widget-foot', {}, progress, h('button.btn.small', { onclick: () => { save(id,{checked:[]}); root.dispatchEvent(new CustomEvent('widget-refresh', {bubbles:true})); } }, 'Sıfırla')));
  } else if (id === 'clocks') {
    body.append(...clocksBody());
  } else if (id === 'risk') {
    const balance = h('input.ctl', { type:'number', min: .01, step:'any', value:c.balance ?? settings.account?.balance ?? 10000 });
    const percent = h('input.ctl', { type:'number', min:0, max:100, step:.1, value:c.percent ?? 1 });
    const result = h('strong.widget-value');
    const update = () => {
      const amount = balance.value === '' || percent.value === '' ? null : riskBudget(Number(balance.value),Number(percent.value));
      result.textContent = amount == null ? 'Geçerli değer gir' : F.money(amount, settings.account?.currency || 'USD');
      if (amount != null) save(id,{balance:Number(balance.value),percent:Number(percent.value)});
    };
    balance.addEventListener('input',update); percent.addEventListener('input',update); update();
    body.append(h('div.row2', {}, h('label.widget-field', {}, 'Bakiye', balance), h('label.widget-field', {}, 'Risk (%)', percent)), result, h('small.muted', {}, 'İşlem başına risk bütçesi · lot hesabı değildir.'));
  } else if (id === 'goal') {
    const goal = h('input.ctl', { type:'number', min:1, max:10000, step:1, value:c.target || 10 });
    const value = h('strong.widget-value'), progress = h('progress', { max:c.target || 10, value:c.done || 0 });
    let done = Math.max(0,c.done || 0);
    const update = () => { const target = Number(goal.value); if (!Number.isInteger(target) || target < 1 || target > 10000) return; done = Math.min(done,target); save(id,{target,done}); value.textContent = `${done} / ${target}`; progress.max=target; progress.value=done; };
    goal.addEventListener('change',update); update();
    body.append(h('label.widget-field', {}, 'Hedef oturum sayısı',goal),value,progress,h('div.widget-foot',{},h('button.btn.small.outline',{onclick:()=>{done=Math.max(0,done-1);update();}},'− 1'),h('button.btn.small.primary',{onclick:()=>{done++;update();}},'+ 1 tamamlandı'),h('button.btn.small',{onclick:()=>{done=0;update();}},'Sıfırla')));
  } else if (id === 'killzones') {
    body.append(...killzonesBody());
  }
  return root;
}
