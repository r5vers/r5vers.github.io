// Profile screen: pick who is trading, add / edit / lock profiles.
import { api } from './api.js?v=64b6fa7342';
import { LOCAL } from './local/boot.js?v=64b6fa7342';
import { pushExport } from './local/sync.js?v=64b6fa7342';

const NEW_SITE = 'https://r5vers.github.io';
import { AVATAR_PATTERNS, avatar as avatarEl, brandMark, confirmBox, field, h, icon, modal, toast } from './ui/dom.js?v=64b6fa7342';
import { BACKGROUNDS, DEFAULT_APPEARANCE, PRESETS, applyAppearance } from './ui/look.js?v=64b6fa7342';

const COLORS = [
  '#8b7cf6', '#5e5ce6', '#4f8fd9', '#0a84ff', '#40c8e0', '#3fb39b', '#30d158', '#8fae5a', '#c6ff3d', '#d9a441',
  '#ff9f0a', '#d9734e', '#ff453a', '#e07a8b', '#ff2bd6', '#b06bc4', '#bf5af2', '#c9a27a', '#5f6b7a', '#2c2c2e',
];

/** A square, small JPEG from any picked image (centre crop). */
async function squarePhoto(file, size = 320) {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  img.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('görsel işlenemedi'))), 'image/jpeg', 0.88));
}

let state = { profiles: [], current: null, max: 8 };
let cloud = null;                                 // the group's cloud on this device (no-server mode)
let managing = false;

// The background of this screen (and the password page) is chosen per
// device, Bulutsu unless changed; the accent and glows follow its theme.
const GATE_KEY = 'rt-gate-bg';
function gateBg() {
  try { const id = localStorage.getItem(GATE_KEY); if (BACKGROUNDS[id] && id !== 'custom') return id; } catch { /* private mode */ }
  return 'nebula';
}
function gateLook(bg) {
  const preset = PRESETS.find((p) => p.bg === bg) || PRESETS.find((p) => p.id === 'carbon');
  return { accent: preset.accent, up: preset.up, down: preset.down };
}
function setGateBg(bg) {
  try {
    localStorage.setItem(GATE_KEY, bg);
    // the password page has no scripts of its own to work this out
    localStorage.setItem('rt-gate-look', JSON.stringify({ css: BACKGROUNDS[bg].css, light: !!BACKGROUNDS[bg].light, ...gateLook(bg) }));
  } catch { /* private mode */ }
  paint();
}

// the look of whoever used this browser last, else the default, on the
// background picked for this device
function paint() {
  let look = null;
  try { look = JSON.parse(localStorage.getItem('rt-last-look') || 'null'); } catch { look = null; }
  const bg = gateBg();
  applyAppearance({ ...(look || DEFAULT_APPEARANCE), design: 'studio', bg, ...gateLook(bg) });
  document.getElementById('brand-tile').replaceChildren(brandMark(96));
}

async function load() {
  if (LOCAL) {
    // the latest from the other devices before the list is drawn (briefly:
    // offline the device's own copy shows)
    try { cloud = await api.cloudStatus(); } catch { cloud = null; }
    if (cloud?.linked) {
      try { cloud = await Promise.race([api.cloudSync(), new Promise((r) => setTimeout(() => r(cloud), 6000))]); } catch (err) { cloud = { ...cloud, error: err.message }; }
    }
  }
  state = await api.profiles();
  render();
  if (!state.profiles.length && (!LOCAL || cloud?.linked)) editDialog(null);
}

function render() {
  const grid = document.getElementById('grid');
  document.getElementById('title').textContent = managing ? 'Profilleri yönet' : 'Kim çalışıyor?';
  document.getElementById('lead').textContent = managing
    ? 'Düzenlemek istediğin profile dokun: ad, renk, desen ya da PIN.'
    : 'Her profilin kendi replay oturumları, backtestleri, çizimleri ve görünümü var. Piyasa verisi herkes için ortak.';
  const btn = document.getElementById('manage');
  btn.replaceChildren(managing ? icon('check', 15) : icon('edit', 15), managing ? 'Bitti' : 'Profilleri yönet');
  btn.classList.toggle('primary', managing);
  btn.classList.toggle('outline', !managing);
  document.getElementById('gate-bg').style.display = managing ? '' : 'none';
  const tiles = state.profiles.map((p) => h(`button.profile-tile${managing ? '.managing' : ''}`, {
    type: 'button', 'aria-label': managing ? `${p.name} profilini düzenle` : `${p.name} olarak gir`, onclick: () => (managing ? editDialog(p) : choose(p)),
  }, avatarEl(p), h('span.profile-name', {}, p.name), managing ? h('span.edit-badge', {}, icon('edit', 18)) : null));
  if (state.profiles.length < state.max) {
    tiles.push(h('button.profile-tile.add', { type: 'button', onclick: () => editDialog(null) },
      h('span.avatar.lg.plus', {}, icon('plus', 34)), h('span.profile-name', {}, 'Profil ekle')));
  }
  grid.replaceChildren(...tiles);
  btn.classList.toggle('hidden', !state.profiles.length);
  renderCloud();
}

/** The cloud on the profile screen. Without a server: join the group once
 *  per device (then every profile, look and session is the same on all of
 *  them). On the server site: move everything to the new site. */
function renderCloud() {
  let zone = document.getElementById('cloud-zone');
  if (!zone) {
    zone = h('section.cloud-zone', { id: 'cloud-zone' });
    document.querySelector('.profile-actions').before(zone);
  }
  if (!LOCAL) {
    zone.replaceChildren(
      h('div.cloud-head', {}, h('span.cloud-title', {}, icon('cloud', 16), 'Yeni site'),
        h('button.btn.small', { type: 'button', onclick: moveDialog }, icon('cloud', 14), 'Yeni siteye taşı')),
      h('p.muted.cloud-lead', {}, 'Bütün profilleri, temaları, çizimleri, replay oturumlarını ve stratejileri buluta aktarır; ', h('b', {}, NEW_SITE.replace('https://', '')), ' her cihazda aynısını açar.'));
    return;
  }
  if (cloud?.linked) {
    const when = cloud.last_sync ? new Date(cloud.last_sync).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : 'henüz';
    zone.replaceChildren(...[
      h('div.cloud-head', {}, h('span.cloud-title', {}, icon('cloud', 16), 'Bulut bağlı'),
        h('span.muted.cloud-when', {}, cloud.error ? `Eşitlenemedi: ${cloud.error}` : `son eşitleme ${when}`)),
    ]);
    zone.classList.add('slim');
    return;
  }
  zone.classList.remove('slim');
  const pass = h('input.ctl', { type: 'password', placeholder: 'Grup şifresi', autocomplete: 'current-password' });
  const join = async (create) => {
    if (create && !(await confirmBox('Grubu kur', 'Bu şifreyle yeni bir bulut grubu kurulur; bu cihazdaki profiller oraya yüklenir. Railway sitesinden “Yeni siteye taşı” yaptıysan kurma, sadece “Bağlan”.', 'Kur'))) return;
    try {
      await api.cloudConnect(pass.value, create);
      toast('Bulut bağlı: profiller ve ayarlar bu cihazda', 'ok', 5000);
      await load();
    } catch (err) { toast(err.message, 'err', 6000); pass.select(); }
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(false); });
  zone.replaceChildren(
    h('div.cloud-head', {}, h('span.cloud-title', {}, icon('cloud', 16), 'Buluta bağlan')),
    h('p.muted.cloud-lead', {}, 'Bu cihazda bir kez grup şifresini gir: bütün profiller, temalar, grafik düzenleri, replay oturumları ve stratejiler gelir ve her cihazda aynı kalır. Mum verisi her cihaza ayrıca iner.'),
    h('div.cloud-link', {}, pass, h('button.btn.small.primary', { type: 'button', onclick: () => join(false) }, 'Bağlan')),
    h('div.cloud-links', {},
      h('button.link-btn', { type: 'button', onclick: rescueDialog }, 'Eski siteden (Railway) taşı'),
      h('button.link-btn', { type: 'button', onclick: () => join(true) }, 'İlk kez mi? Bu şifreyle grubu kur')));
}

/** The old server site cannot be updated: its own page runs the move
 *  (js/migrate.js) when this line is pasted into its browser console. */
function rescueDialog() {
  const line = `import('${location.origin}/js/migrate.js')`;
  const copy = h('button.btn.small', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(line); toast('Kopyalandı', 'ok'); } catch { toast('Kopyalanamadı: satırı elle seç', 'err'); }
  } }, 'Kopyala');
  const step = (n, ...kids) => h('li', {}, h('b', {}, `${n}. `), ...kids);
  modal({
    title: 'Eski siteden taşı',
    body: h('div.rescue', {},
      h('p.muted', { style: { margin: 0 } }, 'Railway\'deki profiller, PIN\'ler, temalar, grafik düzenleri, çizimler, replay oturumları ve stratejiler buluta aktarılır. En kolayı bilgisayarda Chrome ya da Edge ile:'),
      h('ol', {},
        step(1, 'Eski siteyi (Railway adresi) aç ve şifreyle giriş yap.'),
        step(2, h('kbd', {}, 'F12'), ' tuşuna bas → üstte ', h('b', {}, 'Console'), ' sekmesi.'),
        step(3, 'Şu satırı yapıştır ve Enter\'a bas:', h('div.rescue-line', {}, h('code', {}, line), copy),
          h('span.muted', {}, 'Chrome yapıştırmaya izin vermezse önce ', h('code', {}, 'allow pasting'), ' yaz, Enter, sonra tekrar yapıştır.')),
        step(4, 'Açılan pencerede grup şifresini belirle (kilitli profiller için PIN sorulur). Bitince her cihazda bu siteyi açıp o şifreyle “Bağlan”.'))),
    actions: [{ label: 'Tamam', kind: 'primary' }],
  });
}

/** Server site: everything goes to the group's cloud, for the new site. */
function moveDialog() {
  const pass = h('input.ctl', { type: 'password', placeholder: 'Grup şifresi (en az 6 karakter)', autocomplete: 'new-password' });
  const again = h('input.ctl', { type: 'password', placeholder: 'Şifre tekrar', autocomplete: 'new-password' });
  modal({
    title: 'Yeni siteye taşı',
    body: h('div.profile-form', {},
      h('p.muted', { style: { margin: 0 } }, 'Bu sitedeki her şey (profiller ve PIN\'leri, fotoğraflar, temalar, grafik düzenleri, çizimler, replay oturumları, test geçmişi, stratejiler) buluta aktarılır. Bu site olduğu gibi kalır.'),
      field('Grup şifresi', pass, 'Yeni sitede her cihazda bir kez bu şifreyle bağlanacaksın'),
      field('Şifre tekrar', again),
      h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'İkinci kez taşırsan buluttaki kopyanın üstüne bu sitedeki hali yazılır.')),
    actions: [
      { label: 'Vazgeç' },
      { label: 'Taşı', kind: 'primary', onClick: async () => {
        if (pass.value.length < 6) { toast('Şifre en az 6 karakter olmalı', 'err'); return false; }
        if (pass.value !== again.value) { toast('Şifreler aynı değil', 'err'); return false; }
        try {
          const exp = await (await fetch('/api/export')).json();
          const res = await pushExport(exp, pass.value);
          modal({
            title: 'Taşındı',
            body: h('div', {}, h('p', {}, `${res.profiles} profil ve ${res.items} kayıt bulutta.`),
              h('p', {}, 'Şimdi her cihazda ', h('a', { href: NEW_SITE, target: '_blank', rel: 'noopener' }, NEW_SITE.replace('https://', '')), ' adresini aç ve bu şifreyle “Bağlan”.')),
            actions: [{ label: 'Tamam', kind: 'primary' }],
          });
        } catch (err) { toast(`Taşınamadı: ${err.message}`, 'err', 8000); return false; }
        return true;
      } },
    ],
  });
  pass.focus();
}

function pinInput(placeholder = 'PIN') {
  return h('input.ctl.pin', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, placeholder, pattern: '[0-9]*' });
}

async function choose(p, pin) {
  if (p.locked && pin == null) { pinDialog(p); return; }
  await api.selectProfile(p.id, pin || null);
  window.location.replace('/home.html');
}

function pinDialog(p) {
  const input = pinInput('4-8 haneli PIN');
  const dlg = modal({
    title: p.name,
    body: h('div.pin-box', {}, avatarEl(p, 'md'), field('Bu profil PIN ile kilitli', input)),
    actions: [
      { label: 'Vazgeç' },
      { label: 'Gir', kind: 'primary', onClick: async () => {
        try { await choose(p, input.value); } catch (err) { toast(err.message, 'err'); input.value = ''; input.focus(); return false; }
        return true;
      } },
    ],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.el.querySelector('footer .primary')?.click(); });
}

function editDialog(p) {
  const isNew = !p;
  const draft = { name: p?.name || '', color: p?.color || COLORS[state.profiles.length % COLORS.length], avatar: AVATAR_PATTERNS[p?.avatar] !== undefined ? p.avatar : (isNew ? 'p:orb' : ''), photo: p?.photo || null };
  let photoBlob = null;
  let removePhoto = false;
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      photoBlob = await squarePhoto(f);
      removePhoto = false;
      if (draft.photo?.startsWith('blob:')) URL.revokeObjectURL(draft.photo);
      draft.photo = URL.createObjectURL(photoBlob);
      preview(); paintPhoto();
    } catch (err) { toast(`Fotoğraf okunamadı: ${err.message}`, 'err'); }
  } });
  const photoRow = h('div.avatar-photo-row', {});
  const paintPhoto = () => photoRow.replaceChildren(...[fileInput,
    h('button.btn.small.outline', { type: 'button', onclick: () => fileInput.click() }, icon('plus', 14), draft.photo ? 'Fotoğrafı değiştir' : 'Fotoğraf yükle'),
    draft.photo ? h('button.btn.small.outline.danger', { type: 'button', onclick: () => { photoBlob = null; removePhoto = !!p?.photo; draft.photo = null; preview(); paintPhoto(); } }, 'Kaldır') : null,
    h('span.muted', { style: { fontSize: '11.5px' } }, 'Kare kırpılır; renk ve desen yerine görünür.')].filter(Boolean));
  paintPhoto();
  const name = h('input.ctl', { value: draft.name, maxlength: 24, placeholder: 'ör. Kerem', oninput: (e) => { draft.name = e.target.value; preview(); paintPatterns(); } });
  const prev = h('div.avatar-preview', {});
  const preview = () => prev.replaceChildren(avatarEl({ ...draft, name: draft.name || '?', locked: false }, 'md'));
  const colors = h('div.swatch-row', {});
  const patterns = h('div.pattern-row', {});
  const paintColors = () => colors.replaceChildren(...COLORS.map((c) => h(`button.swatch.round${draft.color === c ? '.on' : ''}`, {
    type: 'button', title: c, 'aria-label': `Renk ${c}`, style: { background: c }, onclick: () => { draft.color = c; paintColors(); paintPatterns(); preview(); },
  })));
  const paintPatterns = () => patterns.replaceChildren(...Object.entries(AVATAR_PATTERNS).map(([id, label]) => h(`button.pattern-pick${draft.avatar === id ? '.on' : ''}`, {
    type: 'button', title: label, onclick: () => { draft.avatar = id; paintPatterns(); preview(); },
  }, avatarEl({ name: draft.name || 'A', color: draft.color, avatar: id, locked: false }, 'md'), h('span.lbl', {}, label))));
  paintColors();
  paintPatterns();
  preview();
  const pin = pinInput(p?.locked ? 'Yeni PIN (boş bırakırsan değişmez)' : 'İsteğe bağlı');
  const clear = h('input', { type: 'checkbox' });
  const current = pinInput('Mevcut PIN');
  const needsCurrent = p?.locked && state.current !== p.id;
  const actions = [{ label: 'Vazgeç' }];
  if (!isNew) {
    actions.unshift({ label: 'Profili sil', kind: 'danger', onClick: async () => {
      if (!(await confirmBox('Profili sil', `“${p.name}” ve bu profilin tüm replay oturumları ile stratejileri silinsin mi? Bu geri alınamaz.`, 'Sil', 'danger'))) return false;
      await api.deleteProfile(p.id, needsCurrent ? current.value : undefined);
      toast('Profil silindi', 'ok');
      await load();
      return true;
    } });
  }
  actions.push({ label: isNew ? 'Oluştur' : 'Kaydet', kind: 'primary', onClick: async () => {
    if (!draft.name.trim()) { toast('Bir ad yaz', 'err'); return false; }
    const fields = { name: draft.name, color: draft.color, avatar: draft.avatar };
    const savePhoto = async (id, code) => {
      try {
        if (photoBlob) await api.setPhoto(id, photoBlob, code || undefined);
        else if (removePhoto) await api.deletePhoto(id, code || undefined);
      } catch (err) { toast(`Fotoğraf kaydedilemedi: ${err.message}`, 'err'); }
    };
    if (isNew) {
      const created = await api.createProfile({ ...fields, pin: pin.value || null });
      await savePhoto(created.id, pin.value);
      toast(`${created.name} hazır`, 'ok');
      if (!state.profiles.length) { await choose(created, pin.value || undefined); return true; }
    } else {
      await api.updateProfile(p.id, { ...fields, pin: pin.value || null, clear_pin: clear.checked, current_pin: needsCurrent ? current.value : null });
      // a new PIN takes effect at once: the photo goes up with the PIN that now holds
      await savePhoto(p.id, pin.value || (needsCurrent ? current.value : null));
      toast('Kaydedildi', 'ok');
    }
    await load();
    return true;
  } });
  modal({
    title: isNew ? (state.profiles.length ? 'Profil ekle' : 'İlk profilini oluştur') : 'Profili düzenle',
    body: h('div.profile-form', {},
      prev,
      field('Ad', name),
      field('Renk', colors),
      field('Profil fotoğrafı', photoRow),
      field('Desen', patterns),
      h('div.row2', {}, field(p?.locked ? 'PIN değiştir' : 'PIN kilidi', pin, 'Başkaları bu profile giremesin (4-8 rakam)'),
        p?.locked ? h('label.check', { style: { alignSelf: 'center' } }, clear, 'PIN kilidini kaldır') : h('span')),
      needsCurrent ? field('Bu profil kilitli: değişiklik için mevcut PIN', current) : null),
    actions,
  });
}

paint();
document.getElementById('manage').addEventListener('click', () => { managing = !managing; render(); });
document.getElementById('gate-bg').addEventListener('click', backgroundDialog);

/** Pick this screen's background; it is kept on this device only. */
function backgroundDialog() {
  const grid = h('div.bg-grid');
  const fill = () => grid.replaceChildren(...Object.entries(BACKGROUNDS).filter(([id]) => id !== 'custom').map(([id, b]) =>
    h(`button.bg-tile${id === gateBg() ? '.on' : ''}`, { type: 'button', onclick: () => { setGateBg(id); fill(); } },
      h('span.bg-prev', { style: { background: b.css } }), h('span.bg-name', {}, b.name))));
  fill();
  modal({ title: 'Arka plan', body: [h('p.muted', { style: { margin: '0 0 4px' } }, 'Bu ekranın ve şifre sayfasının arka planı. Sadece bu cihazda geçerli.'), grid], actions: [{ label: 'Tamam', kind: 'primary' }] });
}
load().catch((err) => toast(`Profiller yüklenemedi: ${err.message}`, 'err', 8000));
