/** OCR of handwritten/printed notes via Tesseract.js (runs entirely in-browser),
 *  plus laptop/phone camera capture helpers. */

export async function runOCR(imageSource, onProgress) {
  if (!window.Tesseract) throw new Error('OCR engine still loading — try again in a moment');
  if (onProgress) onProgress(1, 'preprocessing image');
  const processedDataUrl = await preprocessForOCR(imageSource);
  const candidates = [
    await recognizeOCRCandidate(processedDataUrl, 'processed', onProgress, 2, 48),
    await recognizeOCRCandidate(imageSource, 'original', onProgress, 52, 48)
  ];
  const best = chooseOCRCandidate(candidates);
  return {
    text: best.text,
    processedDataUrl,
    confidence: best.confidence,
    qualityScore: best.qualityScore,
    variant: best.variant,
    needsReview: ocrNeedsReview(best),
    candidates: candidates.map(c => ({
      variant: c.variant,
      confidence: c.confidence,
      qualityScore: c.qualityScore,
      length: c.text.length
    }))
  };
}

async function recognizeOCRCandidate(imageSource, variant, onProgress, offset, span) {
  const res = await window.Tesseract.recognize(imageSource, 'eng', {
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.min(99, Math.round(offset + m.progress * span)));
      }
    }
  });
  const candidate = {
    variant,
    text: cleanOCRText(res.data.text || ''),
    confidence: Math.round(Number(res.data.confidence || 0))
  };
  candidate.qualityScore = scoreOCRCandidate(candidate);
  return candidate;
}

export function chooseOCRCandidate(candidates) {
  return (candidates || [])
    .map(candidate => ({ ...candidate, qualityScore: scoreOCRCandidate(candidate) }))
    .sort((a, b) => b.qualityScore - a.qualityScore)[0] || {
      variant: 'none',
      text: '',
      confidence: 0,
      qualityScore: -1000
    };
}

export function ocrNeedsReview(candidate) {
  if (!candidate?.text?.trim()) return true;
  return Number(candidate.confidence || 0) < 55 || scoreOCRCandidate(candidate) < 55;
}

export function scoreOCRCandidate(candidate) {
  const text = cleanOCRText(candidate?.text || '');
  const compact = text.replace(/\s/g, '');
  if (!compact) return -1000;
  const confidence = Math.max(0, Math.min(100, Number(candidate?.confidence || 0)));
  const words = text.match(/[A-Za-z][A-Za-z0-9µ.-]{2,}/g) || [];
  const lowercaseWords = words.filter(w => /[a-z]/.test(w)).length;
  const uppercaseRuns = words.filter(w => /^[A-Z]{3,}$/.test(w)).length;
  const labTerms = (text.match(/\b(sample|vial|tube|buffer|incubat\w*|wash\w*|weigh\w*|spread|compress\w*|trough|acid|water|hour|minute|ph|ml|ul|µl)\b/gi) || []).length;
  const alnum = (compact.match(/[A-Za-z0-9]/g) || []).length;
  const alnumRatio = alnum / compact.length;
  const noiseLines = text.split(/\n/).filter(isNoiseLine).length;
  return Math.round(
    confidence +
    Math.min(25, lowercaseWords * 2) +
    Math.min(20, labTerms * 5) +
    Math.min(10, alnumRatio * 10) -
    uppercaseRuns * 4 -
    noiseLines * 8
  );
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export const cameraSupported = !!(globalThis.navigator?.mediaDevices && navigator.mediaDevices.getUserMedia);

/** Start the camera into a <video>. facingMode 'environment' = rear (phones). */
export async function startCamera(videoEl, facingMode = 'environment') {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facingMode } }, audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

/** Grab the current video frame as { dataURL, blob }. */
export function captureFrame(videoEl) {
  const w = videoEl.videoWidth || 1280, h = videoEl.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  const dataURL = canvas.toDataURL('image/jpeg', 0.9);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve({ dataURL, blob: blob || dataURLtoBlob(dataURL) }), 'image/jpeg', 0.9);
  });
}

export function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function preprocessForOCR(imageSource) {
  const img = await loadImage(imageSource);
  const maxSide = 2200;
  const minSide = 1200;
  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const upscale = longest < minSide ? minSide / longest : 1;
  const downscale = longest > maxSide ? maxSide / longest : 1;
  const scale = Math.min(2, upscale * downscale);
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const image = ctx.getImageData(0, 0, w, h);
  const gray = normalizedGrayscale(image.data);
  const bin = adaptiveThreshold(gray, w, h);
  for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
    image.data[p] = image.data[p + 1] = image.data[p + 2] = bin[i];
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for OCR'));
    img.src = src;
  });
}

function normalizedGrayscale(rgba) {
  const values = new Uint8Array(rgba.length / 4);
  const hist = new Uint32Array(256);
  for (let p = 0, i = 0; p < rgba.length; p += 4, i++) {
    const g = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    values[i] = g;
    hist[g]++;
  }
  const low = percentile(hist, values.length, 0.02);
  const high = Math.max(low + 12, percentile(hist, values.length, 0.98));
  for (let i = 0; i < values.length; i++) {
    values[i] = Math.max(0, Math.min(255, Math.round((values[i] - low) * 255 / (high - low))));
  }
  return values;
}

function percentile(hist, total, p) {
  const target = total * p;
  let sum = 0;
  for (let i = 0; i < hist.length; i++) {
    sum += hist[i];
    if (sum >= target) return i;
  }
  return 255;
}

function adaptiveThreshold(gray, w, h) {
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const out = new Uint8Array(gray.length);
  const radius = Math.max(12, Math.round(Math.min(w, h) / 48));
  const bias = 13;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = rectSum(integral, w + 1, x0, y0, x1 + 1, y1 + 1);
      out[y * w + x] = gray[y * w + x] < (sum / area - bias) ? 0 : 255;
    }
  }
  return out;
}

function rectSum(integral, stride, x0, y0, x1, y1) {
  return integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
}

function cleanOCRText(text) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(line => line && !isNoiseLine(line))
    .join('\n')
    .trim();
}

function isNoiseLine(line) {
  const compact = line.replace(/\s/g, '');
  if (!compact) return true;
  if (compact.length <= 2) return false;
  const alnum = (compact.match(/[A-Za-z0-9]/g) || []).length;
  if (compact.length >= 5 && alnum / compact.length < 0.3) return true;
  if (/^(.)\1{4,}$/.test(compact)) return true;
  return false;
}
