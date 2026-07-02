/** Thin REST client. Auth is cookie-based (same-origin fetch sends the session
 *  cookie automatically); no identity headers are sent from the client. */

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method, headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !path.endsWith('/auth/me')) {
    // session expired mid-use — bounce to login
    window.dispatchEvent(new CustomEvent('scivox:unauthorized'));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  // auth
  me: () => req('GET', '/api/auth/me'),
  providers: () => req('GET', '/api/auth/providers'),
  register: d => req('POST', '/api/auth/register', d),
  login: d => req('POST', '/api/auth/login', d),
  logout: () => req('POST', '/api/auth/logout'),
  // admin users
  users: () => req('GET', '/api/users'),
  setUserRole: (id, role) => req('PATCH', `/api/users/${id}/role`, { role }),
  // experiments
  experiments: () => req('GET', '/api/experiments'),
  experiment: id => req('GET', `/api/experiments/${id}`),
  createExperiment: d => req('POST', '/api/experiments', d),
  updateExperiment: (id, d) => req('PATCH', `/api/experiments/${id}`, d),
  lockExperiment: id => req('POST', `/api/experiments/${id}/lock`),
  deleteExperiment: id => req('DELETE', `/api/experiments/${id}`),
  addEntry: (id, d) => req('POST', `/api/experiments/${id}/entries`, d),
  // entries
  signEntry: id => req('POST', `/api/entries/${id}/sign`),
  // plans
  plans: () => req('GET', '/api/plans'),
  plan: id => req('GET', `/api/plans/${id}`),
  createPlan: d => req('POST', '/api/plans', d),
  updatePlan: (id, d) => req('PATCH', `/api/plans/${id}`, d),
  deletePlan: id => req('DELETE', `/api/plans/${id}`),
  startPlan: (id, d) => req('POST', `/api/plans/${id}/start`, d || {}),
  // inventory
  inventory: () => req('GET', '/api/inventory'),
  createItem: d => req('POST', '/api/inventory', d),
  updateItem: (id, d) => req('PATCH', `/api/inventory/${id}`, d),
  adjustItem: (id, d) => req('POST', `/api/inventory/${id}/adjust`, d),
  deleteItem: id => req('DELETE', `/api/inventory/${id}`),
  // audit + stt + ai
  audit: () => req('GET', '/api/audit'),
  sttHealth: () => req('GET', '/api/stt/health'),
  aiHealth: () => req('GET', '/api/ai/health'),
  aiChat: (experimentId, messages) => req('POST', '/api/ai/chat', { experimentId, messages }),
  // uploads
  async uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  async transcribe(blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'audio.webm');
    const res = await fetch('/api/stt/transcribe', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  }
};
