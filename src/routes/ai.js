/**
 * AI assistant — server-side proxy to the OpenAI Chat Completions API.
 *
 * The API key lives only on the server (process.env.OPENAI_API_KEY, loaded from
 * .env) and is never sent to the browser. Each request is scoped to one
 * experiment: the server injects that experiment's context as a system message
 * so the assistant can answer about the actual record. Requires authentication.
 *
 * Env: OPENAI_API_KEY (required to enable), OPENAI_MODEL (default gpt-5.5),
 * OPENAI_VISION_MODEL (optional; defaults to OPENAI_MODEL).
 */
import { Router } from 'express';
import { Experiments, Audit } from '../db.js';

const r = Router();
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || MODEL;
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_URL = `${BASE}/chat/completions`;
const configured = () => !!process.env.OPENAI_API_KEY;

r.get('/health', (_req, res) => res.json({ configured: configured(), model: MODEL, visionModel: VISION_MODEL }));

r.post('/chat', async (req, res) => {
  if (!configured()) return res.status(501).json({ error: 'AI assistant is not configured (set OPENAI_API_KEY).' });

  const { experimentId, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages[] required' });

  // Build experiment context (server-side, trusted).
  let context = 'No specific experiment is open.';
  const exp = experimentId ? Experiments.get(experimentId, req.user) : null;
  if (experimentId && !exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp) {
    const entries = (exp.entries || []).slice(-12)
      .map(e => `- [${e.type}${e.signed_by ? ', signed' : ''}] ${e.text}`).join('\n').slice(0, 4000);
    context = [
      `Title: ${exp.title}`,
      `Project: ${exp.project || '—'}`,
      `Status: ${exp.status}`,
      `Objective: ${exp.objective || '—'}`,
      `Recent notebook entries:\n${entries || '(none yet)'}`
    ].join('\n');
  }

  const system = {
    role: 'system',
    content:
      'You are SciVox Assistant, an AI embedded in an Electronic Lab Notebook for scientists in regulated labs. ' +
      'Help with experiment design, troubleshooting, calculations, protocols, and interpreting results for the CURRENT experiment. ' +
      'Be concise and scientifically precise. State assumptions and uncertainty; never invent data or results. ' +
      'You cannot modify the notebook or take actions — you only advise. If asked for regulated/compliance guidance, be careful and suggest verifying against the lab\'s SOPs.\n\n' +
      `CURRENT EXPERIMENT CONTEXT:\n${context}`
  };

  // Only pass through user/assistant turns from the client; cap history.
  const history = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [system, ...history] })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `OpenAI error ${resp.status}`;
      return res.status(502).json({ error: msg });
    }
    const reply = data?.choices?.[0]?.message?.content?.trim() || '(no response)';
    Audit.log(req.user.name, req.user.role, 'AI_CHAT', exp ? `"${exp.title}"` : 'general', { projectId: exp?.project_id });
    res.json({ reply, model: MODEL });
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
});

r.post('/observe', async (req, res) => {
  if (!configured()) return res.status(501).json({ configured: false, error: 'Vision observer is not configured (set OPENAI_API_KEY).' });

  const { experimentId, imageData, transcript = '', recentEvents = [] } = req.body || {};
  if (!imageData || typeof imageData !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(imageData)) {
    return res.status(400).json({ error: 'imageData must be a base64 image data URL' });
  }
  if (imageData.length > 1_600_000) return res.status(413).json({ error: 'Observer frame is too large' });

  const exp = experimentId ? Experiments.get(experimentId, req.user) : null;
  if (experimentId && !exp) return res.status(404).json({ error: 'Experiment not found' });
  const recent = Array.isArray(recentEvents) ? recentEvents.slice(-8).map(e => ({
    kind: String(e.kind || '').slice(0, 24),
    text: String(e.text || '').slice(0, 220)
  })) : [];

  const prompt = [
    'You are observing a live laboratory experiment through a mobile phone camera for an Electronic Lab Notebook.',
    'Create a concise, timestamp-ready observation of visible lab actions.',
    'Use the transcript and recent timeline only as context. Do not invent reagent names, values, identities, or results.',
    'If the image is unclear or no action is visible, say that plainly.',
    'Return JSON only with: action (string), objects (array of short strings), warnings (array of short strings), confidence (number 0 to 1).',
    '',
    `Experiment: ${exp ? exp.title : 'unknown'}`,
    `Objective: ${exp?.objective || 'not set'}`,
    `Recent transcript: ${String(transcript).slice(-1200) || '(none)'}`,
    `Recent events: ${JSON.stringify(recent)}`
  ].join('\n');

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        }],
        max_completion_tokens: 260
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `OpenAI vision error ${resp.status}`;
      return res.status(502).json({ error: msg });
    }
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    res.json({ configured: true, ...parseObservation(raw), raw });
  } catch (e) {
    res.status(502).json({ error: 'Vision observation failed: ' + e.message });
  }
});

export default r;

function parseObservation(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      action: String(parsed.action || parsed.summary || '').slice(0, 500),
      objects: Array.isArray(parsed.objects) ? parsed.objects.map(String).slice(0, 8) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 4) : [],
      confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : null
    };
  } catch {
    return { action: cleaned.slice(0, 500), objects: [], warnings: [], confidence: null };
  }
}
