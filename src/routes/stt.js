/**
 * Speech-to-text endpoint for browser-recorded audio.
 *
 * Mobile browsers often do not support the Web Speech API, so server STT is the
 * mobile-safe path: the frontend records audio with MediaRecorder, POSTs it
 * here, and this route forwards it to OpenAI or a self-hosted Whisper service.
 * Use STT_PROVIDER=webspeech for browser-only dictation, STT_PROVIDER=openai
 * for OpenAI transcription, or STT_PROVIDER=whisper for on-prem transcription.
 *
 * Env:
 *   STT_PROVIDER=auto|webspeech|openai|whisper (default auto)
 *   STT_OPENAI_MODEL=gpt-4o-mini-transcribe    (when using OpenAI)
 *   STT_URL=http://whisper:9000                (base URL of the ASR webservice)
 */
import { Router } from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const r = Router();

const REQUESTED_PROVIDER = process.env.STT_PROVIDER || 'auto';
const VALID_PROVIDERS = new Set(['auto', 'webspeech', 'openai', 'whisper']);
const PROVIDER = !VALID_PROVIDERS.has(REQUESTED_PROVIDER) ? 'webspeech' : REQUESTED_PROVIDER === 'auto'
  ? (process.env.OPENAI_API_KEY ? 'openai' : 'webspeech')
  : REQUESTED_PROVIDER; // auto | webspeech | openai | whisper
const STT_URL = (process.env.STT_URL || 'http://whisper:9000').replace(/\/$/, '');
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_TRANSCRIBE_MODEL = process.env.STT_OPENAI_MODEL || 'gpt-4o-mini-transcribe';

r.get('/health', (_req, res) => {
  res.json({
    provider: PROVIDER,
    requestedProvider: REQUESTED_PROVIDER,
    validProvider: VALID_PROVIDERS.has(REQUESTED_PROVIDER),
    serverStt: PROVIDER !== 'webspeech',
    model: PROVIDER === 'openai' ? OPENAI_TRANSCRIBE_MODEL : undefined,
    url: PROVIDER === 'whisper' ? STT_URL : undefined
  });
});

r.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (PROVIDER === 'webspeech') {
    return res.status(501).json({
      error: 'Server-side STT is not enabled. The client uses the Web Speech API.',
      howToEnable: 'Set STT_PROVIDER=auto/openai with OPENAI_API_KEY, or STT_PROVIDER=whisper with the whisper profile.'
    });
  }
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded (field name: audio)' });
  try {
    const text = PROVIDER === 'openai' ? await transcribeOpenAI(req.file) : await transcribeWhisper(req.file);
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: 'Transcription failed: ' + e.message });
  }
});

/**
 * Forward audio to the openai-whisper-asr-webservice `/asr` endpoint.
 * It accepts a multipart `audio_file` and, with output=txt, returns the
 * transcript as plain text. Uses Node's global fetch/FormData/Blob (Node >= 22).
 */
async function transcribeWhisper(file) {
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/webm' });
  form.append('audio_file', blob, file.originalname || 'audio.webm');
  const url = `${STT_URL}/asr?task=transcribe&encode=true&output=txt`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Whisper service responded ${resp.status}`);
  return (await resp.text()).trim();
}

/** Forward audio to OpenAI's audio transcriptions endpoint. */
async function transcribeOpenAI(file) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for STT_PROVIDER=openai');
  const form = new FormData();
  const mime = file.mimetype || 'audio/webm';
  const blob = new Blob([file.buffer], { type: mime });
  form.append('file', blob, file.originalname || filenameForMime(mime));
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  form.append('response_format', 'json');
  form.append('prompt', 'Scientific lab notebook dictation. Preserve reagent names, units, lot numbers, concentrations, pH values, temperatures, and experiment identifiers.');
  const resp = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : await resp.text();
  if (!resp.ok) {
    const msg = typeof data === 'string' ? data : data?.error?.message;
    throw new Error(msg || `OpenAI transcription responded ${resp.status}`);
  }
  return (typeof data === 'string' ? data : data?.text || '').trim();
}

function filenameForMime(mime) {
  if (mime.includes('mp4')) return 'audio.mp4';
  if (mime.includes('mpeg')) return 'audio.mp3';
  if (mime.includes('wav')) return 'audio.wav';
  if (mime.includes('ogg')) return 'audio.ogg';
  return 'audio.webm';
}

export default r;
