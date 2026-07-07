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
import { Entries, ExperimentAttachments, ExperimentLinks, ExperimentSteps, Experiments, Audit, Projects, isHiddenEntryType } from '../db.js';

const r = Router();
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || MODEL;
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_URL = `${BASE}/chat/completions`;
const configured = () => !!process.env.OPENAI_API_KEY;
const VOICE_TEMPLATES = new Set(['lab_report', 'auto_lab_note', 'numbered_observations', 'concise_paragraph']);
const LEGACY_STYLE_TO_TEMPLATE = {
  numbered_bullets: 'numbered_observations',
  concise_paragraph: 'concise_paragraph'
};

r.get('/health', (_req, res) => res.json({ configured: configured(), model: MODEL, visionModel: VISION_MODEL }));

r.post('/process-voice-draft', async (req, res) => {
  const experimentId = String(req.body?.experimentId || '');
  const transcript = compactSpaces(req.body?.transcript || '').slice(0, 16000);
  const rawNotes = compactSpaces(req.body?.rawNotes ?? req.body?.manualNotes ?? '').slice(0, 6000);
  const legacyStyle = req.body?.style === 'concise_paragraph'
    ? 'concise_paragraph'
    : req.body?.style === 'numbered_bullets'
      ? 'numbered_bullets'
      : '';
  const requestedTemplate = String(req.body?.template || '').trim();
  if (requestedTemplate && !VOICE_TEMPLATES.has(requestedTemplate)) {
    return res.status(400).json({ error: 'template must be lab_report, auto_lab_note, numbered_observations, or concise_paragraph' });
  }
  const template = VOICE_TEMPLATES.has(requestedTemplate)
    ? requestedTemplate
    : legacyStyle
      ? LEGACY_STYLE_TO_TEMPLATE[legacyStyle]
      : 'auto_lab_note';
  const responseStyle = legacyStyle || template;
  if (!experimentId) return res.status(400).json({ error: 'experimentId required' });
  if (!transcript && !rawNotes) return res.status(400).json({ error: 'transcript or rawNotes required' });

  const exp = Experiments.get(experimentId, req.user);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  if (!Projects.canAccessProject(req.user, exp.project_id, 'scientist')) return res.status(403).json({ error: 'Project write access required' });
  if (exp.status === 'locked') return res.status(409).json({ error: 'Experiment is locked (read-only)' });

  if (!configured()) {
    const output = localVoiceDraft(transcript, rawNotes, template, exp);
    Audit.log(req.user.name, req.user.role, 'LOCAL_VOICE_DRAFT',
      `${responseStyle} for "${exp.title}" | template ${template} | transcript words ${countWords(transcript)} | raw note words ${countWords(rawNotes)} | model local-template`,
      { projectId: exp.project_id });
    return res.json({ style: responseStyle, template, output, model: 'local-template', experimentId: exp.id, offline: true });
  }

  const system = {
    role: 'system',
    content:
      'You are SciVox Assistant, polishing a dictated laboratory notebook draft for a regulated Electronic Lab Notebook. ' +
      'Use only the supplied transcript and raw lab notes. Do not invent reagent names, measurements, sample IDs, results, conclusions, or rationale. ' +
      'Preserve exact units, concentrations, temperatures, times, pH values, lot numbers, and sample identifiers. ' +
      'Preserve uncertainty, negations, and "not observed" statements exactly. If a detail is unclear, write that it was unclear instead of guessing. Return plain text only.'
  };
  const user = {
    role: 'user',
    content: [
      `template: ${template}`,
      voiceTemplateInstruction(template),
      'Raw lab notes should guide what matters most, but transcript facts remain the source evidence.',
      '',
      `Experiment: ${exp.title}`,
      `Objective: ${exp.objective || 'not set'}`,
      '',
      `Raw lab notes:\n${rawNotes || '(none)'}`,
      '',
      `Source transcript:\n${transcript || '(none)'}`
    ].join('\n')
  };

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [system, user], max_completion_tokens: 520 })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `OpenAI error ${resp.status}`;
      return res.status(502).json({ error: msg });
    }
    const rawOutput = data?.choices?.[0]?.message?.content?.trim() || '';
    const output = normalizeVoiceDraftOutput(rawOutput, template);
    Audit.log(req.user.name, req.user.role, 'AI_POLISH_VOICE_DRAFT',
      `${responseStyle} for "${exp.title}" | template ${template} | transcript words ${countWords(transcript)} | raw note words ${countWords(rawNotes)} | model ${MODEL}`,
      { projectId: exp.project_id });
    res.json({ style: responseStyle, template, output, model: MODEL, experimentId: exp.id });
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
});

r.post('/chat', async (req, res) => {
  if (!configured()) return res.status(501).json({ error: 'AI assistant is not configured (set OPENAI_API_KEY).' });

  const { experimentId, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages[] required' });

  // Build experiment context (server-side, trusted).
  let context = 'No specific experiment is open.';
  const exp = experimentId ? Experiments.get(experimentId, req.user) : null;
  if (experimentId && !exp) return res.status(404).json({ error: 'Experiment not found' });
  if (exp) {
    const entries = (exp.entries || []).filter(e => !isHiddenEntryType(e.type)).slice(-12)
      .map(e => `- [${e.type}${e.signed_by ? ', signed' : ''}] ${e.text}`).join('\n').slice(0, 4000);
    const links = ExperimentLinks.list(exp.id, req.user).slice(0, 12)
      .map(link => `- ${link.linked_title}${link.note ? `: ${link.note}` : ''}`).join('\n').slice(0, 1800);
    const steps = ExperimentSteps.list(exp.id).slice(0, 20)
      .map(step => `- ${step.done ? '[done]' : '[open]'} ${step.text}`).join('\n').slice(0, 1800);
    const attachments = ExperimentAttachments.list(exp.id).slice(0, 12)
      .map(att => `- ${att.original_name}${att.note ? `: ${att.note}` : ''}`).join('\n').slice(0, 1800);
    context = [
      `Title: ${exp.title}`,
      `Project: ${exp.project || '—'}`,
      `Status: ${exp.status}`,
      `Tags: ${exp.tags || '—'}`,
      `Objective: ${exp.objective || '—'}`,
      `Hypothesis: ${exp.hypothesis || '—'}`,
      `Protocol / method: ${exp.protocol || '—'}`,
      `Materials / reagents: ${exp.materials || '—'}`,
      `Success criteria: ${exp.success_criteria || '—'}`,
      `Safety notes: ${exp.safety_notes || '—'}`,
      `Outcome: ${outcomeStatusLabel(exp.outcome_status)}`,
      `Outcome note: ${exp.outcome_summary || '—'}`,
      `Related experiments:\n${links || '(none)'}`,
      `Procedure steps:\n${steps || '(none)'}`,
      `Attachments:\n${attachments || '(none)'}`,
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

r.post('/process-entries', async (req, res) => {
  if (!configured()) return res.status(501).json({ error: 'AI assistant is not configured (set OPENAI_API_KEY).' });

  const ids = Array.from(new Set((req.body?.entryIds || []).map(String).filter(Boolean)));
  const mode = req.body?.mode === 'action_plan' ? 'action_plan' : 'summary';
  if (!ids.length) return res.status(400).json({ error: 'entryIds[] required' });
  if (ids.length > 40) return res.status(400).json({ error: 'Select 40 entries or fewer' });

  const entries = Entries.getManyDetailed(ids, req.user);
  if (entries.length !== ids.length) return res.status(404).json({ error: 'One or more entries were not found or are not accessible' });

  const projectIds = Array.from(new Set(entries.map(e => e.project_id).filter(Boolean)));
  const experiments = Array.from(new Set(entries.map(e => `${e.experiment_title} (${e.experiment_id})`)));
  const originalWordCount = countWords(entries.map(e => e.text).join(' '));
  const summaryWordLimit = Math.max(1, Math.min(originalWordCount - 1, 140));
  const entryBlock = entries.map((e, i) => [
    `Entry ${i + 1}`,
    `Experiment: ${e.experiment_title}`,
    `Project: ${e.project_name || 'General'}`,
    `Objective: ${e.experiment_objective || 'not set'}`,
    `Type: ${e.type}`,
    `Created: ${e.created_at}`,
    `Author: ${e.author || 'Unknown'}`,
    `Signed: ${e.signed_by ? `yes, ${e.signature_meaning || 'signed'} by ${e.signed_by}` : 'no'}`,
    `Text:\n${String(e.text || '').slice(0, 6000)}`
  ].join('\n')).join('\n\n---\n\n').slice(0, 24000);

  const task = mode === 'action_plan'
    ? 'Generate concise bullet points for writing or continuing the experiment.'
    : 'Summarise the selected lab notebook entries in plain, concise language for a lab report.';

  const system = {
    role: 'system',
    content:
      'You are SciVox Assistant, embedded in an Electronic Lab Notebook for scientists. ' +
      'Use only the supplied notebook entries. Do not invent measurements, outcomes, reagent identities, or conclusions. ' +
      'Preserve uncertainty, call out missing information, and keep regulated lab records traceable. ' +
      'Return plain human-readable text only. Do not use Markdown syntax, headings, bold text, code fences, or tables.'
  };
  const user = {
    role: 'user',
    content: [
      task,
      mode === 'action_plan'
        ? 'Return exactly four "-" bullet lines only. Fill each bullet with one concise point under 20 words.'
        : `Write one short paragraph or 3 to 5 short plain lines. The summary must be shorter than the original selected text and stay under ${summaryWordLimit} words.`,
      mode === 'action_plan'
        ? 'Do not add extra sections, commentary, numbering, Markdown emphasis, or explanations after the bullet list.'
        : 'Do not include section headings. Avoid repeating timestamps, signatures, hashes, and metadata unless scientifically important.',
      `Selected entries: ${entries.length}`,
      `Original selected text word count: ${originalWordCount}`,
      `Experiments represented: ${experiments.join('; ')}`,
      '',
      'Notebook entries:',
      entryBlock
    ].join('\n')
  };

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [system, user] })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `OpenAI error ${resp.status}`;
      return res.status(502).json({ error: msg });
    }
    const rawOutput = data?.choices?.[0]?.message?.content?.trim() || '(no response)';
    const output = normalizeProcessedOutput(rawOutput, mode, { summaryWordLimit });
    Audit.log(req.user.name, req.user.role, mode === 'action_plan' ? 'AI_ACTION_PLAN_ENTRIES' : 'AI_SUMMARISE_ENTRIES',
      `${mode} for ${entries.length} selected entries across ${experiments.length} experiment(s)`, { projectId: projectIds.length === 1 ? projectIds[0] : null });
    res.json({
      mode,
      output,
      model: MODEL,
      selectedCount: entries.length,
      experimentIds: Array.from(new Set(entries.map(e => e.experiment_id))),
      experimentTitles: Array.from(new Set(entries.map(e => e.experiment_title)))
    });
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

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function compactSpaces(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\s*\n+\s*/g, '\n').trim();
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

function voiceTemplateInstruction(template) {
  if (template === 'lab_report') {
    return [
      'Return a structured lab report draft using only relevant section headings from this exact set:',
      'Objective, Method, Results / Observations, Deviations / Uncertainty, Next Actions.',
      'Under each included heading, write 1 to 3 short "-" bullet lines.',
      'Omit any heading where the source has no supporting detail. Do not write a conclusion unless the source explicitly supports it.'
    ].join(' ');
  }
  if (template === 'concise_paragraph') {
    return 'Return 1 to 2 concise paragraphs suitable as the visible notebook entry. Do not use bullets or headings.';
  }
  if (template === 'numbered_observations') {
    return 'Return 3 to 7 numbered observations, each as "1. ...", concise and suitable as the visible notebook entry.';
  }
  return [
    'Return a concise structured lab note using only relevant section headings from this exact set:',
    'Summary, Observations, Measurements, Deviations/Uncertainty, Next Actions.',
    'Under each included heading, write 1 to 3 short "-" bullet lines.',
    'Omit any heading where the source has no supporting detail.'
  ].join(' ');
}

function normalizeVoiceDraftOutput(raw, template) {
  const cleaned = stripMarkdown(raw).replace(/\r/g, '').trim();
  if (template === 'concise_paragraph') {
    return takeWords(cleaned
      .split(/\n+/)
      .map(line => line.replace(/^\d+[\).:-]\s*/, '').trim())
      .filter(Boolean)
      .join(' '), 180);
  }
  if (template === 'lab_report') {
    return applyLabReportTemplate(cleaned);
  }
  if (template === 'auto_lab_note') {
    return applyAutoLabNoteTemplate(cleaned);
  }
  return applyNumberedVoiceTemplate(cleaned);
}

function localVoiceDraft(transcript, rawNotes, template, exp = {}) {
  const sourceSentences = extractVoiceDraftSentences(transcript, rawNotes);
  if (template === 'lab_report') return localLabReportDraft(sourceSentences, exp);
  if (template === 'concise_paragraph') {
    const paragraph = takeWords(sourceSentences.join(' '), 180);
    return paragraph || 'No source-backed voice note was generated.';
  }
  if (template === 'numbered_observations') {
    return applyNumberedVoiceTemplate(sourceSentences.join('\n'));
  }
  return applyAutoLabNoteTemplate(sourceSentences.join('\n'));
}

function localLabReportDraft(sentences, exp = {}) {
  const allowed = ['Objective', 'Method', 'Results / Observations', 'Deviations / Uncertainty', 'Next Actions'];
  const sectionMap = new Map(allowed.map(name => [name, []]));
  if (exp.objective) addLocalPoint(sectionMap, 'Objective', exp.objective, 1);

  for (const sentence of sentences) {
    const text = String(sentence || '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    const hasUncertainty = /\b(unclear|uncertain|unsure|unknown|not clear|deviation|deviated|failed|error|issue|questionable)\b/.test(lower);
    const isNext = /\b(next|repeat|follow up|follow-up|check|verify|confirm|store|send|prepare)\b/.test(lower);
    const isMethod = /\b(add(?:ed)?|aliquot(?:ed)?|incubat\w*|mix(?:ed)?|vortex\w*|centrifug\w*|run|ran|measur\w*|transfer(?:red)?|wash(?:ed)?|pipett\w*|dilut\w*)\b/.test(lower);
    const isResult = /\b(observed|visible|cloudy|clear|colour|color|precipitate|contamination|absorbance|yield|increased|decreased|result|signal|reading)\b/.test(lower);

    if (isMethod) addLocalPoint(sectionMap, 'Method', text);
    if (isResult) addLocalPoint(sectionMap, 'Results / Observations', text);
    if (hasUncertainty) addLocalPoint(sectionMap, 'Deviations / Uncertainty', text);
    if (isNext) addLocalPoint(sectionMap, 'Next Actions', text);
    if (!isMethod && !isResult && !hasUncertainty && !isNext) addLocalPoint(sectionMap, 'Objective', text);
  }

  const chunks = [];
  for (const name of allowed) {
    const points = sectionMap.get(name) || [];
    if (!points.length) continue;
    chunks.push(`${name}\n${points.map(point => `- ${point}`).join('\n')}`);
  }
  if (!chunks.length) return 'Objective\n- No source-backed lab report draft was generated.';
  return chunks.join('\n\n');
}

function addLocalPoint(sectionMap, section, point, limit = 3) {
  const points = sectionMap.get(section);
  if (!points || points.length >= limit) return;
  const formatted = formatBulletSentence(point, 34);
  if (!points.includes(formatted)) points.push(formatted);
}

function extractVoiceDraftSentences(...parts) {
  const out = [];
  for (const part of parts) {
    for (const line of String(part || '').split(/\n+/)) {
      const cleaned = line
        .replace(/^(?:manual notes|source transcript|raw lab notes)\s*:\s*/i, '')
        .replace(/^\d+[\).:-]\s*/, '')
        .replace(/^-+\s*/, '')
        .trim();
      if (!cleaned || cleaned === '(none)') continue;
      for (const sentence of splitSentences(cleaned)) {
        const point = sentence.trim();
        if (point) out.push(point);
      }
    }
  }
  return out;
}

function applyLabReportTemplate(raw) {
  const allowed = ['Objective', 'Method', 'Results / Observations', 'Deviations / Uncertainty', 'Next Actions'];
  const sectionMap = new Map(allowed.map(name => [name, []]));
  let current = null;

  for (const originalLine of String(raw || '').split(/\n+/)) {
    const line = originalLine.trim();
    if (!line) continue;
    const normalizedHeading = normalizeLabReportHeading(line);
    if (sectionMap.has(normalizedHeading)) {
      current = normalizedHeading;
      continue;
    }
    const point = line
      .replace(/^\d+[\).:-]\s*/, '')
      .replace(/^-+\s*/, '')
      .trim();
    if (!point || /^[A-Z][A-Za-z/ &-]{0,48}:$/.test(point)) continue;
    if (!current) current = inferLabReportSection(point);
    if (sectionMap.has(current) && sectionMap.get(current).length < 3) {
      sectionMap.get(current).push(formatBulletSentence(point, 34));
    }
  }

  const chunks = [];
  for (const name of allowed) {
    const points = sectionMap.get(name) || [];
    if (!points.length) continue;
    chunks.push(`${name}\n${points.map(point => `- ${point}`).join('\n')}`);
  }
  if (!chunks.length) return 'Objective\n- No source-backed lab report draft was generated.';
  return chunks.join('\n\n');
}

function normalizeLabReportHeading(line) {
  const cleaned = String(line || '').replace(/:$/, '').trim().toLowerCase();
  if (cleaned === 'objective' || cleaned === 'purpose' || cleaned === 'aim') return 'Objective';
  if (cleaned === 'method' || cleaned === 'methods' || cleaned === 'procedure' || cleaned === 'protocol') return 'Method';
  if (cleaned === 'results / observations' || cleaned === 'results and observations' || cleaned === 'results' || cleaned === 'observations') {
    return 'Results / Observations';
  }
  if (cleaned === 'deviations / uncertainty' || cleaned === 'deviations and uncertainty' || cleaned === 'uncertainty' || cleaned === 'deviations') {
    return 'Deviations / Uncertainty';
  }
  if (cleaned === 'next action' || cleaned === 'next actions' || cleaned === 'actions') return 'Next Actions';
  return line;
}

function inferLabReportSection(point) {
  const text = String(point || '').toLowerCase();
  if (/\b(unclear|uncertain|unsure|unknown|not clear|deviation|deviated|failed|error|issue)\b/.test(text)) return 'Deviations / Uncertainty';
  if (/\b(next|repeat|follow up|follow-up|check|verify|confirm|store|send|prepare)\b/.test(text)) return 'Next Actions';
  if (/\b(add|added|aliquot|aliquoted|incubat|mix|mixed|vortex|centrifug|run|ran|measure|measured|transfer|transferred)\b/.test(text)) return 'Method';
  if (/\b(observed|visible|cloudy|clear|colour|color|precipitate|contamination|absorbance|yield|increased|decreased|result)\b/.test(text)) return 'Results / Observations';
  return 'Objective';
}

function applyAutoLabNoteTemplate(raw) {
  const allowed = ['Summary', 'Observations', 'Measurements', 'Deviations/Uncertainty', 'Next Actions'];
  const sectionMap = new Map(allowed.map(name => [name, []]));
  let current = null;

  for (const originalLine of String(raw || '').split(/\n+/)) {
    const line = originalLine.trim();
    if (!line) continue;
    const normalizedHeading = normalizeVoiceHeading(line);
    if (sectionMap.has(normalizedHeading)) {
      current = normalizedHeading;
      continue;
    }
    const point = line
      .replace(/^\d+[\).:-]\s*/, '')
      .replace(/^-+\s*/, '')
      .trim();
    if (!point || /^[A-Z][A-Za-z/ &-]{0,48}:$/.test(point)) continue;
    if (!current) current = inferVoiceSection(point);
    if (sectionMap.has(current) && sectionMap.get(current).length < 3) {
      sectionMap.get(current).push(formatBulletSentence(point, 32));
    }
  }

  const chunks = [];
  for (const name of allowed) {
    const points = sectionMap.get(name) || [];
    if (!points.length) continue;
    chunks.push(`${name}\n${points.map(point => `- ${point}`).join('\n')}`);
  }
  if (!chunks.length) return 'Summary\n- No source-backed voice note was generated.';
  return chunks.join('\n\n');
}

function normalizeVoiceHeading(line) {
  const cleaned = String(line || '').replace(/:$/, '').trim().toLowerCase();
  if (cleaned === 'summary') return 'Summary';
  if (cleaned === 'observation' || cleaned === 'observations') return 'Observations';
  if (cleaned === 'measurement' || cleaned === 'measurements') return 'Measurements';
  if (cleaned === 'deviations/uncertainty' || cleaned === 'deviations and uncertainty' || cleaned === 'uncertainty' || cleaned === 'deviations') {
    return 'Deviations/Uncertainty';
  }
  if (cleaned === 'next action' || cleaned === 'next actions' || cleaned === 'actions') return 'Next Actions';
  return line;
}

function inferVoiceSection(point) {
  const text = String(point || '').toLowerCase();
  if (/\b(unclear|uncertain|unsure|unknown|not clear|deviation|deviated|failed|error|issue)\b/.test(text)) return 'Deviations/Uncertainty';
  if (/\b(\d|ml|µl|ul|mg|g|mm|cm|nm|mM|µM|uM|°c| c\b|seconds?|minutes?|hours?|ph|rpm|x g)\b/i.test(point)) return 'Measurements';
  if (/\b(next|repeat|follow up|follow-up|check|verify|confirm|store|send|prepare)\b/.test(text)) return 'Next Actions';
  if (/\b(observed|visible|cloudy|clear|colour|color|precipitate|contamination)\b/.test(text)) return 'Observations';
  return 'Summary';
}

function formatBulletSentence(point, wordLimit) {
  const text = takeWords(String(point || '').replace(/\s+/g, ' ').trim(), wordLimit).replace(/\s+([,.;:])/g, '$1');
  if (!text) return 'No additional source-backed point.';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function applyNumberedVoiceTemplate(raw) {
  const fromLines = raw.split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const candidates = (fromLines.length > 1 ? fromLines : splitSentences(raw))
    .map(line => line
      .replace(/^\d+[\).:-]\s*/, '')
      .replace(/^-+\s*/, '')
      .trim())
    .filter(line => line && !/^[A-Z][A-Za-z\s]{0,40}:$/.test(line))
    .slice(0, 7);
  if (!candidates.length) candidates.push('No source-backed voice note was generated.');
  return candidates.map((line, index) => `${index + 1}. ${formatBulletSentence(line, 28).replace(/\.$/, '')}.`).join('\n');
}

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function normalizeProcessedOutput(raw, mode, { summaryWordLimit }) {
  const cleaned = stripMarkdown(raw);
  if (mode === 'action_plan') {
    return applyBulletTemplate(cleaned);
  }
  return takeWords(cleaned.replace(/\s*\n+\s*/g, ' '), summaryWordLimit);
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[*-]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

function takeWords(text, limit) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(' ');
  return words.slice(0, Math.max(1, limit)).join(' ') + '...';
}

function applyBulletTemplate(raw) {
  const bulletCount = 4;
  const bullets = raw.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^(?:Action\s*)?\d+[\).:-]\s*/i, '').replace(/^-+\s*/, '').trim())
    .filter(line => line && !/^[A-Z][A-Za-z\s]{0,40}:$/.test(line))
    .slice(0, bulletCount);
  while (bullets.length < bulletCount) bullets.push('No additional source-backed point.');
  return bullets.map(line => `- ${takeWords(line, 19)}`).join('\n');
}
