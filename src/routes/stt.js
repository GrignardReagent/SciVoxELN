/**
 * Speech-to-text endpoint (Whisper-ready seam).
 *
 * The browser SPA transcribes voice with the Web Speech API today, which is
 * fast and free but streams audio to the browser vendor's cloud — unsuitable
 * for classified / on-prem labs. This route is the drop-in replacement point
 * for a self-hosted engine (OpenAI Whisper, whisper.cpp, or faster-whisper
 * running in its own container). The frontend already routes through
 * `public/js/voice.js`, which checks `GET /api/stt/health` and, when a server
 * engine is enabled, POSTs recorded audio here instead of using Web Speech.
 *
 * To enable, set STT_PROVIDER=whisper (and implement `transcribe()` below), or
 * point STT_URL at an external whisper service. Kept as a stub so the app runs
 * with zero extra infrastructure out of the box.
 */
import { Router } from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const r = Router();

const PROVIDER = process.env.STT_PROVIDER || 'webspeech'; // webspeech | whisper

r.get('/health', (_req, res) => {
  res.json({ provider: PROVIDER, serverStt: PROVIDER !== 'webspeech' });
});

r.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (PROVIDER === 'webspeech') {
    return res.status(501).json({
      error: 'Server-side STT is not enabled. The client uses the Web Speech API.',
      howToEnable: 'Set STT_PROVIDER=whisper and implement transcribe() in src/routes/stt.js, or run a Whisper container and set STT_URL.'
    });
  }
  try {
    const text = await transcribe(req.file);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: 'Transcription failed: ' + e.message });
  }
});

/**
 * Implement your engine here. Example (faster-whisper HTTP service):
 *
 *   const form = new FormData();
 *   form.append('file', new Blob([file.buffer]), file.originalname);
 *   const resp = await fetch(process.env.STT_URL + '/v1/audio/transcriptions', { method: 'POST', body: form });
 *   const json = await resp.json();
 *   return json.text;
 */
async function transcribe(_file) {
  throw new Error('transcribe() not implemented — see comments in src/routes/stt.js');
}

export default r;
