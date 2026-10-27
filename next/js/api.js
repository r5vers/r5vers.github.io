// Thin client for the terminal's REST API.
// Without a server (static hosting) local/boot.js answers it on the device.
import './local/boot.js?v=d93fdedfec';

async function request(method, path, { body, params, raw = false, keepalive = false } = {}) {
  let url = `/api${path}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    const s = q.toString();
    if (s) url += `?${s}`;
  }
  const init = { method, headers: {}, keepalive };
  if (body !== undefined) {
    if (raw) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401 && !path.startsWith('/login')) {
    // session expired: back to the login page
    window.location.replace('profiles.html');
  }
  if (res.status === 403 && /TERMINAL_PASSWORD/.test(text)) window.location.replace('profiles.html');
  // no profile picked (or its PIN changed): back to the profile screen
  if (res.status === 409 && /profil/.test(text) && !/profiles\.html$/.test(location.pathname)) window.location.replace('profiles.html');
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? (data.detail ?? JSON.stringify(data)) : text;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Bars as typed arrays from the binary endpoint (24-byte records: uint32
 *  time, four int32 prices in units of 10^-scale, float32 volume). With
 *  `raw`, the records themselves ({ buf, scale, n }), for a worker to read. */
async function barsBin(id, params, raw = false) {
  const q = new URLSearchParams({ ...params, fmt: 'bin' });
  const res = await fetch(`/api/datasets/${id}/bars?${q}`);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* binary or empty */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  const buf = await res.arrayBuffer();
  const scale = Number(res.headers.get('X-Scale') || 0);
  const n = Math.floor(buf.byteLength / 24);
  if (raw) return { buf, scale, n };
  const dv = new DataView(buf);
  const k = 10 ** scale;
  const out = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0, p = 0; i < n; i++, p += 24) {
    out.t[i] = dv.getUint32(p, true);
    out.o[i] = dv.getInt32(p + 4, true) / k;
    out.h[i] = dv.getInt32(p + 8, true) / k;
    out.l[i] = dv.getInt32(p + 12, true) / k;
    out.c[i] = dv.getInt32(p + 16, true) / k;
    out.v[i] = dv.getFloat32(p + 20, true);
  }
  return out;
}

export const api = {
  providers: () => request('GET', '/providers'),
  datasets: () => request('GET', '/datasets'),
  dataset: (id) => request('GET', `/datasets/${id}`),
  patchDataset: (id, fields) => request('PATCH', `/datasets/${id}`, { body: fields }),
  deleteDataset: (id) => request('DELETE', `/datasets/${id}`),
  bars: (id, params) => request('GET', `/datasets/${id}/bars`, { params }),
  barsBin,
  replay: (id, params) => request('GET', `/datasets/${id}/replay`, { params }),
  importCsv: (file, params) => request('POST', '/datasets/import', { body: file, raw: true, params }),
  download: (body) => request('POST', '/datasets/download', { body }),
  jobs: () => request('GET', '/jobs'),
  cancelJob: (id) => request('POST', `/jobs/${id}/cancel`),
  sessions: () => request('GET', '/sessions'),
  session: (id) => request('GET', `/sessions/${id}`),
  createSession: (body) => request('POST', '/sessions', { body }),
  updateSession: (id, body, keepalive = false) => request('PUT', `/sessions/${id}`, { body, keepalive }),
  deleteSession: (id) => request('DELETE', `/sessions/${id}`),
  settings: () => request('GET', '/settings'),
  saveOanda: (body) => request('PUT', '/settings/oanda', { body }),
  deleteOanda: () => request('DELETE', '/settings/oanda'),
  live: (params) => request('GET', '/live', { params }),
  liveTimeframes: (provider) => request('GET', '/live/timeframes', { params: { provider } }),
  logout: () => request('POST', '/logout'),
  packs: () => request('GET', '/packs'),
  downloadPacks: (body) => request('POST', '/packs/download', { body }),
  mirrorRestore: (body = {}) => request('POST', '/mirror/restore', { body }),
  me: () => request('GET', '/me'),
  profiles: () => request('GET', '/profiles'),
  createProfile: (body) => request('POST', '/profiles', { body }),
  updateProfile: (id, body) => request('PATCH', `/profiles/${id}`, { body }),
  deleteProfile: (id, pin) => request('DELETE', `/profiles/${id}`, { params: { pin } }),
  selectProfile: (id, pin) => request('POST', `/profiles/${id}/select`, { body: { pin } }),
  leaveProfile: () => request('POST', '/profiles/leave'),
  setPhoto: (id, blob, pin) => request('PUT', `/profiles/${id}/photo`, { body: blob, raw: true, params: { pin } }),
  deletePhoto: (id, pin) => request('DELETE', `/profiles/${id}/photo`, { params: { pin } }),
  // the group's cloud (only without a server: js/local/sync.js)
  cloudStatus: () => request('GET', '/cloud/status'),
  cloudConnect: (password, create = false) => request('POST', '/cloud/connect', { body: { password, create } }),
  cloudSync: () => request('POST', '/cloud/sync'),
  cloudDisconnect: () => request('POST', '/cloud/disconnect'),
  strategies: () => request('GET', '/strategies'),
  saveStrategy: (name, code) => request('PUT', `/strategies/${encodeURIComponent(name)}`, { body: { code } }),
  deleteStrategy: (name) => request('DELETE', `/strategies/${encodeURIComponent(name)}`),
};
