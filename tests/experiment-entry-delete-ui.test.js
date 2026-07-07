import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/experiments.js', import.meta.url), 'utf8');
const ocrSource = fs.readFileSync(new URL('../public/js/ocr.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('experiment exports are tucked into a three-dot menu with pdf html and json options', () => {
  assert.match(source, /data-export-toggle/);
  assert.match(source, /data-export-menu/);
  assert.match(source, /Export PDF/);
  assert.match(source, /format=pdf/);
  assert.match(source, /Export HTML/);
  assert.match(source, /format=html/);
  assert.match(source, /Export JSON/);
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

test('experiment detail hides write and review controls by project capability', () => {
  assert.match(source, /experimentAccess\(e\)/);
  assert.match(source, /access\.can_write/);
  assert.match(source, /access\.can_review/);
  assert.match(source, /access\.can_admin_delete/);
  assert.match(source, /Read-only project role/);
  assert.match(source, /data-new-disabled/);
  assert.match(source, /canCreateExperiment/);
  assert.match(source, /canWrite\s*&&\s*!locked/);
  assert.match(source, /canReview\s*&&\s*!locked/);
  assert.match(source, /mountReferences\(root,\s*e,\s*access\)/);
  assert.match(source, /mountAssistant\(root,\s*e,\s*access\)/);
  assert.match(source, /entryHTML\(en,\s*locked,\s*access\)/);
});

test('entry signing modal limits reviewer meanings to reviewer-capable users', () => {
  assert.match(source, /wireSignButtons\(root,\s*ctx,\s*e\.id,\s*access\)/);
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
  assert.match(source, /Draft report/);
  assert.match(source, /value="lab_report"/);
  assert.match(source, /Lab report/);
  assert.match(source, /Auto lab note/);
  assert.match(source, /Numbered observations/);
  assert.match(source, /Concise paragraph/);
  assert.doesNotMatch(source, /data-voice-style=/);
  assert.match(source, /api\.processVoiceDraft/);
  assert.match(source, /type:\s*'voice_transcript'/);
  assert.match(source, /sourceEntryIds:\s*\[rawEntry\.id\]/);
  assert.match(source, /voiceTemplate\s*=\s*'lab_report'/);
  assert.match(source, /voiceTranscript\.trim\(\)\s*\|\|\s*text\.value\.trim\(\)/);
  assert.doesNotMatch(source, /voiceDraftReportBtn\.disabled\s*=\s*!aiConfigured/);
  assert.match(source, /Local draft/);
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
