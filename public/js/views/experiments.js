import { api } from '../api.js';
import { esc, fmt, fmtShort, toast, modal, closeModal, confirmModal, guard, autoGrowTextareas } from '../ui.js';
import { getUser, isAdmin } from '../state.js';
import { VoiceController, voiceSupported } from '../voice.js';
import { Recorder, recorderSupported } from '../recorder.js';
import { runOCR, fileToDataURL, dataURLtoBlob, cameraSupported, startCamera, stopCamera, captureFrame } from '../ocr.js';
import { openObserverMode } from '../observer.js';
import { openSketchFigureModal } from '../sketchpad.js';

let showArchivedExperiments = false;

/* ----------------------------- List ----------------------------- */
export const renderExperiments = guard(async (root, ctx) => {
  ctx.setHead('Experiments', 'All lab experiments');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let allExps;
  let projects;
  try {
    [allExps, projects] = await withDbRetry(() =>
      Promise.all([api.experiments(showArchivedExperiments), api.projects()]));
  } catch (err) {
    return renderExperimentsLoadError(root, ctx, err.message || 'Failed to load experiments');
  }
  let exps = allExps;
  const q = ctx.search;
  if (q) exps = exps.filter(e => setupSearchText(e).toLowerCase().includes(q));
  const canCreate = canCreateExperiment(projects);
  root.innerHTML = `
    <div class="between" style="margin-bottom:16px">
      <span class="pill">${exps.length} experiment${exps.length !== 1 ? 's' : ''}</span>
      <div class="row">
        <label class="row" style="gap:7px;font-size:12px;color:var(--muted)">
          <input data-show-archived-experiments type="checkbox" ${showArchivedExperiments ? 'checked' : ''}/>
          Show archived
        </label>
        ${canCreate
          ? '<button class="btn" data-new>+ New experiment</button>'
          : '<button class="btn" data-new-disabled disabled title="Read-only project role">+ New experiment</button>'}
      </div>
    </div>
    ${exps.length ? `<div class="grid cardlist">${exps.map(card).join('')}</div>`
      : `<div class="empty"><div class="big">⚗</div>${q ? 'No matches.' : showArchivedExperiments ? 'No experiments in this view.' : canCreate ? 'No active experiments yet.' : 'Read-only project role — no writable experiments yet.'}</div>`}`;
  root.querySelector('[data-show-archived-experiments]').onchange = e => {
    showArchivedExperiments = e.target.checked;
    ctx.refresh();
  };
  const newBtn = root.querySelector('[data-new]');
  if (newBtn) newBtn.onclick = guard(() => newExperimentModal(ctx, projects.filter(canWriteProject)));
  root.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ctx.go('experiments', { id: el.dataset.exp }));
});

function card(e) {
  const archived = !!e.archived_at;
  return `<div class="card hover" data-exp="${e.id}">
    <div class="between"><h3>${esc(e.title)}</h3><span class="status s-${e.status}">${e.status}</span></div>
    ${experimentRecordIdHTML(e)}
    ${archived ? '<span class="archived-badge">Archived — read only</span>' : ''}
    <div class="muted" style="font-size:13px">${esc(e.objective || 'No objective set')}</div>
    ${outcomeStatusHTML(e)}
    ${experimentTagsHTML(e.tags)}
    ${experimentNextStepHTML(e)}
    <div class="meta"><span class="tag">${esc(e.project_name || e.project || 'General')}</span>
      <span>📝 ${e.entryCount || 0}</span><span>· ${fmtShort(e.created_at)}</span></div></div>`;
}

function experimentNextStepHTML(e) {
  const total = Number(e.stepCount) || 0;
  if (!total) return '';
  const completed = Number(e.completedStepCount) || 0;
  const open = Number(e.openStepCount) || 0;
  if (e.next_step) {
    return `<div class="next-step-preview" data-next-experiment-step="${esc(e.next_step_id || '')}" title="Next open procedure step">
      <b>Next step</b><span>${esc(e.next_step)}</span><em>${open} open · ${completed}/${total} done</em>
    </div>`;
  }
  return `<div class="next-step-preview done" data-next-experiment-step="" title="Procedure step progress">
    <b>Steps</b><span>All procedure steps complete.</span><em>${open} open · ${completed}/${total} done</em>
  </div>`;
}

function experimentRecordIdHTML(e) {
  const code = String(e?.eln_id || '').trim();
  if (!code) return '';
  return `<span class="record-id" data-eln-id="${esc(code)}" title="Stable ELN record ID"><b>ELN ID</b> ${esc(code)}</span>`;
}

function canCreateExperiment(projects) {
  return (projects || []).some(canWriteProject);
}

function canWriteProject(p) {
  return isAdmin() || !!p?.access?.can_write || ['scientist', 'reviewer', 'owner', 'admin'].includes(p?.current_user_project_role);
}

function experimentAccess(e) {
  const access = e?.access || {};
  return {
    project_role: access.project_role || (isAdmin() ? 'admin' : 'viewer'),
    can_read: access.can_read !== false,
    can_write: !!access.can_write || isAdmin(),
    can_review: !!access.can_review || isAdmin(),
    can_manage_members: !!access.can_manage_members || isAdmin(),
    can_admin_delete: !!access.can_admin_delete || isAdmin()
  };
}

async function newExperimentModal(ctx, writableProjects = null) {
  const projects = writableProjects || (await api.projects()).filter(canWriteProject);
  if (!projects.length) return toast('Read-only project role — ask an owner for scientist access.', true);
  let templates = [];
  try {
    const writableProjectIds = new Set(projects.map(p => p.id));
    templates = (await api.experimentTemplates()).filter(t => writableProjectIds.has(t.project_id));
  } catch {}
  modal(`<h3>New experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" placeholder="e.g. Buffer stability study"/>
    <label class="fld">Project</label><select class="txt" id="mProject">
      ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.org_name || 'Workspace')}</option>`).join('')}
    </select>
    <label class="fld">Use template</label><select class="txt" id="mTemplate">
      <option value="">Blank experiment</option>
      ${templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.project_name || 'Project')}</option>`).join('')}
    </select>
    <div class="hint" id="mTemplateHint" style="margin-top:6px">Templates fill objective, protocol, materials, success criteria and safety notes.</div>
    <label class="fld">Tags</label><input class="txt" id="mTags" placeholder="e.g. mRNA, stability, QC"/>
    <label class="fld">Objective</label><textarea class="txt" id="mObj" placeholder="What are you trying to find out?"></textarea>
    <label class="fld">Hypothesis</label><textarea class="txt compact" id="mHypothesis" placeholder="What result do you expect, and why?"></textarea>
    <label class="fld">Protocol / method</label><textarea class="txt compact" id="mProtocol" placeholder="Key method steps, instrument settings, or protocol reference"></textarea>
    <label class="fld">Materials / reagents</label><textarea class="txt compact" id="mMaterials" placeholder="Critical samples, reagent lots, equipment, or cells"></textarea>
    <label class="fld">Success criteria</label><textarea class="txt compact" id="mSuccessCriteria" placeholder="What result would count as a pass or useful outcome?"></textarea>
    <label class="fld">Safety notes</label><textarea class="txt compact" id="mSafetyNotes" placeholder="Hazards, PPE, waste handling, or approvals"></textarea>
    ${metadataFieldsHTML()}
    <label class="fld">Experiment outcome</label><select class="txt" id="mOutcomeStatus">
      ${outcomeStatusOptions('running')}
    </select>
    <textarea class="txt compact" id="mOutcomeSummary" placeholder="Summarize the observed result, deviation, or why the run remains in progress"></textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Create</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  const templateMap = new Map(templates.map(t => [t.id, t]));
  m.querySelector('#mTemplate').onchange = () => applyExperimentTemplate(m, templateMap.get(m.querySelector('#mTemplate').value));
  wireMetadataEditor(m);
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const title = m.querySelector('#mTitle').value.trim();
    if (!title) return toast('Title required', true);
    const selectedTemplateId = m.querySelector('#mTemplate').value;
    const exp = await api.createExperiment({
      title,
      project_id: m.querySelector('#mProject').value,
      template_id: selectedTemplateId,
      tags: m.querySelector('#mTags').value.trim(),
      objective: m.querySelector('#mObj').value.trim(),
      hypothesis: m.querySelector('#mHypothesis').value.trim(),
      protocol: m.querySelector('#mProtocol').value.trim(),
      materials: m.querySelector('#mMaterials').value.trim(),
      success_criteria: m.querySelector('#mSuccessCriteria').value.trim(),
      safety_notes: m.querySelector('#mSafetyNotes').value.trim(),
      metadata: readMetadataFields(m),
      outcome_status: m.querySelector('#mOutcomeStatus').value,
      outcome_summary: m.querySelector('#mOutcomeSummary').value.trim()
    });
    closeModal(); toast('Experiment created'); ctx.go('experiments', { id: exp.id });
  });
  setTimeout(() => m.querySelector('#mTitle').focus(), 40);
}

function applyExperimentTemplate(modalEl, template) {
  if (!template) return;
  modalEl.querySelector('#mProject').value = template.project_id;
  modalEl.querySelector('#mObj').value = template.objective || '';
  modalEl.querySelector('#mHypothesis').value = template.hypothesis || '';
  modalEl.querySelector('#mProtocol').value = template.protocol || '';
  modalEl.querySelector('#mMaterials').value = template.materials || '';
  modalEl.querySelector('#mSuccessCriteria').value = template.success_criteria || '';
  modalEl.querySelector('#mSafetyNotes').value = template.safety_notes || '';
  applyMetadataFields(modalEl, template.metadata);
  const hint = modalEl.querySelector('#mTemplateHint');
  if (hint) hint.textContent = template.description || 'Template setup applied. Edit any field before creating the experiment.';
  autoGrowTextareas(modalEl);
}

/* --------------------------- Single view --------------------------- */
export const renderExperiment = guard(async (root, ctx, id) => {
  root.innerHTML = '<div class="muted">Loading experiment…</div>';
  let e;
  try {
    e = await withDbRetry(() => api.experiment(id));
  } catch (err) {
    return renderExperimentLoadError(root, ctx, id, err.message || 'Failed to load experiment');
  }
  if (!e || typeof e !== 'object' || !Array.isArray(e.entries)) {
    return renderExperimentLoadError(root, ctx, id, 'This experiment could not be loaded (unexpected server response).');
  }
  ctx.setHead(e.title, `${e.project_name || e.project || 'General'} · created ${fmtShort(e.created_at)}`);
  const archived = !!e.archived_at;
  const locked = e.status === 'locked';
  const access = experimentAccess(e);
  const canWrite = access.can_write && !archived;
  const canReview = access.can_review && !archived;
  const viewAccess = { ...access, can_write: canWrite, can_review: canReview };
  const canEditExperiment = canWrite && !locked;
  const canReviewExperiment = canReview && !locked;
  const deleteButton = experimentDeleteButton(locked, access);
  root.innerHTML = `
    <button class="btn ghost sm" data-back>← Back to experiments</button>
    <div class="split" style="margin-top:14px">
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="experiment-card-head">
            <div class="row"><h2 class="sec-t" style="margin:0">${esc(e.title)}</h2><span class="status s-${e.status}">${e.status}</span>${experimentRecordIdHTML(e)}${archived ? '<span class="archived-badge">Archived — read only</span>' : ''}</div>
            ${exportMenu(e.id)}
          </div>
          <div class="muted" style="font-size:13px;margin-top:6px">${esc(e.objective || 'No objective set')}</div>
          ${experimentTagsHTML(e.tags)}
          ${experimentSetupHTML(e)}
          ${experimentMetadataHTML(e.metadata)}
          ${experimentOutcomeHTML(e)}
          <div class="row" style="margin-top:12px">
            ${canEditExperiment ? '<button class="btn sec sm" data-edit>Edit details</button>' : '<button class="btn sec sm" disabled title="Read-only project role">Edit details</button>'}
            ${canWrite ? '<button class="btn sec sm" data-save-template>Save as template</button>' : ''}
            ${canWrite ? '<button class="btn sec sm" data-duplicate-experiment>Repeat setup</button>' : ''}
            ${archived ? '<span class="pill danger">Archived — read only</span>' : locked ? '<span class="pill">🔒 Locked — read only</span>' : canWrite ? '<button class="btn sec sm" data-observe>👁 Observe run</button>' : ''}
            ${locked ? '' : canReviewExperiment ? '<button class="btn ok sm" data-lock>🔒 Lock experiment</button>' : '<button class="btn ok sm" disabled title="Reviewer role required">🔒 Lock experiment</button>'}
            ${experimentArchiveButton(e, access)}
            ${deleteButton}
          </div>
          ${archived ? '<div class="hint">Archived — read only. Restore before adding entries, references, attachments, or edits.</div>' : !canWrite ? '<div class="hint">Read-only project role — you can inspect records and exports, but writing entries requires scientist access.</div>' : ''}
        </div>
        <div class="card procedure-card" style="margin-top:16px">
          <div class="between">
            <h2 class="sec-t" style="margin:0">Procedure steps</h2>
            <div class="row">
              ${canEditExperiment && e.entries.length ? '<button class="btn sec sm" type="button" data-suggest-experiment-steps>Suggest steps</button>' : ''}
              <button class="btn sm" type="button" data-add-experiment-step>+ Step</button>
            </div>
          </div>
          <p class="muted" style="font-size:11px;margin:6px 0 0">Track run actions as a checklist; completed steps stay in the experiment audit trail.</p>
          <div id="experimentStepsList" style="margin-top:10px"></div>
        </div>
        ${canWrite && !locked ? '<div id="composerMount"></div>' : ''}
        <div class="card" style="margin-top:16px">
          <div class="between">
            <h2 class="sec-t" style="margin:0">Notebook entries <span class="muted" style="font-weight:400">(${e.entries.length})</span></h2>
            ${e.entries.length ? '<button class="btn sec sm" type="button" data-summarise-experiment>Summarise entries</button>' : ''}
          </div>
          <div id="entryFeed">${e.entries.map(en => entryHTML(en, locked || archived, viewAccess)).join('') || '<div class="empty">No entries yet.</div>'}</div>
        </div>
      </div>
      <div class="experiment-side">
        <div class="card ai-card">
          <div class="between"><h2 class="sec-t" style="margin:0">🤖 AI assistant</h2><span class="pill" id="aiModel">…</span></div>
          <p class="muted" style="font-size:11px;margin:6px 0 0">Context-aware help for this experiment. It advises only — it can't change the notebook.</p>
          <div class="ai-prompt-bar" id="aiPromptBar"></div>
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
          <div class="between"><h2 class="sec-t" style="margin:0">Related experiments</h2><button class="btn sm" type="button" data-add-experiment-link>+ Link</button></div>
          <p class="muted" style="font-size:11px;margin:6px 0 0">Connect follow-up, repeat, control, or related protocol records.</p>
          <div id="experimentLinksList" style="margin-top:8px"></div>
        </div>
        <div class="card">
          <div class="between"><h2 class="sec-t" style="margin:0">Attachments</h2><button class="btn sm" type="button" data-add-attachment>Attach file</button></div>
          <p class="muted" style="font-size:11px;margin:6px 0 0">Attach raw data, instrument exports, PDFs, spreadsheets or supporting files to this experiment.</p>
          <div id="experimentAttachmentsList" style="margin-top:8px"></div>
        </div>
        <div class="card">
          <div class="between"><h2 class="sec-t" style="margin:0">📚 References</h2><button class="btn sm" id="refAdd">+ Add</button></div>
          <p class="muted" style="font-size:11px;margin:6px 0 0">Papers linked to this experiment — add by DOI, import BibTeX/RIS (a Zotero or Mendeley export), or pull from a Zotero library.</p>
          <div id="refList" style="margin-top:8px"></div>
        </div>
      </div>
  </div>`;
  root.querySelector('[data-back]').onclick = () => ctx.go('experiments');
  const editBtn = root.querySelector('[data-edit]');
  if (editBtn) editBtn.onclick = guard(() => editExperimentModal(ctx, e));
  const saveTemplateBtn = root.querySelector('[data-save-template]');
  if (saveTemplateBtn) saveTemplateBtn.onclick = guard(() => saveExperimentTemplateModal(ctx, e));
  const duplicateBtn = root.querySelector('[data-duplicate-experiment]');
  if (duplicateBtn) duplicateBtn.onclick = guard(() => duplicateExperimentModal(ctx, e));
  const observeBtn = root.querySelector('[data-observe]');
  if (observeBtn) observeBtn.onclick = () => openObserverMode(e, ctx);
  const lockBtn = root.querySelector('[data-lock]');
  if (lockBtn) lockBtn.onclick = () => confirmModal('Lock experiment?',
    'Locking makes this experiment read-only. No new entries can be added.',
    guard(async () => { await api.lockExperiment(e.id); toast('Experiment locked'); ctx.go('experiments', { id: e.id }); }));
  wireExportMenu(root);
  wireExperimentArchiveButton(root, ctx, e);
  wireExperimentDeleteButton(root, ctx, e);
  wireSignButtons(root, ctx, e.id, viewAccess);
  wireDeleteButtons(root, ctx, e.id);
  wireEditEntries(root, ctx, e.id);
  wireCommentButtons(root, ctx, e.id);
  wireSourceLinks(root);
  wireEntryRevisionButtons(root);
  const summariseBtn = root.querySelector('[data-summarise-experiment]');
  if (summariseBtn) summariseBtn.onclick = guard(() => summariseExperimentEntries(e, ctx));
  const suggestStepsBtn = root.querySelector('[data-suggest-experiment-steps]');
  if (suggestStepsBtn) suggestStepsBtn.onclick = guard(() => suggestExperimentSteps(e, ctx));
  if (canWrite && !locked) mountComposer(root.querySelector('#composerMount'), ctx, e.id);
  mountExperimentSteps(root, e, viewAccess);
  mountAssistant(root, e, viewAccess);
  mountExperimentLinks(root, e, viewAccess, ctx);
  mountExperimentAttachments(root, e, viewAccess);
  mountReferences(root, e, viewAccess);
});

function renderExperimentLoadError(root, ctx, id, message) {
  root.innerHTML = `
    <button class="btn ghost sm" data-back>← Back to experiments</button>
    <div class="card" style="margin-top:14px">
      <h2 class="sec-t">Couldn't open this experiment</h2>
      <p class="muted" style="margin-top:0">${esc(message)}</p>
      <div class="hint" style="margin-top:0">If this keeps happening, the database may be locked — this is common when the app's <code>data/</code> folder is inside a syncing cloud drive (e.g. OneDrive). Point <code>DATA_DIR</code> at a local folder outside the synced path, or run via Docker.</div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-retry>Retry</button>
        <button class="btn ghost" data-back2>Back to experiments</button>
      </div>
    </div>`;
  const back = () => ctx.go('experiments');
  root.querySelector('[data-back]').onclick = back;
  root.querySelector('[data-back2]').onclick = back;
  root.querySelector('[data-retry]').onclick = () => ctx.go('experiments', { id });
}

function renderExperimentsLoadError(root, ctx, message) {
  root.innerHTML = `
    <div class="card" style="margin-top:14px">
      <h2 class="sec-t">Couldn't open experiments</h2>
      <p class="muted" style="margin-top:0">${esc(message)}</p>
      <div class="hint" style="margin-top:0">If this keeps happening, the database may be locked — this is common when the app's <code>data/</code> folder is inside a syncing cloud drive (e.g. OneDrive). Point <code>DATA_DIR</code> at a local folder outside the synced path, or run via Docker.</div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-retry>Retry</button>
      </div>
    </div>`;
  root.querySelector('[data-retry]').onclick = () => ctx.go('experiments');
}

function isDbLockError(err) {
  return /database is locked/i.test(String(err?.message || ''));
}

async function withDbRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDbLockError(err) || i >= attempts - 1) throw err;
      await sleep((i + 1) * 250);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exportMenu(expId) {
  const base = `/api/experiments/${esc(expId)}/export`;
  return `<div class="export-menu">
    <button class="btn ghost sm export-trigger" type="button" data-export-toggle aria-haspopup="true" aria-expanded="false" title="Export options">...</button>
    <div class="export-popover" data-export-menu hidden>
      <a href="${base}?format=pdf" download>Export PDF</a>
      <a href="${base}?format=html" download>Export HTML</a>
      <a href="${base}" download>Export JSON</a>
      <a href="${base}?format=rocrate" download>Export RO-Crate</a>
      <a href="${base}?format=zip" download>Export ZIP bundle</a>
    </div>
  </div>`;
}

function setupSearchText(e) {
  return [
    e.eln_id, e.title, e.project, e.project_name, e.objective, e.hypothesis, e.protocol,
    e.materials, e.success_criteria, e.safety_notes, e.tags,
    metadataSearchText(e.metadata), e.outcome_status, outcomeStatusLabel(e.outcome_status), e.outcome_summary
  ].filter(Boolean).join(' ');
}

function outcomeStatusLabel(status) {
  return {
    running: 'Running',
    needs_redo: 'Needs redo',
    success: 'Success',
    fail: 'Fail',
    inconclusive: 'Inconclusive'
  }[String(status || 'running')] || 'Running';
}

function outcomeStatusClass(status) {
  return String(status || 'running').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'running';
}

function outcomeStatusOptions(selected = 'running') {
  return ['running', 'needs_redo', 'success', 'fail', 'inconclusive']
    .map(status => `<option value="${status}" ${String(selected || 'running') === status ? 'selected' : ''}>${outcomeStatusLabel(status)}</option>`)
    .join('');
}

function outcomeStatusHTML(e) {
  return `<div class="outcome-inline">
    <span class="outcome-badge outcome-${outcomeStatusClass(e.outcome_status)}">${esc(outcomeStatusLabel(e.outcome_status))}</span>
  </div>`;
}

function parseExperimentTags(tags) {
  return Array.from(new Set(String(tags || '')
    .split(/[,;]+/)
    .map(tag => tag.trim())
    .filter(Boolean)))
    .slice(0, 12);
}

function experimentTagsHTML(tags) {
  const parsed = parseExperimentTags(tags);
  if (!parsed.length) return '';
  return `<div class="experiment-tags" aria-label="Experiment tags">${parsed.map(tag => `<span class="experiment-tag">${esc(tag)}</span>`).join('')}</div>`;
}

function experimentMetadataHTML(metadata) {
  const fields = metadataEntries(metadata);
  if (!fields.length) return '';
  return `<div class="metadata-panel">
    <div class="study-setup-title">Custom metadata</div>
    <div class="metadata-grid">${fields.map(([label, field]) => `
      <div class="metadata-item">
        <div class="metadata-label">${esc(label)}</div>
        <div class="metadata-value">${esc(formatMetadataValue(field) || 'Not set')}</div>
      </div>`).join('')}</div>
  </div>`;
}

function metadataSearchText(metadata) {
  return metadataEntries(metadata).map(([label, field]) => `${label} ${field.value || ''} ${field.unit || ''}`).join(' ');
}

function metadataEntries(metadata) {
  const fields = metadata?.extra_fields && typeof metadata.extra_fields === 'object' ? metadata.extra_fields : {};
  return Object.entries(fields)
    .filter(([label, field]) => String(label || '').trim() && field && typeof field === 'object')
    .sort((a, b) => (Number(a[1].position) || 0) - (Number(b[1].position) || 0) || a[0].localeCompare(b[0]));
}

function formatMetadataValue(field) {
  return [field?.value, field?.unit].filter(Boolean).join(' ');
}

function experimentSetupHTML(e) {
  const items = [
    ['Hypothesis', e.hypothesis],
    ['Protocol / method', e.protocol],
    ['Materials / reagents', e.materials],
    ['Success criteria', e.success_criteria],
    ['Safety notes', e.safety_notes]
  ];
  return `<div class="study-setup">
    <div class="study-setup-title">Study setup</div>
    <div class="study-setup-grid">${items.map(([label, value]) => `
      <div class="study-setup-item">
        <div class="study-setup-label">${esc(label)}</div>
        <div class="study-setup-value">${esc(value || 'Not set')}</div>
      </div>`).join('')}</div>
  </div>`;
}

function experimentOutcomeHTML(e) {
  return `<div class="outcome-panel">
    <div class="between">
      <div class="study-setup-title" style="margin-bottom:0">Experiment outcome</div>
      ${outcomeStatusHTML(e)}
    </div>
    <div class="study-setup-value" style="margin-top:8px">${esc(e.outcome_summary || 'No outcome note yet.')}</div>
  </div>`;
}

function metadataFieldsHTML(metadata = null) {
  const rows = metadataEntries(metadata);
  return `<div class="metadata-editor" data-metadata-editor>
    <div class="between">
      <label class="fld" style="margin:12px 0 5px">Custom metadata</label>
      <button class="btn ghost sm" type="button" data-add-metadata>+ Field</button>
    </div>
    <div class="metadata-list" data-metadata-list>
      ${rows.map(([label, field]) => metadataFieldRow(label, field)).join('')}
    </div>
    <div class="hint" style="margin-top:6px">Optional structured fields for sample IDs, strain, cell line, instrument, temperature, or assay readout.</div>
  </div>`;
}

function metadataFieldRow(label = '', field = {}, index = 0) {
  return `<div class="metadata-row" data-metadata-row>
    <input class="txt" data-metadata-name placeholder="Field" value="${esc(label)}"/>
    <input class="txt" data-metadata-value placeholder="Value" value="${esc(field?.value || '')}"/>
    <input class="txt" data-metadata-unit placeholder="Unit" value="${esc(field?.unit || '')}"/>
    <button class="btn ghost sm" type="button" data-remove-metadata title="Remove metadata field">Remove</button>
  </div>`;
}

function wireMetadataEditor(root) {
  const list = root.querySelector('[data-metadata-list]');
  if (!list) return;
  const add = root.querySelector('[data-add-metadata]');
  if (add) add.onclick = () => {
    list.insertAdjacentHTML('beforeend', metadataFieldRow('', {}, list.querySelectorAll('[data-metadata-row]').length));
    wireMetadataEditor(root);
    const last = list.querySelector('[data-metadata-row]:last-child [data-metadata-name]');
    if (last) last.focus();
  };
  list.querySelectorAll('[data-remove-metadata]').forEach(btn => {
    btn.onclick = () => btn.closest('[data-metadata-row]')?.remove();
  });
}

function readMetadataFields(root) {
  const extra_fields = {};
  root.querySelectorAll('[data-metadata-row]').forEach((row, index) => {
    const name = row.querySelector('[data-metadata-name]')?.value.trim();
    const value = row.querySelector('[data-metadata-value]')?.value.trim();
    const unit = row.querySelector('[data-metadata-unit]')?.value.trim();
    if (!name || (!value && !unit)) return;
    extra_fields[name] = {
      type: inferMetadataInputType(value),
      value: value || '',
      ...(unit ? { unit } : {}),
      position: index + 1
    };
  });
  return { extra_fields };
}

function applyMetadataFields(modalEl, metadata = null) {
  const list = modalEl.querySelector('[data-metadata-list]');
  if (!list) return;
  list.innerHTML = metadataEntries(metadata).map(([label, field]) => metadataFieldRow(label, field)).join('');
  wireMetadataEditor(modalEl);
}

function inferMetadataInputType(value) {
  const text = String(value || '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'date';
  if (/^https?:\/\//i.test(text)) return 'url';
  return 'text';
}

function wireExportMenu(root) {
  const btn = root.querySelector('[data-export-toggle]');
  const menu = root.querySelector('[data-export-menu]');
  if (!btn || !menu) return;
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.onclick = e => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  };
  menu.onclick = e => e.stopPropagation();
  root.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('.export-menu')) close();
  });
}

function experimentDeleteButton(locked, access = { can_admin_delete: isAdmin() }) {
  if (!access.can_admin_delete) {
    return '<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Admin only">Delete experiment</button><span class="muted" style="font-size:11px">Admin only</span>';
  }
  if (locked) {
    return '<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Locked experiments cannot be deleted">Delete experiment</button>';
  }
  return '<button class="btn danger sm" type="button" data-delete-experiment>Delete experiment</button>';
}

function experimentArchiveButton(exp, access = experimentAccess({})) {
  if (!access.can_write) return '';
  if (exp.archived_at) return '<button class="btn ok sm" type="button" data-restore-experiment>Restore experiment</button>';
  return '<button class="btn sec sm" type="button" data-archive-experiment>Archive experiment</button>';
}

function wireExperimentArchiveButton(root, ctx, exp) {
  const archiveBtn = root.querySelector('[data-archive-experiment]');
  if (archiveBtn) archiveBtn.onclick = () => confirmModal('Archive experiment?',
    `<b>${esc(exp.title)}</b> will be hidden from the default experiment list and become read-only until restored. Entries, signatures, comments, attachments and audit history stay intact.`,
    guard(async () => {
      await api.archiveExperiment(exp.id);
      toast('Experiment archived');
      ctx.go('experiments');
    }),
    'Archive');

  const restoreBtn = root.querySelector('[data-restore-experiment]');
  if (restoreBtn) restoreBtn.onclick = () => confirmModal('Restore experiment?',
    `<b>${esc(exp.title)}</b> will return to the default experiment list and become editable for users with write access.`,
    guard(async () => {
      await api.restoreExperiment(exp.id);
      toast('Experiment restored');
      ctx.go('experiments', { id: exp.id });
    }),
    'Restore');
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

/* ------------------------- Procedure steps ------------------------- */
async function mountExperimentSteps(root, exp, access = experimentAccess(exp)) {
  const listEl = root.querySelector('#experimentStepsList');
  const addBtn = root.querySelector('[data-add-experiment-step]');
  if (!listEl) return;
  const canEditSteps = access.can_write && exp.status !== 'locked';
  if (addBtn && !canEditSteps) {
    addBtn.disabled = true;
    addBtn.title = exp.status === 'locked' ? 'Locked experiments are read-only' : 'Read-only project role';
  }

  const load = async () => {
    listEl.innerHTML = '<div class="muted" style="font-size:12px">Loading...</div>';
    let steps = [];
    try { steps = await api.experimentSteps(exp.id); }
    catch { listEl.innerHTML = '<div class="muted" style="font-size:12px">Failed to load procedure steps.</div>'; return; }
    const nextStep = steps.find(step => !Number(step.done));
    listEl.innerHTML = steps.length
      ? `${nextStep ? `<div class="step-next">Next step: ${esc(nextStep.text)}</div>` : '<div class="step-next done">All procedure steps complete.</div>'}
        <div class="experiment-step-list">${steps.map(step => experimentStepItem(step, canEditSteps)).join('')}</div>`
      : '<div class="muted" style="font-size:12px;padding:6px 0">No procedure steps yet.</div>';
    if (canEditSteps) {
      listEl.querySelectorAll('[data-toggle-experiment-step]').forEach(input => {
        input.onchange = guard(async () => {
          await api.updateExperimentStep(exp.id, input.dataset.toggleExperimentStep, { done: input.checked });
          toast(input.checked ? 'Step completed' : 'Step reopened');
          await load();
        });
      });
      listEl.querySelectorAll('[data-delete-experiment-step]').forEach(btn => {
        btn.onclick = () => confirmModal(
          'Remove procedure step?',
          'This removes the step from the active checklist. The audit trail keeps the removal event.',
          guard(async () => {
            await api.deleteExperimentStep(exp.id, btn.dataset.deleteExperimentStep);
            toast('Procedure step removed');
            await load();
          }),
          'Remove'
        );
      });
    }
  };

  if (addBtn && canEditSteps) addBtn.onclick = () => addExperimentStepModal(exp, load);
  await load();
}

function experimentStepItem(step, canEditSteps = true) {
  const done = Number(step.done) === 1;
  const meta = done && step.completed_at ? `Completed ${fmtShort(step.completed_at)}${step.completed_by ? ` by ${step.completed_by}` : ''}` : 'Open';
  return `<div class="experiment-step ${done ? 'done' : ''}">
    <label class="experiment-step-main">
      <input type="checkbox" data-toggle-experiment-step="${esc(step.id)}" ${done ? 'checked' : ''} ${canEditSteps ? '' : 'disabled'}/>
      <span>
        <span class="experiment-step-text">${esc(step.text)}</span>
        <span class="experiment-step-meta">${esc(meta)}</span>
      </span>
    </label>
    ${canEditSteps ? `<button class="experiment-step-del" type="button" data-delete-experiment-step="${esc(step.id)}" title="Remove procedure step">Remove</button>` : ''}
  </div>`;
}

function addExperimentStepModal(exp, onDone) {
  modal(`<h3>Add procedure step</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Add the next action a scientist should perform during this experiment.</p>
    <label class="fld">Step</label>
    <textarea class="txt compact" id="experimentStepText" placeholder="e.g. Thaw aliquots on ice and record thaw duration"></textarea>
    <div class="auth-err" id="experimentStepErr"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button>
      <button class="btn" data-save-experiment-step>Add step</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-save-experiment-step]').onclick = guard(async () => {
    const err = m.querySelector('#experimentStepErr');
    const text = m.querySelector('#experimentStepText').value.trim();
    err.textContent = '';
    if (!text) {
      err.textContent = 'Step text is required';
      return;
    }
    await api.addExperimentStep(exp.id, { text });
    closeModal();
    toast('Procedure step added');
    await onDone();
  });
  setTimeout(() => m.querySelector('#experimentStepText').focus(), 40);
}

/* ---------------------- Related experiments ---------------------- */
async function mountExperimentLinks(root, exp, access = experimentAccess(exp), ctx) {
  const listEl = root.querySelector('#experimentLinksList');
  const addBtn = root.querySelector('[data-add-experiment-link]');
  if (!listEl) return;
  const canEditLinks = access.can_write && exp.status !== 'locked';
  if (addBtn && !canEditLinks) {
    addBtn.disabled = true;
    addBtn.title = exp.status === 'locked' ? 'Locked experiments are read-only' : 'Read-only project role';
  }

  const load = async () => {
    listEl.innerHTML = '<div class="muted" style="font-size:12px">Loading...</div>';
    let links = [];
    try { links = await api.experimentLinks(exp.id); }
    catch { listEl.innerHTML = '<div class="muted" style="font-size:12px">Failed to load related experiments.</div>'; return; }
    listEl.innerHTML = links.length
      ? links.map(link => experimentLinkItem(link, canEditLinks)).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 0">No related experiments yet.</div>';
    listEl.querySelectorAll('[data-open-experiment-link]').forEach(btn => {
      btn.onclick = () => ctx.go('experiments', { id: btn.dataset.openExperimentLink });
    });
    if (canEditLinks) {
      listEl.querySelectorAll('[data-delete-experiment-link]').forEach(btn => {
        btn.onclick = () => confirmModal(
          'Remove related experiment?',
          'This removes the relationship from this experiment. The linked experiment record is not deleted.',
          guard(async () => {
            await api.deleteExperimentLink(exp.id, btn.dataset.deleteExperimentLink);
            toast('Related experiment removed');
            await load();
          }),
          'Remove'
        );
      });
    }
  };

  if (addBtn && canEditLinks) addBtn.onclick = () => addExperimentLinkModal(exp, load);
  await load();
}

function experimentLinkItem(link, canEditLinks = true) {
  const meta = [link.linked_project_name || link.linked_project || 'General', link.linked_status].filter(Boolean).join(' | ');
  return `<div class="experiment-link">
    <button class="experiment-link-main" type="button" data-open-experiment-link="${esc(link.linked_experiment_id)}">
      <span class="experiment-link-title">${esc(link.linked_title || 'Untitled experiment')}</span>
      <span class="experiment-link-meta">${esc(meta)}</span>
      ${link.note ? `<span class="experiment-link-note">${esc(link.note)}</span>` : ''}
    </button>
    ${canEditLinks ? `<button class="experiment-link-del" type="button" data-delete-experiment-link="${esc(link.id)}" title="Remove related experiment">Remove</button>` : ''}
  </div>`;
}

async function addExperimentLinkModal(exp, onDone) {
  const experiments = (await api.experiments()).filter(candidate => candidate.id !== exp.id);
  if (!experiments.length) return toast('Create another experiment before linking.', true);
  modal(`<h3>Link experiment</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Choose an existing experiment to connect as a follow-up, repeat, control, or related protocol record.</p>
    <label class="fld">Experiment</label>
    <select class="txt" id="linkedExperimentId">
      ${experiments.map(candidate => `<option value="${esc(candidate.id)}">${esc(candidate.title)} · ${esc(candidate.project_name || candidate.project || 'General')}</option>`).join('')}
    </select>
    <label class="fld">Note <span class="muted">(optional)</span></label>
    <textarea class="txt compact" id="linkedExperimentNote" placeholder="e.g. Follow-up run using the same setup"></textarea>
    <div class="auth-err" id="experimentLinkErr"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button>
      <button class="btn" data-save-experiment-link>Link experiment</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-save-experiment-link]').onclick = guard(async () => {
    const err = m.querySelector('#experimentLinkErr');
    err.textContent = '';
    await api.addExperimentLink(exp.id, {
      linkedExperimentId: m.querySelector('#linkedExperimentId').value,
      note: m.querySelector('#linkedExperimentNote').value.trim()
    });
    closeModal();
    toast('Experiment linked');
    await onDone();
  });
  setTimeout(() => m.querySelector('#linkedExperimentId').focus(), 40);
}

/* --------------------------- Attachments --------------------------- */
async function mountExperimentAttachments(root, exp, access = experimentAccess(exp)) {
  const listEl = root.querySelector('#experimentAttachmentsList');
  const addBtn = root.querySelector('[data-add-attachment]');
  if (!listEl) return;
  const canEditAttachments = access.can_write && exp.status !== 'locked';
  if (addBtn && !canEditAttachments) {
    addBtn.disabled = true;
    addBtn.title = exp.status === 'locked' ? 'Locked experiments are read-only' : 'Read-only project role';
  }

  const load = async () => {
    listEl.innerHTML = '<div class="muted" style="font-size:12px">Loading...</div>';
    let attachments = [];
    try { attachments = await api.experimentAttachments(exp.id); }
    catch { listEl.innerHTML = '<div class="muted" style="font-size:12px">Failed to load attachments.</div>'; return; }
    listEl.innerHTML = attachments.length
      ? attachments.map(att => attachmentItem(att, canEditAttachments)).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 0">No attachments yet.</div>';
    if (canEditAttachments) {
      listEl.querySelectorAll('[data-delete-attachment]').forEach(btn => {
        btn.onclick = () => confirmModal(
          'Remove attachment?',
          'This removes the file from the active attachment list. The audit trail keeps the file hash and removal event.',
          guard(async () => {
            await api.deleteExperimentAttachment(exp.id, btn.dataset.deleteAttachment);
            toast('Attachment removed');
            await load();
          }),
          'Remove'
        );
      });
    }
  };

  if (addBtn && canEditAttachments) addBtn.onclick = () => addAttachmentModal(exp, load);
  await load();
}

function attachmentItem(att, canEditAttachments = true) {
  const meta = [formatFileSize(att.size), att.mime_type || 'file', fmtShort(att.uploaded_at)].filter(Boolean).join(' | ');
  return `<div class="attachment-item">
    <a class="attachment-main" href="${esc(att.url)}" target="_blank" rel="noopener" download="${esc(att.original_name)}">
      <span class="attachment-title">${esc(att.original_name || 'attachment')}</span>
      <span class="attachment-meta">${esc(meta)}</span>
      ${att.note ? `<span class="attachment-note">${esc(att.note)}</span>` : ''}
      <span class="attachment-hash">sha256 ${esc(att.hash || '')}</span>
    </a>
    ${canEditAttachments ? `<button class="attachment-del" type="button" data-delete-attachment="${esc(att.id)}" title="Remove attachment">Remove</button>` : ''}
  </div>`;
}

function addAttachmentModal(exp, onDone) {
  modal(`<h3>Attach file</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Upload raw data, instrument output, PDFs, spreadsheets, images or other supporting experiment evidence.</p>
    <label class="fld">File</label>
    <input class="txt" id="attachmentFile" type="file"/>
    <label class="fld">Note <span class="muted">(optional)</span></label>
    <textarea class="txt compact" id="attachmentNote" placeholder="e.g. Bioanalyzer RIN result table"></textarea>
    <div class="auth-err" id="attachmentErr"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button>
      <button class="btn" data-save-attachment>Attach file</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-save-attachment]').onclick = guard(async () => {
    const err = m.querySelector('#attachmentErr');
    err.textContent = '';
    const file = m.querySelector('#attachmentFile').files?.[0];
    if (!file) {
      err.textContent = 'Choose a file to attach';
      return;
    }
    await api.uploadExperimentAttachment(exp.id, file, m.querySelector('#attachmentNote').value.trim());
    closeModal();
    toast('Attachment uploaded');
    await onDone();
  });
  setTimeout(() => m.querySelector('#attachmentFile').focus(), 40);
}

function formatFileSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* --------------------------- References --------------------------- */
async function mountReferences(root, exp, access = experimentAccess(exp)) {
  const listEl = root.querySelector('#refList');
  const addBtn = root.querySelector('#refAdd');
  if (!listEl) return;
  const canEditRefs = access.can_write && exp.status !== 'locked';
  if (addBtn && !canEditRefs) {
    addBtn.disabled = true;
    addBtn.title = exp.status === 'locked' ? 'Locked experiments are read-only' : 'Read-only project role';
  }

  const load = async () => {
    listEl.innerHTML = '<div class="muted" style="font-size:12px">Loading…</div>';
    let refs = [];
    try { refs = await api.references(exp.id); }
    catch { listEl.innerHTML = '<div class="muted" style="font-size:12px">Failed to load references.</div>'; return; }
    listEl.innerHTML = refs.length
      ? refs.map(r => refItem(r, canEditRefs)).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 0">No references yet.</div>';
    if (canEditRefs) {
      listEl.querySelectorAll('[data-delref]').forEach(b => b.onclick = () => confirmModal('Remove reference?',
        'This removes the paper from this experiment.',
        guard(async () => { await api.deleteReference(b.dataset.delref); toast('Reference removed'); load(); }), 'Remove'));
    }
  };

  if (addBtn && canEditRefs) addBtn.onclick = () => addReferencesModal(exp, load);
  await load();
}

function refItem(rf, canEditRefs = true) {
  const cite = [rf.authors, rf.year ? `(${rf.year})` : ''].filter(Boolean).join(' ');
  const link = rf.url || (rf.doi ? `https://doi.org/${rf.doi}` : '');
  const titleHtml = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(rf.title)}</a>` : esc(rf.title);
  return `<div class="ref-item">
    ${canEditRefs ? `<button class="ref-del" data-delref="${rf.id}" title="Remove">✕</button>` : ''}
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

async function mountAssistant(root, exp, access = experimentAccess(exp)) {
  const msgsEl = root.querySelector('#aiMsgs');
  const textEl = root.querySelector('#aiText');
  const sendEl = root.querySelector('#aiSend');
  const noteEl = root.querySelector('#aiNote');
  const modelEl = root.querySelector('#aiModel');
  const promptBar = root.querySelector('#aiPromptBar');
  if (!msgsEl) return;
  const history = aiHistory.get(exp.id) || [];
  aiHistory.set(exp.id, history);

  let configured = false, model = 'AI';
  try { const h = await api.aiHealth(); configured = h.configured; model = h.model || 'AI'; } catch {}
  modelEl.textContent = configured ? model : 'offline';
  if (!configured) {
    noteEl.textContent = 'Assistant not configured — set OPENAI_API_KEY in .env to enable.';
    textEl.disabled = true; sendEl.disabled = true;
  } else if (!access.can_write) {
    noteEl.textContent = 'Read-only project role — assistant can advise, but drafting and saving entries requires scientist access.';
  }

  const prompts = assistantPrompts(exp);
  if (promptBar) {
    promptBar.innerHTML = prompts.map((p, i) =>
      `<button class="btn ghost sm" type="button" data-ai-prompt="${i}" title="${esc(p.title)}">${esc(p.label)}</button>`
    ).join('');
    promptBar.querySelectorAll('[data-ai-prompt]').forEach(btn => {
      btn.onclick = () => {
        const prompt = prompts[Number(btn.dataset.aiPrompt)]?.prompt || '';
        textEl.disabled = false;
        textEl.value = prompt;
        textEl.setSelectionRange(0, 0);
        textEl.scrollTop = 0;
        autoGrowTextareas(textEl);
        textEl.focus();
        if (!configured) textEl.disabled = true;
      };
    });
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
    autoGrowTextareas(textEl);
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

function assistantPrompts(exp) {
  const setupFields = 'objective, hypothesis, protocol, materials, success criteria, safety notes, custom metadata';
  return [
    {
      label: 'Summarize record',
      title: 'Summarize the current experiment for handover',
      prompt: `Summarize this experiment record for a lab handover. Use the ${setupFields} and recent notebook entries. Call out missing data and do not invent results.`
    },
    {
      label: 'Check missing setup',
      title: 'Find missing setup metadata before more lab work',
      prompt: `Check this experiment for missing setup metadata: ${setupFields}. Prioritize protocol, materials, success criteria, safety notes, sample IDs, reagent lots, and acceptance criteria.`
    },
    {
      label: 'Troubleshoot',
      title: 'Draft troubleshooting questions from the current context',
      prompt: `Troubleshoot this experiment using only the current record. Identify likely failure points, controls to verify, and measurements that would reduce uncertainty.`
    },
    {
      label: 'Next steps',
      title: 'Suggest next experimental actions',
      prompt: `Suggest the next steps for this experiment. Separate immediate lab actions from documentation updates, and mention any safety or compliance checks that should happen first.`
    }
  ];
}

function entryHTML(en, locked, access = experimentAccess({})) {
  const type = en.signed_by ? 'sig' : en.type;
  const badge = {
    voice: '<span class="badge b-voice">🎙 Voice</span>',
    ocr: '<span class="badge b-ocr">📷 OCR</span>',
    observe: '<span class="badge b-observe">👁 Observe</span>',
    figure: '<span class="badge b-figure">Figure</span>',
    note: '<span class="badge b-note">Note</span>'
  }[en.type] || '';
  const canSign = access.can_write && !en.signed_by && !locked && getUser();
  const canEdit = access.can_write && !en.signed_by && !locked && getUser();
  const canComment = access.can_write && !locked && getUser();
  const canDelete = access.can_admin_delete;
  const revisionCount = Number(en.revision_count || 0);
  const revisionButton = revisionCount
    ? `<button class="btn sec sm" type="button" data-entry-revisions="${esc(en.id)}">View revisions (${revisionCount})</button>`
    : '';
  const deleteButton = canDelete
    ? `<button class="btn danger sm" data-delete-entry="${esc(en.id)}">Delete entry</button>`
    : `<button class="btn danger sm" type="button" disabled aria-disabled="true" title="Admin only">Delete entry</button><span class="muted" style="font-size:11px">Admin only</span>`;
  const commentButton = canComment
    ? `<button class="btn sec sm" data-comment-entry="${esc(en.id)}">Add comment</button>`
    : `<button class="btn sec sm" type="button" disabled aria-disabled="true" title="Comments require write access on an unlocked experiment">Add comment</button>`;
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
    ${entryCommentsHTML(en)}
    <div class="hashline">fingerprint ${en.hash}${en.signed_by ? ` · signed ${fmt(en.signed_at)} · sig ${en.sig}` : ''}</div>
    <div class="row" style="margin-top:8px">
      ${canSign ? `<button class="btn ok sm" data-sign="${en.id}">🔒 Sign &amp; lock entry</button>` : ''}
      ${revisionButton}
      ${commentButton}
      ${deleteButton}
    </div>
  </div>`;
}

function entryCommentsHTML(en) {
  const comments = Array.isArray(en.comments) ? en.comments : [];
  if (!comments.length) return '';
  return `<div class="entry-comments" data-entry-comments="${esc(en.id)}">
    <div class="entry-comments-title">${comments.length} comment${comments.length === 1 ? '' : 's'}</div>
    ${comments.map(c => `<div class="entry-comment">
      <div class="entry-comment-meta">${esc(c.author || 'Unknown')}${c.role ? ` (${esc(c.role)})` : ''} · ${fmtShort(c.created_at)}</div>
      <div>${esc(c.text || '')}</div>
    </div>`).join('')}
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

function wireCommentButtons(root, ctx, expId) {
  root.querySelectorAll('[data-comment-entry]').forEach(btn => btn.onclick = () => {
    modal(`<h3>Comment on entry</h3>
      <p class="muted" style="font-size:12px;margin-top:0">Add a review note, clarification request or handoff comment without changing the entry text.</p>
      <textarea class="txt" id="entryCommentText" placeholder="Write a comment for this entry"></textarea>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn" data-save-comment>Save comment</button>
      </div>`);
    const m = document.getElementById('modal');
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save-comment]').onclick = guard(async () => {
      const text = m.querySelector('#entryCommentText').value.trim();
      if (!text) return toast('Comment text is required', true);
      await api.commentEntry(btn.dataset.commentEntry, { text });
      closeModal();
      toast('Comment added');
      ctx.go('experiments', { id: expId });
    });
    setTimeout(() => m.querySelector('#entryCommentText').focus(), 40);
  });
}

function wireSourceLinks(root) {
  root.querySelectorAll('[data-source-entry]').forEach(btn => btn.onclick = guard(async () => {
    const target = root.querySelector(`#entry-${CSS.escape(btn.dataset.sourceEntry)}`);
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

function wireEntryRevisionButtons(root) {
  root.querySelectorAll('[data-entry-revisions]').forEach(btn => {
    btn.onclick = guard(() => openEntryRevisionsModal(btn));
  });
}

async function openEntryRevisionsModal(btn) {
  const revisions = await api.entryRevisions(btn.dataset.entryRevisions);
  modal(`<div class="between">
      <h3>Entry revisions</h3>
      <span class="pill">${revisions.length} previous version${revisions.length === 1 ? '' : 's'}</span>
    </div>
    ${entryRevisionsHTML(revisions)}
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Close</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  autoGrowTextareas(m);
}

function entryRevisionsHTML(revisions) {
  if (!revisions.length) return '<div class="empty">No previous versions recorded for this entry.</div>';
  return `<div class="entry-revisions">
    ${revisions.map(rev => `<div class="entry-revision">
      <div class="between">
        <div class="entry-revision-title">Revision ${esc(rev.revision_no)}</div>
        <span class="muted">${fmtShort(rev.created_at)}</span>
      </div>
      <div class="muted" style="font-size:12px;margin:2px 0 8px">
        Edited by ${esc(rev.edited_by || 'Unknown')}${rev.edited_role ? ` (${esc(rev.edited_role)})` : ''} · previous update ${fmtShort(rev.previous_updated_at)}
      </div>
      <div class="hashline">previous fingerprint ${esc(rev.previous_hash || '')}</div>
      <label class="fld">Previous text</label>
      <textarea class="txt compact" readonly>${esc(rev.previous_text || '')}</textarea>
    </div>`).join('')}
  </div>`;
}

async function summariseExperimentEntries(e, ctx) {
  const entryIds = (e.entries || []).map(en => en.id).filter(Boolean);
  if (!entryIds.length) return toast('No notebook entries to summarise', true);
  const res = await api.processEntries(entryIds, 'summary');
  showExperimentSummaryModal(res, entryIds, e, ctx);
}

function showExperimentSummaryModal(res, entryIds, e, ctx) {
  const access = experimentAccess(e);
  const canSave = access.can_write && e.status !== 'locked' && res.experimentIds?.length === 1;
  modal(`<div class="between">
      <h3>Summary</h3>
      <span class="pill">${esc(res.offline ? 'local-template' : res.model || 'AI')}</span>
    </div>
    <p class="muted" style="font-size:12px;margin-top:0">Generated from ${entryIds.length} notebook entr${entryIds.length === 1 ? 'y' : 'ies'} in this experiment.</p>
    <label class="fld">Generated entry</label>
    <textarea class="txt ai-output-edit" id="experimentSummaryText">${esc(res.output || '')}</textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Close</button>
      <button class="btn sec" data-copy>Copy</button>
      ${canSave ? '<button class="btn" data-save>Save as entry</button>' : ''}
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-copy]').onclick = guard(async () => {
    await navigator.clipboard.writeText(experimentGeneratedText(m));
    toast('Copied');
  });
  const saveBtn = m.querySelector('[data-save]');
  if (saveBtn) saveBtn.onclick = guard(async () => {
    const text = experimentGeneratedText(m);
    if (!text) return toast('Generated entry text is required', true);
    await api.addEntry(e.id, {
      type: 'note',
      text,
      sourceEntryIds: entryIds
    });
    closeModal();
    toast('Summary saved as notebook entry');
    ctx.go('experiments', { id: e.id });
  });
  autoGrowTextareas(m);
}

function experimentGeneratedText(modalEl) {
  return modalEl.querySelector('#experimentSummaryText')?.value.trim() || '';
}

async function suggestExperimentSteps(e, ctx) {
  const entryIds = (e.entries || []).map(en => en.id).filter(Boolean);
  if (!entryIds.length) return toast('No notebook entries to suggest steps from', true);
  const res = await api.processEntries(entryIds, 'action_plan');
  showSuggestedStepsModal(res, entryIds, e, ctx);
}

function showSuggestedStepsModal(res, entryIds, e, ctx) {
  const access = experimentAccess(e);
  const steps = parseSuggestedSteps(res.output);
  const canSave = access.can_write && e.status !== 'locked' && !e.archived_at
    && res.experimentIds?.length === 1 && res.experimentIds[0] === e.id && steps.length;
  modal(`<div class="between">
      <h3>Suggested steps</h3>
      <span class="pill">${esc(res.offline ? 'local-template' : res.model || 'AI')}</span>
    </div>
    <p class="muted" style="font-size:12px;margin-top:0">Generated from ${entryIds.length} notebook entr${entryIds.length === 1 ? 'y' : 'ies'} in this experiment.</p>
    <div class="suggested-steps" data-suggested-steps>
      ${steps.length ? steps.map((step, index) => `<label class="suggested-step">
        <input type="checkbox" data-suggested-step="${index}" value="${esc(step)}" checked/>
        <span>${esc(step)}</span>
      </label>`).join('') : '<div class="muted" style="font-size:12px">No source-backed steps suggested.</div>'}
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Close</button>
      ${steps.length ? '<button class="btn sec" data-copy-suggested-steps>Copy</button>' : ''}
      ${canSave ? '<button class="btn" data-save-suggested-steps>Add selected</button>' : ''}
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  const copyBtn = m.querySelector('[data-copy-suggested-steps]');
  if (copyBtn) copyBtn.onclick = guard(async () => {
    await navigator.clipboard.writeText(selectedSuggestedSteps(m).join('\n') || steps.join('\n'));
    toast('Copied');
  });
  const saveBtn = m.querySelector('[data-save-suggested-steps]');
  if (saveBtn) saveBtn.onclick = guard(async () => {
    const selected = selectedSuggestedSteps(m);
    if (!selected.length) return toast('Select at least one step', true);
    for (const step of selected) await api.addExperimentStep(e.id, { text: step });
    closeModal();
    toast(`${selected.length} suggested step${selected.length === 1 ? '' : 's'} added`);
    ctx.go('experiments', { id: e.id });
  });
}

function parseSuggestedSteps(output) {
  return Array.from(new Set(String(output || '')
    .split(/\r?\n/)
    .map(line => line
      .replace(/^(?:Action\s*)?\d+[\).:-]\s*/i, '')
      .replace(/^-+\s*/, '')
      .trim())
    .filter(line => line && !/No additional source-backed point/i.test(line))))
    .slice(0, 8);
}

function selectedSuggestedSteps(modalEl) {
  return Array.from(modalEl.querySelectorAll('[data-suggested-step]:checked'))
    .map(input => input.value.trim())
    .filter(Boolean);
}

function wireSignButtons(root, ctx, expId, access = experimentAccess({})) {
  root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => {
    const u = getUser();
    modal(`<h3>Sign &amp; lock entry</h3>
      <p class="muted" style="font-size:12px">By signing, you attest this record is accurate and complete. It will be locked as <b>${esc(u.name || u.email)}</b>.</p>
      <label class="fld">Signature meaning</label>
      <select class="txt" id="sigMeaning">
        ${signatureMeaningOptions(access)}
      </select>
      ${!access.can_review ? '<div class="hint">Reviewer access required for reviewer or approval signatures.</div>' : ''}
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

function signatureMeaningOptions(access = experimentAccess({})) {
  const reviewerDisabled = access.can_review ? '' : ' disabled title="Reviewer access required"';
  return [
    '<option value="author">author</option>',
    `<option value="reviewer"${reviewerDisabled}>reviewer${access.can_review ? '' : ' (Reviewer access required)'}</option>`,
    `<option value="approval"${reviewerDisabled}>approval${access.can_review ? '' : ' (Reviewer access required)'}</option>`
  ].join('');
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
  const projects = (await api.projects()).filter(canWriteProject);
  if (!projects.length) return toast('Read-only project role — ask an owner for scientist access.', true);
  modal(`<h3>Edit experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" value="${esc(e.title)}"/>
    <label class="fld">Project</label><select class="txt" id="mProject">
      ${projects.map(p => `<option value="${esc(p.id)}" ${e.project_id === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.org_name || 'Workspace')}</option>`).join('')}
    </select>
    <label class="fld">Tags</label><input class="txt" id="mTags" value="${esc(e.tags || '')}" placeholder="e.g. mRNA, stability, QC"/>
    <label class="fld">Objective</label><textarea class="txt" id="mObj">${esc(e.objective)}</textarea>
    <label class="fld">Hypothesis</label><textarea class="txt compact" id="mHypothesis">${esc(e.hypothesis || '')}</textarea>
    <label class="fld">Protocol / method</label><textarea class="txt compact" id="mProtocol">${esc(e.protocol || '')}</textarea>
    <label class="fld">Materials / reagents</label><textarea class="txt compact" id="mMaterials">${esc(e.materials || '')}</textarea>
    <label class="fld">Success criteria</label><textarea class="txt compact" id="mSuccessCriteria">${esc(e.success_criteria || '')}</textarea>
    <label class="fld">Safety notes</label><textarea class="txt compact" id="mSafetyNotes">${esc(e.safety_notes || '')}</textarea>
    ${metadataFieldsHTML(e.metadata)}
    <label class="fld">Experiment outcome</label><select class="txt" id="mOutcomeStatus">
      ${outcomeStatusOptions(e.outcome_status)}
    </select>
    <textarea class="txt compact" id="mOutcomeSummary" placeholder="Summarize the observed result, deviation, or why the run remains in progress">${esc(e.outcome_summary || '')}</textarea>
    <label class="fld">Status</label><select class="txt" id="mStat">
      ${['planned', 'active', 'locked'].map(s => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  wireMetadataEditor(m);
  m.querySelector('[data-ok]').onclick = guard(async () => {
    await api.updateExperiment(e.id, {
      title: m.querySelector('#mTitle').value.trim() || e.title,
      project_id: m.querySelector('#mProject').value,
      tags: m.querySelector('#mTags').value.trim(),
      objective: m.querySelector('#mObj').value.trim(),
      hypothesis: m.querySelector('#mHypothesis').value.trim(),
      protocol: m.querySelector('#mProtocol').value.trim(),
      materials: m.querySelector('#mMaterials').value.trim(),
      success_criteria: m.querySelector('#mSuccessCriteria').value.trim(),
      safety_notes: m.querySelector('#mSafetyNotes').value.trim(),
      metadata: readMetadataFields(m),
      outcome_status: m.querySelector('#mOutcomeStatus').value,
      outcome_summary: m.querySelector('#mOutcomeSummary').value.trim(),
      status: m.querySelector('#mStat').value
    });
    closeModal(); toast('Saved'); ctx.go('experiments', { id: e.id });
  });
}

async function saveExperimentTemplateModal(ctx, e) {
  modal(`<h3>Experiment template</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Save this experiment setup as a reusable project template for future runs.</p>
    <label class="fld">Template name</label><input class="txt" id="templateName" value="${esc(e.title)} template"/>
    <label class="fld">Description</label><textarea class="txt compact" id="templateDescription" placeholder="When should this setup be reused?"></textarea>
    <div class="hint" style="margin-top:10px">The template includes objective, hypothesis, protocol, materials, success criteria, safety notes and custom metadata.</div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-save-template-confirm>Save template</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-save-template-confirm]').onclick = guard(async () => {
    const name = m.querySelector('#templateName').value.trim();
    if (!name) return toast('Template name required', true);
    await api.saveExperimentTemplate(e.id, {
      name,
      description: m.querySelector('#templateDescription').value.trim()
    });
    closeModal();
    toast('Experiment template saved');
    ctx.go('experiments', { id: e.id });
  });
  setTimeout(() => m.querySelector('#templateName').focus(), 40);
}

async function duplicateExperimentModal(ctx, e) {
  modal(`<h3>Repeat setup</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Create a new active experiment with the same setup, tags, and procedure steps, including custom metadata. Notebook observations, signatures, comments, attachments, and references stay with the original record.</p>
    <label class="fld">New experiment title</label><input class="txt" id="duplicateTitle" value="${esc(e.title)} repeat"/>
    <div class="hint" style="margin-top:10px">The new run starts active with outcome set to Running and includes a related-experiment link back to this source.</div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-duplicate-confirm>Repeat setup</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-duplicate-confirm]').onclick = guard(async () => {
    const title = m.querySelector('#duplicateTitle').value.trim();
    if (!title) return toast('Title required', true);
    const repeated = await api.duplicateExperiment(e.id, { title });
    closeModal();
    toast('Repeat setup created');
    ctx.go('experiments', { id: repeated.id });
  });
  setTimeout(() => m.querySelector('#duplicateTitle').focus(), 40);
}

/* --------------------------- Composer --------------------------- */
async function mountComposer(mount, ctx, expId) {
  let capturedType = null, uploadedUrl = null;
  let rawOcrUrl = null, cleanOcrUrl = null;
  let rawOcrText = '', correctedOcrText = '';
  let voiceTranscript = '', voiceTemplate = 'auto_lab_note', polishedReady = false, reviewMode = false;
  let voiceBusy = false;
  let recordingStartedAt = 0, recordingTimer = null;
  let stt = { provider: 'webspeech', serverStt: false };
  try { stt = await api.sttHealth(); } catch {}
  let aiConfigured = false, aiModel = 'AI';
  try { const h = await api.aiHealth(); aiConfigured = !!h.configured; aiModel = h.model || 'AI'; } catch {}
  const serverStt = !!stt.serverStt;
  const liveSpeechAvailable = voiceSupported;
  const recorderAvailable = serverStt && recorderSupported;
  const audioUploadAvailable = serverStt;
  const voiceModes = [
    liveSpeechAvailable ? { value: 'live_dictation', label: 'Live dictation' } : null,
    recorderAvailable ? { value: 'server_transcription', label: `Use server transcription · ${stt.provider}` } : null
  ].filter(Boolean);
  let selectedVoiceMode = chooseVoiceMode();

  mount.innerHTML = `
    <div class="composer">
      <div class="between" style="margin-bottom:8px"><b>Add entry</b>
        <span class="pill" id="voiceModePill">${esc(voiceModeLabel(selectedVoiceMode))}</span></div>
      <div id="voiceCaptureWrap">
        <div class="toolbar">
          ${voiceModes.length > 1 ? `<select class="txt voice-mode-select" id="voiceModeSelect" title="Choose voice capture mode">
            ${voiceModes.map(mode => `<option value="${esc(mode.value)}" ${mode.value === selectedVoiceMode ? 'selected' : ''}>${esc(mode.label)}</option>`).join('')}
          </select>` : ''}
          <button class="btn sm mic" id="micStart" type="button">🎙 Start voice</button>
          <button class="btn sm warn" id="micPause" type="button" style="display:none">⏸ Pause</button>
          <button class="btn sm danger" id="micStop" type="button" style="display:none">⏹ Stop</button>
          <button class="btn ghost sm" id="voiceSourceBtn" type="button" data-voice-source disabled>Source transcript</button>
          <button class="btn sm sec" id="voiceDraftReport" type="button">Draft report</button>
          <button class="btn sm sec" id="voiceCleanNote" type="button">Clean up</button>
          ${audioUploadAvailable ? '<button class="btn sm sec" id="voiceUploadAudio" type="button">Upload audio</button>' : ''}
          <button class="btn sm sec" id="ocrCam" type="button">📸 Camera</button>
          <button class="btn sm sec" id="ocrBtn" type="button">🖼 Upload scan</button>
          <button class="btn sm sec" id="sketchBtn" type="button">Sketch figure</button>
          <input type="file" id="ocrFile" accept="image/*" style="display:none"/>
          ${audioUploadAvailable ? '<input type="file" id="voiceAudioFile" accept="audio/*" style="display:none"/>' : ''}
        </div>
        <label class="fld">Raw lab notes</label>
        <textarea class="txt" id="voiceManualNotes" placeholder="Jot observations, sample IDs, headings, or shorthand while dictation runs in the background."></textarea>
        <textarea class="txt voice-transcript" id="voiceTranscript" readonly hidden></textarea>
        <div class="voice-capture-status">
          <span class="reclabel" id="reclabel"><span class="dot"></span> <span id="recword">Recording…</span></span>
          <span class="muted" id="voiceTranscriptCount">0 transcript words</span>
        </div>
      </div>
      <div class="voice-review" id="voiceReviewWrap" hidden>
        <div class="between">
          <div>
            <b>Enhanced entry</b>
            <div class="muted" style="font-size:12px">Review the drafted note before saving it to the experiment.</div>
          </div>
          <span class="pill">${esc(aiConfigured ? aiModel : 'Local draft')}</span>
        </div>
        <label class="fld">Format</label>
        <select class="txt" id="voiceTemplate">
          <option value="lab_report">Lab report</option>
          <option value="clean_voice_note">Clean note</option>
          <option value="auto_lab_note">Auto lab note</option>
          <option value="numbered_observations">Numbered observations</option>
          <option value="concise_paragraph">Concise paragraph</option>
        </select>
        <label class="fld">Notebook entry draft</label>
        <textarea class="txt" id="voicePolished"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn sec sm" id="voiceRegenerate" type="button">Regenerate</button>
          <button class="btn ghost sm" id="voiceBackToCapture" type="button">Back to raw notes</button>
          <button class="btn ghost sm" type="button" data-voice-source>Sources</button>
        </div>
      </div>
      <div id="ocrPreview"></div>
      <div class="ocr-review" id="ocrReviewWrap" hidden>
        <div class="between">
          <div>
            <b>OCR review</b>
            <div class="muted" style="font-size:12px">Correct the extracted text before saving it to the experiment.</div>
          </div>
          <span class="pill" id="ocrConfidencePill">Review scan</span>
        </div>
        <label class="fld">Corrected OCR text</label>
        <textarea class="txt" id="ocrCorrectedText" placeholder="Correct the OCR output here before saving."></textarea>
        <details class="ocr-raw-source" open>
          <summary>Raw OCR output</summary>
          <textarea class="txt" id="ocrRawText" readonly></textarea>
        </details>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="saveEntry" type="button" disabled>Save entry</button>
        <button class="btn sec sm" id="entryDraftCheck" type="button" disabled>Check draft</button>
        <button class="btn ghost sm" id="clearEntry" type="button">Clear</button>
        <span class="muted" id="composerState" style="font-size:12px"></span>
      </div>
    </div>`;

  const text = mount.querySelector('#voiceManualNotes');
  const transcriptEl = mount.querySelector('#voiceTranscript');
  const transcriptCount = mount.querySelector('#voiceTranscriptCount');
  const captureWrap = mount.querySelector('#voiceCaptureWrap');
  const reviewWrap = mount.querySelector('#voiceReviewWrap');
  const polishedEl = mount.querySelector('#voicePolished');
  const templateEl = mount.querySelector('#voiceTemplate');
  const regenerateBtn = mount.querySelector('#voiceRegenerate');
  const backToCaptureBtn = mount.querySelector('#voiceBackToCapture');
  const voiceDraftReportBtn = mount.querySelector('#voiceDraftReport');
  const voiceCleanNoteBtn = mount.querySelector('#voiceCleanNote');
  const voiceUploadAudioBtn = mount.querySelector('#voiceUploadAudio');
  const voiceAudioFile = mount.querySelector('#voiceAudioFile');
  const ocrReviewWrap = mount.querySelector('#ocrReviewWrap');
  const ocrCorrectedEl = mount.querySelector('#ocrCorrectedText');
  const ocrRawEl = mount.querySelector('#ocrRawText');
  const saveBtn = mount.querySelector('#saveEntry');
  const checkDraftBtn = mount.querySelector('#entryDraftCheck');
  const stateEl = mount.querySelector('#composerState');
  const voiceModePill = mount.querySelector('#voiceModePill');
  const voiceModeSelect = mount.querySelector('#voiceModeSelect');
  const upd = () => {
    const hasText = !!currentSaveText().trim();
    saveBtn.disabled = voiceBusy || !hasText;
    checkDraftBtn.disabled = voiceBusy || !hasText;
  };
  text.addEventListener('input', () => { upd(); syncVoiceSourceButtons(); if (!capturedType) capturedType = 'note'; });
  polishedEl.addEventListener('input', () => { polishedReady = !!polishedEl.value.trim(); upd(); });
  ocrCorrectedEl.addEventListener('input', () => { correctedOcrText = ocrCorrectedEl.value; upd(); });
  templateEl.onchange = guard(async () => {
    voiceTemplate = templateEl.value;
    if (reviewMode && (voiceTranscript.trim() || text.value.trim())) await enhanceVoiceDraft();
  });
  voiceDraftReportBtn.onclick = guard(async () => {
    voiceTemplate = 'lab_report';
    await enhanceVoiceDraft();
  });
  voiceCleanNoteBtn.onclick = guard(async () => {
    voiceTemplate = 'clean_voice_note';
    await enhanceVoiceDraft();
  });
  regenerateBtn.onclick = guard(enhanceVoiceDraft);
  backToCaptureBtn.onclick = () => {
    reviewMode = false;
    captureWrap.hidden = false;
    reviewWrap.hidden = true;
    stateEl.textContent = voiceTranscript.trim() ? 'Voice captured — raw notes and transcript preserved' : '';
    autoGrowTextareas(captureWrap);
    upd();
  };
  mount.querySelectorAll('[data-voice-source]').forEach(btn => btn.onclick = () => {
    openVoiceSourceModal(text.value, voiceTranscript, voiceTemplate);
  });
  if (voiceModeSelect) voiceModeSelect.onchange = () => {
    selectedVoiceMode = voiceModeSelect.value;
    wireSelectedVoiceMode();
  };
  if (voiceUploadAudioBtn && voiceAudioFile) {
    voiceUploadAudioBtn.onclick = () => voiceAudioFile.click();
    voiceAudioFile.onchange = guard(async ev => {
      const file = ev.target.files?.[0];
      ev.target.value = '';
      if (file) await processServerAudio(file, { fromUpload: true });
    });
  }

  const micStart = mount.querySelector('#micStart');
  const micPause = mount.querySelector('#micPause');
  const micStop = mount.querySelector('#micStop');
  const reclabel = mount.querySelector('#reclabel');
  const recword = mount.querySelector('#recword');
  function showRecording() {
    micStart.style.display = 'none'; micPause.style.display = ''; micStop.style.display = ''; micPause.textContent = '⏸ Pause';
    micStart.classList.add('rec'); reclabel.classList.add('on'); reclabel.classList.remove('paused'); startRecordingTimer(); paintRecordingMeta('Recording');
  }
  function showPaused() {
    micPause.textContent = '▶ Resume'; reclabel.classList.add('on', 'paused'); paintRecordingMeta('Paused');
  }
  function showIdle() {
    micStart.style.display = ''; micPause.style.display = 'none'; micStop.style.display = 'none'; micStart.classList.remove('rec'); reclabel.classList.remove('on', 'paused'); stopRecordingTimer();
  }
  function setVoiceTranscript(value) {
    voiceTranscript = String(value || '').trimStart();
    transcriptEl.value = voiceTranscript;
    autoGrowTextareas(transcriptEl);
    paintRecordingMeta(reclabel.classList.contains('paused') ? 'Paused' : reclabel.classList.contains('on') ? 'Recording' : '');
    syncVoiceSourceButtons();
    upd();
  }
  async function afterVoiceStop({ manageDraftBusy = true } = {}) {
    capturedType = 'voice';
    stopRecordingTimer();
    if (!voiceTranscript.trim()) {
      stateEl.textContent = recorderAvailable && !useRecorder()
        ? 'No speech detected — try server transcription'
        : 'No speech detected';
      syncVoiceSourceButtons(); upd(); return;
    }
    if (aiConfigured) await enhanceVoiceDraft({ manageBusy: manageDraftBusy });
    else { reviewWrap.hidden = true; captureWrap.hidden = false; stateEl.textContent = 'Voice captured — review & save raw transcript'; upd(); }
  }
  async function enhanceVoiceDraft({ manageBusy = true } = {}) {
    const transcript = voiceTranscript.trim();
    const rawNotes = text.value.trim();
    if (!transcript && !rawNotes) return;
    if (manageBusy) {
      voiceBusy = true;
      upd();
    }
    reviewMode = true;
    captureWrap.hidden = true;
    reviewWrap.hidden = false;
    templateEl.value = voiceTemplate;
    polishedEl.disabled = true;
    regenerateBtn.disabled = true;
    stateEl.textContent = aiConfigured ? 'Enhancing voice entry…' : 'Drafting local lab report…';
    try {
      const res = await api.processVoiceDraft(expId, transcript, rawNotes, voiceTemplate);
      polishedEl.value = res.output || '';
      autoGrowTextareas(reviewWrap);
      polishedReady = !!polishedEl.value.trim();
      stateEl.textContent = polishedReady
        ? (res.offline ? 'Local draft ready — review & save' : 'Enhanced draft ready — review & save')
        : 'No enhanced draft returned';
    } finally {
      polishedEl.disabled = false;
      regenerateBtn.disabled = false;
      if (manageBusy) voiceBusy = false;
      upd();
    }
  }
  function currentSaveText() {
    if (reviewMode && polishedReady && polishedEl.value.trim()) return polishedEl.value.trim();
    if (capturedType === 'ocr') {
      return [text.value.trim(), (correctedOcrText || ocrCorrectedEl.value).trim()]
        .filter(Boolean)
        .join('\n\n');
    }
    if (voiceTranscript.trim()) return buildVoiceFallbackText(text.value, voiceTranscript);
    return text.value.trim();
  }
  function syncVoiceSourceButtons() {
    const hasSource = !!(voiceTranscript.trim() || text.value.trim());
    mount.querySelectorAll('[data-voice-source]').forEach(btn => { btn.disabled = !hasSource; });
    voiceDraftReportBtn.disabled = !hasSource;
    voiceCleanNoteBtn.disabled = !hasSource;
    voiceDraftReportBtn.title = hasSource
      ? (aiConfigured
        ? 'Draft a structured lab report from the current raw notes or transcript'
        : 'Draft a local structured lab report from the current raw notes or transcript')
      : 'Add raw notes or capture speech first';
    voiceCleanNoteBtn.title = hasSource
      ? (aiConfigured
        ? 'Clean punctuation, capitalization and paragraphs from the current raw notes or transcript'
        : 'Locally clean punctuation, capitalization and paragraphs from the current raw notes or transcript')
      : 'Add raw notes or capture speech first';
  }
  function startRecordingTimer() {
    if (!recordingStartedAt) recordingStartedAt = Date.now();
    if (!recordingTimer) recordingTimer = setInterval(() => paintRecordingMeta(reclabel.classList.contains('paused') ? 'Paused' : 'Recording'), 1000);
  }
  function stopRecordingTimer() {
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = null;
  }
  function paintRecordingMeta(label = '') {
    const words = countWords(voiceTranscript);
    const elapsed = recordingStartedAt ? ` · ${formatElapsed(Date.now() - recordingStartedAt)}` : '';
    transcriptCount.textContent = `${words} transcript word${words === 1 ? '' : 's'}${elapsed}`;
    if (label) recword.textContent = `${label}${elapsed}`;
  }
  function resetEnhancedDraft() {
    polishedReady = false;
    polishedEl.value = '';
    autoGrowTextareas(reviewWrap);
    reviewMode = false;
    reviewWrap.hidden = true;
    captureWrap.hidden = false;
  }

  function chooseVoiceMode() {
    if (liveSpeechAvailable) return 'live_dictation';
    if (recorderAvailable) return 'server_transcription';
    return 'unavailable';
  }

  function voiceModeLabel(mode) {
    if (mode === 'live_dictation') return 'Live dictation';
    if (mode === 'server_transcription') return `Server transcription · ${stt.provider}`;
    return 'Voice unavailable';
  }

  function useLiveSpeech(mode = selectedVoiceMode) {
    return mode === 'live_dictation' && liveSpeechAvailable;
  }

  function useRecorder(mode = selectedVoiceMode) {
    return mode === 'server_transcription' && recorderAvailable;
  }

  function wireSelectedVoiceMode() {
    if (mount._voice && mount._voice.state !== 'idle') mount._voice.stop();
    if (mount._rec && mount._rec.state !== 'idle') mount._rec.stop();
    mount._voice = null;
    mount._rec = null;
    showIdle();
    micStart.disabled = false;
    micStart.textContent = '🎙 Start voice';
    micStart.title = '';
    stateEl.textContent = '';
    if (voiceModePill) voiceModePill.textContent = voiceModeLabel(selectedVoiceMode);
    if (useLiveSpeech()) wireWebSpeech();
    else if (useRecorder()) wireRecorder();
    else wireVoiceUnavailable();
  }

  wireSelectedVoiceMode();

  function wireWebSpeech() {
    const voice = new VoiceController({
      onText: t => { setVoiceTranscript(t); },
      onState: s => {
        if (s.startsWith('error')) {
          stateEl.textContent = recorderAvailable
            ? 'Mic blocked — use server transcription'
            : 'Mic blocked — check permissions';
          showIdle(); return;
        }
        capturedType = 'voice';
        if (s === 'recording') { showRecording(); stateEl.textContent = 'Listening… speak now'; }
        else if (s === 'paused') { showPaused(); stateEl.textContent = 'Paused — Resume or Stop'; }
        else { showIdle(); }
      }
    });
    micStart.onclick = () => { resetEnhancedDraft(); recordingStartedAt = Date.now(); voice.start(voiceTranscript); };
    micPause.onclick = () => (voice.state === 'recording' ? voice.pause() : voice.resume());
    micStop.onclick = guard(async () => { voice.stop(); await afterVoiceStop(); });
    mount._voice = voice;
  }
  function wireVoiceUnavailable() {
    micStart.disabled = true;
    micStart.textContent = '🎙 Voice unavailable';
    if (serverStt && !recorderSupported) {
      micStart.title = 'This browser cannot access microphone recording here. Upload an audio file or use HTTPS/localhost with microphone access.';
      stateEl.textContent = 'Voice needs microphone access here, or upload an existing audio recording.';
    } else {
      micStart.title = 'This browser does not support live dictation. Set STT_PROVIDER=auto with OPENAI_API_KEY, or STT_PROVIDER=whisper, to enable server recording.';
      stateEl.textContent = 'Voice on this device needs server transcription.';
    }
  }
  function wireRecorder() {
    const rec = new Recorder(); mount._rec = rec;
    micStart.onclick = guard(async () => {
      capturedType = 'voice'; resetEnhancedDraft(); recordingStartedAt = Date.now();
      try { await rec.start(); } catch { stateEl.textContent = 'Mic blocked — check permissions'; return; }
      showRecording(); stateEl.textContent = 'Recording… click Stop to transcribe';
    });
    micPause.onclick = () => { if (rec.state === 'recording') { rec.pause(); showPaused(); stateEl.textContent = 'Paused'; } else if (rec.state === 'paused') { rec.resume(); showRecording(); stateEl.textContent = 'Recording…'; } };
    micStop.onclick = guard(async () => {
      showIdle(); stateEl.textContent = 'Transcribing…';
      const blob = await rec.stop(); if (!blob) { stateEl.textContent = ''; return; }
      await processServerAudio(blob);
    });
  }

  async function processServerAudio(file, { fromUpload = false } = {}) {
    capturedType = 'voice';
    resetEnhancedDraft();
    voiceBusy = true;
    upd();
    stateEl.textContent = fromUpload ? 'Transcribing uploaded audio…' : 'Transcribing…';
    if (voiceUploadAudioBtn) voiceUploadAudioBtn.disabled = true;
    let tx = '';
    try {
      try {
        ({ text: tx = '' } = await api.transcribe(file));
      } catch (err) {
        stateEl.textContent = 'Transcription failed: ' + err.message;
        return;
      }
      setVoiceTranscript([voiceTranscript, tx || ''].filter(Boolean).join(' '));
      stateEl.textContent = tx
        ? (fromUpload ? 'Transcribed uploaded audio' : 'Transcribed')
        : (fromUpload ? 'No speech detected in uploaded audio' : 'No speech detected');
      if (!tx) return;
      if (fromUpload) voiceTemplate = 'lab_report';
      try {
        await afterVoiceStop({ manageDraftBusy: false });
        if (fromUpload && !aiConfigured) await enhanceVoiceDraft({ manageBusy: false });
      } catch (err) {
        stateEl.textContent = 'Transcribed — draft failed: ' + err.message;
        syncVoiceSourceButtons();
        upd();
      }
    } catch (err) {
      stateEl.textContent = 'Transcribed — draft failed: ' + err.message;
      syncVoiceSourceButtons();
      upd();
    } finally {
      voiceBusy = false;
      if (voiceUploadAudioBtn) voiceUploadAudioBtn.disabled = false;
      upd();
    }
  }

  /* ---- OCR: shared processing for uploaded file or camera capture ---- */
  async function processOcr(dataURL, fileForUpload) {
    capturedType = 'ocr';
    rawOcrUrl = null; cleanOcrUrl = null; uploadedUrl = null;
    rawOcrText = ''; correctedOcrText = '';
    ocrReviewWrap.hidden = true;
    ocrCorrectedEl.value = '';
    ocrRawEl.value = '';
    mount.querySelector('#ocrPreview').innerHTML = `${ocrEvidencePreview(dataURL, null)}<div class="muted" style="font-size:12px;margin-top:6px" id="ocrStatus">Reading handwriting…</div>`;
    stateEl.textContent = 'Running OCR…';
    try {
      const out = await runOCR(dataURL, p => { const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = 'Reading… ' + p + '%'; });
      const extracted = typeof out === 'string' ? out : (out.text || '');
      const processedDataUrl = typeof out === 'string' ? null : out.processedDataUrl;
      const confidence = typeof out === 'string' ? null : out.confidence;
      const needsReview = typeof out !== 'string' && out.needsReview;
      rawOcrText = extracted;
      correctedOcrText = extracted;
      ocrCorrectedEl.value = extracted;
      ocrRawEl.value = extracted || '(no text detected)';
      ocrReviewWrap.hidden = false;
      autoGrowTextareas(ocrReviewWrap);
      const confidenceText = confidence == null ? '' : ` · confidence ${confidence}%`;
      const confidencePill = mount.querySelector('#ocrConfidencePill');
      if (confidencePill) {
        confidencePill.textContent = extracted
          ? (needsReview ? `Needs careful review${confidenceText}` : `OCR ready${confidenceText}`)
          : 'No text detected';
        confidencePill.title = needsReview
          ? 'Low-confidence OCR: correct the extracted text against the original scan before saving.'
          : 'OCR confidence is acceptable, but the text should still be reviewed before saving.';
      }
      if (processedDataUrl) mount.querySelector('#ocrPreview').innerHTML = `${ocrEvidencePreview(dataURL, processedDataUrl)}<div class="muted" style="font-size:12px;margin-top:6px" id="ocrStatus"></div>`;
      try { rawOcrUrl = (await api.uploadImage(fileForUpload, fileForUpload?.name || 'raw-ocr-scan.png', 'ocr-raw', expId)).url; } catch { rawOcrUrl = null; }
      try {
        if (processedDataUrl) cleanOcrUrl = (await api.uploadImage(dataURLtoBlob(processedDataUrl), 'processed-ocr-scan.png', 'ocr-clean', expId)).url;
      } catch { cleanOcrUrl = null; }
      uploadedUrl = cleanOcrUrl || rawOcrUrl;
      const s = mount.querySelector('#ocrStatus');
      if (s) {
        s.textContent = extracted
          ? (needsReview ? `Low-confidence OCR${confidenceText} — correct against the scan before saving` : `✓ Text extracted${confidenceText} — correct & save`)
          : 'No text detected — try again';
      }
      stateEl.textContent = needsReview
        ? 'OCR complete · low-confidence text needs correction'
        : cleanOcrUrl || rawOcrUrl ? 'OCR complete · image evidence stored' : 'OCR complete · text only';
      upd();
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
  checkDraftBtn.onclick = guard(checkEntryDraft);
  mount.querySelector('#clearEntry').onclick = () => {
    text.value = ''; capturedType = null; uploadedUrl = null; rawOcrUrl = null; cleanOcrUrl = null; rawOcrText = ''; correctedOcrText = ''; recordingStartedAt = 0; resetEnhancedDraft(); setVoiceTranscript('');
    ocrCorrectedEl.value = '';
    ocrRawEl.value = '';
    ocrReviewWrap.hidden = true;
    mount.querySelector('#ocrPreview').innerHTML = ''; stateEl.textContent = ''; upd();
    autoGrowTextareas(mount);
    if (mount._voice && mount._voice.state !== 'idle') mount._voice.stop();
    if (mount._rec && mount._rec.state !== 'idle') mount._rec.stop();
    showIdle();
  };
  saveBtn.onclick = guard(async () => {
    const val = currentSaveText().trim(); if (!val) return;
    if (mount._voice && mount._voice.state !== 'idle') mount._voice.stop();
    if (reviewMode && polishedReady && polishedEl.value.trim() && (voiceTranscript.trim() || text.value.trim())) {
      const rawEntry = await api.addEntry(expId, { type: 'voice_transcript', text: buildVoiceSourceText(text.value, voiceTranscript) });
      await api.addEntry(expId, { type: 'voice', text: polishedEl.value.trim(), sourceEntryIds: [rawEntry.id] });
    } else {
      const entryType = voiceTranscript.trim() ? 'voice' : (capturedType || 'note');
      let payload;
      if (entryType === 'ocr') {
        const sourceEntryIds = [];
        if (rawOcrText.trim()) {
          const rawEntry = await api.addEntry(expId, { type: 'ocr_raw_text', text: buildOcrSourceText(rawOcrText) });
          sourceEntryIds.push(rawEntry.id);
        }
        payload = {
          type: entryType,
          text: val,
          imageUrl: cleanOcrUrl || rawOcrUrl || uploadedUrl,
          rawImageUrl: rawOcrUrl,
          cleanImageUrl: cleanOcrUrl,
          sourceEntryIds
        };
      } else {
        payload = { type: entryType, text: val, imageUrl: voiceTranscript.trim() ? null : uploadedUrl };
      }
      await api.addEntry(expId, payload);
    }
    toast('Entry saved & time-stamped'); ctx.go('experiments', { id: expId });
  });
  syncVoiceSourceButtons();

  async function checkEntryDraft() {
    const val = currentSaveText().trim();
    if (!val) return toast('Draft text required', true);
    checkDraftBtn.disabled = true;
    stateEl.textContent = 'Checking draft…';
    try {
      const res = await api.checkEntryDraft(expId, currentSaveText());
      showEntryDraftCheckModal(res);
      stateEl.textContent = res.status === 'ready' ? 'Draft check passed' : 'Draft check found missing details';
    } finally {
      upd();
    }
  }
}

function showEntryDraftCheckModal(res) {
  const ready = res.status === 'ready';
  const score = Number.isFinite(Number(res.score)) ? Number(res.score) : 0;
  modal(`<div class="between">
      <h3>Draft check</h3>
      <span class="pill ${ready ? '' : 'warn'}">${esc(ready ? 'Ready' : 'Needs details')} · ${score}/100</span>
    </div>
    <p class="muted" style="font-size:12px;margin-top:0">Review suggested completeness checks before saving this notebook entry.</p>
    <div class="entry-draft-check">
      ${(res.findings || []).map(finding => entryDraftFindingHTML(finding)).join('')}
    </div>
    ${(res.suggestions || []).length ? `<div class="hint" style="margin-top:12px">${esc((res.suggestions || []).slice(0, 3).join(' '))}</div>` : ''}
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn" data-x>Close</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
}

function entryDraftFindingHTML(finding) {
  const present = finding.status === 'present';
  return `<div class="entry-draft-finding ${present ? 'present' : 'missing'}" data-entry-draft-finding="${esc(finding.key || '')}">
    <span class="entry-draft-finding-icon">${present ? '✓' : '!'}</span>
    <span>
      <b>${esc(finding.label || 'Draft detail')}</b>
      <span>${esc(finding.detail || '')}</span>
    </span>
  </div>`;
}

function buildVoiceSourceText(manualNotes, transcript) {
  return [
    'Manual notes:',
    String(manualNotes || '').trim() || '(none)',
    '',
    'Source transcript:',
    String(transcript || '').trim()
  ].join('\n');
}

function buildOcrSourceText(rawText) {
  return [
    'Raw OCR output:',
    String(rawText || '').trim()
  ].join('\n');
}

function buildVoiceFallbackText(manualNotes, transcript) {
  const notes = String(manualNotes || '').trim();
  const source = String(transcript || '').trim();
  return [notes, source].filter(Boolean).join(notes && source ? '\n\n' : '');
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function openVoiceSourceModal(manualNotes, transcript, template = 'auto_lab_note') {
  const source = buildVoiceSourceText(manualNotes, transcript);
  modal(`<div class="between">
      <h3>Source transcript</h3>
      <span class="pill">${esc(templateLabel(template))}</span>
    </div>
    <p class="muted" style="font-size:12px;margin-top:0">Raw lab notes and transcript are source evidence for the enhanced voice entry.</p>
    <textarea class="txt" readonly style="min-height:280px" id="voiceSourceModalText">${esc(source)}</textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-copy-source>Copy source</button>
      <button class="btn ghost" data-x>Close</button>
    </div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-copy-source]').onclick = guard(async () => {
    await navigator.clipboard?.writeText(source);
    toast('Source copied');
  });
}

function templateLabel(template) {
  return {
    lab_report: 'Lab report',
    clean_voice_note: 'Clean note',
    auto_lab_note: 'Auto lab note',
    numbered_observations: 'Numbered observations',
    concise_paragraph: 'Concise paragraph'
  }[template] || 'Auto lab note';
}

function ocrEvidencePreview(rawSrc, cleanSrc) {
  return `<div class="ocr-evidence">
    ${rawSrc ? `<figure><img class="ocr-img raw" src="${esc(rawSrc)}" alt="original notebook scan"/><figcaption>Original scan</figcaption></figure>` : ''}
    ${cleanSrc ? `<figure><img class="ocr-img" src="${esc(cleanSrc)}" alt="processed OCR scan"/><figcaption>Processed for OCR</figcaption></figure>` : ''}
  </div>`;
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
  if (en.type === 'ocr') {
    const clean = en.clean_image_url || en.image_url;
    const raw = en.raw_image_url || (clean ? null : en.image_url);
    return ocrEvidencePreview(raw, clean);
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
