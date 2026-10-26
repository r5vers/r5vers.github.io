'use strict';

const SNAPSHOT = Object.freeze({ date: '26 Ekim 2026', sourceCommit: 'ccc9d037ff160ebdd1833b3582ef84eac1d6f9e3', currentCI: 329 });
const SIMS = [
  { id: 'ODEN', name: 'Fırsat ve Volatilite', tag: 'RESEARCH', category: 'research', maturity: 55, color: '#b8d5c1', state: 'Discovery araştırması', scope: 'Piyasa fırsatını ve beklenen hareket büyüklüğünü inceler. Yön tahminini VIRA’dan devralmaz.', achieved: ['Donmuş Discovery araştırma hattı ve LightGBM-A soyuna ait kanıtlar mevcut.', 'ODEN uzmanlık alanı ve veri sınırları tanımlandı.'], missing: ['Araştırma dışı performans ve bağımsız kabul kapıları.', 'Üretim sinyaline bağlanmış model entegrasyonu.'], note: 'Eğitilmiş araştırma soyunun bulunması üretime kabul edildiği anlamına gelmez.' },
  { id: 'VIRA', name: 'Yapı ve Yön Zekâsı', tag: 'BLOCKED', category: 'research', maturity: 35, color: '#e2c59b', state: 'Sentetik araştırma', scope: 'Fraktal yapı, HTF bias ve likidite yönü kanıtlarını kendi bilimsel sözleşmesiyle üretir.', achieved: ['LightGBM proposal v2 ve sentetik nested runner geliştirildi.', '3F.9 araştırmasının sentetik incelemesinde koşullu mühendislik kabulü mevcut.'], missing: ['F9-01 kimlik/fit sınırı düzeltmesi ve yeni audit.', 'Bağımsız immutable sağlayıcı kanıtı ve imzalı yürütme yetkisi.', 'Gerçek Discovery eğitimi için ayrıca izin.'], note: 'Gerçek VIRA eğitimi STOP; modelin bilimsel kabulü verilmedi.' },
  { id: 'KESH', name: 'Momentum ve Güç', tag: 'PROTOTYPE', category: 'engineering', maturity: 25, color: '#a9c6d8', state: 'Sentetik çekirdek', scope: 'Geçmiş penceredeki momentum, persistence, acceleration ve strength ölçümlerini tanımlar.', achieved: ['Tamamlanmış M5 verisine dayalı betimleyici çekirdeği.', 'Nedensellik ve hatalı fiyat testleri.'], missing: ['Bilimsel hedef/özellik/ölçüm sözleşmesi ve deney bütçesi.', 'Eğitilmiş, bağımsız KESH modeli.'], note: 'Bu bir momentum betimleyicisidir; olasılık tahmini veya öğrenilmiş KESH modeli değildir.' },
  { id: 'NOLU', name: 'Risk ve Güvenlik', tag: 'PROTOTYPE', category: 'engineering', maturity: 30, color: '#b5c8dc', state: 'Sentetik güvenlik kapısı', scope: 'TAMB planını değiştirip yeniden yazmadan risk limitlerini ve onaylı pozisyon büyüklüğünü denetler.', achieved: ['TAMB planının hash’ine bağlı deterministik paper risk incelemesi.', 'Lot/birim, spread, kayma, günlük kayıp ve drawdown sentetik testleri.'], missing: ['Gerçek broker/fon kuralları için doğrulanmış risk profili.', 'NOLU yetkisinin kaynak doğrulaması ve Claude PR #3 incelemesi.'], note: 'Örnek paper limitleri gerçek prop-firm kuralları değildir.' },
  { id: 'TAMB', name: 'Plan ve Simülasyon', tag: 'PROTOTYPE', category: 'engineering', maturity: 30, color: '#a6c2cc', state: 'Kanonik motor adaptörü', scope: 'Dondurulmuş işlem planını taşır ve mevcut mylo/outcomes.py motorunda paper yürütmeyi temsil eder.', achieved: ['Çift/uyumsuz simülasyon motoru kaldırıldı.', 'Kanonik BID/ASK, boşluk ve intrabar belirsizliği kullanan adaptör mevcut.', 'Sentetik uçtan uca paper senaryosu doğrulandı.'], missing: ['Gerçek piyasaya göre kalibre edilmiş yürütme doğrulaması.', 'Bağımsız plan üretim zekâsı ve bilimsel görev sözleşmesi.'], note: 'Gerçek emir gönderme yetkisi veya broker bağlantısı bulunmuyor.' },
  { id: 'RYZO', name: 'Kanıt ve Hafıza', tag: 'PROTOTYPE', category: 'engineering', maturity: 20, color: '#b2c4d9', state: 'Bellek içi günlük', scope: 'Olayları nedensel olarak kaydeder, as-of okuma ve SHA tabanlı yerel bütünlük sağlar.', achieved: ['Sentetik olay zinciri ve deterministik iz.', 'Kanıt kopyalama, as-of filtre ve bütünlük testleri.'], missing: ['Kalıcı, yedekli olay depolama ve onaylı sözleşmeler.', 'Harici değiştirilemez kanıt ve episodik öğrenme.'], note: 'Şu anki SHA zinciri WORM veya kalıcı denetim sistemi değildir.' },
  { id: 'MYLO', name: 'Karar ve Orkestrasyon', tag: 'PROTOTYPE', category: 'engineering', maturity: 30, color: '#b8d3c7', state: 'Sentetik entegrasyon', scope: 'Uzman kanıtlarını tipli sözleşmeyle sentezler, NOLU’yu aşmadan insan onayına sunar.', achieved: ['Sekiz SIM rolüyle çalışan sentetik dikey dilim.', 'Zaman damgası, kanıt bütünlüğü ve izin sınırları.', 'NEO advisory ile NOLU güvenlik vetosu ayrımı.'], missing: ['Gerçek uzman modellerine sürümlü adaptörler.', 'Çelişki çözüm kuralı ve bağımsız bilimsel değerlendirme.', 'Ana PR #2 ve yardımcı PR’lar için kapanış/merge kararı.'], note: 'Bu üretime alınmış AI karar motoru değil, sentetik orkestrasyon prototipidir.' },
  { id: 'NEO', name: 'Zamansal Olay Zekâsı', tag: 'CONCEPT', category: 'concept', maturity: 10, color: '#c8b9dc', state: 'Founder onaylı konsept', scope: 'Olay sırası, çoklu zaman dilimi ve yapı uyuşmazlığını advisory düzeyinde değerlendirecek uzmanlık.', achieved: ['Sekizinci SIM konsepti ve advisory sınırı onaylandı.', 'Sentetik akışta açıkça stub olarak işaretlendi.'], missing: ['Founder Design Review ve uygulama yetkisi.', 'Sürüm, olay şeması, hedef, değerlendirme ve araştırma bütçesi.'], note: 'VETO isimli tavsiye dahi NOLU sert vetosu değildir. Uygulama/eğitim izni yok.' },
];
const PRS = [
  { n: 1, code: 'VIRA / 3F.9', owner: 'Claude', desc: 'Bilimsel proposal ve sentetik koşucu', status: 'STOP / DRAFT', kind: 'danger', tests: 'Koşullu sentetik kabul', sha: '1c6c815', url: 'https://github.com/r5vers/mylo-labs/pull/1' },
  { n: 2, code: '8-SIM INTEGRATION', owner: 'Claude + Lex', desc: 'MYLO sentetik orkestrasyonu', status: 'DRAFT', kind: 'neutral', tests: '304 PASS', sha: '19f524b', url: 'https://github.com/r5vers/mylo-labs/pull/2' },
  { n: 3, code: 'RAIL HARDENING', owner: 'Lex', desc: 'NOLU / NEO sınır kontrolleri', status: 'DRAFT', kind: 'neutral', tests: '323 PASS', sha: '370f00a', url: 'https://github.com/r5vers/mylo-labs/pull/3' },
  { n: 4, code: 'AGENT PILOT', owner: 'Lex', desc: 'Claude – Codex – Work devir protokolü', status: 'PILOT / DRAFT', kind: 'warning', tests: '329 PASS', sha: '72acc18', url: 'https://github.com/r5vers/mylo-labs/pull/4' },
];
const MILESTONES = [
  { title: 'Veri sınırını güvene al', summary: 'Discovery erişimi, yıllık mühür ve güvenli test politikası.', tag: 'FOUNDER KARARI', code: '01' },
  { title: 'Yardımcı PR’ları denetle', summary: 'Claude PR #3 ve #4’ü bağımsız inceleyecek; merge yetkisi yok.', tag: 'CODE REVIEW', code: '02' },
  { title: 'Gerçek Codex pilotunu çalıştır', summary: 'Kota açılınca izole sentetik test + manifest + Claude incelemesi.', tag: 'PİLOT BEKLİYOR', code: '03' },
];
const ROADMAP = [
  { id: '01', title: 'Temel mimari ve Founder yönetişimi', done: true, text: 'SIM sahipliği, sekizli mimari, NEO’nun konsept sınırı, araştırma/merge yetki modeli, kaynak ve mühür ilkeleri kayıtlı.', tags: ['KAVRAM ONAYLI', 'AYRI YETKİ KAPILARI'] },
  { id: '02', title: 'Sentetik dikey entegrasyon', done: true, text: 'MYLO kanıt sözleşmeleri, NOLU paper riski, TAMB/outcomes adaptörü, RYZO journal ve uçtan uca test senaryosu çalışıyor. Kod hâlâ taslak PR’larda.', tags: ['SENTETİK TESTLİ', 'MERGE YOK'] },
  { id: '03', title: 'Mühendislik ve mühür kabulünü tamamla', now: true, text: 'VIRA F9-01 / kanıt sağlayıcı engelleri; gerçek veri erişim politikası; PR #3/#4 için bağımsız inceleme ve üçlü iş bölümü pilotu.', tags: ['ŞİMDİKİ AŞAMA', 'BLOCKED GATES'] },
  { id: '04', title: 'Her SIM’in bilimsel çekirdeğini geliştir', text: 'KESH, NOLU, TAMB, RYZO ve MYLO öğrenme alanları için ayrı hedef, özellik, metrik ve araştırma bütçeleri; NEO için ek Founder yetkisi.', tags: ['YENİ SÖZLEŞMELER', 'İZİN GEREKİR'] },
  { id: '05', title: 'Discovery ve bağımsız doğrulama', text: 'İzinli gerçek deneyler, nedensellik, aşırı uyum ve maliyet testleri, tekrarlanabilir deney kanıtı; holdout erişimi ayrı kapı.', tags: ['BİLİMSEL KABUL', 'HENÜZ AÇILMADI'] },
  { id: '06', title: 'İnsan onaylı sinyal pilotu', text: 'Bağımsız güvenlik ve bütünleşik sinyal değerlendirmesi sonrası insan kontrollü pilot. Gerçek emir / otomasyon için ayrıca kapsam kararı.', tags: ['ÜRÜN KAPISI', 'CANLI YETKİ YOK'] },
];
const TASKS = [
  { id: 'GOV-01', title: 'XM veri erişim sınırının kararı', type: 'decision', urgency: 'high', owner: 'FOUNDER + LEX', text: 'Unfiltered xm_m1 yüklemesini Discovery-only fixture’dan ayırma ve mühürlü yıl bütünlüğünün yetkili kayıt işlemini belirleme.' },
  { id: 'ARCH-02', title: 'Kanonik plan / veto / sentez sırasını uzlaştır', type: 'decision', urgency: 'high', owner: 'FOUNDER + LEX', text: 'K-054/K-055 ayrıntılı TAMB planı → NOLU → MYLO sırasıyla N2 yüksek seviye çizimini metinsel olarak uyumlu kıl.' },
  { id: 'VIRA-03', title: '3F.9 son kabul kapısını kapat', type: 'engineering', urgency: 'high', owner: 'CLAUDE + LEX', text: 'F9-01 kimlik alias, fit rezervasyonu, bağımsız immutable receipt, imzalı yetki ve güvenli çalışma ortamı olmadan gerçek fit yok.' },
  { id: 'REV-04', title: 'Lex PR #3 kodunu Claude’a incelet', type: 'engineering', urgency: 'medium', owner: 'CLAUDE', text: 'NEO advisory istisnaları, hatalı NOLU onayları ve mevcut sözleşme uyumunu gerçek diff ile doğrula.' },
  { id: 'CODEX-05', title: 'Kaydedilen Codex pilotunu başlat', type: 'engineering', urgency: 'medium', owner: 'CODEX + CLAUDE', text: 'Kota açıldığında izole dalda gerçekten eksik tek sentetik NOLU–TAMB regresyonu; görev manifesti, Claude review ve Lex audit.' },
  { id: 'PR-06', title: 'PR #2 / #3 / #4 birleşim incelemesi', type: 'decision', urgency: 'medium', owner: 'FOUNDER', text: 'Bağımsız teknik denetimden sonra ayrı merge kararı ver. İki yardımcı PR kardeş daldır, uyum doğrulanmalı.' },
  { id: 'NEO-07', title: 'NEO uygulama yetkisini tasarla', type: 'decision', urgency: 'low', owner: 'FOUNDER', text: 'Mevcut NEO yalnız konsepttir. Gerçek olay zekâsı / learned head için ayrı Founder Design Review ve bilimsel sözleşme gerekli.' },
];
const SCORES = SIMS.reduce((n, s) => n + s.maturity, 0);
const SCORE = Math.round(SCORES / SIMS.length);
const ICONS = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  route:'<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a5 5 0 0 0 5-5V7M5 17V9a4 4 0 0 1 4-4h7"/>',
  code:'<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-5-13-4 18"/>',
  checklist:'<path d="m4 7 2 2 3-3m3 2h8M4 17l2 2 3-3m3 2h8"/>',
  book:'<path d="M4 19V5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1-2-2Zm0 0a2 2 0 0 1 2-2h14"/>',
  external:'<path d="M13 5h6v6m0-6-9 9"/><path d="M19 13v6H5V5h6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  arrow:'<path d="M4 12h16m-7-7 7 7-7 7"/>',
  shield:'<path d="m12 3 8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7l8-4Z"/><path d="m9 12 2 2 4-4"/>',
  branch:'<circle cx="6" cy="4" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12m0-8h8a4 4 0 0 0 4-3"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  activity:'<path d="M3 12h4l3-6 4 12 3-6h4"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit:'<path d="m15 5 4 4m-14 8 1-5L17 3a2.12 2.12 0 0 1 3 3L9 18l-5 1Z"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/>',
  close:'<path d="M5 5 19 19M19 5 5 19"/>',
};
function icon(name) { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" aria-hidden="true">${ICONS[name]||ICONS.info}</svg>`; }
function decorateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML=icon(el.dataset.icon); }); }
function maturityRow(sim) {
  return `<button type="button" class="maturity-item" data-sim="${sim.id}" aria-label="${sim.id} detayını aç"><span class="maturity-code">${sim.id}</span><span class="maturity-track"><span class="maturity-fill" style="display:block;width:${sim.maturity}%;background:${sim.color}"></span></span><span class="maturity-val">${sim.maturity}%</span></button>`;
}
function setupOverview() {
 document.getElementById('heroScore').textContent = SCORE;
 const circle=document.getElementById('progressCircle');circle.setAttribute('stroke-dashoffset', String(2*Math.PI*91*(1-SCORES/SIMS.length/100)));
 document.getElementById('homeMaturity').innerHTML=SIMS.map(maturityRow).join('');
 document.getElementById('homeMilestones').innerHTML=MILESTONES.map(m=>`<article class="soft-panel milestone"><span class="milestone-number">${m.code} / CRITICAL GATE</span><h3>${m.title}</h3><p>${m.summary}</p><div class="milestone-bottom">${m.tag}</div></article>`).join('');
}
function setupSystems() {
 const root=document.getElementById('systemsGrid');
 function render(filter='all') {
  const subset=SIMS.filter(s=>filter==='all'||s.category===filter);
  root.innerHTML=subset.map(s=>`<button type="button" class="soft-panel system-card" data-sim="${s.id}" style="--tint:${s.color}"><div class="system-top"><span class="system-icon">${s.id}</span><span class="status-label">${s.tag}</span></div><strong class="system-title">${s.name}</strong><p class="system-desc">${s.scope}</p><div class="system-progress"><div class="system-progress-top"><span>Olgunluk tahmini</span><b>${s.maturity}%</b></div><div class="maturity-track"><div class="maturity-fill" style="width:${s.maturity}%;background:${s.color}"></div></div></div><div class="system-bottom"><span>Ayrıntılı incele</span>${icon('arrow')}</div></button>`).join('');
 }
 render();
 document.getElementById('simFilters').addEventListener('click',e=>{
  const b=e.target.closest('[data-filter]');if(!b)return;
  document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render(b.dataset.filter);
 });
}
function setupRoadmap() {
 document.getElementById('roadmapTrack').innerHTML=ROADMAP.map(r=>`<article class="road-node"><div class="road-count ${r.done?'done':r.now?'now':''}">${r.done?icon('check'):r.id}</div><div class="road-body"><h3>${r.id} / ${r.title}</h3><p>${r.text}</p><div class="road-tags">${r.tags.map((t,i)=>`<span class="tag ${r.done&&i===0?'success':r.now?'warning':'neutral'}">${t}</span>`).join('')}</div></div></article>`).join('');
}
function setupEngineering() {
 document.getElementById('prRows').innerHTML=PRS.map(p=>`<tr><td><a href="${p.url}" target="_blank" rel="noreferrer"><strong>PR #${p.n}</strong></a><small>${p.sha}</small></td><td><strong>${p.code}</strong><small>${p.owner} · ${p.desc}</small></td><td>${p.tests}</td><td><span class="tag ${p.kind}">${p.status}</span></td><td><a href="${p.url}" target="_blank" rel="noreferrer" aria-label="PR ${p.n} aç">${icon('external')}</a></td></tr>`).join('');
}
function escapeText(s) {return s.replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
const DEVICE_KEY='mylo-workspace-v2';
function loadLocal() {try {return JSON.parse(localStorage.getItem(DEVICE_KEY)||'{}');}catch{return {};}}
function persist(state) {try{localStorage.setItem(DEVICE_KEY,JSON.stringify(state));return true;}catch{return false;}}
const local=loadLocal();if(typeof local.memo!=='string')local.memo='';if(!local.reviewed||typeof local.reviewed!=='object')local.reviewed={};
let taskFilter='all';let taskSearch='';
function setupTasks() {
 const input=document.getElementById('taskSearch');const root=document.getElementById('taskList');
 const render=()=>{
  const q=taskSearch.toLocaleLowerCase('tr'); const filtered=TASKS.filter(t=>(taskFilter==='all'||t.type===taskFilter)&&[t.id,t.title,t.owner,t.text].join(' ').toLocaleLowerCase('tr').includes(q));
  root.innerHTML=filtered.length?filtered.map(t=>`<article class="soft-panel task-item"><div class="task-header"><span>${t.id} · ${t.owner}</span><span class="tag ${t.urgency==='high'?'warning':'neutral'}">${t.urgency==='high'?'ÖNCELİKLİ':t.urgency==='medium'?'TAKİP':'PLANLI'}</span></div><h3>${t.title}</h3><p>${t.text}</p><div class="task-footer"><span>${t.type==='decision'?'FOUNDER KARARI':'MÜHENDİSLİK GÖREVİ'}</span><button type="button" data-mark="${t.id}" class="${local.reviewed[t.id]?'marked':''}">${local.reviewed[t.id]?'Takipte ✓':'Takibe al'}</button></div></article>`).join(''):'<div class="soft-panel panel-pad"><p>Bu filtreyle eşleşen görev bulunamadı.</p></div>';
 };
 document.getElementById('taskFilters').addEventListener('click',e=>{const b=e.target.closest('[data-task-filter]');if(!b)return;taskFilter=b.dataset.taskFilter;document.querySelectorAll('[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});
 input.addEventListener('input',()=>{taskSearch=input.value;render();});
 root.addEventListener('click',e=>{const b=e.target.closest('[data-mark]');if(!b)return;local.reviewed[b.dataset.mark]=!local.reviewed[b.dataset.mark];persist(local);render();toast('Yerel takip listesi güncellendi.');});
 const memo=document.getElementById('personalMemo');memo.value=local.memo;let saveTimeout;
 memo.addEventListener('input',()=>{local.memo=memo.value;const ok=persist(local);document.getElementById('memoStatus').textContent=ok?'Bu cihazda kaydedildi':'Kaydetme erişimi kapalı';});
 document.getElementById('exportMemo').addEventListener('click',()=>{
  const obj={exportedAt:new Date().toISOString(),snapshot:SNAPSHOT.date,memo:local.memo,followedTasks:Object.keys(local.reviewed).filter(x=>local.reviewed[x])};
  const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='mylo-notlarim.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Notlarını JSON olarak dışa aktardın.');
 });
 render();
}
function setupEvidence() {document.getElementById('methodBars').innerHTML=SIMS.map(s=>`<div class="method-item"><span>${s.id}</span><div class="maturity-track"><div class="maturity-fill" style="width:${s.maturity}%;background:${s.color}"></div></div><b>${s.maturity}%</b></div>`).join('');}
function showSim(id) {
 const s=SIMS.find(x=>x.id===id);if(!s)return;
 const dialog=document.getElementById('simDialog');
 document.getElementById('dialogContent').innerHTML=`<p class="dialog-code">SIM / ${s.id} · ${s.tag}</p><h2 class="dialog-title">${s.name}</h2><p class="dialog-lead">${s.scope}</p><div class="dialog-progress"><strong>${s.maturity}%</strong><div><p>Bu modüle verilen öznel mühendislik olgunluk puanı.</p><div class="maturity-track" style="margin-top:10px;width:190px"><div class="maturity-fill" style="width:${s.maturity}%;background:${s.color}"></div></div></div></div><section class="dialog-section"><h3>BUGÜN MEVCUT OLANLAR</h3><ul>${s.achieved.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="dialog-section"><h3>TAMAMLANMASI GEREKENLER</h3><ul>${s.missing.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="dialog-section"><h3>KABUL SINIRI</h3><p>${s.note}</p></section><div class="dialog-end">MYLO / SOURCE SNAPSHOT · 26.10.2026</div>`;
 if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600);}
const VIEWS={overview:'Overview',systems:'SIM Systems',roadmap:'Roadmap',engineering:'Engineering',decisions:'Decisions',evidence:'Evidence'};
function navigate(view,push=true){if(!VIEWS[view])view='overview';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('is-visible',v.id===`view-${view}`));document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('is-active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.getElementById('breadcrumbCurrent').textContent=VIEWS[view];if(push)history.replaceState(null,'',location.pathname+location.search+'#'+view);window.scrollTo({top:0,behavior:'instant'});}
function init(){decorateIcons();setupOverview();setupSystems();setupRoadmap();setupEngineering();setupTasks();setupEvidence();document.body.addEventListener('click',e=>{const nav=e.target.closest('[data-view],[data-nav]');if(nav){navigate(nav.dataset.view||nav.dataset.nav);return;}const sim=e.target.closest('[data-sim]');if(sim){showSim(sim.dataset.sim);return;}if(e.target.closest('[data-open-method]')){navigate('evidence');return;}});document.getElementById('closeDialog').addEventListener('click',()=>document.getElementById('simDialog').close());document.getElementById('simDialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close();});navigate(location.hash.slice(1)||'overview',false);}
init();
