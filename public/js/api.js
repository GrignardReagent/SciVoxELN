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
  requestPasswordReset: email => req('POST', '/api/auth/password-reset', { email }),
  resetPassword: (token, password) => req('POST', '/api/auth/password-reset', { token, password }),
  requestEmailVerification: () => req('POST', '/api/auth/verify-email', {}),
  verifyEmail: token => req('POST', '/api/auth/verify-email', { token }),
  revokeSession: (all = false) => req('POST', '/api/auth/sessions/revoke', { all }),
  // admin users
  users: (includeArchived = false) => req('GET', `/api/users${query({ includeArchived })}`),
  setUserRole: (id, role) => req('PATCH', `/api/users/${id}/role`, { role }),
  archiveUser: id => req('POST', `/api/users/${id}/archive`),
  restoreUser: id => req('POST', `/api/users/${id}/restore`),
  // orgs + projects
  orgs: () => req('GET', '/api/orgs'),
  createOrg: d => req('POST', '/api/orgs', d),
  projects: () => req('GET', '/api/projects'),
  createProject: d => req('POST', '/api/projects', d),
  projectMembers: id => req('GET', `/api/projects/${id}/members`),
  setProjectMember: (id, d) => req('PATCH', `/api/projects/${id}/members`, d),
  // experiments
  experiments: () => req('GET', '/api/experiments'),
  experimentTemplates: (projectId = '') => req('GET', `/api/experiments/templates${query({ projectId })}`),
  experiment: id => req('GET', `/api/experiments/${id}`),
  createExperiment: d => req('POST', '/api/experiments', d),
  updateExperiment: (id, d) => req('PATCH', `/api/experiments/${id}`, d),
  lockExperiment: id => req('POST', `/api/experiments/${id}/lock`),
  deleteExperiment: (id, d) => req('DELETE', `/api/experiments/${id}`, d),
  saveExperimentTemplate: (id, d) => req('POST', `/api/experiments/${id}/template`, d),
  duplicateExperiment: (id, d) => req('POST', `/api/experiments/${id}/duplicate`, d),
  experimentLinks: id => req('GET', `/api/experiments/${id}/links`),
  addExperimentLink: (id, d) => req('POST', `/api/experiments/${id}/links`, d),
  deleteExperimentLink: (id, linkId) => req('DELETE', `/api/experiments/${id}/links/${linkId}`),
  experimentSteps: id => req('GET', `/api/experiments/${id}/steps`),
  addExperimentStep: (id, d) => req('POST', `/api/experiments/${id}/steps`, d),
  updateExperimentStep: (id, stepId, d) => req('PATCH', `/api/experiments/${id}/steps/${stepId}`, d),
  deleteExperimentStep: (id, stepId) => req('DELETE', `/api/experiments/${id}/steps/${stepId}`),
  experimentAttachments: id => req('GET', `/api/experiments/${id}/attachments`),
  deleteExperimentAttachment: (id, attachmentId) => req('DELETE', `/api/experiments/${id}/attachments/${attachmentId}`),
  async uploadExperimentAttachment(id, file, note = '') {
    const fd = new FormData();
    fd.append('note', note);
    fd.append('file', file);
    const res = await fetch(`/api/experiments/${id}/attachments`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  },
  addEntry: (id, d) => req('POST', `/api/experiments/${id}/entries`, d),
  // entries
  entries: () => req('GET', '/api/entries'),
  entry: id => req('GET', `/api/entries/${id}`),
  updateEntry: (id, d) => req('PATCH', `/api/entries/${id}`, d),
  commentEntry: (id, d) => req('POST', `/api/entries/${id}/comments`, d),
  signEntry: (id, d = {}) => req('POST', `/api/entries/${id}/sign`, d),
  deleteEntry: (id, d) => req('DELETE', `/api/entries/${id}`, d),
  batchDeleteEntries: entryIds => req('DELETE', '/api/entries/batch', { entryIds }),
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
  reserveItem: (id, d) => req('POST', `/api/inventory/${id}/reservations`, d),
  cancelItemReservation: (itemId, reservationId) => req('DELETE', `/api/inventory/${itemId}/reservations/${reservationId}`),
  inventoryAvailability: (id, params = {}) => req('GET', `/api/inventory/${id}/availability${query(params)}`),
  inventoryCalendarToken: id => req('POST', `/api/inventory/${id}/calendar-token`),
  deleteItem: id => req('DELETE', `/api/inventory/${id}`),
  // audit + stt + ai
  audit: (params = {}) => req('GET', `/api/audit${query(params)}`),
  smartSearch: q => req('GET', `/api/search?q=${encodeURIComponent(q || '')}`),
  sttHealth: () => req('GET', '/api/stt/health'),
  aiHealth: () => req('GET', '/api/ai/health'),
  aiChat: (experimentId, messages) => req('POST', '/api/ai/chat', { experimentId, messages }),
  processEntries: (entryIds, mode) => req('POST', '/api/ai/process-entries', { entryIds, mode }),
  processVoiceDraft: (experimentId, transcript, rawNotes, template = 'auto_lab_note') =>
    req('POST', '/api/ai/process-voice-draft', { experimentId, transcript, rawNotes, template }),
  observeFrame: (experimentId, imageData, transcript, recentEvents) =>
    req('POST', '/api/ai/observe', { experimentId, imageData, transcript, recentEvents }),
  // references (papers)
  references: experimentId => req('GET', `/api/references?experimentId=${encodeURIComponent(experimentId)}`),
  addReference: (experimentId, d) => req('POST', '/api/references', { experimentId, ...d }),
  addReferenceDoi: (experimentId, doi) => req('POST', '/api/references/doi', { experimentId, doi }),
  importReferences: (experimentId, text) => req('POST', '/api/references/import', { experimentId, text }),
  importZotero: (experimentId, d) => req('POST', '/api/references/zotero', { experimentId, ...d }),
  deleteReference: id => req('DELETE', `/api/references/${id}`),
  // uploads
  async uploadImage(file, filename, kind = '', experimentId = '') {
    const fd = new FormData();
    if (kind) fd.append('kind', kind);
    if (experimentId) fd.append('experimentId', experimentId);
    if (filename) fd.append('image', file, filename);
    else fd.append('image', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  async transcribe(blob) {
    const fd = new FormData();
    fd.append('audio', blob, audioFilename(blob.type));
    const res = await fetch('/api/stt/transcribe', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  }
};

function query(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, v); });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

function audioFilename(type = '') {
  if (type.includes('mp4')) return 'audio.mp4';
  if (type.includes('mpeg')) return 'audio.mp3';
  if (type.includes('wav')) return 'audio.wav';
  return 'audio.webm';
}
