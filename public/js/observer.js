import { api } from './api.js';
import { esc, guard, modal, closeModal, toast, autoGrowTextareas } from './ui.js';
import { VoiceController, voiceSupported } from './voice.js';
import { cameraSupported, startCamera, stopCamera } from './ocr.js';

const ANALYZE_EVERY_MS = 12000;
const SPEECH_EVENT_EVERY_MS = 6000;

export function openObserverMode(exp, ctx) {
  let stream = null;
  let voice = null;
  let analyzeTimer = null;
  let speechTimer = null;
  let startedAt = null;
  let running = false;
  let analyzing = false;
  let transcript = '';
  let lastLoggedTranscript = '';
  let lastFrameBlob = null;
  let aiReady = false;
  const events = [];

  modal(`
    <div class="observe-modal">
      <div class="between observe-head">
        <div>
          <h3>Observe run</h3>
          <div class="muted" style="font-size:12px">${esc(exp.title)} · camera, live speech, action timeline</div>
        </div>
        <button class="btn ghost sm" id="obsClose" type="button">Close</button>
      </div>

      <div class="observe-grid">
        <div>
          <div class="observe-video">
            <video id="obsVideo" playsinline autoplay muted></video>
            <div class="observe-live" id="obsLive">Idle</div>
          </div>
          <div class="observe-controls">
            <button class="btn" id="obsStart" type="button">Start observe</button>
            <button class="btn warn" id="obsAnalyze" type="button" disabled>Analyze now</button>
            <button class="btn danger" id="obsStop" type="button" disabled>Stop</button>
            <button class="btn ok" id="obsSave" type="button" disabled>Review entry</button>
          </div>
          <div class="hint" id="obsHint">Use HTTPS or localhost so the phone can grant camera and microphone access.</div>
        </div>

        <div class="observe-side">
          <label class="fld">Live transcript</label>
          <textarea class="txt" id="obsTranscript" placeholder="Speech appears here while you talk." readonly></textarea>

          <label class="fld">Manual action marker</label>
          <div class="observe-marker">
            <input class="txt" id="obsMarker" placeholder="e.g. added 5 mL buffer to vial A1"/>
            <button class="btn sec" id="obsMark" type="button" disabled>Add</button>
          </div>

          <div class="between" style="margin-top:12px">
            <h2 class="sec-t" style="margin:0">Timeline</h2>
            <span class="pill" id="obsAi">Vision AI: checking</span>
          </div>
          <div class="observe-timeline" id="obsTimeline"></div>
        </div>
      </div>
    </div>`);

  const shell = document.getElementById('modal');
  shell.classList.add('modal-observe');
  const overlay = document.getElementById('overlay');
  const video = shell.querySelector('#obsVideo');
  const live = shell.querySelector('#obsLive');
  const hint = shell.querySelector('#obsHint');
  const transcriptEl = shell.querySelector('#obsTranscript');
  const timelineEl = shell.querySelector('#obsTimeline');
  const aiEl = shell.querySelector('#obsAi');
  const markerEl = shell.querySelector('#obsMarker');
  const startBtn = shell.querySelector('#obsStart');
  const analyzeBtn = shell.querySelector('#obsAnalyze');
  const stopBtn = shell.querySelector('#obsStop');
  const saveBtn = shell.querySelector('#obsSave');
  const markBtn = shell.querySelector('#obsMark');

  const cleanupAndClose = () => { cleanup(); closeModal(); };
  const overlayCleanup = e => { if (e.target.id === 'overlay') cleanup(); };
  overlay.addEventListener('click', overlayCleanup);

  shell.querySelector('#obsClose').onclick = cleanupAndClose;
  startBtn.onclick = guard(start);
  analyzeBtn.onclick = guard(() => analyzeFrame('Manual snapshot'));
  stopBtn.onclick = stop;
  markBtn.onclick = () => {
    const text = markerEl.value.trim();
    if (!text) return;
    markerEl.value = '';
    addEvent('manual', text);
  };
  saveBtn.onclick = guard(reviewEntry);

  api.aiHealth()
    .then(h => {
      aiReady = !!h.configured;
      aiEl.textContent = aiReady ? `Vision AI: ${h.visionModel || h.model || 'ready'}` : 'Vision AI: off';
    })
    .catch(() => { aiEl.textContent = 'Vision AI: off'; });

  renderTimeline();

  async function start() {
    if (running) return;
    if (!cameraSupported) {
      hint.textContent = 'Camera is unavailable in this browser context. Use HTTPS or localhost.';
      return;
    }
    stream = await startCamera(video, 'environment');
    running = true;
    startedAt = new Date();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    analyzeBtn.disabled = false;
    markBtn.disabled = false;
    saveBtn.disabled = true;
    live.textContent = 'Watching';
    live.classList.add('on');
    hint.textContent = voiceSupported
      ? 'Watching through the camera and listening for live speech.'
      : 'Watching through the camera. Live dictation is unavailable in this browser.';
    addEvent('system', 'Observer started');

    if (voiceSupported) {
      voice = new VoiceController({
        onText: t => {
          transcript = t;
          transcriptEl.value = t;
          autoGrowTextareas(transcriptEl);
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
        },
        onState: s => {
          if (s.startsWith('error')) addEvent('warning', 'Microphone access was blocked or unavailable');
        }
      });
      voice.start('');
      speechTimer = setInterval(logSpeechDelta, SPEECH_EVENT_EVERY_MS);
    } else {
      addEvent('warning', 'Live speech is unavailable here; use manual markers or a supported browser for live voice capture');
    }

    analyzeTimer = setInterval(() => analyzeFrame('Auto snapshot'), ANALYZE_EVERY_MS);
    setTimeout(() => analyzeFrame('Initial snapshot'), 1800);
  }

  function stop() {
    if (!running) return;
    running = false;
    stopCamera(stream);
    stream = null;
    if (voice) voice.stop();
    voice = null;
    clearInterval(analyzeTimer);
    clearInterval(speechTimer);
    analyzeTimer = null;
    speechTimer = null;
    logSpeechDelta();
    live.textContent = 'Stopped';
    live.classList.remove('on');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    analyzeBtn.disabled = true;
    markBtn.disabled = true;
    saveBtn.disabled = false;
    addEvent('system', 'Observer stopped');
  }

  async function analyzeFrame(label) {
    if (!running || analyzing) return;
    analyzing = true;
    analyzeBtn.disabled = true;
    try {
      const frame = await captureCompactFrame(video);
      lastFrameBlob = frame.blob;
      if (!aiReady) {
        addEvent('snapshot', `${label} captured`);
        return;
      }
      addEvent('snapshot', `${label} sent for visual observation`);
      const obs = await api.observeFrame(exp.id, frame.dataURL, transcript, events.slice(-8));
      if (!obs.configured) {
        aiReady = false;
        aiEl.textContent = 'Vision AI: off';
        return;
      }
      const action = obs.action || obs.summary || obs.raw || '';
      if (action) addEvent('vision', action, obs);
      if (Array.isArray(obs.warnings)) obs.warnings.filter(Boolean).slice(0, 2).forEach(w => addEvent('warning', w));
    } catch (e) {
      addEvent('warning', 'Visual observation failed: ' + (e.message || 'unknown error'));
    } finally {
      analyzing = false;
      analyzeBtn.disabled = !running;
    }
  }

  function logSpeechDelta() {
    const next = transcript.trim();
    if (!next || next === lastLoggedTranscript) return;
    const delta = next.startsWith(lastLoggedTranscript)
      ? next.slice(lastLoggedTranscript.length).trim()
      : next;
    if (delta.length < 10 && next.length < 30) return;
    lastLoggedTranscript = next;
    addEvent('speech', delta || next);
  }

  function reviewEntry() {
    if (running) stop();
    const text = buildEntryText(exp.title, startedAt, new Date(), transcript, events);
    if (!text.trim()) return toast('Nothing recorded yet', true);
    showReview(text);
  }

  function showReview(text) {
    shell.innerHTML = `
      <div class="between observe-head">
        <div>
          <h3>Confirm observer entry</h3>
          <div class="muted" style="font-size:12px">${esc(exp.title)} · review before it enters the notebook</div>
        </div>
        <button class="btn ghost sm" id="obsDiscard" type="button">Discard</button>
      </div>
      <div class="hint">This is the exact entry that will be written to the experiment and audit trail. Review or edit it, then confirm.</div>
      <textarea class="txt observe-review" id="obsReviewText">${esc(text)}</textarea>
      <div class="row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn ghost" id="obsCancelReview" type="button">Cancel</button>
        <button class="btn ok" id="obsConfirmSave" type="button">Confirm &amp; save</button>
      </div>`;
    shell.querySelector('#obsDiscard').onclick = cleanupAndClose;
    shell.querySelector('#obsCancelReview').onclick = cleanupAndClose;
    shell.querySelector('#obsConfirmSave').onclick = guard(async () => {
      const reviewedText = shell.querySelector('#obsReviewText').value.trim();
      if (!reviewedText) return toast('Entry text required', true);
      await saveConfirmed(reviewedText);
    });
    autoGrowTextareas(shell);
    setTimeout(() => shell.querySelector('#obsReviewText')?.focus(), 30);
  }

  async function saveConfirmed(text) {
    let imageUrl = null;
    if (lastFrameBlob) {
      try { imageUrl = (await api.uploadImage(lastFrameBlob, 'observer-frame.jpg')).url; } catch {}
    }
    await api.addEntry(exp.id, { type: 'observe', text, imageUrl });
    toast('Observer run saved');
    cleanupAndClose();
    ctx.go('experiments', { id: exp.id });
  }

  function cleanup() {
    stopCamera(stream);
    stream = null;
    if (voice && voice.state !== 'idle') voice.stop();
    voice = null;
    clearInterval(analyzeTimer);
    clearInterval(speechTimer);
    overlay.removeEventListener('click', overlayCleanup);
    shell.classList.remove('modal-observe');
  }

  function addEvent(kind, text, meta = {}) {
    events.push({
      at: new Date().toISOString(),
      elapsed: startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0,
      kind,
      text: String(text || '').trim(),
      meta
    });
    renderTimeline();
  }

  function renderTimeline() {
    timelineEl.innerHTML = events.length ? events.slice().reverse().map(e => `
      <div class="observe-event ${esc(e.kind)}">
        <div class="observe-time">${formatElapsed(e.elapsed)} · ${esc(labelFor(e.kind))}</div>
        <div>${esc(e.text)}</div>
        ${e.meta?.objects?.length ? `<div class="muted" style="font-size:11px;margin-top:4px">Objects: ${esc(e.meta.objects.join(', '))}</div>` : ''}
      </div>`).join('') : '<div class="empty" style="padding:22px 12px">No observations yet.</div>';
  }
}

function labelFor(kind) {
  return { system: 'System', speech: 'Speech', vision: 'Vision', snapshot: 'Frame', manual: 'Manual', warning: 'Check' }[kind] || kind;
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.max(0, seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function captureCompactFrame(video) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
  const w = Math.max(1, Math.round(sourceW * scale));
  const h = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  const dataURL = canvas.toDataURL('image/jpeg', 0.72);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  return { dataURL, blob: blob || dataURLtoBlob(dataURL) };
}

function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function buildEntryText(title, startedAt, endedAt, transcript, events) {
  const lines = [
    `Observer run: ${title}`,
    `Started: ${startedAt ? startedAt.toISOString() : 'not started'}`,
    `Ended: ${endedAt.toISOString()}`,
    '',
    'Live transcript:',
    transcript.trim() || '(no speech captured)',
    '',
    'Observed timeline:'
  ];
  events.forEach(e => lines.push(`[${formatElapsed(e.elapsed)}] ${labelFor(e.kind)}: ${e.text}`));
  return lines.join('\n').trim();
}
