// The journal's records, kept with the profile's other synced values (the
// /api/kv store): one key per trade ("rt:jr:t:<id>"), one per day's notes
// ("rt:jr:d:YYYY-MM-DD") and the journal's own choices ("rt:jr:prefs"). Each
// trade being its own key, two devices adding trades at the same time never
// overwrite each other in the group's cloud; a change made on another device
// arrives with the cloud's next sync ("rv-synced") and the page repaints.
import { normalizePrefs } from './core/journal.js?v=ac0ce45574';

const T = 'rt:jr:t:', D = 'rt:jr:d:', P = 'rt:jr:prefs';

export const jr = {
  entries: new Map(),
  days: new Map(),
  prefs: normalizePrefs(null),
  loaded: false,
  profile: null,
};

const listeners = new Set();
export const onJournalChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) fn(); };

async function kv(method, body) {
  const r = await fetch(`/api/kv?profile=${jr.profile}`, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail || detail; } catch { /* plain */ }
    throw new Error(detail || 'kaydedilemedi');
  }
  return r.json();
}

/** Read everything of this profile's journal. */
export async function loadJournal(profileId) {
  jr.profile = profileId;
  const all = await kv('GET');
  const entries = new Map(), days = new Map();
  for (const [k, v] of Object.entries(all || {})) {
    if (!v || typeof v !== 'object') continue;
    if (k.startsWith(T) && v.id) entries.set(v.id, v);
    else if (k.startsWith(D) && v.date) days.set(v.date, v);
  }
  jr.entries = entries;
  jr.days = days;
  jr.prefs = normalizePrefs(all?.[P]);
  jr.loaded = true;
  return jr;
}

/** Save trades (one or many) in one request. */
export async function putEntries(list) {
  const now = Date.now();
  const body = {};
  for (const e of list) {
    e.updated = now;
    e.created ||= now;
    body[T + e.id] = e;
  }
  await kv('PUT', body);
  for (const e of list) jr.entries.set(e.id, e);
  changed();
}
export const putEntry = (e) => putEntries([e]);

export async function deleteEntries(ids) {
  await kv('PUT', Object.fromEntries(ids.map((id) => [T + id, null])));
  for (const id of ids) jr.entries.delete(id);
  changed();
}

/** A day's notes; empty notes take the day's key away. */
export async function putDay(day, { quiet = false } = {}) {
  const empty = !String(day.plan || '').trim() && !String(day.review || '').trim() && !day.mood;
  const value = empty ? null : { ...day, updated: Date.now() };
  await kv('PUT', { [D + day.date]: value });
  if (empty) jr.days.delete(day.date); else jr.days.set(day.date, value);
  if (!quiet) changed();
}

export async function savePrefs(patch = null) {
  if (patch) Object.assign(jr.prefs, patch);
  jr.prefs = normalizePrefs(jr.prefs);
  await kv('PUT', { [P]: jr.prefs });
  changed();
}

/** Everything at once (a backup put back), newer copies winning. */
export async function mergeBackup({ entries = [], days = [], prefs = null }) {
  const body = {};
  let n = 0;
  for (const e of entries) {
    if (!e?.id || !e.symbol) continue;
    const have = jr.entries.get(e.id);
    if (have && (have.updated || 0) >= (e.updated || 0)) continue;
    body[T + e.id] = e; n++;
  }
  for (const d of days) {
    if (!d?.date) continue;
    const have = jr.days.get(d.date);
    if (have && (have.updated || 0) >= (d.updated || 0)) continue;
    body[D + d.date] = d;
  }
  if (prefs) body[P] = normalizePrefs({ ...prefs, accounts: mergeById(jr.prefs.accounts, prefs.accounts || []), templates: mergeById(jr.prefs.templates, prefs.templates || []) });
  if (!Object.keys(body).length) return 0;
  await kv('PUT', body);
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith(T)) jr.entries.set(v.id, v);
    else if (k.startsWith(D)) jr.days.set(v.date, v);
    else jr.prefs = v;
  }
  changed();
  return n;
}
const mergeById = (a = [], b = []) => { const m = new Map(a.map((x) => [x.id, x])); for (const x of b) if (x?.id && !m.has(x.id)) m.set(x.id, x); return [...m.values()]; };

// what other devices changed comes down with the cloud's sync
if (typeof window !== 'undefined') {
  window.addEventListener('rv-synced', (e) => {
    if (!jr.loaded || jr.profile == null) return;
    if (!(e.detail?.changed || []).some((c) => c.kind === 'kv' && String(c.key).startsWith('rt:jr:'))) return;
    loadJournal(jr.profile).then(changed, () => {});
  });
}
