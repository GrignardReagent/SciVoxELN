/**
 * Speech-to-text endpoint (Whisper-ready seam).
 *
 * By default the browser SPA transcribes voice with the Web Speech API, which
 * is fast and free but streams audio to the browser vendor's cloud —
 * unsuitable for classified / on-prem labs. Set STT_PROVIDER=whisper to route
 * voice through a self-hosted Whisper container instead (see docker-compose.yml,
 * the `whisper` profile). When enabled, the frontend records audio with
 * MediaRecorder and POSTs it here; this route forwards it to the Whisper ASR
 * webservice and returns the transcript.
 *
 * Env:
 *   STT_PROVIDER=webspeech|whisper   (default webspeech)
 *   STT_URL=http://whisper:9000      (base URL of the ASR webservice)
 */
import { Router } from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const r = Router();

const PROVIDER = process.env.STT_PROVIDER || 'webspeech'; // webspeech | whisper
const STT_URL = (process.env.STT_URL || 'http://whisper:9000').replace(/\/$/, '');

r.get('/health', (_req, res) => {
  res.json({ provider: PROVIDER, serverStt: PROVIDER !== 'webspeech', url: PROVIDER !== 'webspeech' ? STT_URL : undefined });
});

r.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (PROVIDER === 'webspeech') {
    return res.status(501).json({
      error: 'Server-side STT is not enabled. The client uses the Web Speech API.',
      howToEnable: 'Set STT_PROVIDER=whisper and run the whisper profile (see docker-compose.yml).'
    });
  }
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded (field name: audio)' });
  try {
    const text = await transcribe(req.file);
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
async function transcribe(file) {
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/webm' });
  form.append('audio_file', blob, file.originalname || 'audio.webm');
  const url = `${STT_URL}/asr?task=transcribe&encode=true&output=txt`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Whisper service responded ${resp.status}`);
  return (await resp.text()).trim();
}

export default r;
