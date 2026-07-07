import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('MVP pilot workflow: projects, access, signatures, exports, audit and session revocation', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-mvp-'));
  const ai = await mockOpenAI();
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-mvp-api',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: ai.baseUrl,
    OPENAI_MODEL: 'mock-gpt'
  });
  const { app } = await import(`../src/index.js?mvp=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();

    const adminUser = await admin.req(base, 'POST', '/api/auth/register', {
      email: 'admin@biotech.test',
      name: 'Admin',
      password: 'admin-pass-123'
    });
    assert.equal(adminUser.role, 'admin');

    const project = await admin.req(base, 'POST', '/api/projects', {
      name: 'Pilot R&D',
      description: 'Access control pilot'
    });
    assert.ok(project.id);

    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'sci@biotech.test',
      name: 'Scientist',
      password: 'sci-pass-123'
    });

    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'viewer'
    });

    const exp = await admin.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'mRNA stability screen',
      objective: 'Assess stability after freeze-thaw.',
      hypothesis: 'Freeze-thaw cycles reduce mRNA integrity.',
      protocol: 'Aliquot formulation, run three freeze-thaw cycles, then measure RIN.',
      materials: 'LNP batch LN-042; PBS pH 7.4; RNase-free tubes.',
      success_criteria: 'RIN stays above 8.0 after three cycles.',
      safety_notes: 'Use RNase decontamination and dry-ice gloves.',
      tags: 'mRNA, freeze-thaw, QC'
    });
    assert.equal(exp.project_id, project.id);
    assert.equal(exp.hypothesis, 'Freeze-thaw cycles reduce mRNA integrity.');
    assert.equal(exp.protocol, 'Aliquot formulation, run three freeze-thaw cycles, then measure RIN.');
    assert.equal(exp.materials, 'LNP batch LN-042; PBS pH 7.4; RNase-free tubes.');
    assert.equal(exp.success_criteria, 'RIN stays above 8.0 after three cycles.');
    assert.equal(exp.safety_notes, 'Use RNase decontamination and dry-ice gloves.');
    assert.equal(exp.tags, 'mRNA, freeze-thaw, QC');
    assert.equal(exp.outcome_status, 'running');
    assert.equal(exp.outcome_summary, '');

    const viewed = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(viewed.title, exp.title);
    assert.equal(viewed.hypothesis, exp.hypothesis);
    assert.equal(viewed.protocol, exp.protocol);
    assert.equal(viewed.materials, exp.materials);
    assert.equal(viewed.success_criteria, exp.success_criteria);
    assert.equal(viewed.safety_notes, exp.safety_notes);
    assert.equal(viewed.tags, exp.tags);
    assert.equal(viewed.outcome_status, 'running');
    assert.equal(viewed.outcome_summary, '');
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'viewer cannot write' }),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/references', { experimentId: exp.id, title: 'Viewer should not add references' }),
      /403/
    );
    await assert.rejects(
      () => scientist.uploadImage(base, tinyPng(), 'viewer-ocr-upload.png', 'ocr-raw', exp.id),
      /403/
    );
    await assert.rejects(
      () => scientist.uploadAttachment(base, Buffer.from('viewer raw data'), 'viewer-data.csv', 'text/csv', exp.id),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, { text: 'Viewer should not add steps' }),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/template`, { name: 'Viewer template attempt' }),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/duplicate`, { title: 'Viewer duplicate attempt' }),
      /403/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
        experimentId: exp.id,
        transcript: 'Viewer should not polish voice drafts.',
        manualNotes: '',
        style: 'numbered_bullets'
      }),
      /403/
    );

    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'scientist'
    });

    const updatedSetup = await scientist.req(base, 'PATCH', `/api/experiments/${exp.id}`, {
      hypothesis: 'Three cycles are tolerated when thaw duration stays below five minutes.',
      protocol: 'Run three controlled freeze-thaw cycles, record thaw duration, then measure RIN.',
      materials: 'LNP batch LN-042; PBS pH 7.4; RNase-free tubes; Bioanalyzer chip.',
      success_criteria: 'RIN above 8.0 and no visible aggregation.',
      safety_notes: 'Wear cryogenic gloves and keep RNaseZap available.',
      tags: 'mRNA, freeze-thaw, reviewer-ready',
      outcome_status: 'success',
      outcome_summary: 'RIN remained above threshold after three cycles.'
    });
    assert.equal(updatedSetup.hypothesis, 'Three cycles are tolerated when thaw duration stays below five minutes.');
    assert.equal(updatedSetup.protocol, 'Run three controlled freeze-thaw cycles, record thaw duration, then measure RIN.');
    assert.equal(updatedSetup.materials, 'LNP batch LN-042; PBS pH 7.4; RNase-free tubes; Bioanalyzer chip.');
    assert.equal(updatedSetup.success_criteria, 'RIN above 8.0 and no visible aggregation.');
    assert.equal(updatedSetup.safety_notes, 'Wear cryogenic gloves and keep RNaseZap available.');
    assert.equal(updatedSetup.tags, 'mRNA, freeze-thaw, reviewer-ready');
    assert.equal(updatedSetup.outcome_status, 'success');
    assert.equal(updatedSetup.outcome_summary, 'RIN remained above threshold after three cycles.');

    const template = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/template`, {
      name: 'mRNA freeze-thaw setup',
      description: 'Reusable validated setup for follow-up stability screens.'
    });
    assert.equal(template.name, 'mRNA freeze-thaw setup');
    assert.equal(template.project_id, project.id);
    assert.equal(template.protocol, updatedSetup.protocol);
    assert.equal(template.materials, updatedSetup.materials);

    const templates = await scientist.req(base, 'GET', `/api/experiments/templates?projectId=${project.id}`);
    assert.equal(templates.some(t => t.id === template.id), true);

    const templatedExp = await scientist.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'mRNA stability follow-up from template',
      template_id: template.id
    });
    assert.equal(templatedExp.objective, updatedSetup.objective);
    assert.equal(templatedExp.hypothesis, updatedSetup.hypothesis);
    assert.equal(templatedExp.protocol, updatedSetup.protocol);
    assert.equal(templatedExp.materials, updatedSetup.materials);
    assert.equal(templatedExp.success_criteria, updatedSetup.success_criteria);
    assert.equal(templatedExp.safety_notes, updatedSetup.safety_notes);

    const relatedLink = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/links`, {
      linkedExperimentId: templatedExp.id,
      note: 'Follow-up run created from the reusable setup.'
    });
    assert.equal(relatedLink.experiment_id, exp.id);
    assert.equal(relatedLink.linked_experiment_id, templatedExp.id);
    assert.equal(relatedLink.linked_title, templatedExp.title);
    assert.equal(relatedLink.note, 'Follow-up run created from the reusable setup.');
    const relatedLinks = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/links`);
    assert.equal(relatedLinks.length, 1);
    assert.equal(relatedLinks[0].id, relatedLink.id);
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/links`, { linkedExperimentId: exp.id }),
      /400/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/links`, { linkedExperimentId: templatedExp.id }),
      /409/
    );
    const removableLink = await scientist.req(base, 'POST', `/api/experiments/${templatedExp.id}/links`, {
      linkedExperimentId: exp.id,
      note: 'Temporary reverse link.'
    });
    await scientist.req(base, 'DELETE', `/api/experiments/${templatedExp.id}/links/${removableLink.id}`);
    const clearedLinks = await scientist.req(base, 'GET', `/api/experiments/${templatedExp.id}/links`);
    assert.equal(clearedLinks.some(l => l.id === removableLink.id), false);

    const stepOne = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, {
      text: 'Thaw aliquots on ice and record thaw duration.'
    });
    assert.equal(stepOne.experiment_id, exp.id);
    assert.equal(stepOne.text, 'Thaw aliquots on ice and record thaw duration.');
    assert.equal(stepOne.done, 0);
    assert.equal(stepOne.position, 1);
    const stepTwo = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, {
      text: 'Run Bioanalyzer and attach RIN table.'
    });
    assert.equal(stepTwo.position, 2);
    const listedSteps = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/steps`);
    assert.deepEqual(listedSteps.map(step => step.text), [
      'Thaw aliquots on ice and record thaw duration.',
      'Run Bioanalyzer and attach RIN table.'
    ]);
    const completedStep = await scientist.req(base, 'PATCH', `/api/experiments/${exp.id}/steps/${stepOne.id}`, {
      done: true
    });
    assert.equal(completedStep.done, 1);
    assert.ok(completedStep.completed_at);
    assert.equal(completedStep.completed_by, 'Scientist');
    await scientist.req(base, 'DELETE', `/api/experiments/${exp.id}/steps/${stepTwo.id}`);
    const stepsAfterRemove = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/steps`);
    assert.equal(stepsAfterRemove.some(step => step.id === stepTwo.id), false);

    const setupAwareChat = await scientist.req(base, 'POST', '/api/ai/chat', {
      experimentId: exp.id,
      messages: [{ role: 'user', content: 'context-audit' }]
    });
    assert.match(setupAwareChat.reply, /hypothesis yes/);
    assert.match(setupAwareChat.reply, /protocol yes/);
    assert.match(setupAwareChat.reply, /materials yes/);
    assert.match(setupAwareChat.reply, /success yes/);
    assert.match(setupAwareChat.reply, /safety yes/);
    assert.match(setupAwareChat.reply, /outcome yes/);

    const manualRef = await scientist.req(base, 'POST', '/api/references', {
      experimentId: exp.id,
      title: 'Reference added by project scientist',
      authors: 'Curie M',
      year: '1911'
    });
    assert.equal(manualRef.title, 'Reference added by project scientist');

    const entry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Prepared formulation A and recorded visual clarity.'
    });
    assert.match(entry.hash, /^[a-f0-9]{64}$/);

    const comment = await scientist.req(base, 'POST', `/api/entries/${entry.id}/comments`, {
      text: 'Please confirm thaw duration before reviewer approval.'
    });
    assert.equal(comment.entry_id, entry.id);
    assert.equal(comment.text, 'Please confirm thaw duration before reviewer approval.');
    assert.equal(comment.author, 'Scientist');
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${entry.id}/comments`, { text: '   ' }),
      /400/
    );

    const expWithComment = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    const entryWithComment = expWithComment.entries.find(en => en.id === entry.id);
    assert.equal(entryWithComment.comments.length, 1);
    assert.equal(entryWithComment.comments[0].text, comment.text);

    const edited = await scientist.req(base, 'PATCH', `/api/entries/${entry.id}`, {
      text: 'Prepared formulation A and recorded visual clarity after thaw.'
    });
    assert.equal(edited.text, 'Prepared formulation A and recorded visual clarity after thaw.');
    assert.notEqual(edited.hash, entry.hash);

    const generated = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'AI-generated summary from one selected entry.',
      sourceEntryIds: [entry.id]
    });
    assert.deepEqual(JSON.parse(generated.source_entry_ids), [entry.id]);

    await assert.rejects(
      () => scientist.req(base, 'DELETE', '/api/entries/batch', { entryIds: [generated.id] }),
      /403/
    );
    const batchDeleted = await admin.req(base, 'DELETE', '/api/entries/batch', { entryIds: [generated.id] });
    assert.equal(batchDeleted.deleted, 1);

    const entries = await scientist.req(base, 'GET', '/api/entries');
    const libraryEntry = entries.find(e => e.id === entry.id);
    assert.equal(libraryEntry.experiment_title, exp.title);
    assert.equal(libraryEntry.project_id, project.id);
    assert.equal(entries.some(e => e.id === generated.id), false);

    const bulletDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Added 5 mL buffer to sample A1 and incubated at 37 C for 15 minutes.',
      manualNotes: 'Important: A1 looked cloudy after incubation.',
      style: 'numbered_bullets'
    });
    assert.equal(bulletDraft.style, 'numbered_bullets');
    assert.equal(bulletDraft.model, 'mock-gpt');
    assert.match(bulletDraft.output, /^1\. Added 5 mL buffer to sample A1\./);
    assert.match(bulletDraft.output, /\n2\. Incubated at 37 C for 15 minutes\./);
    assert.doesNotMatch(bulletDraft.output, /^-/m);

    const paragraphDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Measured pH 7.4 and stored tube B2 on ice.',
      manualNotes: '',
      style: 'concise_paragraph'
    });
    assert.equal(paragraphDraft.style, 'concise_paragraph');
    assert.match(paragraphDraft.output, /^Measured pH 7\.4 and stored tube B2 on ice\./);
    assert.doesNotMatch(paragraphDraft.output, /^\d+\./m);

    const autoDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Tube C7 was vortexed for 10 seconds. Yield was unclear. No contamination was visible.',
      rawNotes: 'C7: keep uncertainty; no visible contamination',
      template: 'auto_lab_note'
    });
    assert.equal(autoDraft.template, 'auto_lab_note');
    assert.equal(autoDraft.style, 'auto_lab_note');
    assert.match(autoDraft.output, /^Summary\n/);
    assert.match(autoDraft.output, /Observations\n- No visible contamination was recorded\./);
    assert.match(autoDraft.output, /Measurements\n- Tube C7 was vortexed for 10 seconds\./);
    assert.match(autoDraft.output, /Deviations\/Uncertainty\n- Yield was unclear\./);
    assert.doesNotMatch(autoDraft.output, /Next Actions\n\s*(?:\n|$)/);

    const reportDraft = await scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
      experimentId: exp.id,
      transcript: 'Aliquoted sample D4 and added 20 ul enzyme mix. Incubated for 30 minutes at 37 C. Absorbance increased to 0.82 but replicate two was uncertain.',
      rawNotes: 'D4 endpoint report; preserve replicate uncertainty',
      template: 'lab_report'
    });
    assert.equal(reportDraft.template, 'lab_report');
    assert.equal(reportDraft.style, 'lab_report');
    assert.match(reportDraft.output, /^Objective\n/);
    assert.match(reportDraft.output, /Method\n- Added 20 ul enzyme mix to sample D4\./);
    assert.match(reportDraft.output, /Results \/ Observations\n- Absorbance increased to 0\.82\./);
    assert.match(reportDraft.output, /Deviations \/ Uncertainty\n- Replicate two was uncertain\./);

    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/ai/process-voice-draft', {
        experimentId: exp.id,
        transcript: 'Invalid template should not silently fall back.',
        rawNotes: '',
        template: 'meeting_minutes'
      }),
      /400/
    );

    const rawVoice = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'voice_transcript',
      text: 'Manual notes:\nA1 looked cloudy.\n\nSource transcript:\nAdded confidential phrase XYZ-123 and incubated sample A1.'
    });
    assert.equal(rawVoice.type, 'voice_transcript');
    const polishedVoice = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'voice',
      text: bulletDraft.output,
      sourceEntryIds: [rawVoice.id]
    });
    assert.deepEqual(JSON.parse(polishedVoice.source_entry_ids), [rawVoice.id]);
    const expWithVoice = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(expWithVoice.entries.some(en => en.id === rawVoice.id), false);
    assert.equal(expWithVoice.entries.some(en => en.id === polishedVoice.id), true);
    const libraryAfterVoice = await scientist.req(base, 'GET', '/api/entries');
    assert.equal(libraryAfterVoice.some(en => en.id === rawVoice.id), false);
    const sourceTranscript = await scientist.req(base, 'GET', `/api/entries/${rawVoice.id}`);
    assert.equal(sourceTranscript.text, rawVoice.text);
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/entries/${rawVoice.id}`, { text: 'tampered source transcript' }),
      /409/
    );

    const rawUpload = await scientist.uploadImage(base, tinyPng(), 'raw-slide-sketch.png', 'figure-raw', exp.id);
    const cleanUpload = await scientist.uploadImage(base, tinyPng(), 'clean-slide-diagram.png', 'figure-clean', exp.id);
    assert.match(rawUpload.url, new RegExp(`^/uploads/figures/${exp.id}/raw/`));
    assert.match(cleanUpload.url, new RegExp(`^/uploads/figures/${exp.id}/clean/`));

    const attachment = await scientist.uploadAttachment(
      base,
      Buffer.from('time,rin\n0,9.1\n24,8.7\n'),
      'rin-results.csv',
      'text/csv',
      exp.id,
      'Bioanalyzer RIN result table.'
    );
    assert.equal(attachment.experiment_id, exp.id);
    assert.equal(attachment.original_name, 'rin-results.csv');
    assert.equal(attachment.mime_type, 'text/csv');
    assert.equal(attachment.note, 'Bioanalyzer RIN result table.');
    assert.match(attachment.hash, /^[a-f0-9]{64}$/);
    assert.match(attachment.url, new RegExp(`^/uploads/attachments/${exp.id}/`));
    const listedAttachments = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/attachments`);
    assert.equal(listedAttachments.some(a => a.id === attachment.id), true);
    const attachmentDownload = await scientist.raw(base, 'GET', attachment.url);
    assert.equal(attachmentDownload.body.toString('utf8'), 'time,rin\n0,9.1\n24,8.7\n');
    const removableAttachment = await scientist.uploadAttachment(
      base,
      Buffer.from('temporary attachment'),
      'temporary.txt',
      'text/plain',
      exp.id,
      'Remove after upload test.'
    );
    await scientist.req(base, 'DELETE', `/api/experiments/${exp.id}/attachments/${removableAttachment.id}`);
    const afterAttachmentRemove = await scientist.req(base, 'GET', `/api/experiments/${exp.id}/attachments`);
    assert.equal(afterAttachmentRemove.some(a => a.id === removableAttachment.id), false);

    const repeatedExp = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/duplicate`, {
      title: 'mRNA stability repeat setup'
    });
    assert.equal(repeatedExp.title, 'mRNA stability repeat setup');
    assert.equal(repeatedExp.project_id, exp.project_id);
    assert.equal(repeatedExp.objective, updatedSetup.objective);
    assert.equal(repeatedExp.hypothesis, updatedSetup.hypothesis);
    assert.equal(repeatedExp.protocol, updatedSetup.protocol);
    assert.equal(repeatedExp.materials, updatedSetup.materials);
    assert.equal(repeatedExp.success_criteria, updatedSetup.success_criteria);
    assert.equal(repeatedExp.safety_notes, updatedSetup.safety_notes);
    assert.equal(repeatedExp.tags, updatedSetup.tags);
    assert.equal(repeatedExp.status, 'active');
    assert.equal(repeatedExp.outcome_status, 'running');
    assert.equal(repeatedExp.outcome_summary, '');
    assert.equal(repeatedExp.entries.length, 0);
    const repeatedSteps = await scientist.req(base, 'GET', `/api/experiments/${repeatedExp.id}/steps`);
    assert.deepEqual(repeatedSteps.map(step => step.text), ['Thaw aliquots on ice and record thaw duration.']);
    assert.equal(repeatedSteps[0].done, 0);
    assert.equal(repeatedSteps[0].completed_at, null);
    const repeatedLinks = await scientist.req(base, 'GET', `/api/experiments/${repeatedExp.id}/links`);
    assert.equal(repeatedLinks.length, 1);
    assert.equal(repeatedLinks[0].linked_experiment_id, exp.id);
    assert.match(repeatedLinks[0].note, /Repeat setup duplicated from/);
    const repeatedAttachments = await scientist.req(base, 'GET', `/api/experiments/${repeatedExp.id}/attachments`);
    assert.equal(repeatedAttachments.length, 0);

    const figure = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'figure',
      text: 'Microscope slide layout with sample regions A-D.',
      imageUrl: cleanUpload.url,
      rawImageUrl: rawUpload.url,
      cleanImageUrl: cleanUpload.url
    });
    assert.equal(figure.type, 'figure');
    assert.equal(figure.raw_image_url, rawUpload.url);
    assert.equal(figure.clean_image_url, cleanUpload.url);

    const rawOcrUpload = await scientist.uploadImage(base, tinyPng(), 'raw-notebook-scan.png', 'ocr-raw', exp.id);
    const cleanOcrUpload = await scientist.uploadImage(base, tinyPng(), 'processed-notebook-scan.png', 'ocr-clean', exp.id);
    assert.match(rawOcrUpload.url, new RegExp(`^/uploads/ocr/${exp.id}/raw/`));
    assert.match(cleanOcrUpload.url, new RegExp(`^/uploads/ocr/${exp.id}/clean/`));

    const rawOcrTextEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'ocr_raw_text',
      text: 'Raw OCR output:\npH after incubation was 7.Z; sampl A1 remained cl0udy.'
    });
    assert.equal(rawOcrTextEntry.type, 'ocr_raw_text');

    const ocrEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'ocr',
      text: 'pH after incubation was 7.2; sample A1 remained cloudy.',
      imageUrl: cleanOcrUpload.url,
      rawImageUrl: rawOcrUpload.url,
      cleanImageUrl: cleanOcrUpload.url,
      sourceEntryIds: [rawOcrTextEntry.id]
    });
    assert.equal(ocrEntry.type, 'ocr');
    assert.equal(ocrEntry.raw_image_url, rawOcrUpload.url);
    assert.equal(ocrEntry.clean_image_url, cleanOcrUpload.url);
    assert.deepEqual(JSON.parse(ocrEntry.source_entry_ids), [rawOcrTextEntry.id]);
    const expWithOcrSource = await scientist.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(expWithOcrSource.entries.some(en => en.id === rawOcrTextEntry.id), false);
    assert.equal(expWithOcrSource.entries.some(en => en.id === ocrEntry.id), true);

    const singleDeleteEntry = await scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, {
      type: 'note',
      text: 'Duplicate note to delete from the experiment page.'
    });
    await assert.rejects(
      () => scientist.req(base, 'DELETE', `/api/entries/${singleDeleteEntry.id}`, { reason: 'scientist should not delete entries' }),
      /403/
    );
    await admin.req(base, 'DELETE', `/api/entries/${singleDeleteEntry.id}`, { reason: 'duplicate note from experiment page' });
    const expAfterEntryDelete = await admin.req(base, 'GET', `/api/experiments/${exp.id}`);
    assert.equal(expAfterEntryDelete.entries.some(en => en.id === singleDeleteEntry.id), false);

    const deletableExp = await admin.req(base, 'POST', '/api/experiments', {
      project_id: project.id,
      title: 'Temporary calibration run',
      objective: 'Exercise deletion audit context.'
    });
    const deletableEntry = await scientist.req(base, 'POST', `/api/experiments/${deletableExp.id}/entries`, {
      type: 'note',
      text: 'Temporary observation for deletion.'
    });
    await admin.req(base, 'PATCH', `/api/projects/${project.id}/members`, {
      email: 'sci@biotech.test',
      role: 'owner'
    });
    await assert.rejects(
      () => scientist.req(base, 'DELETE', `/api/experiments/${deletableExp.id}`, { reason: 'owner should not delete experiments' }),
      /403/
    );
    await admin.req(base, 'DELETE', `/api/experiments/${deletableExp.id}`, { reason: 'duplicate calibration run' });
    await assert.rejects(
      () => admin.req(base, 'GET', `/api/experiments/${deletableExp.id}`),
      /404/
    );

    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${entry.id}/sign`, { meaning: 'author', password: 'wrong-password' }),
      /401/
    );

    const signed = await scientist.req(base, 'POST', `/api/entries/${entry.id}/sign`, {
      meaning: 'author',
      password: 'sci-pass-123'
    });
    assert.equal(signed.signature_meaning, 'author');
    assert.match(signed.sig, /^[a-f0-9]{64}$/);

    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/entries/${entry.id}`, { text: 'cannot edit signed entry' }),
      /409/
    );

    await admin.req(base, 'POST', `/api/experiments/${exp.id}/lock`);
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/experiments/${exp.id}`, { status: 'active', objective: 'unlock attempt' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/experiments/${exp.id}`, { outcome_status: 'fail', outcome_summary: 'post-lock result edit' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'note', text: 'after lock' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/entries`, { type: 'voice_transcript', text: 'after lock transcript' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/entries/${entry.id}/comments`, { text: 'after lock comment' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', '/api/references', { experimentId: exp.id, title: 'Reference after lock' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/links`, { linkedExperimentId: templatedExp.id }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/experiments/${exp.id}/steps`, { text: 'Step after lock' }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'PATCH', `/api/experiments/${exp.id}/steps/${stepOne.id}`, { done: false }),
      /409/
    );
    await assert.rejects(
      () => scientist.req(base, 'DELETE', `/api/experiments/${exp.id}/steps/${stepOne.id}`),
      /409/
    );
    await assert.rejects(
      () => scientist.uploadImage(base, tinyPng(), 'locked-ocr-upload.png', 'ocr-raw', exp.id),
      /409/
    );
    await assert.rejects(
      () => scientist.uploadAttachment(base, Buffer.from('locked data'), 'locked-data.csv', 'text/csv', exp.id),
      /409/
    );

    const exported = await admin.req(base, 'GET', `/api/experiments/${exp.id}/export`);
    assert.equal(exported.experiment.id, exp.id);
    assert.equal(exported.experiment.tags, 'mRNA, freeze-thaw, reviewer-ready');
    assert.equal(exported.experiment.outcome_status, 'success');
    assert.equal(exported.experiment.outcome_summary, 'RIN remained above threshold after three cycles.');
    assert.equal(exported.experiment_links[0].linked_experiment_id, templatedExp.id);
    assert.equal(exported.experiment_links[0].note, 'Follow-up run created from the reusable setup.');
    assert.equal(exported.steps[0].text, 'Thaw aliquots on ice and record thaw duration.');
    assert.equal(exported.steps[0].done, 1);
    assert.equal(exported.attachments[0].original_name, 'rin-results.csv');
    assert.equal(exported.attachments[0].note, 'Bioanalyzer RIN result table.');
    assert.match(exported.integrity.sha256, /^[a-f0-9]{64}$/);
    assert.ok(exported.experiment.entries.some(en => en.id === rawVoice.id));
    assert.equal(exported.experiment.entries.find(en => en.id === entry.id).comments[0].text, comment.text);
    const exportedPdf = await admin.raw(base, 'GET', `/api/experiments/${exp.id}/export?format=pdf`);
    assert.equal(exportedPdf.status, 200);
    assert.match(exportedPdf.headers['content-type'], /application\/pdf/);
    assert.match(exportedPdf.headers['content-disposition'], /mrna-stability-screen-export\.pdf/);
    assert.equal(exportedPdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(exportedPdf.body.includes(Buffer.from('mRNA stability screen')));
    assert.ok(exportedPdf.body.includes(Buffer.from('mRNA, freeze-thaw, reviewer-ready')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Related Experiments')));
    assert.ok(exportedPdf.body.includes(Buffer.from('mRNA stability follow-up from template')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Procedure Steps')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Thaw aliquots on ice and record thaw duration.')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Attachments')));
    assert.ok(exportedPdf.body.includes(Buffer.from('rin-results.csv')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Three cycles are tolerated when thaw duration stays below five minutes.')));
    assert.ok(exportedPdf.body.includes(Buffer.from('Outcome')));
    assert.ok(exportedPdf.body.includes(Buffer.from('RIN remained above threshold after three cycles.')));
    const exportedHtml = await admin.raw(base, 'GET', `/api/experiments/${exp.id}/export?format=html`);
    assert.equal(exportedHtml.status, 200);
    assert.match(exportedHtml.headers['content-type'], /text\/html/);
    assert.ok(exportedHtml.body.includes(Buffer.from('Study setup')));
    assert.ok(exportedHtml.body.includes(Buffer.from('mRNA, freeze-thaw, reviewer-ready')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Related Experiments')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Follow-up run created from the reusable setup.')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Procedure steps')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Thaw aliquots on ice and record thaw duration.')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Attachments')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Bioanalyzer RIN result table.')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Three cycles are tolerated when thaw duration stays below five minutes.')));
    assert.ok(exportedHtml.body.includes(Buffer.from('Outcome')));
    assert.ok(exportedHtml.body.includes(Buffer.from('RIN remained above threshold after three cycles.')));

    const audit = await admin.req(base, 'GET', `/api/audit?project=${project.id}`);
    assert.ok(audit.some(a => a.action === 'SIGN_ENTRY'));
    assert.ok(audit.some(a => a.action === 'CREATE_EXPERIMENT_TEMPLATE' && a.detail.includes(template.id)));
    assert.ok(audit.some(a => a.action === 'CREATE_EXPERIMENT' && a.detail.includes(templatedExp.id)));
    assert.ok(audit.some(a => a.action === 'DUPLICATE_EXPERIMENT' && a.detail.includes(exp.id) && a.detail.includes(repeatedExp.id)));
    assert.ok(audit.some(a => a.action === 'ADD_EXPERIMENT_LINK' && a.detail.includes(relatedLink.id)));
    assert.ok(audit.some(a => a.action === 'REMOVE_EXPERIMENT_LINK' && a.detail.includes(removableLink.id)));
    assert.ok(audit.some(a => a.action === 'ADD_EXPERIMENT_STEP' && a.detail.includes(stepOne.id)));
    assert.ok(audit.some(a => a.action === 'UPDATE_EXPERIMENT_STEP' && a.detail.includes(stepOne.id) && a.detail.includes('done')));
    assert.ok(audit.some(a => a.action === 'REMOVE_EXPERIMENT_STEP' && a.detail.includes(stepTwo.id)));
    assert.ok(audit.some(a => a.action === 'ADD_EXPERIMENT_ATTACHMENT' && a.detail.includes(attachment.id) && a.detail.includes('rin-results.csv')));
    assert.ok(audit.some(a => a.action === 'REMOVE_EXPERIMENT_ATTACHMENT' && a.detail.includes(removableAttachment.id)));
    assert.ok(audit.some(a => a.action === 'ADD_ENTRY_COMMENT' && a.detail.includes(comment.id)));
    assert.ok(audit.some(a =>
      a.action === 'UPLOAD_EVIDENCE' &&
      a.detail.includes('figure-raw') &&
      a.detail.includes('raw-slide-sketch.png') &&
      a.detail.includes(exp.id)
    ));
    assert.ok(audit.some(a =>
      a.action === 'UPLOAD_EVIDENCE' &&
      a.detail.includes('ocr-clean') &&
      a.detail.includes('processed-notebook-scan.png') &&
      a.detail.includes(exp.id)
    ));
    assert.ok(audit.some(a => a.action === 'ADD_FIGURE_ENTRY'));
    assert.ok(audit.some(a => a.action === 'ADD_OCR_ENTRY' && a.detail.includes(ocrEntry.id)));
    assert.ok(audit.some(a => a.action === 'AI_POLISH_VOICE_DRAFT' && a.detail.includes('numbered_bullets')));
    assert.ok(audit.some(a => a.action === 'AI_POLISH_VOICE_DRAFT' && a.detail.includes('concise_paragraph')));
    assert.ok(audit.some(a => a.action === 'AI_POLISH_VOICE_DRAFT' && a.detail.includes('auto_lab_note')));
    assert.ok(audit.some(a => a.action === 'ADD_VOICE_TRANSCRIPT_SOURCE' && a.detail.includes(rawVoice.id)));
    assert.equal(audit.some(a => a.detail.includes('confidential phrase XYZ-123')), false);
    assert.ok(audit.some(a =>
      a.action === 'DELETE_ENTRY' &&
      a.detail.includes(singleDeleteEntry.id) &&
      a.detail.includes('reason: duplicate note from experiment page') &&
      a.detail.includes(`hash ${singleDeleteEntry.hash}`)
    ));
    assert.ok(audit.some(a =>
      a.action === 'DELETE_EXPERIMENT' &&
      a.detail.includes(deletableExp.id) &&
      a.detail.includes('reason: duplicate calibration run') &&
      a.detail.includes('entries deleted: 1') &&
      a.detail.includes(`entry hashes: ${deletableEntry.hash}`)
    ));
    assert.ok(audit.every(a => a.hash && a.previous_hash != null));

    const search = await scientist.req(base, 'GET', '/api/search?q=formulation clarity');
    assert.ok(search.entries.some(e => e.id === entry.id));
    const tagSearch = await scientist.req(base, 'GET', '/api/search?q=reviewer-ready');
    assert.ok(tagSearch.experiments.some(e => e.id === exp.id));
    const outcomeSearch = await scientist.req(base, 'GET', '/api/search?q=threshold');
    assert.ok(outcomeSearch.experiments.some(e => e.id === exp.id));

    await scientist.req(base, 'POST', '/api/auth/sessions/revoke', {});
    await assert.rejects(() => scientist.req(base, 'GET', '/api/experiments'), /401/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => ai.server.close(resolve));
  }
});

test('backup and restore scripts preserve the data directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-backup-src-'));
  const restore = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-backup-dst-'));
  fs.writeFileSync(path.join(tmp, 'scivox.db'), 'not-a-real-db-for-script-test');
  fs.mkdirSync(path.join(tmp, 'uploads'));
  fs.writeFileSync(path.join(tmp, 'uploads', 'scan.txt'), 'scan');

  const backup = await runNode('scripts/backup.js', { DATA_DIR: tmp });
  const backupLine = backup.split(/\r?\n/).find(line => line.startsWith('Backup written to '));
  const backupPath = backupLine?.replace('Backup written to ', '').trim();
  assert.ok(backupPath, backup);
  assert.ok(fs.existsSync(path.join(backupPath, 'manifest.json')));

  await runNode('scripts/restore.js', { DATA_DIR: restore, BACKUP_PATH: backupPath });
  assert.equal(fs.readFileSync(path.join(restore, 'uploads', 'scan.txt'), 'utf8'), 'scan');
});

test('migration upgrades a pre-project database without crashing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-legacy-db-'));
  const dbPath = path.join(tmp, 'scivox.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user', password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local', provider_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE experiments (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', objective TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'note',
      author TEXT DEFAULT 'Unknown', role TEXT DEFAULT '', text TEXT NOT NULL,
      image_url TEXT, hash TEXT NOT NULL, signed_by TEXT, signed_role TEXT,
      signed_at TEXT, sig TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, experiment_id TEXT, title TEXT NOT NULL,
      hypothesis TEXT DEFAULT '', variables TEXT DEFAULT '[]', steps TEXT DEFAULT '[]',
      materials TEXT DEFAULT '[]', expected_outcome TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE inventory (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '',
      catalog_number TEXT DEFAULT '', lot_number TEXT DEFAULT '', location TEXT DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT '', reorder_level REAL NOT NULL DEFAULT 0,
      expiry_date TEXT, notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE audit (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, user TEXT DEFAULT 'Unknown',
      role TEXT DEFAULT '', action TEXT NOT NULL, detail TEXT DEFAULT ''
    );
  `);
  legacy.close();

  await runNodeEval("import('./src/db.js').then(m => m.migrate())", { DATA_DIR: tmp, DB_PATH: dbPath, NODE_NO_WARNINGS: '1' });

  const upgraded = new DatabaseSync(dbPath);
  const auditCols = upgraded.prepare('PRAGMA table_info(audit)').all().map(c => c.name);
  const expCols = upgraded.prepare('PRAGMA table_info(experiments)').all().map(c => c.name);
  assert.ok(auditCols.includes('project_id'));
  assert.ok(auditCols.includes('hash'));
  assert.ok(expCols.includes('project_id'));
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_templates'").get());
  assert.ok(expCols.includes('hypothesis'));
  assert.ok(expCols.includes('protocol'));
  assert.ok(expCols.includes('materials'));
  assert.ok(expCols.includes('success_criteria'));
  assert.ok(expCols.includes('safety_notes'));
  assert.ok(expCols.includes('tags'));
  assert.ok(expCols.includes('outcome_status'));
  assert.ok(expCols.includes('outcome_summary'));
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entry_comments'").get());
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_links'").get());
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_attachments'").get());
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_steps'").get());
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_project'").get());
  upgraded.close();
});

function jar() {
  let cookie = '';
  return {
    async req(base, method, url, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      const data = text && (res.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : text;
      if (!res.ok) throw new Error(`${res.status} ${typeof data === 'string' ? data : data.error || res.statusText}`);
      return data;
    },
    async raw(base, method, url, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`${res.status} ${buffer.toString('utf8') || res.statusText}`);
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: buffer
      };
    },
    async uploadImage(base, bytes, filename, kind, experimentId = '') {
      const fd = new FormData();
      fd.append('kind', kind);
      if (experimentId) fd.append('experimentId', experimentId);
      fd.append('image', new Blob([bytes], { type: 'image/png' }), filename);
      const res = await fetch(base + '/api/uploads', {
        method: 'POST',
        headers: cookie ? { cookie } : {},
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${data.error || res.statusText}`);
      return data;
    },
    async uploadAttachment(base, bytes, filename, mimeType, experimentId, note = '') {
      const fd = new FormData();
      fd.append('note', note);
      fd.append('file', new Blob([bytes], { type: mimeType }), filename);
      const res = await fetch(base + `/api/experiments/${experimentId}/attachments`, {
        method: 'POST',
        headers: cookie ? { cookie } : {},
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${data.error || res.statusText}`);
      return data;
    }
  };
}

function tinyPng() {
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  ));
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function mockOpenAI() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    const userText = payload.messages?.map(m => m.content).join('\n') || '';
    const content = userText.includes('context-audit')
      ? [
          userText.includes('Hypothesis: Three cycles are tolerated when thaw duration stays below five minutes.') ? 'hypothesis yes' : 'hypothesis no',
          userText.includes('Protocol / method: Run three controlled freeze-thaw cycles, record thaw duration, then measure RIN.') ? 'protocol yes' : 'protocol no',
          userText.includes('Materials / reagents: LNP batch LN-042; PBS pH 7.4; RNase-free tubes; Bioanalyzer chip.') ? 'materials yes' : 'materials no',
          userText.includes('Success criteria: RIN above 8.0 and no visible aggregation.') ? 'success yes' : 'success no',
          userText.includes('Safety notes: Wear cryogenic gloves and keep RNaseZap available.') ? 'safety yes' : 'safety no',
          userText.includes('Outcome: Success') && userText.includes('Outcome note: RIN remained above threshold after three cycles.') ? 'outcome yes' : 'outcome no'
        ].join('\n')
      : userText.includes('template: lab_report')
      ? [
          'Objective',
          '- Record endpoint response for sample D4.',
          '',
          'Method',
          '- Added 20 ul enzyme mix to sample D4.',
          '- Incubated for 30 minutes at 37 C.',
          '',
          'Results / Observations',
          '- Absorbance increased to 0.82.',
          '',
          'Deviations / Uncertainty',
          '- Replicate two was uncertain.'
        ].join('\n')
      : userText.includes('auto_lab_note')
      ? [
          'Summary',
          '- Tube C7 was processed with uncertainty preserved.',
          '',
          'Observations',
          '- No visible contamination was recorded.',
          '',
          'Measurements',
          '- Tube C7 was vortexed for 10 seconds.',
          '',
          'Deviations/Uncertainty',
          '- Yield was unclear.'
        ].join('\n')
      : userText.includes('concise_paragraph')
      ? 'Measured pH 7.4 and stored tube B2 on ice. No additional result was stated.'
      : ['Added 5 mL buffer to sample A1.', 'Incubated at 37 C for 15 minutes.', 'A1 looked cloudy after incubation.'].map((line, i) => `${i + 1}. ${line}`).join('\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function runNode(file, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `exit ${code}`)));
  });
}

function runNodeEval(code, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `exit ${code}`)));
  });
}
