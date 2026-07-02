/**
 * AI assistant — server-side proxy to the OpenAI Chat Completions API.
 *
 * The API key lives only on the server (process.env.OPENAI_API_KEY, loaded from
 * .env) and is never sent to the browser. Each request is scoped to one
 * experiment: the server injects that experiment's context as a system message
 * so the assistant can answer about the actual record. Requires authentication.
 *
 * Env: OPENAI_API_KEY (required to enable), OPENAI_MODEL (default gpt-5.5).
 */
import { Router } from 'express';
import { Experiments, Audit } from '../db.js';

const r = Router();
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_URL = `${BASE}/chat/completions`;
const configured = () => !!process.env.OPENAI_API_KEY;

r.get('/health', (_req, res) => res.json({ configured: configured(), model: MODEL }));

r.post('/chat', async (req, res) => {
  if (!configured()) return res.status(501).json({ error: 'AI assistant is not configured (set OPENAI_API_KEY).' });

  const { experimentId, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages[] required' });

  // Build experiment context (server-side, trusted).
  let context = 'No specific experiment is open.';
  const exp = experimentId ? Experiments.get(experimentId) : null;
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
    Audit.log(req.user.name, req.user.role, 'AI_CHAT', exp ? `"${exp.title}"` : 'general');
    res.json({ reply, model: MODEL });
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
});

export default r;
