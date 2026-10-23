// The group's cloud on Firebase (project in firebase-config.js), over its
// REST API: Auth for the group's name + password, Firestore for the data.
//
//   users/{uid}/items/{id}    one document per synced thing (sync.js):
//                             { kind, gid, key, value, deleted, updated_at, sv }
//                             `sv` is the server's write time: a device asks
//                             for everything after the last `sv` it saw, so
//                             a wrong clock on some phone loses nothing.
//
// The Firestore rules (see README) let only the signed-in owner read or
// write users/{uid}.
import { FIREBASE_CONFIG } from './firebase-config.js?v=1f79c2a121';

const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
const TOKEN = 'https://securetoken.googleapis.com/v1/token';
const fsBase = (cfg) => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
const EMAIL_DOMAIN = 'users.rv-terminal.app';
const PAGE = 300;

export class CloudError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const AUTH_ERRORS = {
  EMAIL_EXISTS: 'bu isim başka bir profilde kullanılıyor',
  INVALID_LOGIN_CREDENTIALS: 'isim ya da şifre yanlış',
  INVALID_PASSWORD: 'isim ya da şifre yanlış',
  EMAIL_NOT_FOUND: 'isim ya da şifre yanlış',
  USER_DISABLED: 'bu profil kapatılmış',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'çok fazla deneme, biraz sonra tekrar deneyin',
  OPERATION_NOT_ALLOWED: 'bulutta isim + şifre girişi kapalı',
  TOKEN_EXPIRED: 'oturum süresi doldu, tekrar giriş yapın',
  INVALID_REFRESH_TOKEN: 'oturum süresi doldu, tekrar giriş yapın',
  USER_NOT_FOUND: 'bu profil bulutta silinmiş',
};

/** The sign-in e-mail behind a profile name: same name, same account. */
export function nameToEmail(name) {
  const tr = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const clean = String(name).trim().split('').map((c) => tr[c] ?? c).join('').toLowerCase()
    .normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  // names in other scripts: their UTF-8 bytes in hex, still one name = one account
  const local = clean || [...new TextEncoder().encode(String(name).trim())].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${local.slice(0, 60)}@${EMAIL_DOMAIN}`;
}

// ── Firestore values <-> plain JSON ────────────────────────────────────────
export function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
  return out;
}
function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
export function fromFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}
function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  return null;
}

/** One signed-in account. `session` = { uid, idToken, refreshToken, expires } */
export class Cloud {
  constructor({ config = FIREBASE_CONFIG, fetchFn = (...a) => fetch(...a), session = null } = {}) {
    this.cfg = config;
    this.fetch = fetchFn;
    this.session = session;
  }

  get enabled() { return !!this.cfg?.apiKey; }

  async _auth(path, body) {
    let r;
    try {
      r = await this.fetch(`${AUTH}:${path}?key=${this.cfg.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new CloudError('buluta ulaşılamadı (internet?)', 503); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = String(d.error?.message || '').split(' ')[0];
      if (code === 'WEAK_PASSWORD') throw new CloudError('şifre en az 6 karakter olmalı');
      throw new CloudError(AUTH_ERRORS[code] || `bulut hatası: ${code || r.status}`, code === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 429 : 403);
    }
    return d;
  }

  _keep(d) {
    this.session = { uid: d.localId || d.user_id, idToken: d.idToken || d.id_token, refreshToken: d.refreshToken || d.refresh_token, expires: Date.now() + (Number(d.expiresIn || d.expires_in || 3600) - 120) * 1000 };
    return this.session;
  }

  async signUp(name, password) {
    if (String(password || '').length < 6) throw new CloudError('şifre en az 6 karakter olmalı');
    return this._keep(await this._auth('signUp', { email: nameToEmail(name), password, returnSecureToken: true }));
  }

  async signIn(name, password) {
    return this._keep(await this._auth('signInWithPassword', { email: nameToEmail(name), password, returnSecureToken: true }));
  }

  async token() {
    if (!this.session) throw new CloudError('bulutta oturum yok', 401);
    if (Date.now() < this.session.expires) return this.session.idToken;
    let r;
    try {
      r = await this.fetch(`${TOKEN}?key=${this.cfg.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.session.refreshToken)}` });
    } catch { throw new CloudError('buluta ulaşılamadı (internet?)', 503); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new CloudError(AUTH_ERRORS[String(d.error?.message || '').split(' ')[0]] || 'oturum yenilenemedi', 401);
    this._keep(d);
    return this.session.idToken;
  }

  async _fs(method, path, body, { auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${await this.token()}`;
    let r;
    try {
      r = await this.fetch(`${fsBase(this.cfg)}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new CloudError('buluta ulaşılamadı (internet?)', 503); }
    if (r.status === 404 && method === 'GET') return null;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new CloudError(r.status === 403 ? 'bulut bu işleme izin vermedi' : `bulut hatası: ${d.error?.message || r.status}`, r.status);
    return d;
  }

  // ── the group's items ───────────────────────────────────────────────────
  /** Write items, a few commits as needed (Firestore takes 500 writes and
   *  10 MB per request); each gets the server's time as `sv`. */
  async putItems(items) {
    const uid = this.session.uid;
    const root = `projects/${this.cfg.projectId}/databases/(default)/documents`;
    let batch = [], bytes = 0;
    const send = async () => { if (batch.length) await this._fs('POST', ':commit', { writes: batch }); batch = []; bytes = 0; };
    for (const it of items) {
      const size = (it.value?.length || 0) + 300;
      if (batch.length >= 400 || bytes + size > 8_000_000) await send();
      batch.push({
        update: { name: `${root}/users/${uid}/items/${itemId(it.kind, `${it.gid ?? ''}|${it.key}`)}`, fields: toFields(it) },
        updateTransforms: [{ fieldPath: 'sv', setToServerValue: 'REQUEST_TIME' }],
      });
      bytes += size;
    }
    await send();
  }

  /** Items written after the last one seen, oldest first, and the new
   *  position: { items, last }. A position is the (sv, document name) of
   *  the last item seen, so every item is read once: reading from its time
   *  alone would read a whole commit (up to 400 items share one time) again
   *  on every poll. `since` may also be a bare time (older devices): from
   *  that time on. */
  async itemsSince(since, page = PAGE) {
    const uid = this.session.uid;
    const out = [];
    const pos = since && typeof since === 'object' ? since : null;
    const from = pos ? pos.sv : since || '1970-01-01T00:00:00Z';
    let after = pos ? [pos.sv, pos.name] : null;     // [sv, document name] of the last row
    let last = pos;
    for (;;) {
      const query = {
        structuredQuery: {
          from: [{ collectionId: 'items' }],
          where: { fieldFilter: { field: { fieldPath: 'sv' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: from } } },
          orderBy: [{ field: { fieldPath: 'sv' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
          limit: page,
          ...(after ? { startAt: { values: [{ timestampValue: after[0] }, { referenceValue: after[1] }], before: false } } : {}),
        },
      };
      const rows = ((await this._fs('POST', `/users/${uid}:runQuery`, query)) || []).filter((r) => r.document);
      for (const r of rows) out.push(fromFields(r.document.fields));
      if (rows.length) {
        const doc = rows[rows.length - 1].document;
        after = [fromFields(doc.fields).sv, doc.name];
        last = { sv: after[0], name: after[1] };
      }
      if (rows.length < page) break;
    }
    return { items: out, last };
  }

  async deleteAccount() {
    await this._auth('delete', { idToken: await this.token() });
    this.session = null;
  }
}

/** Document id of an item: base64url of "kind:key" (any key, no slashes). */
export function itemId(kind, key) {
  const bytes = new TextEncoder().encode(`${kind}:${key}`);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
