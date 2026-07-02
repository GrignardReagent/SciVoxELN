import { api } from '../api.js';
import { esc, fmt, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { getIdentity } from '../state.js';
import { VoiceController, voiceSupported } from '../voice.js';
import { runOCR, fileToDataURL } from '../ocr.js';

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

  root.querySelector('[data-new]').onclick = () => newExperimentModal(ctx);
  root.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ctx.go('experiments', { id: el.dataset.exp }));
});

function card(e) {
  return `<div class="card hover" data-exp="${e.id}">
    <div class="between"><h3>${esc(e.title)}</h3><span class="status s-${e.status}">${e.status}</span></div>
    <div class="muted" style="font-size:13px">${esc(e.objective || 'No objective set')}</div>
    <div class="meta"><span class="tag">${esc(e.project || 'General')}</span>
      <span>📝 ${e.entryCount || 0}</span><span>· ${fmtShort(e.created_at)}</span></div>
  </div>`;
}

function newExperimentModal(ctx) {
  modal(`<h3>New experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" placeholder="e.g. Buffer stability study"/>
    <label class="fld">Project</label><input class="txt" id="mProj" placeholder="e.g. Formulation"/>
    <label class="fld">Objective</label><textarea class="txt" id="mObj" placeholder="What are you trying to find out?"></textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Create</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const title = m.querySelector('#mTitle').value.trim();
    if (!title) return toast('Title required', true);
    const exp = await api.createExperiment({
      title, project: m.querySelector('#mProj').value.trim(), objective: m.querySelector('#mObj').value.trim()
    });
    closeModal(); toast('Experiment created'); ctx.go('experiments', { id: exp.id });
  });
  setTimeout(() => m.querySelector('#mTitle').focus(), 40);
}

/* --------------------------- Single view --------------------------- */
export const renderExperiment = guard(async (root, ctx, id) => {
  const e = await api.experiment(id);
  ctx.setHead(e.title, `${e.project || 'General'} · created ${fmtShort(e.created_at)}`);
  const locked = e.status === 'locked';

  root.innerHTML = `
    <button class="btn ghost sm" data-back>← Back to experiments</button>
    <div class="split" style="margin-top:14px">
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="row"><h2 class="sec-t" style="margin:0">${esc(e.title)}</h2><span class="status s-${e.status}">${e.status}</span></div>
          <div class="muted" style="font-size:13px;margin-top:6px">${esc(e.objective || 'No objective set')}</div>
          <div class="row" style="margin-top:12px">
            <button class="btn sec sm" data-edit>Edit details</button>
            ${locked ? '<span class="pill">🔒 Locked — read only</span>' : '<button class="btn ok sm" data-lock>🔒 Lock experiment</button>'}
          </div>
        </div>
        ${locked ? '' : '<div id="composerMount"></div>'}
        <div class="card" style="margin-top:16px">
          <h2 class="sec-t">Notebook entries <span class="muted" style="font-weight:400">(${e.entries.length})</span></h2>
          <div id="entryFeed">${e.entries.map(en => entryHTML(en, locked)).join('') || '<div class="empty">No entries yet.</div>'}</div>
        </div>
      </div>
      <div class="card">
        <h2 class="sec-t">Integrity</h2>
        <p class="muted" style="font-size:12px;margin-top:0">Each entry carries a content fingerprint. Signing locks it; any later change breaks the fingerprint — the basis of an audit-ready record.</p>
        <div class="hint" style="margin-top:0">Signed: <b>${e.entries.filter(x => x.signed_by).length}/${e.entries.length}</b></div>
        <div class="hint">Status: <b>${e.status}</b></div>
      </div>
    </div>`;

  root.querySelector('[data-back]').onclick = () => ctx.go('experiments');
  root.querySelector('[data-edit]').onclick = () => editExperimentModal(ctx, e);
  const lockBtn = root.querySelector('[data-lock]');
  if (lockBtn) lockBtn.onclick = () => confirmModal('Lock experiment?',
    'Locking makes this experiment read-only. No new entries can be added.',
    guard(async () => { await api.lockExperiment(e.id); toast('Experiment locked'); ctx.go('experiments', { id: e.id }); }));

  wireSignButtons(root, ctx, e.id);
  if (!locked) mountComposer(root.querySelector('#composerMount'), ctx, e.id);
});

function entryHTML(en, locked) {
  const type = en.signed_by ? 'sig' : en.type;
  const badge = { voice: '<span class="badge b-voice">🎙 Voice</span>', ocr: '<span class="badge b-ocr">📷 OCR</span>', note: '<span class="badge b-note">Note</span>' }[en.type] || '';
  const id = getIdentity();
  const canSign = !en.signed_by && !locked && id.name;
  return `<div class="entry ${type}">
    <div class="eh">${badge}
      <span>🕒 ${fmt(en.created_at)}</span>
      <span>· ${esc(en.author || 'Unknown')}${en.role ? ' (' + esc(en.role) + ')' : ''}</span>
      ${en.signed_by ? `<span class="badge b-sig">🔒 Signed by ${esc(en.signed_by)}</span>` : ''}</div>
    <div class="body">${esc(en.text)}</div>
    ${en.image_url ? `<img class="thumb" src="${esc(en.image_url)}" alt="scan"/>` : ''}
    <div class="hashline">fingerprint ${en.hash}${en.signed_by ? ` · signed ${fmt(en.signed_at)} · sig ${en.sig}` : ''}</div>
    ${canSign ? `<button class="btn ok sm" style="margin-top:8px" data-sign="${en.id}">🔒 Sign &amp; lock entry</button>` : ''}
  </div>`;
}

function wireSignButtons(root, ctx, expId) {
  root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => {
    if (!getIdentity().name) { toast('Set your identity in Settings first', true); return ctx.go('settings'); }
    confirmModal('Sign &amp; lock this entry?',
      `By signing you attest this record is accurate and complete. It will be locked as ${esc(getIdentity().name)}.`,
      guard(async () => { await api.signEntry(b.dataset.sign); toast('Entry signed & locked'); ctx.go('experiments', { id: expId }); }),
      'Sign');
  });
}

function editExperimentModal(ctx, e) {
  modal(`<h3>Edit experiment</h3>
    <label class="fld">Title</label><input class="txt" id="mTitle" value="${esc(e.title)}"/>
    <label class="fld">Project</label><input class="txt" id="mProj" value="${esc(e.project)}"/>
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
      project: m.querySelector('#mProj').value.trim(),
      objective: m.querySelector('#mObj').value.trim(),
      status: m.querySelector('#mStat').value
    });
    closeModal(); toast('Saved'); ctx.go('experiments', { id: e.id });
  });
}

/* --------------------------- Composer --------------------------- */
function mountComposer(mount, ctx, expId) {
  let capturedType = null;   // 'voice' | 'ocr' | null(note)
  let uploadedUrl = null;
  let previewData = null;

  mount.innerHTML = `
    <div class="composer">
      <div class="between" style="margin-bottom:8px"><b>Add entry</b>
        <span class="reclabel" id="reclabel"><span class="dot"></span> <span id="recword">Recording…</span></span></div>
      <div class="toolbar">
        <button class="btn sm mic" id="micStart" type="button">🎙 Start voice</button>
        <button class="btn sm warn" id="micPause" type="button" style="display:none">⏸ Pause</button>
        <button class="btn sm danger" id="micStop" type="button" style="display:none">⏹ Stop</button>
        <button class="btn sm sec" id="ocrBtn" type="button">📷 Scan handwriting (OCR)</button>
        <input type="file" id="ocrFile" accept="image/*" capture="environment" style="display:none"/>
      </div>
      <textarea class="txt" id="composerText" placeholder="Type, dictate (Start voice), or scan a handwritten note."></textarea>
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

  /* Voice */
  const micStart = mount.querySelector('#micStart');
  const micPause = mount.querySelector('#micPause');
  const micStop = mount.querySelector('#micStop');
  const reclabel = mount.querySelector('#reclabel');
  const recword = mount.querySelector('#recword');

  if (!voiceSupported) {
    micStart.disabled = true; micStart.textContent = '🎙 Voice not supported';
    micStart.title = 'Use Chrome or Edge for browser voice entry';
  }

  const voice = new VoiceController({
    onText: t => { text.value = t; upd(); },
    onState: s => {
      if (s.startsWith('error')) { stateEl.textContent = 'Mic blocked — check browser permissions'; resetVoiceUI(); return; }
      capturedType = 'voice';
      if (s === 'recording') {
        micStart.style.display = 'none'; micPause.style.display = ''; micStop.style.display = '';
        micPause.textContent = '⏸ Pause';
        reclabel.classList.add('on'); reclabel.classList.remove('paused'); recword.textContent = 'Recording…';
        stateEl.textContent = 'Listening… speak now';
      } else if (s === 'paused') {
        micPause.textContent = '▶ Resume';
        reclabel.classList.add('on', 'paused'); recword.textContent = 'Paused';
        stateEl.textContent = 'Paused — Resume or Stop';
      } else { resetVoiceUI(); stateEl.textContent = text.value ? 'Voice captured — review & save' : ''; }
    }
  });
  function resetVoiceUI() {
    micStart.style.display = ''; micPause.style.display = 'none'; micStop.style.display = 'none';
    reclabel.classList.remove('on', 'paused');
  }
  micStart.onclick = () => voice.start(text.value);
  micPause.onclick = () => (voice.state === 'recording' ? voice.pause() : voice.resume());
  micStop.onclick = () => voice.stop();

  /* OCR */
  mount.querySelector('#ocrBtn').onclick = () => mount.querySelector('#ocrFile').click();
  mount.querySelector('#ocrFile').onchange = guard(async ev => {
    const f = ev.target.files[0]; if (!f) return;
    previewData = await fileToDataURL(f);
    capturedType = 'ocr';
    mount.querySelector('#ocrPreview').innerHTML =
      `<img class="thumb" src="${previewData}"/><div class="muted" style="font-size:12px;margin-top:6px" id="ocrStatus">Reading handwriting…</div>`;
    stateEl.textContent = 'Running OCR…';
    try {
      const out = await runOCR(previewData, p => { const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = 'Reading… ' + p + '%'; });
      text.value = (text.value ? text.value + '\n' : '') + out;
      const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = out ? '✓ Text extracted — review & save' : 'No text detected — try a clearer image';
      stateEl.textContent = 'OCR complete'; upd();
      // upload the image so it is stored with the record
      try { uploadedUrl = (await api.uploadImage(f)).url; } catch { uploadedUrl = null; }
    } catch (err) {
      const s = mount.querySelector('#ocrStatus'); if (s) s.textContent = 'OCR failed: ' + err.message;
    }
  });

  /* Save / clear */
  mount.querySelector('#clearEntry').onclick = () => {
    text.value = ''; capturedType = null; uploadedUrl = null; previewData = null;
    mount.querySelector('#ocrPreview').innerHTML = ''; stateEl.textContent = ''; upd();
    if (voice.state !== 'idle') voice.stop();
  };
  saveBtn.onclick = guard(async () => {
    const val = text.value.trim(); if (!val) return;
    if (voice.state !== 'idle') voice.stop();
    await api.addEntry(expId, { type: capturedType || 'note', text: val, imageUrl: uploadedUrl });
    toast('Entry saved & time-stamped'); ctx.go('experiments', { id: expId });
  });
}
