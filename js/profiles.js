// Profile screen: pick who is trading, add / edit / lock profiles.
import { api } from './api.js';
import { LOCAL } from './local/boot.js';
import { AVATAR_PATTERNS, avatar as avatarEl, brandMark, confirmBox, field, h, icon, modal, toast } from './ui/dom.js';
import { BACKGROUNDS, DEFAULT_APPEARANCE, PRESETS, applyAppearance } from './ui/look.js';

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
let cloud = { cards: null, error: null };         // profiles in the cloud (no-server mode)
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
  state = await api.profiles();
  render();
  if (LOCAL) loadCloud();
  if (!state.profiles.length && !LOCAL) editDialog(null);
}

async function loadCloud() {
  try { cloud = { cards: (await api.cloudProfiles()).profiles, error: null }; } catch (err) { cloud = { cards: null, error: err.message }; }
  renderCloud();
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
  }, avatarEl(p), h('span.profile-name', {}, p.name, p.cloud ? h('span.cloud-mark', { title: 'Bulutta: diğer cihazlarla eşit' }, icon('cloud', 14)) : null),
  managing ? h('span.edit-badge', {}, icon('edit', 18)) : null));
  if (state.profiles.length < state.max) {
    tiles.push(h('button.profile-tile.add', { type: 'button', onclick: () => editDialog(null) },
      h('span.avatar.lg.plus', {}, icon('plus', 34)), h('span.profile-name', {}, 'Profil ekle')));
  }
  grid.replaceChildren(...tiles);
  btn.classList.toggle('hidden', !state.profiles.length);
  renderCloud();
}

/** Cloud profiles: bring one to this device with its name and password;
 *  friends' profiles that are not here yet are listed to pick from. */
function renderCloud() {
  if (!LOCAL) return;
  let zone = document.getElementById('cloud-zone');
  if (!zone) {
    zone = h('section.cloud-zone', { id: 'cloud-zone' });
    document.querySelector('.profile-actions').before(zone);
  }
  const elsewhere = (cloud.cards || []).filter((c) => c.local_id == null);
  zone.replaceChildren(...[
    h('div.cloud-head', {},
      h('span.cloud-title', {}, icon('cloud', 16), 'Bulut'),
      h('button.btn.small', { type: 'button', onclick: () => cloudLoginDialog() }, icon('download', 14), 'Buluttan profil indir')),
    h('p.muted.cloud-lead', {}, state.profiles.length || elsewhere.length
      ? 'Başka cihazda kullandığın profili adı ve şifresiyle buraya indir; sonra iki cihaz da hep aynı kalır.'
      : 'İlk kez mi? Yeni profil oluştur, ya da başka cihazdaki profilini adı ve şifresiyle indir.'),
    cloud.error ? h('p.muted.cloud-lead', {}, `Buluta ulaşılamadı: ${cloud.error}`) : null,
    elsewhere.length ? h('div.friend-row', {}, elsewhere.map((c) => h('button.friend', {
      type: 'button', title: `${c.name}: buraya indir`, onclick: () => cloudLoginDialog(c.name),
    }, avatarEl({ ...c, locked: false }, 'md'), h('span', {}, c.name)))) : null,
  ].filter(Boolean));
}

function cloudLoginDialog(name = '') {
  const nameIn = h('input.ctl', { value: name, maxlength: 24, placeholder: 'Profil adı', autocomplete: 'username' });
  const pass = h('input.ctl', { type: 'password', placeholder: 'Şifre', autocomplete: 'current-password' });
  const dlg = modal({
    title: 'Buluttan profil indir',
    body: h('div.profile-form', {},
      field('Profil adı', nameIn),
      field('Şifre', pass, 'Profili buluta yüklerken belirlediğin şifre'),
      h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'Ayarlar, temalar, çizimler, replay oturumları ve stratejiler gelir. Mum verisi her cihaza ayrıca iner (Veri sekmesi).')),
    actions: [
      { label: 'Vazgeç' },
      { label: 'İndir ve gir', kind: 'primary', onClick: async () => {
        try {
          const res = await api.cloudLogin(nameIn.value, pass.value);
          toast(`${res.profile.name} bu cihazda`, 'ok');
          window.location.replace('/home.html');
        } catch (err) { toast(err.message, 'err'); pass.select(); return false; }
        return true;
      } },
    ],
  });
  (name ? pass : nameIn).focus();
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.el.querySelector('footer .primary')?.click(); });
}

/** The cloud row of the edit dialog: link this profile, or see its link. */
function cloudField(p) {
  if (!LOCAL || !p) return null;
  if (p.cloud) {
    const when = p.cloud.last_sync ? new Date(p.cloud.last_sync).toLocaleString('tr-TR') : 'henüz';
    return field('Bulut', h('div.cloud-linked', {},
      h('span', {}, icon('cloud', 15), ` Bulutta · giriş adı “${p.cloud.name}” · son eşitleme: ${when}`),
      state.current === p.id ? h('button.btn.small.outline', { type: 'button', onclick: async () => {
        if (!(await confirmBox('Buluttan ayır', 'Bu cihazdaki profil buluttan ayrılır ve artık eşitlenmez. Buluttaki kopya ve diğer cihazlar etkilenmez.', 'Ayır'))) return;
        await api.cloudUnlink();
        toast('Buluttan ayrıldı', 'ok');
        await load();
      } }, 'Ayır') : null));
  }
  if (state.current !== p.id) return field('Bulut', h('span.muted', {}, 'Buluta yüklemek için önce bu profille gir.'));
  const pass = h('input.ctl', { type: 'password', placeholder: 'Şifre belirle (en az 6 karakter)', autocomplete: 'new-password' });
  const go = h('button.btn.small.primary', { type: 'button', onclick: async () => {
    go.disabled = true;
    try {
      const st = await api.cloudLink(pass.value);
      toast('Profil bulutta: diğer cihazlarda adı ve bu şifreyle aç', 'ok', 6000);
      // the dialog shows the link at once; the list behind it too
      row.replaceWith(cloudField({ ...p, cloud: { name: st.name, last_sync: st.last_sync || Date.now() } }));
      await load();
    } catch (err) { toast(err.message, 'err', 6000); } finally { go.disabled = false; }
  } }, icon('cloud', 14), 'Buluta yükle');
  const row = field('Bulut', h('div.cloud-link', {}, pass, go), `Diğer cihazlarda “Buluttan profil indir” → “${p.name}” + bu şifre. Her şey eşit kalır.`);
  return row;
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
      needsCurrent ? field('Bu profil kilitli: değişiklik için mevcut PIN', current) : null,
      cloudField(p)),
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
