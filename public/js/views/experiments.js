import { api } from '../api.js';
import { esc, fmt, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { getUser } from '../state.js';
import { VoiceController, voiceSupported } from '../voice.js';
import { Recorder, recorderSupported } from '../recorder.js';
import { runOCR, fileToDataURL, cameraSupported, startCamera, stopCamera, captureFrame } from '../ocr.js';

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
      <span>📝 ${e.entryCount || 0}</span><span>· ${fmtShort(e.created_at)}</span></div></div>`;
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
    const exp = await api.createExperiment({ title, project: m.querySelector('#mProj').value.trim(), objective: m.querySelector('#mObj').value.trim() });
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
  mountAssistant(root, e);
});

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
  const badge = { voice: '<span class="badge b-voice">🎙 Voice</span>', ocr: '<span class="badge b-ocr">📷 OCR</span>', note: '<span class="badge b-note">Note</span>' }[en.type] || '';
  const canSign = !en.signed_by && !locked && getUser();
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
    const u = getUser();
    confirmModal('Sign &amp; lock this entry?',
      `By signing you attest this record is accurate and complete. It will be locked as ${esc(u.name || u.email)}.`,
      guard(async () => { await api.signEntry(b.dataset.sign); toast('Entry signed & locked'); ctx.go('experiments', { id: expId }); }), 'Sign');
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
async function mountComposer(mount, ctx, expId) {
  let capturedType = null, uploadedUrl = null;
  let serverStt = false;
  try { serverStt = !!(await api.sttHealth()).serverStt; } catch {}
  const useRecorder = serverStt && recorderSupported;

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
        <input type="file" id="ocrFile" accept="image/*" capture="environment" style="display:none"/>
        <span class="pill" style="margin-left:auto">${useRecorder ? '🔒 Whisper' : 'Web Speech'}</span>
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

  if (useRecorder) wireRecorder(); else wireWebSpeech();

  function wireWebSpeech() {
    if (!voiceSupported) { micStart.disabled = true; micStart.textContent = '🎙 Voice not supported'; micStart.title = 'Use Chrome/Edge or enable server Whisper'; return; }
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
