// Moving the old server site (Railway) to the new one without deploying
// anything there: this module is loaded from r5vers.github.io into the old
// site's own page (browser console or a bookmark), reads everything through
// the API that site already has, and puts it in the group's cloud.
//
//   import('https://r5vers.github.io/js/migrate.js')
//
// Locked profiles are opened with their PIN, which is kept (hashed the way
// the server did) so it still opens them on the new site. Values the old
// site never managed to save on its server are taken from this browser.
//
// When the old server no longer answers (stopped, 404), what this browser
// kept of it is moved instead: every setting, look and drawing the site
// wrote here (it keeps them as "rt:p<id>:..." in localStorage).
import { pushExport } from './local/sync.js?v=4a4bde5db4';

const NEW_SITE = 'https://r5vers.github.io';

const css = `
#rv-move{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(5,6,10,.72);backdrop-filter:blur(10px);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eaf2}
#rv-move .box{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:22px;border-radius:18px;background:#111318;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 30px 80px -20px #000}
#rv-move h2{margin:0 0 6px;font-size:18px} #rv-move p{margin:6px 0;color:#9aa0b4}
#rv-move input{width:100%;box-sizing:border-box;margin:6px 0;padding:10px 12px;border-radius:10px;border:1px solid #2a2e3a;background:#0b0c10;color:#fff;font:inherit}
#rv-move button{margin-top:8px;padding:10px 14px;border:0;border-radius:10px;background:#9fa8ff;color:#0b0c10;font:600 14px system-ui;cursor:pointer}
#rv-move button.ghost{background:transparent;color:#9aa0b4;box-shadow:inset 0 0 0 1px #2a2e3a;margin-left:6px}
#rv-move .log{margin-top:10px;font:12px/1.5 ui-monospace,monospace;color:#b8bdd0;white-space:pre-wrap}
#rv-move .ok{color:#30d158} #rv-move .err{color:#ff6b6b} #rv-move a{color:#9fa8ff}
#rv-move .prof{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center;margin:8px 0;padding:10px 12px;border-radius:12px;background:#0b0c10;box-shadow:inset 0 0 0 1px #2a2e3a}
#rv-move .prof input[type=checkbox]{width:auto;margin:0} #rv-move .prof input[type=text]{margin:0} #rv-move .prof small{grid-column:2;color:#9aa0b4;font-size:12px}`;

function panel() {
  document.getElementById('rv-move')?.remove();
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.id = 'rv-move';
  root.innerHTML = '<div class="box"></div>';
  document.body.append(style, root);
  return root.querySelector('.box');
}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...kids);
  return e;
};

async function api(method, path, body) {
  const r = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw Object.assign(new Error(data?.detail || `HTTP ${r.status}`), { status: r.status });
  return data;
}

// the server's PIN hash: pbkdf2-sha256, 100 000 rounds, "salt$digest" in hex
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return `${hex(salt)}$${hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256))}`;
}

async function photoBase64(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const u8 = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  } catch { return null; }
}

/** kv writes this browser made that never reached the old server. */
function unsent(pid) {
  const out = {};
  try {
    const keys = JSON.parse(localStorage.getItem(`rt:p${pid}:__unsent`) || '[]');
    for (const k of keys) {
      const v = localStorage.getItem(`rt:p${pid}:${k.replace(/^rt:/, '')}`);
      if (v != null) out[k] = JSON.parse(v);
    }
  } catch { /* storage blocked or not JSON */ }
  return out;
}

function ask(box, title, text, placeholder, { type = 'password', confirmText = 'Devam', skip = null, error = null } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type, placeholder });
    const go = el('button', { textContent: confirmText, onclick: () => resolve(input.value) });
    const kids = [el('h2', { textContent: title }), el('p', { textContent: text }), ...(error ? [el('p', { className: 'err', textContent: error })] : []), input, go];
    if (skip) kids.push(el('button', { className: 'ghost', textContent: skip, onclick: () => resolve(null) }));
    box.replaceChildren(...kids);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    input.focus();
  });
}

/** What this browser kept of the old site, per profile. */
function localProfiles() {
  const out = new Map();
  const add = (id, key, raw) => {
    let value;
    try { value = JSON.parse(raw); } catch { return; }
    if (!out.has(id)) out.set(id, {});
    out.get(id)[key] = value;
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = /^rt:p(\d+):(.+)$/.exec(k);
      if (m) { if (m[2] !== '__unsent') add(Number(m[1]), `rt:${m[2]}`, localStorage.getItem(k)); }
      else if (/^rt:/.test(k)) add('legacy', k, localStorage.getItem(k));   // from before profiles
    }
  } catch { /* storage blocked */ }
  return [...out.entries()].map(([id, kv]) => {
    const drawings = Object.entries(kv).filter(([k, v]) => k.startsWith('rt:drawings:') && Array.isArray(v)).reduce((n, [, v]) => n + v.length, 0);
    return { id, kv, keys: Object.keys(kv).length, drawings };
  }).filter((p) => p.keys);
}

const COLORS = ['#8b7cf6', '#3fb39b', '#e07a8b', '#f5a623', '#0a84ff', '#bf5af2'];

/** The old server is gone: move what this browser kept of it. */
async function fromBrowser(box, why) {
  const found = localProfiles();
  if (!found.length) {
    box.replaceChildren(el('h2', { textContent: 'Eski sunucu kapalı' }),
      el('p', { textContent: `Sunucu cevap vermiyor (${why}) ve bu tarayıcıda da eski siteden kalan kayıt yok.` }),
      el('p', { textContent: 'Eski siteyi en çok kullandığın cihazda ve tarayıcıda (aynı adres) bu komutu çalıştır: ayarlar, temalar ve çizimler o tarayıcının hafızasında durur.' }));
    return;
  }
  const rows = found.map((p, i) => {
    const on = el('input', { type: 'checkbox', checked: true });
    const name = el('input', { type: 'text', value: p.id === 'legacy' ? 'Eski ayarlar' : `Profil ${i + 1}`, placeholder: 'Profil adı' });
    const row = el('label', { className: 'prof' }, on, name, el('small', { textContent: `${p.keys} ayar${p.drawings ? ` · ${p.drawings} çizim` : ''}` }));
    return { p, on, name, row, color: COLORS[i % COLORS.length] };
  });
  const pass = el('input', { type: 'password', placeholder: 'Grup şifresi (en az 6 karakter)' });
  const err = el('p', { className: 'err' });
  const go = el('button', { textContent: 'Buluta yükle' });
  box.replaceChildren(
    el('h2', { textContent: 'Sunucu kapalı, bu tarayıcıdan kurtar' }),
    el('p', { textContent: `Eski sunucu artık cevap vermiyor (${why}). Bu tarayıcı eski sitenin temalarını, ayarlarını ve çizimlerini saklamış: ${found.length} profil bulundu. Profil adlarını yaz (sunucu kapalı olduğu için adlar okunamıyor). Replay oturumları sunucuda durduğu için gelmez.` }),
    ...rows.map((r) => r.row), pass, err, go);
  await new Promise((resolve) => {
    go.onclick = () => {
      if (pass.value.length < 6) { err.textContent = 'Şifre en az 6 karakter olmalı'; return; }
      if (!rows.some((r) => r.on.checked)) { err.textContent = 'En az bir profil seç'; return; }
      resolve();
    };
  });
  const now = Math.floor(Date.now() / 1000);
  const exp = { format: 1, exported_at: now, profiles: rows.filter((r) => r.on.checked).map((r) => ({
    id: r.p.id, name: r.name.value.trim() || 'Profil', color: r.color, avatar: '', pin: null, created_at: now, updated_at: now, photo: null, kv: r.p.kv, sessions: [], strategies: [],
  })) };
  await upload(box, exp, pass.value);
}

async function upload(box, exp, password) {
  const log = el('div', { className: 'log' });
  box.replaceChildren(el('h2', { textContent: 'Buluta yükleniyor…' }), log);
  const say = (msg, cls = '') => log.append(el('div', { className: cls, textContent: msg }));
  try {
    const res = await pushExport(exp, password);
    say(`Tamam: ${res.profiles} profil, ${res.items} kayıt bulutta.`, 'ok');
    box.append(el('p', {}, 'Şimdi her cihazda ', el('a', { href: NEW_SITE, target: '_blank', textContent: NEW_SITE.replace('https://', '') }), ' adresini aç ve bu grup şifresiyle “Bağlan”.'),
      el('button', { textContent: 'Kapat', onclick: () => document.getElementById('rv-move').remove() }));
  } catch (err) {
    say(`Yüklenemedi: ${err.message}`, 'err');
    box.append(el('button', { textContent: 'Tekrar dene', onclick: run }));
  }
}

async function run() {
  const box = panel();
  const log = el('div', { className: 'log' });
  const say = (msg, cls = '') => { log.append(el('div', { className: cls, textContent: msg })); log.scrollTop = log.scrollHeight; };

  if (location.origin === NEW_SITE) {
    box.replaceChildren(el('h2', { textContent: 'Bu yeni site' }), el('p', { textContent: 'Komutu eski sitenin (Railway) sekmesinde, onun konsolunda çalıştır.' }));
    return;
  }
  let list;
  try { list = await api('GET', '/profiles'); } catch (err) {
    if (err.status === 401) {
      box.replaceChildren(el('h2', { textContent: 'Önce giriş yap' }), el('p', { textContent: 'Bu sitede oturum açık değil: şifreyle giriş yap, sonra komutu tekrar çalıştır.' }));
      return;
    }
    await fromBrowser(box, err.status ? `HTTP ${err.status}` : 'bağlantı yok');
    return;
  }
  // something answered, but not the old site's API (a host's own page)
  if (!Array.isArray(list?.profiles)) { await fromBrowser(box, 'API yok'); return; }
  const profiles = list.profiles;
  let password = null;
  for (;;) {
    password = await ask(box, 'Yeni siteye taşı', `${profiles.length} profil bulundu. Hepsi (temalar, ayarlar, çizimler, replay oturumları, stratejiler) buluta aktarılacak. Yeni sitede her cihazda bir kez kullanacağın grup şifresini belirle.`, 'Grup şifresi (en az 6 karakter)', { confirmText: 'Devam' });
    if (password && password.length >= 6) break;
  }

  const datasets = await api('GET', '/datasets').catch(() => []);
  const keyOf = Object.fromEntries(datasets.map((d) => [d.id, d.meta?.pack ? `pack:${d.meta.pack}:${d.base_tf}` : `ds:${d.symbol}:${d.base_tf}:${d.name}`]));
  const exp = { format: 1, exported_at: Math.floor(Date.now() / 1000), profiles: [] };

  for (const p of profiles) {
    let pinHash = null;
    let opened = false;
    let error = null;
    while (!opened) {
      let pin = null;
      if (p.locked) {
        pin = await ask(box, p.name, `“${p.name}” PIN ile kilitli. PIN'ini gir (yeni sitede de aynı PIN geçerli olacak).`, 'PIN', { type: 'password', skip: 'Bu profili atla', error });
        if (pin === null) break;
      }
      try {
        await api('POST', `/profiles/${p.id}/select`, { pin: pin || null });
        opened = true;
        if (pin) pinHash = await hashPin(pin);
      } catch (err) {
        if (!p.locked) throw err;
        error = err.status === 429 ? err.message : 'PIN yanlış, tekrar dene';
      }
    }
    box.replaceChildren(el('h2', { textContent: 'Taşınıyor…' }), log);
    if (!opened) { say(`${p.name}: atlandı`); continue; }
    const kv = { ...(await api('GET', `/kv?profile=${p.id}`)), ...unsent(p.id) };
    const rows = await api('GET', '/sessions');
    const sessions = [];
    for (const s of rows) {
      const full = await api('GET', `/sessions/${s.id}`);
      sessions.push({ id: full.id, name: full.name, kind: full.kind, dataset_id: full.dataset_id, dataset_key: keyOf[full.dataset_id] || null, state: full.state, summary: full.summary || {}, created_at: full.created_at, updated_at: full.updated_at });
    }
    const strategies = await api('GET', '/strategies').catch(() => []);
    exp.profiles.push({ id: p.id, name: p.name, color: p.color, avatar: p.avatar || '', pin: pinHash, created_at: p.created_at, updated_at: p.updated_at, photo: await photoBase64(p.photo), kv, sessions, strategies });
    say(`${p.name}: ${Object.keys(kv).length} ayar, ${sessions.length} oturum, ${strategies.length} strateji`);
  }
  if (!exp.profiles.length) { say('Taşınacak profil yok.', 'err'); return; }

  await upload(box, exp, password);
}

run().catch((err) => {
  const box = document.querySelector('#rv-move .box') || panel();
  box.append(el('p', { className: 'err', textContent: `Hata: ${err.message}` }));
});
