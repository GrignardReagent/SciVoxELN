import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/experiments.js', import.meta.url), 'utf8');
const dashboardSource = fs.readFileSync(new URL('../public/js/views/dashboard.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const ocrSource = fs.readFileSync(new URL('../public/js/ocr.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('experiment exports are tucked into a three-dot menu with pdf html json RO-Crate and ZIP bundle options', () => {
  assert.match(source, /data-export-toggle/);
  assert.match(source, /data-export-menu/);
  assert.match(source, /Export PDF/);
  assert.match(source, /format=pdf/);
  assert.match(source, /Export HTML/);
  assert.match(source, /format=html/);
  assert.match(source, /Export JSON/);
  assert.match(source, /Export RO-Crate/);
  assert.match(source, /format=rocrate/);
  assert.match(source, /Export ZIP bundle/);
  assert.match(source, /format=zip/);
});

test('experiment entries always render delete controls with admin-only disabled affordance', () => {
  assert.match(source, /data-delete-entry/);
  assert.match(source, /disabled[^`]*Admin only|Admin only[^`]*disabled/s);
  assert.doesNotMatch(source, /\$\{canDelete \? `<button class="btn danger sm" data-delete-entry/);
});

test('experiment detail renders an admin-gated delete button wired to a reasoned API call', () => {
  assert.match(source, /data-delete-experiment/);
  assert.match(source, /Locked experiments cannot be deleted/);
  assert.match(source, /Deletion reason required/);
  assert.match(source, /api\.deleteExperiment\(exp\.id,\s*\{\s*reason\s*\}\)/);
});

test('experiments support archive and restore without default list clutter', () => {
  assert.match(source, /data-show-archived-experiments/);
  assert.match(source, /Show archived/);
  assert.match(source, /data-archive-experiment/);
  assert.match(source, /data-restore-experiment/);
  assert.match(source, /Archived — read only/);
  assert.match(source, /Archive experiment/);
  assert.match(source, /Restore experiment/);
  assert.match(source, /api\.experiments\(showArchivedExperiments\)/);
  assert.match(source, /api\.archiveExperiment/);
  assert.match(source, /api\.restoreExperiment/);
  assert.match(styles, /\.archived-badge/);
});

test('experiment setup surfaces structured scientific metadata in create edit and detail views', () => {
  assert.match(source, /Hypothesis/);
  assert.match(source, /Protocol \/ method/);
  assert.match(source, /Materials \/ reagents/);
  assert.match(source, /Success criteria/);
  assert.match(source, /Safety notes/);
  assert.match(source, /id="mHypothesis"/);
  assert.match(source, /id="mProtocol"/);
  assert.match(source, /id="mMaterials"/);
  assert.match(source, /id="mSuccessCriteria"/);
  assert.match(source, /id="mSafetyNotes"/);
  assert.match(source, /hypothesis:\s*m\.querySelector\('#mHypothesis'\)\.value\.trim\(\)/);
  assert.match(source, /protocol:\s*m\.querySelector\('#mProtocol'\)\.value\.trim\(\)/);
  assert.match(source, /materials:\s*m\.querySelector\('#mMaterials'\)\.value\.trim\(\)/);
  assert.match(source, /success_criteria:\s*m\.querySelector\('#mSuccessCriteria'\)\.value\.trim\(\)/);
  assert.match(source, /safety_notes:\s*m\.querySelector\('#mSafetyNotes'\)\.value\.trim\(\)/);
});

test('experiment detail supports compact custom metadata fields', () => {
  assert.match(source, /Custom metadata/);
  assert.match(source, /data-add-metadata/);
  assert.match(source, /metadataFieldsHTML/);
  assert.match(source, /experimentMetadataHTML/);
  assert.match(source, /readMetadataFields/);
  assert.match(source, /metadata:\s*readMetadataFields\(m\)/);
  assert.match(source, /applyMetadataFields\(modalEl,\s*template\.metadata/);
  assert.match(source, /setupSearchText\(e\)[\s\S]*metadataSearchText\(e\.metadata\)/);
  assert.match(styles, /\.metadata-grid/);
});

test('experiment tags are editable searchable and rendered as visible chips', () => {
  assert.match(source, /id="mTags"/);
  assert.match(source, /Tags/);
  assert.match(source, /experimentTagsHTML/);
  assert.match(source, /class="experiment-tags"/);
  assert.match(source, /class="experiment-tag"/);
  assert.match(source, /tags:\s*m\.querySelector\('#mTags'\)\.value\.trim\(\)/);
  assert.match(source, /setupSearchText\(e\)[\s\S]*e\.tags/);
  assert.match(styles, /\.experiment-tags/);
  assert.match(styles, /\.experiment-tag/);
});

test('experiment cards and detail show immutable ELN record identifiers', () => {
  assert.match(source, /ELN ID/);
  assert.match(source, /eln_id/);
  assert.match(source, /data-eln-id/);
  assert.match(source, /experimentRecordIdHTML/);
  assert.match(source, /setupSearchText\(e\)[\s\S]*e\.eln_id/);
  assert.match(styles, /\.record-id/);
});

test('experiment detail supports related experiment links', () => {
  assert.match(source, /Related experiments/);
  assert.match(source, /mountExperimentLinks/);
  assert.match(source, /data-add-experiment-link/);
  assert.match(source, /data-open-experiment-link/);
  assert.match(source, /data-delete-experiment-link/);
  assert.match(source, /api\.experimentLinks/);
  assert.match(source, /api\.addExperimentLink/);
  assert.match(source, /api\.deleteExperimentLink/);
  assert.match(source, /Link experiment/);
  assert.match(styles, /\.experiment-link/);
});

test('experiment detail supports audited file attachments', () => {
  assert.match(source, /Attachments/);
  assert.match(source, /mountExperimentAttachments/);
  assert.match(source, /data-add-attachment/);
  assert.match(source, /data-delete-attachment/);
  assert.match(source, /api\.experimentAttachments/);
  assert.match(source, /api\.uploadExperimentAttachment/);
  assert.match(source, /api\.deleteExperimentAttachment/);
  assert.match(source, /Attach file/);
  assert.match(styles, /\.attachment-item/);
});

test('experiment detail supports a procedure step checklist', () => {
  assert.match(source, /Procedure steps/);
  assert.match(source, /mountExperimentSteps/);
  assert.match(source, /data-add-experiment-step/);
  assert.match(source, /data-toggle-experiment-step/);
  assert.match(source, /data-delete-experiment-step/);
  assert.match(source, /api\.experimentSteps/);
  assert.match(source, /api\.addExperimentStep/);
  assert.match(source, /api\.updateExperimentStep/);
  assert.match(source, /api\.deleteExperimentStep/);
  assert.match(source, /Next step/);
  assert.match(styles, /\.experiment-step/);
});

test('experiment indexes surface the next open procedure step without opening each record', () => {
  assert.match(source, /experimentNextStepHTML/);
  assert.match(source, /data-next-experiment-step/);
  assert.match(source, /e\.next_step/);
  assert.match(source, /openStepCount/);
  assert.match(source, /completedStepCount/);
  assert.match(dashboardSource, /experimentNextStepSummary/);
  assert.match(dashboardSource, /Next step/);
  assert.match(dashboardSource, /e\.next_step/);
  assert.match(styles, /\.next-step-preview/);
});

test('dashboard has a compact open procedure steps to-do list', () => {
  assert.match(dashboardSource, /openProcedureStepItems/);
  assert.match(dashboardSource, /Open procedure steps/);
  assert.match(dashboardSource, /data-next-action-exp/);
  assert.match(dashboardSource, /nextActionRows/);
  assert.match(dashboardSource, /ctx\.go\('experiments',\s*\{\s*id:\s*el\.dataset\.nextActionExp\s*\}\)/);
  assert.match(styles, /\.next-action-list/);
  assert.match(styles, /\.next-action-item/);
});

test('experiment outcome status is editable searchable and visible as a lab result badge', () => {
  assert.match(source, /Experiment outcome/);
  assert.match(source, /id="mOutcomeStatus"/);
  assert.match(source, /id="mOutcomeSummary"/);
  assert.match(source, /outcomeStatusLabel/);
  assert.match(source, /outcomeStatusHTML/);
  assert.match(source, /outcome_status:\s*m\.querySelector\('#mOutcomeStatus'\)\.value/);
  assert.match(source, /outcome_summary:\s*m\.querySelector\('#mOutcomeSummary'\)\.value\.trim\(\)/);
  assert.match(source, /setupSearchText\(e\)[\s\S]*e\.outcome_status[\s\S]*e\.outcome_summary/);
  assert.match(styles, /\.outcome-badge/);
  assert.match(styles, /\.outcome-panel/);
});

test('experiment creation can start from reusable project templates', () => {
  assert.match(source, /id="mTemplate"/);
  assert.match(source, /api\.experimentTemplates/);
  assert.match(source, /applyExperimentTemplate/);
  assert.match(source, /template_id:\s*selectedTemplateId/);
  assert.match(source, /Use template/);
});

test('experiment detail can save setup as a reusable template', () => {
  assert.match(source, /data-save-template/);
  assert.match(source, /Save as template/);
  assert.match(source, /api\.saveExperimentTemplate/);
  assert.match(source, /CREATE_EXPERIMENT_TEMPLATE|Experiment template/);
});

test('experiment detail can repeat an existing setup without copying observations', () => {
  assert.match(source, /data-duplicate-experiment/);
  assert.match(source, /Repeat setup/);
  assert.match(source, /duplicateExperimentModal/);
  assert.match(source, /api\.duplicateExperiment/);
  assert.match(source, /same setup, tags, and procedure steps/);
});

test('experiment entries expose audited collaboration comments', () => {
  assert.match(source, /entryCommentsHTML/);
  assert.match(source, /data-comment-entry/);
  assert.match(source, /api\.commentEntry/);
  assert.match(source, /Add comment/);
  assert.match(source, /Comment on entry/);
  assert.match(styles, /\.entry-comments/);
});

test('experiment entries expose revision history for edited records', () => {
  assert.match(source, /data-entry-revisions/);
  assert.match(source, /View revisions/);
  assert.match(source, /openEntryRevisionsModal/);
  assert.match(source, /entryRevisionsHTML/);
  assert.match(source, /api\.entryRevisions/);
  assert.match(source, /revision_count/);
  assert.match(source, /Previous text/);
  assert.match(styles, /\.entry-revisions/);
});

test('experiment AI assistant exposes scientist-ready quick prompt actions', () => {
  assert.match(source, /id="aiPromptBar"/);
  assert.match(source, /data-ai-prompt/);
  assert.match(source, /Summarize record/);
  assert.match(source, /Check missing setup/);
  assert.match(source, /Troubleshoot/);
  assert.match(source, /Next steps/);
  assert.match(source, /assistantPrompts/);
  assert.match(source, /missing setup metadata/);
  assert.match(source, /protocol, materials, success criteria, safety notes/);
  assert.match(source, /promptBar\.querySelectorAll\('\[data-ai-prompt\]'\)/);
});

test('experiment detail can summarise notebook entries into a source-linked generated entry', () => {
  assert.match(source, /data-summarise-experiment/);
  assert.match(source, /Summarise entries/);
  assert.match(source, /summariseExperimentEntries/);
  assert.match(source, /showExperimentSummaryModal/);
  assert.match(source, /api\.processEntries\(entryIds,\s*'summary'\)/);
  assert.match(source, /sourceEntryIds:\s*entryIds/);
});

test('experiment detail can suggest source-backed procedure steps from notebook entries', () => {
  assert.match(source, /data-suggest-experiment-steps/);
  assert.match(source, /Suggest steps/);
  assert.match(source, /suggestExperimentSteps/);
  assert.match(source, /showSuggestedStepsModal/);
  assert.match(source, /parseSuggestedSteps/);
  assert.match(source, /data-save-suggested-steps/);
  assert.match(source, /api\.processEntries\(entryIds,\s*'action_plan'\)/);
  assert.match(source, /api\.addExperimentStep\(e\.id,\s*\{\s*text:\s*step\s*\}\)/);
  assert.match(styles, /\.suggested-steps/);
});

test('experiment detail groups AI integrity and references into one sidebar column', () => {
  assert.match(source, /class="experiment-side"/);
  assert.match(source, /class="card ai-card"/);
  assert.match(source, /<h2 class="sec-t">Integrity<\/h2>/);
  assert.match(source, /📚 References/);
  assert.match(styles, /\.experiment-side\{display:grid;gap:16px;align-content:start\}/);
  assert.match(styles, /\.split>\*\{min-width:0\}/);
});

test('main app shell suppresses page-level horizontal overflow on mobile', () => {
  assert.match(styles, /\.main\{min-width:0;overflow-y:auto;overflow-x:hidden\}/);
  assert.match(styles, /\.hashline\{[^}]*overflow-wrap:anywhere/);
});

test('top header wraps long experiment titles on mobile', () => {
  assert.match(index, /class="top-title"/);
  assert.match(styles, /\.top-title\{[^}]*min-width:0[^}]*flex:0 1 auto/);
  assert.match(styles, /\.top h1\{[^}]*overflow-wrap:break-word/);
  assert.match(styles, /\.top \.sub\{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.search\{[^}]*flex:0 1 30vw/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.search input\{[^}]*min-width:0/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.top-title\{[^}]*flex:1 1 auto/);
});

test('experiment detail hides write and review controls by project capability', () => {
  assert.match(source, /experimentAccess\(e\)/);
  assert.match(source, /access\.can_write/);
  assert.match(source, /access\.can_review/);
  assert.match(source, /access\.can_admin_delete/);
  assert.match(source, /viewAccess\s*=\s*\{\s*\.\.\.access,\s*can_write:\s*canWrite,\s*can_review:\s*canReview\s*\}/);
  assert.match(source, /Read-only project role/);
  assert.match(source, /data-new-disabled/);
  assert.match(source, /canCreateExperiment/);
  assert.match(source, /canWrite\s*&&\s*!locked/);
  assert.match(source, /canReview\s*&&\s*!locked/);
  assert.match(source, /mountReferences\(root,\s*e,\s*viewAccess\)/);
  assert.match(source, /mountAssistant\(root,\s*e,\s*viewAccess\)/);
  assert.match(source, /entryHTML\(en,\s*locked\s*\|\|\s*archived,\s*viewAccess\)/);
});

test('entry signing modal limits reviewer meanings to reviewer-capable users', () => {
  assert.match(source, /wireSignButtons\(root,\s*ctx,\s*e\.id,\s*viewAccess\)/);
  assert.match(source, /signatureMeaningOptions/);
  assert.match(source, /access\.can_review/);
  assert.match(source, /Reviewer access required/);
  assert.match(source, /approval/);
});

test('voice composer uses quiet capture and review-state enhancement controls', () => {
  assert.match(source, /id="voiceManualNotes"/);
  assert.match(source, /id="voiceTranscript"/);
  assert.match(source, /id="voicePolished"/);
  assert.match(source, /id="voiceCaptureWrap"/);
  assert.match(source, /id="voiceReviewWrap"/);
  assert.match(source, /id="voiceTemplate"/);
  assert.match(source, /data-voice-source/);
  assert.match(source, /id="voiceDraftReport"/);
  assert.match(source, /id="voiceCleanNote"/);
  assert.match(source, /Draft report/);
  assert.match(source, /Clean up/);
  assert.match(source, /value="lab_report"/);
  assert.match(source, /value="clean_voice_note"/);
  assert.match(source, /Lab report/);
  assert.match(source, /Clean note/);
  assert.match(source, /Auto lab note/);
  assert.match(source, /Numbered observations/);
  assert.match(source, /Concise paragraph/);
  assert.doesNotMatch(source, /data-voice-style=/);
  assert.match(source, /api\.processVoiceDraft/);
  assert.match(source, /type:\s*'voice_transcript'/);
  assert.match(source, /sourceEntryIds:\s*\[rawEntry\.id\]/);
  assert.match(source, /voiceTemplate\s*=\s*'lab_report'/);
  assert.match(source, /voiceTemplate\s*=\s*'clean_voice_note'/);
  assert.match(source, /voiceTranscript\.trim\(\)\s*\|\|\s*text\.value\.trim\(\)/);
  assert.doesNotMatch(source, /voiceDraftReportBtn\.disabled\s*=\s*!aiConfigured/);
  assert.match(source, /voiceCleanNoteBtn\.disabled\s*=\s*!hasSource/);
  assert.match(source, /Local draft/);
});

test('voice composer can switch to server transcription even when live speech is supported', () => {
  assert.match(source, /id="voiceModeSelect"/);
  assert.match(source, /server_transcription/);
  assert.match(source, /chooseVoiceMode/);
  assert.match(source, /wireSelectedVoiceMode/);
  assert.match(source, /Use server transcription/);
  assert.match(source, /No speech detected[\s\S]*server transcription/);
  assert.match(source, /voiceModeSelect\.onchange/);
  assert.match(source, /useRecorder/);
  assert.match(source, /useLiveSpeech/);
});

test('voice composer can check draft completeness before saving', () => {
  assert.match(apiSource, /checkEntryDraft/);
  assert.match(source, /id="entryDraftCheck"/);
  assert.match(source, /Check draft/);
  assert.match(source, /checkEntryDraft\(\)/);
  assert.match(source, /api\.checkEntryDraft\(expId,\s*currentSaveText\(\)\)/);
  assert.match(source, /showEntryDraftCheckModal/);
  assert.match(source, /data-entry-draft-finding/);
  assert.match(source, /entry-draft-check/);
  assert.match(styles, /\.entry-draft-check/);
});

test('voice composer can transcribe an uploaded real audio file through server STT', () => {
  assert.match(source, /id="voiceAudioFile"/);
  assert.match(source, /accept="audio\/\*"/);
  assert.match(source, /id="voiceUploadAudio"/);
  assert.match(source, /Upload audio/);
  assert.match(source, /processServerAudio/);
  assert.match(source, /voiceAudioFile\.onchange/);
  assert.match(source, /api\.transcribe\(file/);
  assert.match(source, /setVoiceTranscript\(\[voiceTranscript,\s*tx \|\| ''\]/);
  assert.match(source, /afterVoiceStop\(\)/);
  assert.match(source, /Transcribed uploaded audio/);
  assert.match(source, /Transcribed — draft failed/);
  assert.match(source, /voiceBusy/);
  assert.match(source, /const hasText = !!currentSaveText\(\)\.trim\(\)/);
  assert.match(source, /saveBtn\.disabled = voiceBusy \|\| !hasText/);
  assert.match(source, /checkDraftBtn\.disabled = voiceBusy \|\| !hasText/);
});

test('source transcript links fetch hidden source entries into a modal', () => {
  assert.match(source, /openSourceEntryModal/);
  assert.match(source, /api\.entry\(btn\.dataset\.sourceEntry\)/);
  assert.match(source, /Source transcript/);
});

test('ocr capture exposes a correction review panel and saves raw OCR text as source evidence', () => {
  assert.match(source, /id="ocrReviewWrap"/);
  assert.match(source, /id="ocrCorrectedText"/);
  assert.match(source, /id="ocrRawText"/);
  assert.match(source, /Raw OCR output/);
  assert.match(source, /rawOcrText/);
  assert.match(source, /correctedOcrText/);
  assert.match(source, /buildOcrSourceText/);
  assert.match(source, /type:\s*'ocr_raw_text'/);
  assert.match(source, /sourceEntryIds:\s*\[rawEntry\.id\]/);
});

test('ocr entries preserve and render original plus processed evidence images', () => {
  assert.match(ocrSource, /processedDataUrl/);
  assert.match(ocrSource, /text:\s*cleanOCRText/);
  assert.match(ocrSource, /dataURLtoBlob/);
  assert.match(source, /rawOcrUrl/);
  assert.match(source, /cleanOcrUrl/);
  assert.match(source, /ocr-raw/);
  assert.match(source, /ocr-clean/);
  assert.match(source, /rawImageUrl:\s*rawOcrUrl/);
  assert.match(source, /cleanImageUrl:\s*cleanOcrUrl/);
  assert.match(source, /class="ocr-evidence"/);
  assert.match(source, /Original scan/);
  assert.match(source, /Processed for OCR/);
});
