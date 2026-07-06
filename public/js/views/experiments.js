import { api } from '../api.js';
import { esc, fmt, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { getUser, isAdmin } from '../state.js';
import { VoiceController, voiceSupported } from '../voice.js';
import { Recorder, recorderSupported } from '../recorder.js';
import { runOCR, fileToDataURL, cameraSupported, startCamera, stopCamera, captureFrame } from '../ocr.js';
import { openObserverMode } from '../observer.js';
import { openSketchFigureModal } from '../sketchpad.js';

/* ----------------------------- List ----------------------------- */
export const renderExperiments = guard(async (root, ctx) => {
  ctx.setHead('Experiments', 'All lab experiments');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let exps = await api.experiments();
  const q = ctx.search;
  if (q) exps = exps.filter(e => (e.title + ' ' + e.project + ' ' + e.objective).toLowerCase().includes(q));
  root.innerHTML = `
    <div class="between" style="margin-bottom:16px">
      <span class="pill">${exps.length} experiment${exps.length !== 1 ? 's' : ''}</span>
      <button class="btn" data-new>+ New experiment</button>
    </div>
    ${exps.length ? `<div class="grid cardlist">${exps.map(card).join('')}</div>`
      : `<div class="empty"><div class="big">⚗</div>${q ? 'No matches.' : 'No experiments yet.'}</div>`}`;
  root.querySelector('[data-new]').onclick = guard(() => newExperimentModal(ctx));
  root.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ctx.go('experiments', { id: el.dataset.exp }));
});

function card(e) {
  return `<div class="card hover" data-exp="${e.id}">
    <div class="between"><h3>${esc(e.title)}</h3><span class="status s-${e.status}">${e.status}</span></div>
    <div class="muted" style="font-size:13px">${esc(e.objective || 'No objective set')}</div>
    <div class="meta"><span class="tag">${esc(e.project_name || e.project || 'General')}</span>
      <span>📝 ${e.entryCount || 0}</span><span>· ${fmtShort(e.created_at)}</span></div></div>`;
}

async function newExperimentModal(ctx) {
  const projects = await api.projects();
  modal(`<h3>New experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" placeholder="e.g. Buffer stability study"/>
    <label class="fld">Project</label><select class="txt" id="mProject">
      ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.org_name || 'Workspace')}</option>`).join('')}
    </select>
    <label class="fld">Objective</label><textarea class="txt" id="mObj" placeholder="What are you trying to find out?"></textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Create</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const title = m.querySelector('#mTitle').value.trim();
    if (!title) return toast('Title required', true);
    const exp = await api.createExperiment({ title, project_id: m.querySelector('#mProject').value, objective: m.querySelector('#mObj').value.trim() });
    closeModal(); toast('Experiment created'); ctx.go('experiments', { id: exp.id });
  });
  setTimeout(() => m.querySelector('#mTitle').focus(), 40);
}

/* --------------------------- Single view --------------------------- */
export const renderExperiment = guard(async (root, ctx, id) => {
  const e = await api.experiment(id);
  ctx.setHead(e.title, `${e.project_name || e.project || 'General'} · created ${fmtShort(e.created_at)}`);
  const locked = e.status === 'locked';
  const deleteButton = experimentDeleteButton(locked);
  root.innerHTML = `
    <button class="btn ghost sm" data-back>← Back to experiments</button>
    <div class="split" style="margin-top:14px">
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="row"><h2 class="sec-t" style="margin:0">${esc(e.title)}</h2><span class="status s-${e.status}">${e.status}</span></div>
          <div class="muted" style="font-size:13px;margin-top:6px">${esc(e.objective || 'No objective set')}</div>
          <div class="row" style="margin-top:12px">
            <button class="btn sec sm" data-edit>Edit details</button>
            <a class="btn ghost sm" href="/api/experiments/${esc(e.id)}/export?format=html" download>Export HTML</a>
            <a class="btn ghost sm" href="/api/experiments/${esc(e.id)}/export" download>Export JSON</a>
            ${locked ? '<span class="pill">🔒 Locked — read only</span>' : '<button class="btn sec sm" data-observe>👁 Observe run</button><button class="btn ok sm" data-lock>🔒 Lock experiment</button>'}
            ${deleteButton}
          </div>
        </div>
        ${locked ? '' : '<div id="composerMount"></div>'}
        <div class="card" style="margin-top:16px">
          <h2 class="sec-t">Notebook entries <span class="muted" style="font-weight:400">(${e.entries.length})</span></h2>
          <div id="entryFeed">${e.entries.map(en => entryHTML(en, locked)).join('') || '<div class="empty">No entries yet.</div>'}</div>
        </div>
      </div>
      <div class="card ai-card">
        <div class="between"><h2 class="sec-t" style="margin:0">🤖 AI assistant</h2><span class="pill" id="aiModel">…</span></div>
        <p class="muted" style="font-size:11px;margin:6px 0 0">Context-aware help for this experiment. It advises only — it can't change the notebook.</p>
        <div class="ai-msgs" id="aiMsgs"></div>
        <div class="ai-input">
          <textarea class="txt" id="aiText" rows="2" placeholder="Ask about this experiment…"></textarea>
          <button class="btn" id="aiSend" type="button">Send</button>
        </div>
        <div class="muted" id="aiNote" style="font-size:11px;margin-top:6px"></div>
      </div>
      <div class="card">
        <h2 class="sec-t">Integrity</h2>
        <p class="muted" style="font-size:12px;margin-top:0">Each entry carries a SHA-256 fingerprint. Signing requires signer confirmation and stores signature meaning for audit-ready records.</p>
        <div class="hint" style="margin-top:0">Signed: <b>${e.entries.filter(x => x.signed_by).length}/${e.entries.length}</b></div>
        <div class="hint">Status: <b>${e.status}</b></div>
      </div>
      <div class="card">
        <div class="between"><h2 class="sec-t" style="margin:0">📚 References</h2><button class="btn sm" id="refAdd">+ Add</button></div>
        <p class="muted" style="font-size:11px;margin:6px 0 0">Papers linked to this experiment — add by DOI, import BibTeX/RIS (a Zotero or Mendeley export), or pull from a Zotero library.</p>
        <div id="refList" style="margin-top:8px"></div>
      </div>
    </div>`;
  root.querySelector('[data-back]').onclick = () => ctx.go('experiments');
  root.querySelector('[data-edit]').onclick = guard(() => editExperimentModal(ctx, e));
  const observeBtn = root.querySelector('[data-observe]');
  if (observeBtn) observeBtn.onclick = () => openObserverMode(e, ctx);
  const lockBtn = root.querySelector('[data-lock]');
  if (lockBtn) lockBtn.onclick = () => confirmModal('Lock experiment?',
    'Locking makes this experiment read-only. No new entries can be added.',
    guard(async () => { await api.lockExperiment(e.id); toast('Experiment locked'); ctx.go('experiments', { id: e.id }); }));
  wireExperimentDeleteButton(root, ctx, e);
  wireSignButtons(root, ctx, e.id);
  wireDeleteButtons(root, ctx, e.id);
  wireEditEntries(root, ctx, e.id);
  wireSourceLinks(root);
  if (!locked) mountComposer(root.querySelector('#composerMount'), ctx, e.id);
  mountAssistant(root, e);
  mountReferences(root, e);
});

function experimentDeleteButton(locked) {
  if (!isAdmin()) {
    return '<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Admin only">Delete experiment</button><span class="muted" style="font-size:11px">Admin only</span>';
  }
  if (locked) {
    return '<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Locked experiments cannot be deleted">Delete experiment</button>';
  }
  return '<button class="btn danger sm" type="button" data-delete-experiment>Delete experiment</button>';
}

function wireExperimentDeleteButton(root, ctx, exp) {
  const btn = root.querySelector('[data-delete-experiment]');
  if (!btn) return;
  btn.onclick = () => {
    const entryCount = exp.entries?.length || 0;
    modal(`<h3>Delete experiment?</h3>
      <p class="muted">Only admins can do this. The experiment and ${entryCount} notebook entr${entryCount === 1 ? 'y' : 'ies'} will be removed, and the reason will be recorded in the audit trail.</p>
      <label class="fld">Reason</label>
      <textarea class="txt" id="experimentDeleteReason" placeholder="e.g. Duplicate calibration run created during setup"></textarea>
      <div class="auth-err" id="experimentDeleteErr"></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn danger" data-delete-experiment-confirm>Delete experiment</button>
      </div>`);
    const m = document.getElementById('modal');
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-delete-experiment-confirm]').onclick = guard(async () => {
      const err = m.querySelector('#experimentDeleteErr');
      const reason = m.querySelector('#experimentDeleteReason').value.trim();
      if (!reason) {
        err.textContent = 'Deletion reason required';
        return;
      }
      await api.deleteExperiment(exp.id, { reason });
      closeModal();
      toast('Experiment deleted');
      ctx.go('experiments');
    });
    setTimeout(() => m.querySelector('#experimentDeleteReason').focus(), 40);
  };
}

/* --------------------------- References --------------------------- */
async function mountReferences(root, exp) {
  const listEl = root.querySelector('#refList');
  const addBtn = root.querySelector('#refAdd');
  if (!listEl) return;

  const load = async () => {
    listEl.innerHTML = '<div class="muted" style="font-size:12px">Loading…</div>';
    let refs = [];
    try { refs = await api.references(exp.id); }
    catch { listEl.innerHTML = '<div class="muted" style="font-size:12px">Failed to load references.</div>'; return; }
    listEl.innerHTML = refs.length
      ? refs.map(refItem).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 0">No references yet.</div>';
    listEl.querySelectorAll('[data-delref]').forEach(b => b.onclick = () => confirmModal('Remove reference?',
      'This removes the paper from this experiment.',
      guard(async () => { await api.deleteReference(b.dataset.delref); toast('Reference removed'); load(); }), 'Remove'));
  };

  addBtn.onclick = () => addReferencesModal(exp, load);
  await load();
}

function refItem(rf) {
  const cite = [rf.authors, rf.year ? `(${rf.year})` : ''].filter(Boolean).join(' ');
  const link = rf.url || (rf.doi ? `https://doi.org/${rf.doi}` : '');
  const titleHtml = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(rf.title)}</a>` : esc(rf.title);
  return `<div class="ref-item">
    <button class="ref-del" data-delref="${rf.id}" title="Remove">✕</button>
    <div class="ref-title">${titleHtml}</div>
    <div class="ref-meta">${esc(cite) || '—'}${rf.doi ? ' · ' + esc(rf.doi) : ''} <span class="ref-src">${esc(rf.source)}</span></div>
  </div>`;
}

function addReferencesModal(exp, onDone) {
  let tab = 'doi';
  const body = t => {
    if (t === 'doi') return `<label class="fld">DOI</label><input class="txt" id="rDoi" placeholder="10.1038/s41586-020-2649-2"/><p class="muted" style="font-size:11px;margin-top:6px">Metadata is fetched automatically from CrossRef.</p>`;
    if (t === 'import') return `<label class="fld">Paste BibTeX or RIS</label><textarea class="txt" id="rText" style="min-height:150px" placeholder="In Zotero or Mendeley, export your items as BibTeX or RIS and paste them here…"></textarea>`;
    if (t === 'zotero') return `<label class="fld">Zotero numeric user ID</label><input class="txt" id="rZid" placeholder="e.g. 123456"/>
      <label class="fld">API key (only for private libraries)</label><input class="txt" id="rZkey" placeholder="optional"/>
      <label class="fld">Collection key (optional)</label><input class="txt" id="rZcol" placeholder="optional — import one collection"/>
      <p class="muted" style="font-size:11px;margin-top:6px">Find your user ID and create an API key at zotero.org → Settings → Feeds/API.</p>`;
    return `<label class="fld">Title</label><input class="txt" id="rTitle"/>
      <label class="fld">Authors</label><input class="txt" id="rAuth" placeholder="Smith J, Doe A"/>
      <div class="row"><div style="flex:1"><label class="fld">Year</label><input class="txt" id="rYear"/></div>
      <div style="flex:2"><label class="fld">DOI or URL</label><input class="txt" id="rUrl"/></div></div>`;
  };
  const okLabel = () => tab === 'manual' ? 'Add' : tab === 'doi' ? 'Look up & add' : 'Import';
  const render = () => {
    modal(`<h3>Add references</h3>
      <div class="auth-tabs" style="margin-top:8px;flex-wrap:wrap">
        <button class="auth-tab ${tab === 'doi' ? 'on' : ''}" data-t="doi">DOI</button>
        <button class="auth-tab ${tab === 'import' ? 'on' : ''}" data-t="import">BibTeX / RIS</button>
        <button class="auth-tab ${tab === 'zotero' ? 'on' : ''}" data-t="zotero">Zotero</button>
        <button class="auth-tab ${tab === 'manual' ? 'on' : ''}" data-t="manual">Manual</button>
      </div>
      <div id="refBody" style="margin-top:6px">${body(tab)}</div>
      <div class="auth-err" id="refErr"></div>
      <div class="row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn ghost" data-x>Close</button>
        <button class="btn" data-ok>${okLabel()}</button></div>`);
    const m = document.getElementById('modal');
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-ok]').onclick = submit;
  };
  const submit = guard(async () => {
    const m = document.getElementById('modal');
    const err = m.querySelector('#refErr'); err.textContent = '';
    const ok = m.querySelector('[data-ok]'); const label = ok.textContent;
    ok.disabled = true; ok.textContent = 'Working…';
    try {
      if (tab === 'doi') {
        const doi = m.querySelector('#rDoi').value.trim(); if (!doi) throw new Error('Enter a DOI');
        await api.addReferenceDoi(exp.id, doi); toast('Reference added');
      } else if (tab === 'import') {
        const res = await api.importReferences(exp.id, m.querySelector('#rText').value);
        toast(`Imported ${res.added}${res.skipped ? `, skipped ${res.skipped}` : ''}`);
      } else if (tab === 'zotero') {
        const res = await api.importZotero(exp.id, {
          userId: m.querySelector('#rZid').value.trim(),
          apiKey: m.querySelector('#rZkey').value.trim(),
          collectionKey: m.querySelector('#rZcol').value.trim()
        });
        toast(`Imported ${res.added} from Zotero`);
      } else {
        const url = m.querySelector('#rUrl').value.trim();
        const doi = /^10\.\S+\//.test(url) ? url : '';
        const title = m.querySelector('#rTitle').value.trim();
        if (!title) throw new Error('Title is required');
        await api.addReference(exp.id, { title, authors: m.querySelector('#rAuth').value.trim(), year: m.querySelector('#rYear').value.trim(), doi, url: doi ? '' : url });
        toast('Reference added');
      }
      closeModal(); onDone();
    } catch (ex) { err.textContent = ex.message || 'Failed'; ok.disabled = false; ok.textContent = label; }
  });
  render();
}

/* --------------------------- AI assistant --------------------------- */
const aiHistory = new Map(); // experimentId -> [{role, content}]

async function mountAssistant(root, exp) {
  const msgsEl = root.querySelector('#aiMsgs');
  const textEl = root.querySelector('#aiText');
  const sendEl = root.querySelector('#aiSend');
  const noteEl = root.querySelector('#aiNote');
  const modelEl = root.querySelector('#aiModel');
  if (!msgsEl) return;
  const history = aiHistory.get(exp.id) || [];
  aiHistory.set(exp.id, history);

  let configured = false, model = 'AI';
  try { const h = await api.aiHealth(); configured = h.configured; model = h.model || 'AI'; } catch {}
  modelEl.textContent = configured ? model : 'offline';
  if (!configured) {
    noteEl.textContent = 'Assistant not configured — set OPENAI_API_KEY in .env to enable.';
    textEl.disabled = true; sendEl.disabled = true;
  }

  const bubble = m => `<div class="ai-msg ${m.role}">${esc(m.content)}</div>`;
  const paint = () => {
    msgsEl.innerHTML = history.length ? history.map(bubble).join('')
      : '<div class="muted" style="font-size:12px;padding:8px 0">Ask about protocols, calculations, troubleshooting, or how to interpret your results.</div>';
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  paint();

  const send = guard(async () => {
    const q = textEl.value.trim();
    if (!q || sendEl.disabled) return;
    history.push({ role: 'user', content: q });
    textEl.value = '';
    paint();
    sendEl.disabled = true; textEl.disabled = true;
    msgsEl.insertAdjacentHTML('beforeend', '<div class="ai-msg assistant thinking" id="aiThinking">Thinking…</div>');
    msgsEl.scrollTop = msgsEl.scrollHeight;
    try {
      const { reply } = await api.aiChat(exp.id, history);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      history.push({ role: 'assistant', content: '⚠ ' + (err.message || 'Request failed') });
    } finally {
      sendEl.disabled = false; textEl.disabled = false; paint(); textEl.focus();
    }
  });

  sendEl.onclick = send;
  textEl.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
}

function entryHTML(en, locked) {
  const type = en.signed_by ? 'sig' : en.type;
  const badge = {
    voice: '<span class="badge b-voice">🎙 Voice</span>',
    ocr: '<span class="badge b-ocr">📷 OCR</span>',
    observe: '<span class="badge b-observe">👁 Observe</span>',
    figure: '<span class="badge b-figure">Figure</span>',
    note: '<span class="badge b-note">Note</span>'
  }[en.type] || '';
  const canSign = !en.signed_by && !locked && getUser();
  const canEdit = !en.signed_by && !locked && getUser();
  const canDelete = isAdmin();
  const deleteButton = canDelete
    ? `<button class="btn danger sm" data-delete-entry="${esc(en.id)}">Delete entry</button>`
    : `<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Admin only">Delete entry</button><span class="muted" style="font-size:11px">Admin only</span>`;
  return `<div class="entry ${type}" id="entry-${esc(en.id)}">
    <div class="eh">${badge}
      <span>🕒 ${fmt(en.created_at)}</span>
      <span>· ${esc(en.author || 'Unknown')}${en.role ? ' (' + esc(en.role) + ')' : ''}</span>
      ${en.signed_by ? `<span class="badge b-sig">🔒 ${esc(en.signature_meaning || 'signed')} by ${esc(en.signed_by)}</span>` : ''}
      ${en.updated_at && en.updated_at !== en.created_at ? `<span class="pill">edited ${fmtShort(en.updated_at)}</span>` : ''}
    </div>
    <div class="body ${canEdit ? 'editable-entry' : ''}" ${canEdit ? `data-edit-entry="${esc(en.id)}" title="Click to edit"` : ''}>${esc(en.text)}</div>
    ${canEdit ? `<div class="entry-editor" data-entry-editor="${esc(en.id)}" style="display:none">
      <textarea class="txt" data-entry-text="${esc(en.id)}">${esc(en.text)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" data-save-entry="${esc(en.id)}">Save</button>
        <button class="btn ghost sm" data-cancel-entry="${esc(en.id)}">Cancel</button>
      </div>
    </div>` : ''}
    ${sourceTags(en)}
    ${entryImages(en)}
    <div class="hashline">fingerprint ${en.hash}${en.signed_by ? ` · signed ${fmt(en.signed_at)} · sig ${en.sig}` : ''}</div>
    <div class="row" style="margin-top:8px">
      ${canSign ? `<button class="btn ok sm" data-sign="${en.id}">🔒 Sign &amp; lock entry</button>` : ''}
      ${deleteButton}
    </div>
  </div>`;
}

function sourceTags(en) {
  const ids = parseSourceEntryIds(en.source_entry_ids);
  if (!ids.length) return '';
  return `<div class="source-tags"><span class="muted">Based on</span>
    ${ids.map((id, i) => `<button class="source-tag" data-source-entry="${esc(id)}" type="button">note ${i + 1}</button>`).join('')}
  </div>`;
}

function parseSourceEntryIds(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function wireEditEntries(root, ctx, expId) {
  root.querySelectorAll('[data-edit-entry]').forEach(body => body.onclick = () => {
    const id = body.dataset.editEntry;
    const editor = root.querySelector(`[data-entry-editor="${CSS.escape(id)}"]`);
    if (!editor) return;
    body.style.display = 'none';
    editor.style.display = '';
    editor.querySelector('textarea').focus();
  });
  root.querySelectorAll('[data-cancel-entry]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.cancelEntry;
    const editor = root.querySelector(`[data-entry-editor="${CSS.escape(id)}"]`);
    const body = root.querySelector(`[data-edit-entry="${CSS.escape(id)}"]`);
    if (editor) editor.style.display = 'none';
    if (body) body.style.display = '';
  });
  root.querySelectorAll('[data-save-entry]').forEach(btn => btn.onclick = guard(async () => {
    const id = btn.dataset.saveEntry;
    const text = root.querySelector(`[data-entry-text="${CSS.escape(id)}"]`)?.value.trim();
    if (!text) return toast('Entry text is required', true);
    await api.updateEntry(id, { text });
    toast('Entry updated');
    ctx.go('experiments', { id: expId });
  }));
}

function wireSourceLinks(root) {
  root.querySelectorAll('[data-source-entry]').forEach(btn => btn.onclick = () => {
    const target = root.querySelector(`#entry-${CSS.escape(btn.dataset.sourceEntry)}`);
    if (!target) return toast('Source note is not visible here', true);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('entry-focus');
    setTimeout(() => target.classList.remove('entry-focus'), 1400);
  });
}

function wireSignButtons(root, ctx, expId) {
  root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => {
    const u = getUser();
    modal(`<h3>Sign &amp; lock entry</h3>
      <p class="muted" style="font-size:12px">By signing, you attest this record is accurate and complete. It will be locked as <b>${esc(u.name || u.email)}</b>.</p>
      <label class="fld">Signature meaning</label>
      <select class="txt" id="sigMeaning">
        <option value="author">author</option>
        <option value="reviewer">reviewer</option>
        <option value="approval">approval</option>
      </select>
      <label class="fld">Password confirmation</label>
      <input class="txt" id="sigPassword" type="password" autocomplete="current-password" placeholder="Enter your password"/>
      <div class="auth-err" id="sigErr"></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button><button class="btn ok" data-ok>Sign</button></div>`);
    const m = document.getElementById('modal');
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-ok]').onclick = guard(async () => {
      const err = m.querySelector('#sigErr'); err.textContent = '';
      try {
        await api.signEntry(b.dataset.sign, {
          meaning: m.querySelector('#sigMeaning').value,
          password: m.querySelector('#sigPassword').value,
          attestation: 'I am signing this record'
        });
        closeModal(); toast('Entry signed & locked'); ctx.go('experiments', { id: expId });
      } catch (ex) { err.textContent = ex.message || 'Signing failed'; }
    });
    setTimeout(() => m.querySelector('#sigPassword').focus(), 40);
  });
}

function wireDeleteButtons(root, ctx, expId) {
  root.querySelectorAll('[data-delete-entry]').forEach(b => b.onclick = () => {
    modal(`<h3>Delete notebook entry?</h3>
      <p class="muted">Only admins can do this. The entry will be removed from the experiment, and the deletion will be recorded in the audit trail.</p>
      <label class="fld">Reason <span class="muted">(optional)</span></label>
      <textarea class="txt" id="deleteReason" placeholder="e.g. Duplicate entry created during transcription review"></textarea>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn danger" data-delete-confirm>Delete</button>
      </div>`);
    const m = document.getElementById('modal');
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-delete-confirm]').onclick = guard(async () => {
      const reason = m.querySelector('#deleteReason').value.trim();
      await api.deleteEntry(b.dataset.deleteEntry, { reason });
      closeModal();
      toast('Entry deleted');
      ctx.go('experiments', { id: expId });
    });
    setTimeout(() => m.querySelector('#deleteReason').focus(), 40);
  });
}

async function editExperimentModal(ctx, e) {
  const projects = await api.projects();
  modal(`<h3>Edit experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" value="${esc(e.title)}"/>
    <label class="fld">Project</label><select class="txt" id="mProject">
      ${projects.map(p => `<option value="${esc(p.id)}" ${e.project_id === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.org_name || 'Workspace')}</option>`).join('')}
    </select>
    <label class="fld">Objective</label><textarea class="txt" id="mObj">${esc(e.objective)}</textarea>
    <label class="fld">Status</label><select class="txt" id="mStat">
      ${['planned', 'active', 'locked'].map(s => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    await api.updateExperiment(e.id, {
      title: m.querySelector('#mTitle').value.trim() || e.title,
      project_id: m.querySelector('#mProject').value,
      objective: m.querySelector('#mObj').value.trim(),
      status: m.querySelector('#mStat').value
    });
    closeModal(); toast('Saved'); ctx.go('experiments', { id: e.id });
  });
}

/* --------------------------- Composer --------------------------- */
async function mountComposer(mount, ctx, expId) {
  let capturedType = null, uploadedUrl = null;
  let stt = { provider: 'webspeech', serverStt: false };
  try { stt = await api.sttHealth(); } catch {}
  const serverStt = !!stt.serverStt;
  const useLiveSpeech = voiceSupported;
  const useRecorder = !useLiveSpeech && serverStt && recorderSupported;
  const voiceMode = useLiveSpeech ? 'Live dictation'
    : useRecorder ? `Server transcription · ${esc(stt.provider)}`
      : 'Voice unavailable';

  mount.innerHTML = `
    <div class="composer">
      <div class="between" style="margin-bottom:8px"><b>Add entry</b>
        <span class="reclabel" id="reclabel"><span class="dot"></span> <span id="recword">Recording…</span></span></div>
      <div class="toolbar">
        <button class="btn sm mic" id="micStart" type="button">🎙 Start voice</button>
        <button class="btn sm warn" id="micPause" type="button" style="display:none">⏸ Pause</button>
        <button class="btn sm danger" id="micStop" type="button" style="display:none">⏹ Stop</button>
        <button class="btn sm sec" id="ocrCam" type="button">📸 Camera</button>
        <button class="btn sm sec" id="ocrBtn" type="button">🖼 Upload scan</button>
        <button class="btn sm sec" id="sketchBtn" type="button">Sketch figure</button>
        <input type="file" id="ocrFile" accept="image/*" style="display:none"/>
        <span class="pill" style="margin-left:auto">${voiceMode}</span>
      </div>
      <textarea class="txt" id="composerText" placeholder="Type, dictate (Start voice), photograph a note (Camera), or upload a scan."></textarea>
      <div id="ocrPreview"></div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="saveEntry" type="button" disabled>Save entry</button>
        <button class="btn ghost sm" id="clearEntry" type="button">Clear</button>
        <span class="muted" id="composerState" style="font-size:12px"></span>
      </div>
    </div>`;

  const text = mount.querySelector('#composerText');
  const saveBtn = mount.querySelector('#saveEntry');
  const stateEl = mount.querySelector('#composerState');
  const upd = () => { saveBtn.disabled = !text.value.trim(); };
  text.addEventListener('input', () => { upd(); if (!capturedType) capturedType = 'note'; });

  const micStart = mount.querySelector('#micStart');
  const micPause = mount.querySelector('#micPause');
  const micStop = mount.querySelector('#micStop');
  const reclabel = mount.querySelector('#reclabel');
  const recword = mount.querySelector('#recword');
  function showRecording() { micStart.style.display = 'none'; micPause.style.display = ''; micStop.style.display = ''; micPause.textContent = '⏸ Pause'; micStart.classList.add('rec'); reclabel.classList.add('on'); reclabel.classList.remove('paused'); recword.textContent = 'Recording…'; }
  function showPaused() { micPause.textContent = '▶ Resume'; reclabel.classList.add('on', 'paused'); recword.textContent = 'Paused'; }
  function showIdle() { micStart.style.display = ''; micPause.style.display = 'none'; micStop.style.display = 'none'; micStart.classList.remove('rec'); reclabel.classList.remove('on', 'paused'); }

  if (useLiveSpeech) wireWebSpeech();
  else if (useRecorder) wireRecorder();
  else wireVoiceUnavailable();

  function wireWebSpeech() {
    const voice = new VoiceController({
      onText: t => { text.value = t; upd(); },
      onState: s => {
        if (s.startsWith('error')) { stateEl.textContent = 'Mic blocked — check permissions'; showIdle(); return; }
        capturedType = 'voice';
        if (s === 'recording') { showRecording(); stateEl.textContent = 'Listening… speak now'; }
        else if (s === 'paused') { showPaused(); stateEl.textContent = 'Paused — Resume or Stop'; }
        else { showIdle(); stateEl.textContent = text.value ? 'Voice captured — review & save' : ''; }
      }
    });
    micStart.onclick = () => voice.start(text.value);
    micPause.onclick = () => (voice.state === 'recording' ? voice.pause() : voice.resume());
    micStop.onclick = () => voice.stop();
    mount._voice = voice;
  }
  function wireVoiceUnavailable() {
    micStart.disabled = true;
    micStart.textContent = '🎙 Voice unavailable';
    if (serverStt && !recorderSupported) {
      micStart.title = 'This browser cannot access microphone recording here. Use HTTPS or localhost and allow microphone access.';
      stateEl.textContent = 'Voice needs a secure browser context with microphone recording.';
    } else {
      micStart.title = 'This browser does not support live dictation. Set STT_PROVIDER=auto with OPENAI_API_KEY, or STT_PROVIDER=whisper, to enable server recording.';
      stateEl.textContent = 'Voice on this device needs server transcription.';
    }
  }
  function wireRecorder() {
    const rec = new Recorder(); mount._rec = rec;
    micStart.onclick = guard(async () => { capturedType = 'voice'; try { await rec.start(); } catch { stateEl.textContent = 'Mic blocked — check permissions'; return; } showRecording(); stateEl.textContent = 'Recording… click Stop to transcribe'; });
    micPause.onclick = () => { if (rec.state === 'recording') { rec.pause(); showPaused(); stateEl.textContent = 'Paused'; } else if (rec.state === 'paused') { rec.resume(); showRecording(); stateEl.textContent = 'Recording…'; } };
    micStop.onclick = guard(async () => {
      showIdle(); stateEl.textContent = 'Transcribing…';
      const blob = await rec.stop(); if (!blob) { stateEl.textContent = ''; return; }
      try { const { text: tx } = await api.transcribe(blob); text.value = (text.value ? text.value.trimEnd() + ' ' : '') + (tx || ''); upd(); stateEl.textContent = tx ? 'Transcribed — review & save' : 'No speech detected'; }
      catch (err) { stateEl.textContent = 'Transcription failed: ' + err.message; }
    });
  }

  /* ---- OCR: shared processing for uploaded file or camera capture ---- */
  async function processOcr(dataURL, fileForUpload) {
    capturedType = 'ocr';
    mount.querySelector('#ocrPreview').innerHTML = `<img class="thumb" src="${dataURL}"/><div class="muted" style="font-size:12px;margin-top:6px" id="ocrStatus">Reading handwriting…</div>`;
    stateEl.textContent = 'Running OCR…';
    try {
      const out = await runOCR(dataURL, p => { const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = 'Reading… ' + p + '%'; });
      text.value = (text.value ? text.value + '\n' : '') + out;
      const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = out ? '✓ Text extracted — review & save' : 'No text detected — try again';
      stateEl.textContent = 'OCR complete'; upd();
      try { uploadedUrl = (await api.uploadImage(fileForUpload)).url; } catch { uploadedUrl = null; }
    } catch (err) { const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = 'OCR failed: ' + err.message; }
  }

  mount.querySelector('#ocrBtn').onclick = () => mount.querySelector('#ocrFile').click();
  mount.querySelector('#ocrFile').onchange = guard(async ev => {
    const f = ev.target.files[0]; if (!f) return;
    await processOcr(await fileToDataURL(f), f);
  });

  const camBtn = mount.querySelector('#ocrCam');
  if (!cameraSupported) { camBtn.disabled = true; camBtn.title = 'Camera not available on this device/context (needs HTTPS)'; }
  else camBtn.onclick = () => openCamera(processOcr);

  mount.querySelector('#sketchBtn').onclick = () => openSketchFigureModal({ id: expId }, () => ctx.go('experiments', { id: expId }));

  /* ---- Save / clear ---- */
  mount.querySelector('#clearEntry').onclick = () => {
    text.value = ''; capturedType = null; uploadedUrl = null;
    mount.querySelector('#ocrPreview').innerHTML = ''; stateEl.textContent = ''; upd();
    if (mount._voice && mount._voice.state !== 'idle') mount._voice.stop();
    if (mount._rec && mount._rec.state !== 'idle') mount._rec.stop();
    showIdle();
  };
  saveBtn.onclick = guard(async () => {
    const val = text.value.trim(); if (!val) return;
    if (mount._voice && mount._voice.state !== 'idle') mount._voice.stop();
    await api.addEntry(expId, { type: capturedType || 'note', text: val, imageUrl: uploadedUrl });
    toast('Entry saved & time-stamped'); ctx.go('experiments', { id: expId });
  });
}

function entryImages(en) {
  if (en.type === 'figure') {
    const clean = en.clean_image_url || en.image_url;
    const raw = en.raw_image_url;
    return `<div class="figure-entry">
      ${clean ? `<figure><img class="figure-img" src="${esc(clean)}" alt="cleaned scientific diagram"/><figcaption>Clean diagram</figcaption></figure>` : ''}
      ${raw ? `<figure><img class="figure-img raw" src="${esc(raw)}" alt="raw sketch"/><figcaption>Raw sketch</figcaption></figure>` : ''}
    </div>`;
  }
  return en.image_url ? `<img class="thumb" src="${esc(en.image_url)}" alt="scan"/>` : '';
}

/* --------------------------- Camera modal --------------------------- */
function openCamera(onCapture) {
  let stream = null, facing = 'environment';
  modal(`<h3>Capture note</h3>
    <div class="cam-wrap"><video id="camVideo" playsinline autoplay muted></video></div>
    <div class="cam-controls">
      <button class="btn" id="camShot">📸 Capture</button>
      <button class="btn sec sm" id="camFlip">🔄 Switch camera</button>
      <button class="btn ghost sm" id="camCancel">Cancel</button>
    </div>
    <div class="muted" id="camMsg" style="font-size:12px;text-align:center;margin-top:8px">Point at the handwritten note and Capture.</div>`);
  const m = document.getElementById('modal');
  const video = m.querySelector('#camVideo');

  async function begin() {
    try { stopCamera(stream); stream = await startCamera(video, facing); }
    catch (e) { m.querySelector('#camMsg').textContent = 'Camera access denied or unavailable.'; }
  }
  begin();

  const cleanup = () => { stopCamera(stream); closeModal(); };
  m.querySelector('#camCancel').onclick = cleanup;
  m.querySelector('#camFlip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; begin(); };
  m.querySelector('#camShot').onclick = guard(async () => {
    if (!stream) return;
    const { dataURL, blob } = await captureFrame(video);
    stopCamera(stream); closeModal();
    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
    onCapture(dataURL, file);
  });
}
