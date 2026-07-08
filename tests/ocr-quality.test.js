import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { chooseOCRCandidate, ocrNeedsReview } from '../public/js/ocr.js';

const experimentsSource = fs.readFileSync(new URL('../public/js/views/experiments.js', import.meta.url), 'utf8');

test('ocr candidate scoring prefers the readable original scan over threshold noise', () => {
  const processedNoise = {
    variant: 'processed',
    confidence: 25,
    text: 'EEE EERE PODER R EEE NY o JP\nPRB SEE SEER YALE RE\nRR CE SEE 3'
  };
  const originalScan = {
    variant: 'original',
    confidence: 45,
    text: 'Dated v this is. Go Vial subilies from a while ago. Spread 50 ul safranin. Repeasd saps 1-3.'
  };

  const best = chooseOCRCandidate([processedNoise, originalScan]);

  assert.equal(best.variant, 'original');
  assert.equal(ocrNeedsReview(best), true);
});

test('ocr review recalculates auto-growing textareas after programmatic OCR fill', () => {
  assert.match(experimentsSource, /autoGrowTextareas/);
  assert.match(experimentsSource, /ocrCorrectedEl\.value = extracted[\s\S]*autoGrowTextareas/);
  assert.match(experimentsSource, /ocrRawEl\.value = extracted \|\| '\(no text detected\)'[\s\S]*autoGrowTextareas/);
  assert.match(experimentsSource, /confidence/);
  assert.match(experimentsSource, /Needs careful review|Low-confidence OCR/);
});
