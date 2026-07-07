import { api } from '../api.js';
import { esc, fmt, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { isAdmin } from '../state.js';

const selected = new Set();

export const renderEntries = guard(async (root, ctx) => {
  ctx.setHead('Entries Library', 'All notebook records');
  root.innerHTML = '<div class="muted">Loading…</div>';
  const entries = await api.entries();
  const filtered = applyFilters(entries, ctx.search, root);
  selected.forEach(id => { if (!entries.some(e => e.id === id)) selected.delete(id); });

  root.innerHTML = `
    <div class="between" style="margin-bottom:12px">
      <div class="row">
        <span class="pill" id="entryCount">${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}</span>
        <span class="pill" id="selCount">${selected.size} selected</span>
      </div>
      <div class="row">
        <button class="btn sec sm" data-mode="summary" disabled>Summarise</button>
        <button class="btn sec sm" data-mode="action_plan" disabled>Bullet point</button>
        ${isAdmin() ? '<button class="btn danger sm" id="batchDelete" disabled>Delete selected</button>' : ''}
      </div>
    </div>
    <div class="card entry-tools">
      <div class="entry-filter-grid">
        <div>
          <label class="fld">Experiment</label>
          <select class="txt" id="entryExp">
            <option value="">All experiments</option>
            ${options(unique(entries, 'experiment_title'))}
          </select>
        </div>
        <div>
          <label class="fld">Type</label>
          <select class="txt" id="entryType">
            <option value="">All types</option>
            ${options(unique(entries, 'type'))}
          </select>
        </div>
        <div>
          <label class="fld">Status</label>
          <select class="txt" id="entryStatus">
            <option value="">All entries</option>
            <option value="signed">Signed</option>
            <option value="unsigned">Unsigned</option>
          </select>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="between" style="margin-bottom:10px">
        <h2 class="sec-t" style="margin:0">Notebook entries</h2>
        <div class="row">
          <button class="btn ghost sm" id="selectVisible">Select visible</button>
          <button class="btn ghost sm" id="clearSelected">Clear</button>
        </div>
      </div>
      <div id="entryLibrary">${filtered.length ? filtered.map(entryRow).join('') : '<div class="empty">No entries found.</div>'}</div>
    </div>`;

  const expFilter = root.querySelector('#entryExp');
  const typeFilter = root.querySelector('#entryType');
  const statusFilter = root.querySelector('#entryStatus');
  restoreFilter(expFilter, 'entry_exp');
  restoreFilter(typeFilter, 'entry_type');
  restoreFilter(statusFilter, 'entry_status');
  repaintList(root, entries, ctx.search, ctx);

  [expFilter, typeFilter, statusFilter].forEach(el => el.onchange = () => {
    sessionStorage.setItem(storageKey(el), el.value);
    repaintList(root, entries, ctx.search, ctx);
  });

  root.querySelector('#selectVisible').onclick = () => {
    visibleRows(root).forEach(row => selected.add(row.dataset.entryId));
    repaintSelection(root);
  };
  root.querySelector('#clearSelected').onclick = () => { selected.clear(); repaintSelection(root); };
  const deleteBtn = root.querySelector('#batchDelete');
  if (deleteBtn) deleteBtn.onclick = () => confirmModal('Delete selected entries?',
    'This removes the selected entries from the library and records each deletion in the audit trail.',
    guard(async () => {
      const res = await api.batchDeleteEntries(Array.from(selected));
      selected.clear();
      toast(`Deleted ${res.deleted} entr${res.deleted === 1 ? 'y' : 'ies'}`);
      ctx.refresh();
    }), 'Delete');
  root.querySelectorAll('[data-mode]').forEach(btn => btn.onclick = guard(() => processSelected(root, entries, btn.dataset.mode, ctx)));
});

function repaintList(root, entries, search, ctx) {
  const list = root.querySelector('#entryLibrary');
  const filtered = applyFilters(entries, search, root);
  const count = root.querySelector('#entryCount');
  if (count) count.textContent = `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`;
  list.innerHTML = filtered.length ? filtered.map(entryRow).join('') : '<div class="empty">No entries found.</div>';
  list.querySelectorAll('[data-entry-check]').forEach(chk => chk.onchange = () => {
    if (chk.checked) selected.add(chk.value);
    else selected.delete(chk.value);
    repaintSelection(root);
  });
  list.querySelectorAll('[data-open-exp]').forEach(btn => btn.onclick = () => window.__scivox?.go('experiments', { id: btn.dataset.openExp }));
  wireEntryEditing(root, ctx);
  wireSourceLinks(root);
  repaintSelection(root);
}

function repaintSelection(root) {
  root.querySelectorAll('[data-entry-check]').forEach(chk => { chk.checked = selected.has(chk.value); });
  const count = root.querySelector('#selCount');
  if (count) count.textContent = `${selected.size} selected`;
  root.querySelectorAll('[data-mode]').forEach(btn => { btn.disabled = selected.size === 0; });
  const deleteBtn = root.querySelector('#batchDelete');
  if (deleteBtn) deleteBtn.disabled = selected.size === 0;
}

function visibleRows(root) {
  return Array.from(root.querySelectorAll('[data-entry-id]'));
}

function applyFilters(entries, search, root) {
  const exp = root.querySelector?.('#entryExp')?.value || sessionStorage.getItem('scivox_entry_exp') || '';
  const type = root.querySelector?.('#entryType')?.value || sessionStorage.getItem('scivox_entry_type') || '';
  const status = root.querySelector?.('#entryStatus')?.value || sessionStorage.getItem('scivox_entry_status') || '';
  const q = (search || '').toLowerCase();
  return entries.filter(e => {
    if (exp && e.experiment_title !== exp) return false;
    if (type && e.type !== type) return false;
    if (status === 'signed' && !e.signed_by) return false;
    if (status === 'unsigned' && e.signed_by) return false;
    if (q) {
      const hay = [e.text, e.experiment_title, e.project_name, e.author, e.type].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function entryRow(en) {
  const canEdit = !en.signed_by && en.experiment_status !== 'locked';
  return `<div class="entry-lib-row ${en.signed_by ? 'signed' : ''}" data-entry-id="${esc(en.id)}">
    <input type="checkbox" data-entry-check value="${esc(en.id)}" aria-label="Select entry"/>
    <div class="entry-lib-main">
      <div class="entry-lib-head">
        ${badge(en)}
        ${en.signed_by ? `<span class="badge b-sig">Signed</span>` : ''}
      </div>
      <div class="entry-lib-meta-grid" data-entry-meta>
        ${entryMetaHTML('Experiment', en.experiment_title || 'Untitled experiment')}
        ${entryMetaHTML('Project', en.project_name || 'General')}
        ${entryMetaHTML('Created', fmt(en.created_at))}
        ${entryMetaHTML('Author', en.author || 'Unknown')}
        ${entryMetaHTML('Fingerprint', (en.hash || '').slice(0, 12), true)}
      </div>
      <div class="body ${canEdit ? 'editable-entry' : ''}" ${canEdit ? `data-lib-edit-entry="${esc(en.id)}" title="Click to edit"` : ''}>${esc(en.text)}</div>
      ${canEdit ? `<div class="entry-editor" data-lib-entry-editor="${esc(en.id)}" style="display:none">
        <textarea class="txt" data-lib-entry-text="${esc(en.id)}">${esc(en.text)}</textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn sm" data-lib-save-entry="${esc(en.id)}">Save</button>
          <button class="btn ghost sm" data-lib-cancel-entry="${esc(en.id)}">Cancel</button>
        </div>
      </div>` : ''}
      ${sourceTags(en)}
    </div>
    <button class="btn ghost sm" data-open-exp="${esc(en.experiment_id)}">Open</button>
  </div>`;
}

function entryMetaHTML(label, value, mono = false) {
  return `<div class="entry-lib-meta-item">
    <span class="entry-lib-meta-label">${esc(label)}</span>
    <span class="entry-lib-meta-value ${mono ? 'mono' : ''}">${esc(value || '—')}</span>
  </div>`;
}

function wireEntryEditing(root, ctx) {
  root.querySelectorAll('[data-lib-edit-entry]').forEach(body => body.onclick = () => {
    const id = body.dataset.libEditEntry;
    const editor = root.querySelector(`[data-lib-entry-editor="${CSS.escape(id)}"]`);
    if (!editor) return;
    body.style.display = 'none';
    editor.style.display = '';
    editor.querySelector('textarea').focus();
  });
  root.querySelectorAll('[data-lib-cancel-entry]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.libCancelEntry;
    const editor = root.querySelector(`[data-lib-entry-editor="${CSS.escape(id)}"]`);
    const body = root.querySelector(`[data-lib-edit-entry="${CSS.escape(id)}"]`);
    if (editor) editor.style.display = 'none';
    if (body) body.style.display = '';
  });
  root.querySelectorAll('[data-lib-save-entry]').forEach(btn => btn.onclick = guard(async () => {
    const id = btn.dataset.libSaveEntry;
    const text = root.querySelector(`[data-lib-entry-text="${CSS.escape(id)}"]`)?.value.trim();
    if (!text) return toast('Entry text is required', true);
    await api.updateEntry(id, { text });
    toast('Entry updated');
    ctx.refresh();
  }));
}

function badge(en) {
  const labels = {
    voice: '<span class="badge b-voice">Voice</span>',
    ocr: '<span class="badge b-ocr">OCR</span>',
    observe: '<span class="badge b-observe">Observe</span>',
    note: '<span class="badge b-note">Note</span>'
  };
  return labels[en.type] || `<span class="badge b-note">${esc(en.type || 'note')}</span>`;
}

async function processSelected(root, entries, mode, ctx) {
  const ids = Array.from(selected);
  if (!ids.length) return;
  const btns = root.querySelectorAll('[data-mode]');
  btns.forEach(b => b.disabled = true);
  try {
    const res = await api.processEntries(ids, mode);
    showResultModal(res, entries.filter(e => selected.has(e.id)), ctx);
  } finally {
    repaintSelection(root);
  }
}

function showResultModal(res, rows, ctx) {
  const canSave = res.experimentIds?.length === 1 && rows.every(e => e.experiment_status !== 'locked');
  const title = res.mode === 'action_plan' ? 'Bullet point' : 'Summary';
    modal(`<div class="between">
      <h3>${title}</h3>
      <span class="pill">${esc(res.model || 'AI')}</span>
    </div>
    <label class="fld">Generated entry</label>
    <textarea class="txt ai-output-edit" id="generatedEntryText">${esc(res.output)}</textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Close</button>
      <button class="btn sec" data-copy>Copy</button>
      ${canSave ? '<button class="btn" data-save>Save as entry</button>' : ''}
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-copy]').onclick = guard(async () => {
    await navigator.clipboard.writeText(generatedText(m));
    toast('Copied');
  });
  const saveBtn = m.querySelector('[data-save]');
  if (saveBtn) saveBtn.onclick = guard(async () => {
    const text = generatedText(m);
    if (!text) return toast('Generated entry text is required', true);
    await api.addEntry(res.experimentIds[0], {
      type: 'note',
      text,
      sourceEntryIds: rows.map(e => e.id)
    });
    closeModal();
    selected.clear();
    toast('Saved as notebook entry');
    ctx.refresh();
  });
}

function generatedText(modalEl) {
  return modalEl.querySelector('#generatedEntryText')?.value.trim() || '';
}

function unique(rows, key) {
  return Array.from(new Set(rows.map(r => r[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function options(values) {
  return values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function sourceTags(en) {
  const ids = parseSourceEntryIds(en.source_entry_ids);
  if (!ids.length) return '';
  return `<div class="source-tags"><span class="muted">Based on</span>
    ${ids.map((id, i) => `<button class="source-tag" data-source-entry="${esc(id)}" type="button">note ${i + 1}</button>`).join('')}
  </div>`;
}

function wireSourceLinks(root) {
  root.querySelectorAll('[data-source-entry]').forEach(btn => btn.onclick = guard(async () => {
    const target = visibleRows(root).find(row => row.dataset.entryId === btn.dataset.sourceEntry);
    if (!target) return openSourceEntryModal(btn);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('entry-focus');
    setTimeout(() => target.classList.remove('entry-focus'), 1400);
  }));
}

async function openSourceEntryModal(btn) {
  const en = await api.entry(btn.dataset.sourceEntry);
  const isTranscript = en.type === 'voice_transcript';
  const isRawOcr = en.type === 'ocr_raw_text';
  modal(`<div class="between">
      <h3>${isTranscript ? 'Source transcript' : isRawOcr ? 'Raw OCR output' : 'Source entry'}</h3>
      <span class="pill">${esc(en.type || 'entry')}</span>
    </div>
    <textarea class="txt" readonly style="min-height:260px">${esc(en.text || '')}</textarea>
    <div class="hashline">fingerprint ${esc(en.hash || '')}</div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Close</button>
    </div>`);
  document.getElementById('modal').querySelector('[data-x]').onclick = closeModal;
}

function parseSourceEntryIds(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function restoreFilter(el, key) {
  const value = sessionStorage.getItem(`scivox_${key}`);
  if (value && Array.from(el.options).some(o => o.value === value)) el.value = value;
}

function storageKey(el) {
  if (el.id === 'entryExp') return 'scivox_entry_exp';
  if (el.id === 'entryType') return 'scivox_entry_type';
  return 'scivox_entry_status';
}
