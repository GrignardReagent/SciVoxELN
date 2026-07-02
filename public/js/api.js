/** Thin REST client. Injects the acting user's identity into every request. */
import { getIdentity } from './state.js';

async function req(method, path, body) {
  const id = getIdentity();
  const headers = {
    'x-user-name': encodeURIComponent(id.name || 'Unknown'),
    'x-user-role': encodeURIComponent(id.role || '')
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
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
  // audit + stt
  audit: () => req('GET', '/api/audit'),
  sttHealth: () => req('GET', '/api/stt/health'),
  // uploads (multipart, handled separately)
  async uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  }
};
